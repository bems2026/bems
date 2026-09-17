import { coverageOf } from './supabaseReports';
import type { DailyRow, DemandSummary, HourRow } from './reportSeries';

/**
 * Three findings the report's own series already hold — RM-084. No migration and no new query.
 *
 * Each is a sentence a facilities manager acts on, and each has a quiet way to be wrong, which is
 * what this file is mostly about:
 *
 *   weekday against weekend   averaged over partial days, a Monday that saw 166 minutes halves the
 *                             weekday. Only COMPLETE days count, by `coverageOf`'s own threshold.
 *   load factor               a ratio over a period nobody watched is a ratio of two guesses. It is
 *                             stated, and qualified whenever the period was not fully observed.
 *   overnight base load       "the base load" from two night hours is one reading of one night.
 *                             It needs four of the six.
 *
 * Every one returns `null` with a reason in words rather than a number it cannot stand behind. Hour
 * energy is never integrated from power here: RM-077 measured that disagreeing with the registers.
 */

export const MIN_WEEKDAYS = 3;
export const MIN_WEEKEND_DAYS = 2;
/** 00:00 up to, not including, 06:00 in the building's own day. */
export const OVERNIGHT_HOURS = 6;
export const MIN_OVERNIGHT_HOURS = 4;

export interface DayKindAverage {
  /** Average energy per complete day of this kind; `null` when there were too few to say. */
  kwh: number | null;
  days: number;
}

export interface WeekdayWeekend {
  weekday: DayKindAverage;
  weekend: DayKindAverage;
  reason: string | null;
}

/**
 * Saturday and Sunday. The site configuration has no working week, so this is an assumption — the
 * page says so beside the figure rather than leaving a reader to guess which days were which.
 * The day is a bare date the SQL resolved in the building's zone, so its weekday is taken in UTC.
 */
function isWeekend(localDay: string): boolean {
  const [y, m, d] = localDay.slice(0, 10).split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

const mean = (values: readonly number[]) => values.reduce((a, v) => a + v, 0) / values.length;

export function weekdayWeekend(daily: readonly DailyRow[]): WeekdayWeekend {
  const weekday: number[] = [];
  const weekend: number[] = [];
  for (const d of daily) {
    if (coverageOf(d.usable_sample_count, d.expected_samples)?.band !== 'complete') continue;
    if (typeof d.energy_kwh !== 'number' || !Number.isFinite(d.energy_kwh)) continue;
    (isWeekend(d.local_day) ? weekend : weekday).push(d.energy_kwh);
  }

  if (weekday.length < MIN_WEEKDAYS || weekend.length < MIN_WEEKEND_DAYS) {
    return {
      weekday: { kwh: null, days: weekday.length },
      weekend: { kwh: null, days: weekend.length },
      reason: `Needs at least ${MIN_WEEKDAYS} complete weekdays and ${MIN_WEEKEND_DAYS} complete weekend days; this period has ${weekday.length} and ${weekend.length}.`,
    };
  }
  return {
    weekday: { kwh: mean(weekday), days: weekday.length },
    weekend: { kwh: mean(weekend), days: weekend.length },
    reason: null,
  };
}

export interface LoadFactor {
  /** Average demand over peak demand, 0–1. */
  ratio: number | null;
  averageW: number | null;
  peakW: number | null;
  /** Share of the period's minutes that held a reading, when it can be stated. */
  coverage: number | null;
  /** True whenever the period was not fully observed — the ratio is real, but not the period's. */
  qualified: boolean;
  reason: string | null;
}

export function loadFactor(daily: readonly DailyRow[], summary: DemandSummary | null): LoadFactor {
  const refuse = (reason: string): LoadFactor => ({ ratio: null, averageW: null, peakW: null, coverage: null, qualified: false, reason });
  if (!summary) return refuse('The demand summary has not loaded.');

  /**
   * Each day's average, weighted by the share of that day actually observed — not by its sample
   * count, which is minutes on one day and hours on a day old enough to have been archived, and not
   * equally, which would let a day that saw an hour speak as loudly as one that saw all of it.
   */
  let weight = 0;
  let weighted = 0;
  for (const d of daily) {
    if (d.usable_sample_count <= 0 || d.expected_samples <= 0) continue;
    if (typeof d.avg_power_w !== 'number' || !Number.isFinite(d.avg_power_w)) continue;
    const observed = Math.min(d.usable_sample_count / d.expected_samples, 1);
    weight += observed;
    weighted += d.avg_power_w * observed;
  }
  if (weight === 0) return refuse('Nothing was recorded in this period, so there is no average demand to set against the peak.');

  const peak = summary.max_w;
  if (typeof peak !== 'number' || !Number.isFinite(peak) || peak <= 0) {
    return refuse('No peak demand was recorded for this period, so there is nothing to divide by.');
  }
  const averageW = weighted / weight;
  if (averageW > peak) return refuse('The average demand came out above the peak, so the two figures disagree.');

  const coverage = coverageOf(summary.usable_minutes, summary.expected_minutes);
  return {
    ratio: averageW / peak,
    averageW,
    peakW: peak,
    coverage: coverage?.ratio ?? null,
    qualified: coverage?.band !== 'complete',
    reason: null,
  };
}

export interface BaseLoad {
  w: number | null;
  /** How many of the six overnight hours were observed. */
  hours: number;
  reason: string | null;
}

/** The median of the typical (p50) demand in each observed hour from 00:00 to 06:00. */
export function overnightBaseLoad(hours: readonly HourRow[] | null): BaseLoad {
  if (!hours) return { w: null, hours: 0, reason: 'The hour-of-day profile has not loaded.' };
  const values = hours
    .filter((h) => h.local_hour >= 0 && h.local_hour < OVERNIGHT_HOURS && h.n > 0 && typeof h.p50_w === 'number' && Number.isFinite(h.p50_w))
    .map((h) => h.p50_w as number)
    .sort((a, b) => a - b);

  if (values.length < MIN_OVERNIGHT_HOURS) {
    return {
      w: null,
      hours: values.length,
      reason: `Needs at least ${MIN_OVERNIGHT_HOURS} of the ${OVERNIGHT_HOURS} hours between 00:00 and 06:00 observed; this period has ${values.length}.`,
    };
  }
  const mid = values.length / 2;
  const w = values.length % 2 === 1 ? values[Math.floor(mid)] : (values[mid - 1] + values[mid]) / 2;
  return { w, hours: values.length, reason: null };
}
