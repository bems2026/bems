import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/config/supabase';
import {
  getDevicePeriodReports,
  getReportPeriods,
  type PeriodBuildingReport,
  type PeriodDeviceReport,
  type ReportPeriod,
} from '@/lib/supabaseReports';
import {
  getDailySeries,
  getDemandCurve,
  getDemandSummary,
  getHourMatrix,
  getHourEnergy,
  getHourProfile,
  type CurveRow,
  type DailyRow,
  type DemandSummary,
  type HourEnergyRow,
  type HourRow,
  type MatrixRow,
} from '@/lib/reportSeries';
import { getEmissionFactors, getTariffs, type FactorEntry, type TariffEntry } from '@/lib/supabaseTariffs';
import { fetchScheduleContext } from '@/lib/supabaseConfig';
import { getCircuitTrend, getDeviceDailyEnergy, type CircuitTrend, type DeviceDaily } from '@/lib/circuitSeries';
import { buildingMeters, measuredDeviceIds } from '@/lib/circuitBreakdown';
import { createReportCache, retryTransient, withTimeout, type ReportCache, type RetryOptions } from '@/lib/reportLoader';

/**
 * Everything the Reports page reads, as independent sections — RM-081, split further by RM-081b.
 *
 * WHY SECTIONS. The page used to fetch the charts' series, the tariffs, the emission factors and
 * the demand ceiling in one `Promise.all`, and kept one error string that nothing ever cleared. A
 * failed tariff read therefore hid five charts that had loaded; a hung heatmap query left a page
 * with nothing on it and nothing saying why; and a month that failed once followed the reader to
 * every other month until somebody reloaded a kiosk nobody was standing at.
 *
 * WHY EACH CHART'S SERIES IS ITS OWN SECTION. RM-081 grouped the hour profile, the heatmap and the
 * duration curve as one "detail" section. Signed in on live data, `report_demand_curve` hit the
 * database's statement timeout on every attempt (RM-086) — and the two charts that had loaded
 * disappeared with it, and the PDF, which waited on all three, could not be made. A section is the
 * unit that fails together, so it must be no bigger than one thing that can fail:
 *
 *   periods  the stored reports of this kind            → the picker
 *   devices  per-device rows for the selected period    → the device table, circuits, CSV
 *   core     daily series + demand summary              → headline figures, coverage, daily chart
 *   hours    hour-of-day profile                        → the load profile chart
 *   matrix   day × hour matrix                          → the heatmap
 *   curve    duration curve                             → the load duration chart
 *   pricing  tariffs + emission factors                 → cost and emissions only
 *   ceiling  the DSM ceiling                            → the line across the duration curve
 *   deviceDaily  each measured device's energy per day  → the Circuits tab's daily chart, the daily CSV
 *   trend        each branch meter's power per hour     → the Circuits tab's power chart
 *
 * THE LAST TWO LOAD ONLY WHEN ASKED — RM-094. They are the Circuits tab's and the exports', and the
 * page's rule is that nothing fetches for a panel nobody opened; `want` says who is looking.
 *
 * DERIVED BY KEY, NEVER CLEARED IN AN EFFECT — the same rule `ReportsPage` has held since c5d4e18.
 * Every outcome is tagged with the request it answers, and a section whose tag does not match the
 * current key simply is not ready. That is what keeps a month's rows from ever rendering under a
 * week that shares its first day, without a synchronous setState in any effect body.
 *
 * THE CACHE IS PER MOUNT, not module scope: a module-level cache would carry one test's fixtures
 * into the next and one signed-in session's answers into another's. Within a visit, stepping back
 * to a period already read answers at once.
 */

export type SectionName = 'periods' | 'devices' | 'core' | 'hours' | 'hourEnergy' | 'matrix' | 'curve' | 'pricing' | 'ceiling' | 'deviceDaily' | 'trend';
export type SectionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Section<T> {
  /** `idle` means there is nothing to load — no period selected — which is not the same as loading. */
  status: SectionStatus;
  data: T | null;
  error: string | null;
  /** Drops this section's cached answer and asks again. */
  retry: () => void;
}

export interface CoreData {
  daily: DailyRow[];
  summary: DemandSummary | null;
}

export interface PricingData {
  tariffs: TariffEntry[];
  factors: FactorEntry[];
}

