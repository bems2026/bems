import { BASELINE, CIRCUITS, SITE } from '@shared/siteConfig.mjs';
import { LOAD_LABELS, LOADS } from '@shared/circuits.mjs';
import { baselineAssumptions, baselineNotCompared } from '@shared/reportProse.mjs';
import type { CircuitDayPoint, CircuitSeriesDef } from '@/components/reports/charts/circuitDailyEnergyChart';
import type { Coverage, ReportPeriod } from './supabaseReports';
import type { ProjectedPeriod } from './baselineProjection';

/**
 * The projected baseline, and a real period set against it — RM-153.
 *
 * The baseline itself is built on the edge (`server/baselineModel.mjs`) and committed as the site's
 * `baseline.mjs`; this reads it. Nothing here fetches: the Baseline tab is the static file plus the
 * period rows the page has already loaded.
 *
 * A PERIOD IS HELD TO ITS OWN CALENDAR. A month is expected to use what its own working days,
 * Saturdays and Sundays use — not a "standard month" — and each holiday in the site calendar is
 * expected as a closed day, using what the quietest modelled day uses. That is the routine
 * adjustment IPMVP asks for, and the only one this site records: weather is not (see the caveats).
 *
 * AND IT REFUSES BELOW 95% RECORDED, like `ipmvp.compare`. Set against an expectation, every missing
 * hour reads as energy avoided — the most flattering error this page could make.
 */

type ByLoad = Readonly<Record<string, number>>;

export interface BaselineProfile {
  label: string;
  days: readonly string[];
  profile_w: Readonly<Record<string, readonly number[]>>;
  kwh: ByLoad;
  standby_w: number;
  working_hours_avg_w: number;
  highest_hourly_w: number;
  working_hours_share: number;
}
export interface DayTypeProfile extends BaselineProfile {
  recorded_weekdays: readonly number[];
}
export interface RecordedProfile extends BaselineProfile {
  key: string;
  weekdays: readonly number[];
}
export interface RecordedDay {
  date: string;
  weekday: number;
  kwh: ByLoad;
  hours_recorded: number;
  highest_w: number | null;
  used_as: string | null;
  reason: string | null;
}

/** The shape `server/baselineModel.mjs` writes. Declared rather than inferred, so a site whose
 * baseline is still `null` type-checks the same as this one. */
export interface ProjectedBaseline {
  version: number;
  site_id: string;
  generated_at: string;
  window: { from: string; to: string; days: number };
  working_hours: { start: string; end: string };
  loads: readonly string[];
  meters: Readonly<Record<string, readonly string[]>>;
  method: { trim_from_days: number; min_hours_recorded: number; ceiling_w: number; automation_sources: readonly string[]; standard_month_days: number };
  day_types: Readonly<Record<string, DayTypeProfile>>;
  week: { days: readonly string[]; kwh: ByLoad };
  standard_month: { days: number; working_days: number; day_counts: ByLoad; kwh: ByLoad };
  peak_operating_draw: { w: number | null; days: number; quantile: number };
  excluded: readonly { date: string; reason: string; evidence: string | null }[];
  dropped_hours: readonly { date: string; hours: readonly number[]; reason: string }[];
  coverage: ByLoad;
  recorded: { from: string; to: string; days: readonly RecordedDay[]; profiles: readonly RecordedProfile[] };
  warnings: readonly string[];
}

export const SITE_BASELINE = BASELINE as unknown as ProjectedBaseline | null;

export interface Holiday {
  date: string;
  name: string;
}
export const SITE_HOLIDAYS: readonly Holiday[] = (SITE as { non_working_days?: readonly Holiday[] }).non_working_days ?? [];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86_400_000;
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const loadLabel = (load: string) => (LOAD_LABELS as Record<string, string>)[load] ?? load;

/** A day type's label inside a sentence: a weekday keeps its capital ("Saturday"), a kind of day does not
 * ("working day"). */
