import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { usableEnergy } from './boundedEnergy';
import type { DeviceDayRow } from './circuitSeries';
import type { DailyRow } from './reportSeries';
import type { PeriodBuildingReport, PeriodDeviceReport } from './supabaseReports';

/**
 * One energy figure per period — RM-154, ADR-0013.
 *
 * TWO REDUCTIONS OF THE SAME FOUR METERS. The stored building row is the bridge's month counter
 * (`shared/buildLatest.mjs`, `energyAccumulator.mjs`): every bounded rise of the branch meters' registers,
 * banked as it happens. The circuits are the same registers rebuilt per meter in SQL from stored hourly
 * readings (`report_device_daily_energy`), with impossible jumps trimmed (phase42). On most days they agree
 * to the hundredth. They part where a counter reset, jumped or missed hours — and then the page showed one
 * number on Overview and another on Circuits.
 *
 * THE CIRCUITS' SUM IS THE FIGURE. Measured on the live rows (E-233): on 23 Sep 2026 the counter read
 * 17.26 kWh, the circuits 19.59 and the meters' average power over the day 21.00; the counter's week of
 * 21 Sep (80.53) was not the sum of its own days (75.17), while the circuits' week (77.88) was exactly the
 * sum of theirs. The circuits' figure adds up — across circuits, and from days to weeks to months — which
 * is what a report is read for. The counter stays on the page as a stated check, never a second total.
 *
 * A CIRCUIT WITH NO ROW keeps the counter: a sum missing a branch is not the building. A circuit whose
 * stored figure is impossible is named, and the sum says it is at least that much — the same words on
 * both tabs, since both now read this.
 */

export interface ConservedBuilding extends PeriodBuildingReport {
  /** The building counter's own figure, kept as the cross-check. */
  counter_kwh: number | null;
  /** Where `energy_kwh` came from. */
  energy_source: 'circuits' | 'counter';
  /** Building meters whose figure could not be counted — the total is then at least `energy_kwh`. */
  uncounted: string[];
}

const ALL_METERS = BUILDING_METER_IDS as readonly string[];

export function conservedBuilding(
  building: PeriodBuildingReport,
  rows: readonly PeriodDeviceReport[] | null,
  meterIds: readonly string[] = ALL_METERS
): ConservedBuilding {
  const counter: ConservedBuilding = { ...building, counter_kwh: building.energy_kwh, energy_source: 'counter', uncounted: [] };
  if (!rows || meterIds.length === 0) return counter;
  const byId = new Map(rows.map((r) => [r.device_id, r]));
  if (meterIds.some((id) => !byId.has(id))) return counter;
  const values = meterIds.map((id) => [id, usableEnergy(byId.get(id) as PeriodDeviceReport)] as const);
  const counted = values.filter(([, v]) => v !== null && Number.isFinite(v)).map(([, v]) => v as number);
  if (counted.length === 0) return { ...counter, uncounted: [...meterIds] };
  return {
    ...building,
    energy_kwh: counted.reduce((a, v) => a + v, 0),
    counter_kwh: building.energy_kwh,
    energy_source: 'circuits',
    uncounted: values.filter(([, v]) => v === null || !Number.isFinite(v)).map(([id]) => id),
  };
}

/** Each day as the sum of its circuits, so the bars add up to the period; everything else about the day
 *  (its coverage, its peak) stays the building series' own. A day a circuit did not report keeps the counter. */
export function conservedDaily(
  daily: DailyRow[],
  days: readonly DeviceDayRow[] | null,
  meterIds: readonly string[] = ALL_METERS
): DailyRow[] {
  if (!days) return daily;
  const meters = new Set(meterIds);
  const byDay = new Map<string, number[]>();
  for (const d of days) {
    if (!meters.has(d.device_id) || d.energy_kwh === null || !Number.isFinite(d.energy_kwh)) continue;
    const key = d.local_day.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), d.energy_kwh]);
  }
  return daily.map((d) => {
    const values = byDay.get(d.local_day.slice(0, 10));
    if (!values || values.length < meters.size) return d;
    return { ...d, energy_kwh: values.reduce((a, v) => a + v, 0) };
  });
}

/** The days on which the counter and the circuits part by a twentieth of a kilowatt-hour or more. */
export function differingDays(counter: readonly DailyRow[], circuits: readonly DailyRow[]): string[] {
  return counter
    .filter((d, i) => {
      const a = d.energy_kwh;
      const b = circuits[i]?.energy_kwh;
      return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) >= 0.05;
    })
    .map((d) => d.local_day.slice(0, 10));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "21 and 23 Sep", "30 Sep and 1 Oct". */
function dayList(dates: readonly string[]): string {
  const words = dates.map((d, i) => {
    const sameMonthAsNext = i < dates.length - 1 && dates[i + 1].slice(0, 7) === d.slice(0, 7);
    return sameMonthAsNext ? String(Number(d.slice(8, 10))) : `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
  });
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** The cross-check, in words — or nothing when there is nothing to say. */
export function counterNote(b: ConservedBuilding, days: readonly string[]): string | null {
  if (b.energy_source !== 'circuits' || b.counter_kwh === null || b.energy_kwh === null) return null;
  const diff = b.counter_kwh - b.energy_kwh;
  if (Math.abs(diff) < 0.05) return null;
  return (
    `The building's own counter read ${b.counter_kwh.toFixed(2)} kWh, ${Math.abs(diff).toFixed(2)} ${diff > 0 ? 'more' : 'less'} than its circuits. ` +
    'A meter counter that reset, jumped or missed hours moves one reading and not the other; the circuits are the figure that adds up across circuits and days' +
    (days.length > 0 ? ` (the two part on ${dayList(days)}).` : '.')
  );
}