export interface ReportData {
  periods: Section<PeriodBuildingReport[]>;
  /** The period being read: the reader's choice when it is a report that exists, else the newest. */
  selected: string | null;
  select: (start: string) => void;
  devices: Section<PeriodDeviceReport[]>;
  core: Section<CoreData>;
  hours: Section<HourRow[]>;
  /** RM-124: a day's hourly credits per device. Idle for a week or a month. */
  hourEnergy: Section<HourEnergyRow[]>;
  matrix: Section<MatrixRow[]>;
  curve: Section<CurveRow[]>;
  pricing: Section<PricingData>;
  ceiling: Section<number | null>;
  deviceDaily: Section<DeviceDaily>;
  trend: Section<CircuitTrend>;
}

/** Which of the on-demand sections a caller is showing — RM-094. */
export interface ReportWants {
  circuits?: boolean;
}

export interface ReportDataOptions {
  timeouts?: Partial<Record<SectionName, number>>;
  retry?: RetryOptions;
}

/** How long each section may take. The matrix and the curve get the longest; a month of either is
 *  the heaviest read the page makes. The database's own statement timeout may cut them sooner, and
 *  that failure is reported in its own words. */
export const DEFAULT_TIMEOUTS: Record<SectionName, number> = {
  periods: 20_000,
  devices: 20_000,
  core: 30_000,
  hours: 30_000,
  hourEnergy: 30_000,
  matrix: 45_000,
  curve: 45_000,
  pricing: 20_000,
  ceiling: 20_000,
  deviceDaily: 30_000,
  trend: 45_000,
};

/** What each section is, in the words a timeout message uses. */
const LABELS: Record<SectionName, string> = {
  periods: 'The list of reports',
  devices: 'The per-device figures',
  core: 'The daily figures',
  hours: 'The typical day chart',
  hourEnergy: 'The hour by hour chart',
  matrix: 'The busy hours chart',
  curve: 'The demand levels chart',
  pricing: 'The tariffs and emission factors',
  ceiling: 'The max total draw',
  deviceDaily: 'The daily figures per circuit',
  trend: 'The power per circuit',
};

/**
 * The DSM ceiling in watts, read from the same key the Automation page writes, so the duration
 * curve cannot disagree with the page that sets it. Unset, zero, negative or unreadable is "no
 * ceiling" — never a ceiling of zero, which would draw the whole curve as a breach.
 */
export function ceilingWatts(ctx: Record<string, unknown>): number | null {
  const raw = ctx['global.dsm.max_total_kw'];
  if (raw === null || raw === undefined || raw === '') return null;
  const kw = Number(raw);
  return Number.isFinite(kw) && kw > 0 ? kw * 1000 : null;
}

type Outcome<T> = { id: string; ok: true; data: T } | { id: string; ok: false; error: string };

interface Resolved {
  timeouts: Record<SectionName, number>;
  retry: RetryOptions;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

function useSection<T>(
  name: SectionName,
  key: string | null,
  loader: (signal: AbortSignal) => Promise<T>,
  cache: ReportCache<unknown>,
  opts: Resolved
): Section<T> {
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<Outcome<T> | null>(null);
  const ms = opts.timeouts[name];
  const retryOptions = opts.retry;

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const id = `${key}#${attempt}`;
    cache
      .get(key, () => retryTransient(() => withTimeout(loader, ms, LABELS[name]), retryOptions))
      .then(
        (data) => {
          if (!cancelled) setOutcome({ id, ok: true, data: data as T });
        },
        (err: unknown) => {
          if (!cancelled) setOutcome({ id, ok: false, error: messageOf(err) });
        }
      );
    return () => {
      cancelled = true;
    };
  }, [name, key, attempt, loader, cache, ms, retryOptions]);

  const retry = useCallback(() => {
    if (key !== null) cache.invalidate(key);
    setAttempt((n) => n + 1);
  }, [key, cache]);

  if (key === null) return { status: 'idle', data: null, error: null, retry };
  if (outcome !== null && outcome.id === `${key}#${attempt}`) {
    return outcome.ok
      ? { status: 'ready', data: outcome.data, error: null, retry }
      : { status: 'error', data: null, error: outcome.error, retry };
  }
  // A period already read in this visit answers from memory, with no loading state in between.
  const cached = cache.peek(key);
  if (cached !== undefined) return { status: 'ready', data: cached as T, error: null, retry };
  return { status: 'loading', data: null, error: null, retry };
}

const startOf = (row: PeriodBuildingReport) => row.period_start.slice(0, 10);

