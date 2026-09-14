import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { SITE } from '@shared/siteConfig.mjs';
import { detectFrozenRuns } from './timeseries';
import { branchShortfalls, energyDisagreement, type BranchShortfall, type EnergyDisagreement } from './energyDisagreement';
import { isReadingExpired } from './staleness';
import { formatKwh, shareOfTotal } from './format';
import type { Device, HistoryPoint, Reading, Totals } from './types';

/**
 * RM-077 and RM-078 — the per-branch energy split, derived once, for every card that shows it.
 *
 * RM-078: TWO COPIES DISAGREED. Overview's Energy Breakdown and Analytics' "By branch" each derived
 * the split for themselves, and the operator reported L.O Red reading differently on the two pages.
 * Three differences, none of them a bug on its own: Overview rounded rows to one decimal and
 * Analytics to two; Overview took every device of class `meter` while Analytics took the
 * `branches` group filtered by each device's `monitoring` function; and neither matched the set the
 * bridge actually sums into `_totals`. This is that one derivation, and its membership is the
 * bridge's own — `BUILDING_METER_IDS`, the topmost metered circuits — so the split always adds up
 * to the tile above it. `circuitBreakdown.ts` reads the same constant for the same reason.
 *
 * RM-077: THE ACCUSATION WAS WRONG. The page said "L.O Red shows 0.00 kWh against 0.30 kWh of its
 * own power integrated over the same day (100 % missing) … energy going missing between the meter
 * and this page". Read back from `readings` on 2026-09-14:
 *
 * | local day | integrated from power | own daily register | own lifetime register Δ |
 * |---|---|---|---|
 * | 09-07 to 09-11 | 0.191 / 0.226 / 0.270 / 0.112 / 0.064 | 0.191 / 0.227 / 0.272 / 0.112 / 0.066 | agrees |
 * | 09-12 | 0.329 | 0.008 | 0.008 |
 * | 09-13 | 0.214 | 0.091 | 0.092 |
 *
 * On 09-12, from 06:00 to 20:59, L.O Red repeated 19.1 W / 228.2 V / 0.576 A exactly while both of
 * its registers stood still, and it reported `online: true` throughout because it kept sending
 * messages. The bridge published exactly what the register said. The "integrated" figure is the
 * legacy flow multiplying a held 19.1 W by fifteen hours. So the second opinion was the fabricator,
 * and the check believed it.
 *
 * What is done about it: a stretch the meter held frozen (`timeseries.detectFrozenRuns`) is named on
 * its own, and the power the integrator counted over it is taken out of that branch's second opinion
 * before the shortfall check reads it. The check itself (`energyDisagreement.ts`) is unchanged — its
 * thresholds were sized on healthy data and still hold. RM-056's real loss, where nothing froze,
 * still trips it. Energy used during a freeze is NOT estimated: it was not measured, and the notice
 * says so (operator decision, 2026-09-14).
 */

export type EnergyPeriod = 'today' | 'week' | 'month';

const READING_KEY: Record<EnergyPeriod, 'energy_kwh_today' | 'energy_kwh_week' | 'energy_kwh_month'> = {
  today: 'energy_kwh_today',
  week: 'energy_kwh_week',
  month: 'energy_kwh_month',
};
const INTEGRATED_KEY: Record<EnergyPeriod, 'energy_kwh_today_integrated' | 'energy_kwh_week_integrated' | 'energy_kwh_month_integrated'> = {
  today: 'energy_kwh_today_integrated',
  week: 'energy_kwh_week_integrated',
  month: 'energy_kwh_month_integrated',
};

const DAY_MS = 86_400_000;
/** A freeze whose last identical sample is this recent is still going on. Five bridge samples. */
const ONGOING_WITHIN_MS = 5 * 60_000;
/** Watts times milliseconds, to kilowatt-hours. */
const W_MS_PER_KWH = 3.6e9;

export interface BranchEnergyRow {
  id: string;
  name: string;
  kwh: number;
  /** Percent of `totalKwh`. */
  share: number;
  /** The reading has expired. The figure is still shown — a register is a count, not a live value. */
  stale: boolean;
}

