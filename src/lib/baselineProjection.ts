import { PHASE_MAP } from '@shared/registry.mjs';
import { SITE } from '@shared/siteConfig.mjs';
import { dayNoun, periodDates, shortDate, type Holiday, type ProjectedBaseline } from './baselineCompare';
import type { CircuitTrend, DeviceDaily, DeviceDayRow, HourSlot } from './circuitSeries';
import type { CurveRow, DailyRow, DemandSummary, HourEnergyRow, HourRow, MatrixRow } from './reportSeries';
import type { PeriodBuildingReport, PeriodDeviceReport, ReportPeriod } from './supabaseReports';

/**
 * A baseline period, built from the recorded days — RM-154.
 *
 * WHAT A READER SEES. Pick Baseline in the calendar and the page reads a projected day, week or month through
 * the same tabs and charts as a stored report. Each of its dates is ONE RECORDED DAY of its kind (a working day,
 * a Saturday or a Sunday, from `baseline-days.mjs`), scaled once per kind so the kind averages the baseline's
 * projected day. So a working Monday is not a working Tuesday, a hot Thursday shows its aircon, and a month has
 * a bar for every day — the spread of the office's real days (E-233), not an average drawn thirty times.
 *
 * A DATE IS ALWAYS THE SAME DAY. Which recorded day a date gets is a pure function of the date: the kind's days
 * in turn, counted from a fixed Sunday. So 7 Oct reads the same alone, in its week and in its month, a week
 * holds five different working days, and a month uses each about as often as the others.
 *
 * THE SAME SHAPES AS A STORED REPORT — `PeriodBuildingReport`, `DailyRow`, `DemandSummary`, `HourRow`,
 * `MatrixRow`, `CurveRow`, `PeriodDeviceReport`, `DeviceDaily`, `HourEnergyRow`, `CircuitTrend` — so no chart is
 * written twice. Everything adds up by construction: circuits to the building, hours to the day, days to the
 * period, as RM-154's energy rule makes the recorded reports do. Demand comes from the days' hourly averages and
 * each hour's highest minute, so its resolution is `hour` and the page says so as it does for older reports.
 *
 * Holidays: the baseline is business as usual and has none. A comparison asks for them (`holidays`), and then
 * each is a closed day, drawn from the quietest kind — what the routine adjustment of IPMVP means here.
 */

export interface DonorMeter {
  w: readonly number[];
  max: readonly number[];
  a: readonly number[];
}
export interface DonorDay {
  date: string;
  weekday: number;
  meters: Readonly<Record<string, DonorMeter>>;
  v: readonly number[];
  max_w: readonly number[];
  filled: readonly { meter: string; hours: readonly number[] }[];
}
/** The shape `server/baselineModel.mjs`'s `buildDonorDays` writes. */
export interface BaselineDays {
  version: number;
  site_id: string;
  generated_at: string;
  meters: readonly string[];
  types: Readonly<Record<string, { label: string; scale: number; days: readonly DonorDay[] }>>;
}

export interface ProjectedDay {
  date: string;
  type: string;
  donor: DonorDay;
  /** The holiday this date was turned into a closed day for, when a comparison asked. */
  holiday: string | null;
}

export interface ProjectedPeriod {
  days: ProjectedDay[];
  building: PeriodBuildingReport;
  devices: PeriodDeviceReport[];
  daily: DailyRow[];
  summary: DemandSummary;
  hours: HourRow[];
  matrix: MatrixRow[];
  curve: CurveRow[];
  deviceDaily: DeviceDaily;
  hourEnergy: HourEnergyRow[];
  trend: CircuitTrend;
  /** Per date, which recorded day it is: "From Tue 15 Sep, scaled × 0.97". */
  notes: Readonly<Record<string, string>>;
}