export function useReportData(period: ReportPeriod, options?: ReportDataOptions, want: ReportWants = {}): ReportData {
  // Read once. Callers pass object literals, and a new object each render must not refetch.
  const [opts] = useState<Resolved>(() => ({
    timeouts: { ...DEFAULT_TIMEOUTS, ...options?.timeouts },
    retry: options?.retry ?? {},
  }));
  const [cache] = useState(() => createReportCache<unknown>({ max: 60 }));
  const enabled = supabase !== null;

  const loadPeriods = useCallback((signal: AbortSignal) => getReportPeriods(period, { signal }), [period]);
  const periods = useSection('periods', enabled ? `periods:${period}` : null, loadPeriods, cache, opts);

  /**
   * The reader's choice, tagged with the period kind it was made under. Changing kind therefore
   * lands on that kind's newest report rather than asking for a month's date as a week — which
   * would match nothing and render an empty report that looks like a week with no consumption.
   */
  const [choice, setChoice] = useState<{ period: ReportPeriod; start: string } | null>(null);
  const list = periods.data;
  const selected =
    list === null
      ? null
      : choice !== null && choice.period === period && list.some((row) => startOf(row) === choice.start)
        ? choice.start
        : list[0]
          ? startOf(list[0])
          : null;
  const select = useCallback((start: string) => setChoice({ period, start }), [period]);

  const at = (section: string) => (selected === null ? null : `${section}:${period}:${selected}`);

  const loadDevices = useCallback(
    (signal: AbortSignal) => getDevicePeriodReports(period, requireStart(selected), { signal }),
    [period, selected]
  );
  const loadCore = useCallback(
    async (signal: AbortSignal): Promise<CoreData> => {
      const start = requireStart(selected);
      const [daily, summary] = await Promise.all([
        getDailySeries(period, start, { signal }),
        getDemandSummary(period, start, { signal }),
      ]);
      return { daily, summary };
    },
    [period, selected]
  );
  const loadHours = useCallback((signal: AbortSignal) => getHourProfile(period, requireStart(selected), { signal }), [period, selected]);
  // RM-124: a day's hourly credits, for every measured device at once — one call serves the
  // Overview (summed over the building meters) and the Circuits tab (one device each). Only a
  // day asks for them: a week's would be 24 × 7 × 12 rows, and the week has its own charts.
  const loadHourEnergy = useCallback(
    (signal: AbortSignal) => getHourEnergy(period, requireStart(selected), measuredDeviceIds(), { signal }),
    [period, selected]
  );
  const loadMatrix = useCallback((signal: AbortSignal) => getHourMatrix(period, requireStart(selected), { signal }), [period, selected]);
  const loadCurve = useCallback((signal: AbortSignal) => getDemandCurve(period, requireStart(selected), { signal }), [period, selected]);
  // Priced per day at the rate in force that day, so these are not per-period: one read per visit.
  const loadPricing = useCallback(async (signal: AbortSignal): Promise<PricingData> => {
    const [tariffs, factors] = await Promise.all([getTariffs({ signal }), getEmissionFactors({ signal })]);
    return { tariffs, factors };
  }, []);
  const loadCeiling = useCallback(
    (signal: AbortSignal) => fetchScheduleContext({ signal }).then((ctx) => ceilingWatts(ctx)),
    []
  );
  // Every device that measures power, read once per period and narrowed in the browser, so changing the
  // scope never asks the database again.
  const loadDeviceDaily = useCallback(
    (signal: AbortSignal) => getDeviceDailyEnergy(period, requireStart(selected), measuredDeviceIds(), { signal }),
    [period, selected]
  );
  const loadTrend = useCallback(
    (signal: AbortSignal) => getCircuitTrend(period, requireStart(selected), buildingMeters(), { signal }),
    [period, selected]
  );
  const onDemand = (section: string) => (want.circuits ? at(section) : null);

  return {
    periods,
    selected,
    select,
    devices: useSection('devices', at('devices'), loadDevices, cache, opts),
    core: useSection('core', at('core'), loadCore, cache, opts),
    hours: useSection('hours', at('hours'), loadHours, cache, opts),
    matrix: useSection('matrix', at('matrix'), loadMatrix, cache, opts),
    hourEnergy: useSection('hourEnergy', period === 'day' ? at('hourEnergy') : null, loadHourEnergy, cache, opts),
    curve: useSection('curve', at('curve'), loadCurve, cache, opts),
    pricing: useSection('pricing', enabled ? 'pricing' : null, loadPricing, cache, opts),
    ceiling: useSection('ceiling', enabled ? 'ceiling' : null, loadCeiling, cache, opts),
    deviceDaily: useSection('deviceDaily', onDemand('deviceDaily'), loadDeviceDaily, cache, opts),
    trend: useSection('trend', onDemand('trend'), loadTrend, cache, opts),
  };
}

/** A loader only runs when its key names a period, so this never throws in practice. It exists so
 *  a future caller that breaks that rule fails loudly instead of asking the database for "null". */
function requireStart(selected: string | null): string {
  if (selected === null) throw new Error('No report period is selected.');
  return selected;
}