export const dayNoun = (label: string) => (WEEKDAYS.includes(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

/** "11 working days, 4 Saturdays, 4 Sundays". */
export function dayTypeCounts(b: ProjectedBaseline): string {
  return Object.values(b.day_types)
    .map((t) => `${t.days.length} ${dayNoun(t.label)}${t.days.length === 1 ? '' : 's'}`)
    .join(', ');
}

/** Every local date of a report period. Weeks start on the Monday the report does. */
export function periodDates(period: ReportPeriod, start: string): string[] {
  const first = start.slice(0, 10);
  if (period === 'day') return [first];
  if (period === 'week') return Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const out: string[] = [];
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) out.push(d);
  return out;
}

/** Weekday numbers as words: a run reads "Monday–Thursday", anything else is listed. */
export function weekdayRange(days: readonly number[]): string {
  const monFirst = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const run = monFirst.every((d, i) => i === 0 || (d + 6) % 7 === ((monFirst[i - 1] + 6) % 7) + 1);
  if (monFirst.length > 2 && run) return `${WEEKDAYS[monFirst[0]]}–${WEEKDAYS[monFirst[monFirst.length - 1]]}`;
  return monFirst.map((d) => WEEKDAYS[d]).join(' and ');
}

/** The modelled day a holiday is expected to be: whichever uses least — the office closed. */
function closedType(b: ProjectedBaseline): string {
  return Object.entries(b.day_types).reduce((a, [t, p]) => (p.kwh.total < b.day_types[a].kwh.total ? t : a), b.week.days[0]);
}

export interface Expected {
  /** Per use, plus `total`. */
  kwh: Record<string, number>;
  /** How many days of each modelled type the dates hold. */
  counts: Record<string, number>;
  /** The holidays that turned a working day into a closed one. */
  holidays: Holiday[];
}

/** What the baseline expects over these dates. `holidays` empty is the brief's "business as usual". */
export function expectedFor(b: ProjectedBaseline, dates: readonly string[], holidays: readonly Holiday[]): Expected {
  const named = new Map(holidays.map((h) => [h.date, h.name]));
  const closed = closedType(b);
  const kwh: Record<string, number> = Object.fromEntries([...b.loads, 'total'].map((l) => [l, 0]));
  const counts: Record<string, number> = {};
  const used: Holiday[] = [];
  for (const date of dates) {
    let type = b.week.days[weekdayOf(date)];
    if (named.has(date) && type !== closed) {
      used.push({ date, name: named.get(date) as string });
      type = closed;
    }
    counts[type] = (counts[type] ?? 0) + 1;
    for (const l of [...b.loads, 'total']) kwh[l] += b.day_types[type].kwh[l] ?? 0;
  }
  return { kwh, counts, holidays: used };
}

export type BaselineComparison =
  | { comparable: false; reason: string }
  | {
      comparable: true;
      expectedKwh: number;
      recordedKwh: number;
      /** Recorded minus expected; negative is less than the baseline. */
      differenceKwh: number;
      differencePct: number | null;
      /** Expected minus recorded — what M&V calls avoided energy. Negative when more was used. */
      avoidedKwh: number;
      byLoad: { load: string; label: string; expectedKwh: number; recordedKwh: number | null }[];
      holidays: Holiday[];
      /** Days of the period inside the window the baseline was built from. */
      ownWindowDays: number;
      /** RM-154: per date, the projection's day against the recorded one. */
      days?: { date: string; expectedKwh: number; recordedKwh: number | null }[];
    };

export function compareWithBaseline(input: {
  baseline: ProjectedBaseline | null;
  period: ReportPeriod;
  start: string;
  holidays: readonly Holiday[];
  recordedKwh: number | null;
  recordedByLoad: Readonly<Record<string, number | null>>;
  coverage: Coverage | null;
}): BaselineComparison {
  const { baseline: b, period, start, holidays, recordedKwh, recordedByLoad, coverage } = input;
  if (!b) return { comparable: false, reason: 'This site has no baseline yet, so there is nothing to set the period against.' };
  if (coverage?.band !== 'complete') {
    return { comparable: false, reason: baselineNotCompared(period, coverage ? Math.round(coverage.ratio * 100) : 0) };
  }
  if (recordedKwh === null || !Number.isFinite(recordedKwh)) {
    return { comparable: false, reason: `This ${period} reports no energy, so there is nothing to set against the baseline.` };
  }
  const dates = periodDates(period, start);
  const e = expectedFor(b, dates, holidays);
  const differenceKwh = recordedKwh - e.kwh.total;
  return {
    comparable: true,
    expectedKwh: e.kwh.total,
    recordedKwh,
    differenceKwh,
    differencePct: e.kwh.total === 0 ? null : (differenceKwh / e.kwh.total) * 100,
    avoidedKwh: -differenceKwh,
    byLoad: b.loads.map((load) => ({ load, label: loadLabel(load), expectedKwh: e.kwh[load], recordedKwh: recordedByLoad[load] ?? null })),
    holidays: e.holidays,
    ownWindowDays: dates.filter((d) => d >= b.window.from && d <= b.window.to).length,
  };
}

/**
 * A period against its projected baseline on the same dates — RM-154. The expectation is the projection itself
 * (`src/lib/baselineProjection.ts`, holidays as closed days), so the figure the Compare tab sets a month against
 * is the month the Baseline view shows, day for day. The refusals are `compareWithBaseline`'s.
 */
export function compareWithProjection(input: {
  baseline: ProjectedBaseline | null;
  projected: ProjectedPeriod | null;
  period: ReportPeriod;
  recordedKwh: number | null;
  recordedByLoad: Readonly<Record<string, number | null>>;
  /** Each recorded day's energy, for the day-by-day table; omitted, there is no table. */
  recordedDaily?: readonly { date: string; kwh: number | null }[];
  coverage: Coverage | null;
}): BaselineComparison {
  const { baseline: b, projected, period, recordedKwh, recordedByLoad, recordedDaily, coverage } = input;
  if (!b) return { comparable: false, reason: 'This site has no baseline yet, so there is nothing to set the period against.' };
  if (coverage?.band !== 'complete') {
    return { comparable: false, reason: baselineNotCompared(period, coverage ? Math.round(coverage.ratio * 100) : 0) };
  }
  if (recordedKwh === null || !Number.isFinite(recordedKwh)) {
    return { comparable: false, reason: `This ${period} reports no energy, so there is nothing to set against the baseline.` };
  }
  if (!projected) return { comparable: false, reason: 'The baseline for this period has not been worked out yet.' };
  const expectedKwh = projected.building.energy_kwh ?? 0;
  const differenceKwh = recordedKwh - expectedKwh;
  const meterKwh = new Map(projected.devices.map((r) => [r.device_id, r.energy_kwh ?? 0]));
  const recordedOf = new Map((recordedDaily ?? []).map((d) => [d.date, d.kwh]));
  return {
    comparable: true,
    expectedKwh,
    recordedKwh,
    differenceKwh,
    differencePct: expectedKwh === 0 ? null : (differenceKwh / expectedKwh) * 100,
    avoidedKwh: -differenceKwh,
    byLoad: b.loads.map((load) => ({
      load,
      label: loadLabel(load),
      expectedKwh: (b.meters[load] ?? []).reduce((a, m) => a + (meterKwh.get(m) ?? 0), 0),
      recordedKwh: recordedByLoad[load] ?? null,
    })),
    holidays: projected.days.filter((d) => d.holiday !== null).map((d) => ({ date: d.date, name: d.holiday as string })),
    ownWindowDays: projected.days.filter((d) => d.date >= b.window.from && d.date <= b.window.to).length,
    ...(recordedDaily
      ? { days: projected.daily.map((d) => ({ date: d.local_day, expectedKwh: d.energy_kwh ?? 0, recordedKwh: recordedOf.get(d.local_day) ?? null })) }
      : {}),
  };
}

/** `This month used 30.8 kWh (13.3%) less than the baseline expects.` — the direction in words. */
export function describeAgainstBaseline(c: Extract<BaselineComparison, { comparable: true }>, period: ReportPeriod): string {
  if (Math.abs(c.differenceKwh) < 0.05) return `This ${period} used what the baseline expects, to the tenth of a kilowatt-hour.`;
  const pct = c.differencePct === null ? '' : ` (${Math.abs(c.differencePct).toFixed(1)}%)`;
  return `This ${period} used ${Math.abs(c.differenceKwh).toFixed(1)} kWh${pct} ${c.differenceKwh < 0 ? 'less' : 'more'} than the baseline expects.`;
}

// --- chart points ---------------------------------------------------------------------------------

/** The uses as chart series, coloured as `loadShareSegments` colours them everywhere else. */
export function loadSeries(b: ProjectedBaseline): CircuitSeriesDef[] {
  return b.loads.map((load) => ({ id: load, label: loadLabel(load), colourIndex: (LOADS as readonly string[]).indexOf(load) }));
}

/** A day type as twenty-four hours: each hour's average watts are that hour's watt-hours. */
export function profilePoints(p: BaselineProfile, loads: readonly string[]): CircuitDayPoint[] {
  return Array.from({ length: 24 }, (_, h) => ({
    day: `${String(h).padStart(2, '0')}:00`,
    label: String(h),
    values: loads.map((l) => (p.profile_w[l]?.[h] ?? 0) / 1000),
    observed: true,
    complete: true,
  }));
}

/** The modelled week, Monday first. */
export function weekPoints(b: ProjectedBaseline): CircuitDayPoint[] {
  return [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const type = b.day_types[b.week.days[wd]];
    return {
      day: WEEKDAYS[wd],
      label: WEEKDAYS[wd].slice(0, 3),
      values: b.loads.map((l) => type.kwh[l] ?? 0),
      observed: true,
      complete: true,
      notes: [type.label],
    };
  });
}

