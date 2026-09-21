import { formatPeriod } from './supabaseReports';

/**
 * Pure. The stored reports laid out as a calendar — RM-103.
 *
 * The period picker's list of every stored report was a column of names grouped by year — right
 * for the three months that existed when it shipped, a scroll of 240 when there are twenty years
 * of them. A calendar reads the same list at a glance: twelve cells a year, or a row of week-starts
 * a month, and a period with no report is a cell that cannot be chosen rather than a name that is
 * silently not in the list.
 *
 * IT IS STILL THE STORED REPORTS, NOT THE CALENDAR'S IDEA OF WHAT EXISTS. A cell carries a `start`
 * only when a report exists for it; everything else it carries is for saying so — `name` is what
 * the cell would be called, so the reason for an empty cell reads "No report for March 2026" in
 * the words the stepper uses.
 *
 * Works on bare date strings in UTC, for the reason `formatMonth` gives: these are dates, not
 * instants, and a reader west of the meridian must not see the day before.
 */

export interface CalendarCell {
  /** The report's period start, or `null` when no report exists for this cell. */
  start: string | null;
  /** The calendar date this cell stands for, always set — the cell is a place even when empty. */
  date: string;
  /** What the cell shows: a short month, or a day of the month. */
  label: string;
  /** What the cell is called in full — the same words the stepper's label uses. */
  name: string;
}

export interface WeekRow {
  month: string;
  cells: CalendarCell[];
}

const DAY_MS = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const shortMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });

/** Each year with a report, once, newest first — the order `getReportPeriods` returns. */
export function yearsOf(starts: readonly string[]): string[] {
  return [...new Set(starts.map((s) => s.slice(0, 4)))];
}

/** Twelve cells, January to December, with a start only where that month's report exists. */
export function monthCells(year: string, starts: readonly string[]): CalendarCell[] {
  const y = Number(year);
  const stored = new Set(starts);
  return Array.from({ length: 12 }, (_, m) => {
    const date = `${year}-${String(m + 1).padStart(2, '0')}-01`;
    return { start: stored.has(date) ? date : null, date, label: shortMonth(y, m), name: formatPeriod('month', date) };
  });
}

/**
 * Every week of the year, on the weekday the stored weeks start, grouped by the month each week
 * begins in. Weekday from the stored weeks themselves — Monday when none is stored — so the grid
 * agrees with the reports rather than assuming what a week is.
 */
export function weekCells(year: string, starts: readonly string[]): WeekRow[] {
  const y = Number(year);
  const stored = new Set(starts);
  const weekday = starts.length > 0 ? new Date(`${starts[0].slice(0, 10)}T00:00:00Z`).getUTCDay() : 1;
  const rows: WeekRow[] = Array.from({ length: 12 }, (_, m) => ({ month: shortMonth(y, m), cells: [] }));
  let t = Date.UTC(y, 0, 1);
  while (new Date(t).getUTCDay() !== weekday) t += DAY_MS;
  for (; new Date(t).getUTCFullYear() === y; t += 7 * DAY_MS) {
    const d = new Date(t);
    const date = iso(t);
    rows[d.getUTCMonth()].cells.push({
      start: stored.has(date) ? date : null,
      date,
      label: String(d.getUTCDate()),
      name: formatPeriod('week', date),
    });
  }
  return rows;
}

/** Each month with a stored day, once, newest first — the pages a day calendar turns. RM-124. */
export function monthsOf(starts: readonly string[]): string[] {
  return [...new Set(starts.map((s) => s.slice(0, 7)))];
}

/** `September 2026`, for a day calendar's header. */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export interface DayGrid {
  /** Blank cells before the 1st, so the grid's columns are Monday to Sunday. */
  leading: number;
  cells: CalendarCell[];
}

/**
 * One month of days on a Monday-first grid, with a start only where that day's report exists —
 * RM-124. A month rather than a year, because 365 cells do not fit a popover and a day is chosen
 * by turning to its month first.
 */
export function dayCells(month: string, starts: readonly string[]): DayGrid {
  const [y, m] = month.split('-').map(Number);
  const stored = new Set(starts);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array.from({ length: days }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { start: stored.has(date) ? date : null, date, label: String(i + 1), name: formatPeriod('day', date) };
  });
  return { leading, cells };
}