export interface FrozenBranch {
  id: string;
  name: string;
  fromMs: number;
  /** The last identical sample, or now if the freeze is still going on. */
  toMs: number;
  ongoing: boolean;
  heldW: number;
  heldV?: number;
  /** What the legacy integrator counted today from the held power. Never shown as consumption. */
  phantomKwh: number;
}

export interface BranchEnergySplit {
  rows: BranchEnergyRow[];
  /** Rounded exactly as `shared/buildLatest.mjs` rounds `_totals`; `null` when no branch has a figure. */
  totalKwh: number | null;
  disagreement: EnergyDisagreement | null;
  shortfalls: BranchShortfall[];
  frozen: FrozenBranch[];
}

export interface BranchEnergyInput {
  devices: Device[];
  readings: Record<string, Reading>;
  totals: Totals | null;
  /** Each building meter's 24h history, for freeze detection. Absent history detects nothing. */
  historyByDevice: Record<string, HistoryPoint[]>;
  period: EnergyPeriod;
  nowMs: number;
  meterIds?: readonly string[];
}

/** The building's local midnight for `nowMs`, at the site's own offset — the boundary the bridge
 * resets every daily counter on. */
export function siteDayStartMs(nowMs: number, offsetMinutes: number = Number(SITE.utc_offset_minutes)): number {
  const offset = offsetMinutes * 60_000;
  return Math.floor((nowMs + offset) / DAY_MS) * DAY_MS - offset;
}

function frozenToday(id: string, name: string, points: HistoryPoint[], nowMs: number): FrozenBranch[] {
  if (points.length === 0) return [];
  const dayStart = siteDayStartMs(nowMs);
  let lastMs = -Infinity;
  for (const p of points) {
    const ms = Date.parse(p.ts);
    if (ms > lastMs) lastMs = ms;
  }
  const found: FrozenBranch[] = [];
  for (const run of detectFrozenRuns(points)) {
    const ongoing = run.toMs === lastMs && nowMs - run.toMs <= ONGOING_WITHIN_MS;
    const toMs = ongoing ? nowMs : run.toMs;
    const countedFrom = Math.max(run.fromMs, dayStart);
    if (toMs <= countedFrom) continue;
    found.push({ id, name, fromMs: run.fromMs, toMs, ongoing, heldW: run.power_w, heldV: run.voltage, phantomKwh: (run.power_w * (toMs - countedFrom)) / W_MS_PER_KWH });
  }
  return found;
}

/**
 * A freeze the BRIDGE flagged on the live reading (RM-079), for a card that has no history loaded to
 * find it in. The bridge flags only from the three-hour mark, so `frozen_since` is when the values
 * last moved and the whole span since then is counted.
 */
function frozenFromReading(id: string, name: string, reading: Reading | undefined, nowMs: number): FrozenBranch | null {
  if (!reading?.measurement_frozen || typeof reading.power_w !== 'number') return null;
  const since = Date.parse(reading.frozen_since ?? '');
  if (!Number.isFinite(since)) return null;
  const countedFrom = Math.max(since, siteDayStartMs(nowMs));
  if (nowMs <= countedFrom) return null;
  return { id, name, fromMs: since, toMs: nowMs, ongoing: true, heldW: reading.power_w, heldV: reading.voltage, phantomKwh: (reading.power_w * (nowMs - countedFrom)) / W_MS_PER_KWH };
}