/** What each baseline chart shows, for its text description — the page and the PDF say the same. */
export const chartDesc = {
  projectedDay: (b: ProjectedBaseline, p: BaselineProfile) =>
    `A ${dayNoun(p.label)} as the baseline expects it: each hour's energy, stacked by use. Working hours ${b.working_hours.start}–${b.working_hours.end} are shaded.`,
  recordedDay: (b: ProjectedBaseline, p: BaselineProfile) =>
    `${p.label} as recorded: each hour's energy averaged over ${p.days.length} day${p.days.length === 1 ? '' : 's'}, stacked by use. Working hours ${b.working_hours.start}–${b.working_hours.end} are shaded.`,
  week: () => 'A typical week as the baseline expects it: each day’s energy, stacked by use, Monday first.',
  recordedDays: (b: ProjectedBaseline) => {
    const used = b.recorded.days.filter((d) => d.used_as !== null).length;
    return (
      `Every day recorded from ${shortDate(b.recorded.from)} to ${shortDate(b.recorded.to, true)}, stacked by use. ${used} of ${b.recorded.days.length} were used for the baseline; ` +
      'each of the others says why it was left out. A day recorded for only part of its hours is drawn lighter.'
    );
  },
};

/** Each recorded day as it was, and what the baseline did with it. */
export function recordedDayPoints(b: ProjectedBaseline): CircuitDayPoint[] {
  return b.recorded.days.map((d) => ({
    day: d.date,
    label: String(Number(d.date.slice(8, 10))),
    values: b.loads.map((l) => (d.hours_recorded > 0 ? d.kwh[l] ?? null : null)),
    observed: d.hours_recorded > 0,
    complete: d.hours_recorded === 24,
    notes: [d.used_as ? `used for the ${b.day_types[d.used_as]?.label ?? d.used_as}` : `not used: ${d.reason ?? 'no reason recorded'}`],
  }));
}