/** The fixed Sunday the turns are counted from. Any date works; it only has to never change. */
const EPOCH = '2026-01-04';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const daysSince = (date: string) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${EPOCH}T00:00:00Z`)) / DAY_MS);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** The modelled day a holiday is expected to be: whichever uses least — the office closed. */
function closedType(b: ProjectedBaseline): string {
  return Object.entries(b.day_types).reduce((a, [t, p]) => (p.kwh.total < b.day_types[a].kwh.total ? t : a), b.week.days[0]);
}

/** How many dates of `type` fall before `date`, counting from the epoch — the date's turn in its kind. */
function turnOf(b: ProjectedBaseline, type: string, date: string): number {
  const n = daysSince(date);
  const perWeek = b.week.days.filter((t) => t === type).length;
  const weeks = Math.floor(n / 7);
  const rest = n - weeks * 7;
  let before = weeks * perWeek;
  // The epoch is a Sunday, so the k-th day after it is weekday k mod 7.
  for (let k = 0; k < rest; k++) if (b.week.days[k % 7] === type) before++;
  return before;
}

/** The recorded day a date is projected from. */
export function donorFor(b: ProjectedBaseline, days: BaselineDays, date: string, holidays: readonly Holiday[]): ProjectedDay {
  const holiday = holidays.find((h) => h.date === date)?.name ?? null;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const ordinary = b.week.days[weekday];
  const closed = closedType(b);
  if (holiday !== null && ordinary !== closed) {
    const pool = days.types[closed].days;
    return { date, type: closed, donor: pool[mod(daysSince(date), pool.length)], holiday };
  }
  const pool = days.types[ordinary].days;
  return { date, type: ordinary, donor: pool[mod(turnOf(b, ordinary, date), pool.length)], holiday: null };
}

const sum = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0);
const mean = (xs: readonly number[]) => (xs.length === 0 ? null : sum(xs) / xs.length);

/** Linear-interpolation quantile of ascending values. */
function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo);
}

export function projectPeriod(
  b: ProjectedBaseline,
  days: BaselineDays,
  period: ReportPeriod,
  start: string,
  { holidays = [], phaseMap = PHASE_MAP as Record<string, readonly string[]>, utcOffsetMinutes = SITE.utc_offset_minutes }: {
    holidays?: readonly Holiday[];
    phaseMap?: Record<string, readonly string[]>;
    utcOffsetMinutes?: number;
  } = {}
): ProjectedPeriod {
  const dates = periodDates(period, start);
  const meters = [...days.meters];
  const projected = dates.map((date) => donorFor(b, days, date, holidays));

  // --- per date and hour ------------------------------------------------------------------------
  const buildingW = (d: ProjectedDay, h: number) => sum(meters.map((m) => d.donor.meters[m]?.w[h] ?? 0));
  const daily: DailyRow[] = projected.map((d) => {
    const hours = Array.from({ length: 24 }, (_, h) => buildingW(d, h));
    return {
      local_day: d.date,
      energy_kwh: sum(meters.map((m) => sum(d.donor.meters[m]?.w ?? []))) / 1000,
      peak_power_w: Math.max(...d.donor.max_w),
      avg_power_w: sum(hours) / 24,
      sample_count: 1440,
      usable_sample_count: 1440,
      expected_samples: 1440,
      first_seen_minute: 0,
      last_seen_minute: 1439,
      resolution: 'hour',
    };
  });
  const matrix: MatrixRow[] = projected.flatMap((d) =>
    Array.from({ length: 24 }, (_, h) => ({
      local_day: d.date,
      local_hour: h,
      avg_power_w: buildingW(d, h),
      max_power_w: d.donor.max_w[h],
      sample_count: 60,
      usable_sample_count: 60,
      resolution: 'hour',
    }))
  );
  const hourly = matrix.map((c) => c.avg_power_w as number);
  const ascending = [...hourly].sort((x, y) => x - y);
  const highest = Math.max(...projected.map((d) => Math.max(...d.donor.max_w)));
  const minutes = dates.length * 1440;

  const summary: DemandSummary = {
    n: hourly.length,
    p50_w: quantile(ascending, 0.5),
    p95_w: quantile(ascending, 0.95),
    p99_w: quantile(ascending, 0.99),
    max_w: highest,
    min_w: ascending[0] ?? null,
    observed_minutes: minutes,
    usable_minutes: minutes,
    expected_minutes: minutes,
    longest_gap_minutes: 0,
    resolution: 'hour',
  };
  const hours: HourRow[] = Array.from({ length: 24 }, (_, h) => {
    const at = projected.map((d) => buildingW(d, h)).sort((x, y) => x - y);
    return {
      local_hour: h,
      n: at.length,
      p50_w: quantile(at, 0.5),
      p95_w: quantile(at, 0.95),
      max_w: Math.max(...projected.map((d) => d.donor.max_w[h])),
      resolution: 'hour',
    };
  });
  // Highest first, as `report_demand_curve` returns it: at 0% the demand never exceeded, at 100% the floor.
  const curve: CurveRow[] = Array.from({ length: 101 }, (_, i) => ({ pct: i, power_w: quantile(ascending, 1 - i / 100), resolution: 'hour' }));

  // --- per circuit -----------------------------------------------------------------------------
  const deviceDayRows: DeviceDayRow[] = projected.flatMap((d) =>
    meters.map((m) => {
      const x = d.donor.meters[m];
      const energy = sum(x?.w ?? []) / 1000;
      return {
        device_id: m,
        local_day: d.date,
        energy_kwh: energy,
        counter_kwh: energy,
        removed_kwh: null,
        clipped_hours: 0,
        peak_power_w: Math.max(...(x?.max ?? [0])),
        avg_power_w: sum(x?.w ?? []) / 24,
        online_minutes: 1440,
        expected_minutes: 1440,
        resolution: 'hour',
      };
    })
  );
  const devices: PeriodDeviceReport[] = meters.map((m) => {
    const rows = deviceDayRows.filter((r) => r.device_id === m);
    return {
      period,
      period_start: start,
      device_id: m,
      energy_kwh: sum(rows.map((r) => r.energy_kwh as number)),
      peak_power_w: Math.max(...rows.map((r) => r.peak_power_w as number)),
      avg_power_w: mean(rows.map((r) => r.avg_power_w as number)),
      online_sample_count: minutes,
      expected_sample_count: minutes,
    };
  });
  const hourEnergy: HourEnergyRow[] =
    period === 'day'
      ? projected.flatMap((d) =>
          meters.flatMap((m) =>
            Array.from({ length: 24 }, (_, h) => ({
              device_id: m,
              local_day: d.date,
              local_hour: h,
              energy_kwh: (d.donor.meters[m]?.w[h] ?? 0) / 1000,
              clipped: false,
              avg_power_w: d.donor.meters[m]?.w[h] ?? 0,
              max_power_w: d.donor.meters[m]?.max[h] ?? 0,
              online_minutes: 60,
              resolution: 'hour',
            }))
          )
        )
      : [];
  const startMs = Date.parse(`${dates[0]}T00:00:00Z`) - utcOffsetMinutes * 60_000;
  const trend: CircuitTrend = {
    startMs,
    endMs: startMs + dates.length * DAY_MS,
    series: meters.map((m) => ({
      meterId: m,
      slots: projected.flatMap((d, i) =>
        Array.from({ length: 24 }, (_, h): HourSlot => ({
          startMs: startMs + (i * 24 + h) * HOUR_MS,
          avgW: d.donor.meters[m]?.w[h] ?? null,
          maxW: d.donor.meters[m]?.max[h] ?? null,
          online: 60,
          samples: 60,
        }))
      ),
    })),
  };

  // --- the building -----------------------------------------------------------------------------
  const phaseCurrent = (phase: string) => {
    const on = (phaseMap[phase] ?? []).filter((m) => meters.includes(m));
    if (on.length === 0) return null;
    return mean(projected.flatMap((d) => Array.from({ length: 24 }, (_, h) => sum(on.map((m) => d.donor.meters[m]?.a[h] ?? 0)))));
  };
  const building: PeriodBuildingReport = {
    period,
    period_start: start,
    energy_kwh: sum(daily.map((d) => d.energy_kwh as number)),
    peak_total_power_w: highest,
    avg_voltage: mean(projected.flatMap((d) => [...d.donor.v])),
    phase_current_red_avg: phaseCurrent('red'),
    phase_current_yellow_avg: phaseCurrent('yellow'),
    phase_current_blue_avg: phaseCurrent('blue'),
    command_count: 0,
    command_count_manual: 0,
    command_count_schedule: 0,
    command_count_autoshed: 0,
    anomaly_count: 0,
    online_sample_count: minutes,
    expected_sample_count: minutes,
    generated_at: b.generated_at,
  };

  const notes: Record<string, string> = {};
  for (const d of projected) {
    const scale = days.types[d.type]?.scale ?? 1;
    const from = `From ${WEEKDAYS[d.donor.weekday]} ${shortDate(d.donor.date)}${Math.abs(scale - 1) >= 0.005 ? `, scaled × ${scale.toFixed(2)}` : ''}`;
    notes[d.date] = d.holiday ? `${d.holiday}: a closed day, as a ${dayNoun(b.day_types[d.type]?.label ?? d.type)}. ${from}` : from;
  }

  return { days: projected, building, devices, daily, summary, hours, matrix, curve, deviceDaily: { available: true, rows: deviceDayRows }, hourEnergy, trend, notes };
}