export function branchEnergySplit(input: BranchEnergyInput): BranchEnergySplit {
  const { devices, readings, totals, historyByDevice, period, nowMs, meterIds = BUILDING_METER_IDS as readonly string[] } = input;
  const byId = new Map(devices.map((d) => [d.id, d]));

  const present: Omit<BranchEnergyRow, 'share'>[] = [];
  const frozen: FrozenBranch[] = [];
  const phantomById = new Map<string, number>();
  for (const id of meterIds) {
    const device = byId.get(id);
    if (!device) continue;
    const found = frozenToday(id, device.display_name, historyByDevice[id] ?? [], nowMs);
    // The history already shows an ongoing freeze when it is loaded; the bridge's flag names the same
    // freeze, so it is only used when the history does not.
    const flagged = frozenFromReading(id, device.display_name, readings[id], nowMs);
    if (flagged && !found.some((f) => f.ongoing)) found.push(flagged);
    frozen.push(...found);
    phantomById.set(id, found.reduce((sum, f) => sum + f.phantomKwh, 0));
    const reading = readings[id];
    const kwh = reading?.[READING_KEY[period]];
    if (typeof kwh !== 'number' || !Number.isFinite(kwh)) continue;
    present.push({ id, name: device.display_name, kwh, stale: isReadingExpired(reading, nowMs) });
  }

  // `shared/buildLatest.mjs` branchSum, exactly: add, then round to the watt-hour. Rounding each
  // term first would make this figure and the tile disagree in the third decimal.
  let sum = 0;
  for (const r of present) sum += r.kwh;
  const totalKwh = present.length > 0 ? Math.round(sum * 1000) / 1000 : null;
  const rows = present.map((r) => ({ ...r, share: shareOfTotal(r.kwh, totalKwh) })).sort((a, b) => b.kwh - a.kwh);

  const totalPhantom = [...phantomById.values()].reduce((a, b) => a + b, 0);
  const integratedTotal = totals?.[INTEGRATED_KEY[period]];
  const trustedTotal = typeof integratedTotal === 'number' && Number.isFinite(integratedTotal) ? Math.max(0, integratedTotal - totalPhantom) : integratedTotal;
  const disagreement = totalKwh === null ? null : energyDisagreement(totalKwh, trustedTotal);

  const shortfalls = branchShortfalls(
    rows.map((r) => {
      const integrated = readings[r.id]?.energy_kwh_today_integrated;
      const trusted = typeof integrated === 'number' && Number.isFinite(integrated) ? Math.max(0, integrated - (phantomById.get(r.id) ?? 0)) : integrated;
      return { id: r.id, name: r.name, kwh: r.kwh, integrated: trusted };
    }),
    period,
  );

  return { rows, totalKwh, disagreement, shortfalls, frozen };
}

/** A building moment as HH:MM on a 00-23 clock. `hourCycle` rather than `hour12: false`, which some
 * engines render as "24:00" for midnight. */
function siteClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', timeZone: SITE.timezone as string });
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** One sentence for a frozen meter, identical wherever it is shown. */
export function describeFrozen(f: FrozenBranch): string {
  const held = f.heldV !== undefined ? `${f.heldW} W at ${f.heldV} V` : `${f.heldW} W`;
  const duration = formatDuration(f.toMs - f.fromMs);
  if (f.ongoing) {
    return `${f.name}'s meter has repeated exactly ${held} since ${siteClock(f.fromMs)} (${duration} so far) while reporting online, so it is not measuring. The figure shown is its own energy register; energy used since then is not measured.`;
  }
  return `${f.name}'s meter repeated exactly ${held} from ${siteClock(f.fromMs)} to ${siteClock(f.toMs)} (${duration}) while reporting online, so it was not measuring. The figure shown is its own energy register; energy used in that window was not measured.`;
}

/** The shortfall notice, identical wherever it is shown. */
export function describeShortfalls(shortfalls: BranchShortfall[], frozen: FrozenBranch[] = []): { headline: string; detail: string } {
  const headline =
    shortfalls.length === 1 ? `${shortfalls[0].name} is reporting less than it measured.` : `${shortfalls.length} branches are reporting less than they measured.`;
  const froze = new Set(frozen.map((f) => f.id));
  const parts = shortfalls.map(
    (s) =>
      `${s.name} shows ${formatKwh(s.reported)} against ${formatKwh(s.integrated)} of its own power integrated over the same day${froze.has(s.id) ? ', not counting the time its meter froze' : ''} (${Math.round(s.fraction * 100)}% missing)`,
  );
  return {
    headline,
    detail: `${parts.join('; ')}. A branch cannot have used less than its own meter recorded, so this is energy going missing between the meter and this page.`,
  };
}