// --- what it assumes -------------------------------------------------------------------------------

/** Fixed, not the locale's: some runtimes abbreviate September as "Sept" and others as "Sep". */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthShort = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1];
/** "25 Aug", or "22 Sep 2026" with the year. */
export const shortDate = (date: string, withYear = false) => `${Number(date.slice(8, 10))} ${monthShort(date)}${withYear ? ` ${date.slice(0, 4)}` : ''}`;
const longDate = shortDate;

/** The window in words: "29 days, 25 Aug – 22 Sep 2026". */
export function windowText(b: ProjectedBaseline): string {
  return `${b.window.days} days, ${longDate(b.window.from, false)} – ${longDate(b.window.to, true)}`;
}

/** The caveats list, from the baseline's own data and the site's circuit tree. */
export function baselineAssumptionItems(b: ProjectedBaseline): { lead: string; body: string }[] {
  const modelled: { lead: string; body: string }[] = [];
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
    const typeId = b.week.days[wd];
    const type = b.day_types[typeId];
    if (type.recorded_weekdays.includes(wd)) continue;
    const recorded = b.recorded.profiles.find((p) => p.weekdays.length === 1 && p.weekdays[0] === wd);
    modelled.push({
      lead: `${WEEKDAYS[wd]} is modelled as a ${dayNoun(type.label)}.`,
      body:
        `It uses the ${weekdayRange(type.recorded_weekdays)} profile` +
        (recorded && recorded.days.length > 0
          ? `; the recorded ${WEEKDAYS[wd]}s averaged ${recorded.kwh.total.toFixed(1)} kWh, against ${type.kwh.total.toFixed(1)}.`
          : '.'),
    });
  }
  const counts = dayTypeCounts(b);
  const unmetered = (CIRCUITS as readonly { name: string; load?: string; apportionment?: readonly { label: string; share: number; basis: string }[] }[]).flatMap(
    (c) => (c.apportionment ?? []).map((a) => ({ group: loadLabel(c.load ?? 'other'), label: a.label, branch: c.name, share: a.share, basis: a.basis }))
  );
  return baselineAssumptions({
    workingHours: `${b.working_hours.start}–${b.working_hours.end}`,
    windowText: windowText(b),
    dayCounts: `${counts}; ${b.excluded.length} left out, each with its reason`,
    modelled,
    unmetered,
  });
}
