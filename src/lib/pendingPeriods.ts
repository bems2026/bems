import { SITE } from '@shared/siteConfig.mjs';
import { periodSettlesAt, REPORT_CHECK_MS } from '@shared/reportSchedule.mjs';
import { formatPeriod, type ReportPeriod } from './supabaseReports';
import { isSiteToday, siteDate, siteTimeShort } from './siteTime';

/**
 * Pure. The reports that do not exist YET, and when they will — RM-138.
 *
 * "The Sept 14 weekly report isn't available even though the week of Sept 21 has started" — the
 * operator, 2026-09-22 at 20:30 Manila. It was not late: the daemon waits two days after a week's UTC end,
 * so that week settles at 08:00 on the 23rd and is made at the daemon's next six-hourly look. But a week
 * that had ended and was not yet made was simply absent from the picker, and absent reads exactly like
 * a broken pipeline. These entries are what the page says instead: the period that has ended and is
 * waiting, and the one still running, each with the moment its report is due.
 *
 * THE MOMENTS ARE THE DAEMON'S, from `shared/reportSchedule.mjs`, which `server/reports.mjs` waits by —
 * so the page cannot promise 08:00 for a week the daemon holds until later.
 *
 * "OVERDUE" NEEDS EVIDENCE. Past the due moment plus one pass interval the report should exist; but a
 * list read before then cannot say it does not. So an entry is overdue only when the list itself was read
 * after that point (plus `OVERDUE_SLACK_MS`, for a pass that started on the last second) and still lacks
 * it. Until then it is "being made", which is true either way.
 *
 * Only the period just ended and the one running are named. An older period with no report is a gap in
 * the data, which the calendar already says as "No report for …".
 */

export type PendingState = 'in-progress' | 'settling' | 'due' | 'overdue';

export interface PendingPeriod {
  period: ReportPeriod;
  /** The period's start, as the stored reports name it. */
  start: string;
  /** What the stepper calls it — "Week of 14 Sep 2026". */
  name: string;
  state: PendingState;
  /** When the period itself ends, at the site's own midnight. */
  endsAt: number;
  /** From when the daemon will make its report. */
  dueAt: number;
  /** By when it should have: one pass interval after `dueAt`. */
  byAt: number;
  /** Where it stands, without its name — for a calendar cell that already names it. */
  status: string;
  /** Its name, then where it stands. */
  label: string;
}

/** A pass that begins on the last second of the interval still needs a moment to write its report. */
export const OVERDUE_SLACK_MS = 15 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOURS = Math.round(REPORT_CHECK_MS / (60 * 60 * 1000));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The start of the period holding `nowMs`, in the site's calendar. Weeks start on Monday, as the daemon's do. */
function startHolding(period: ReportPeriod, nowMs: number, offsetMinutes: number): string {
  const local = new Date(nowMs + offsetMinutes * 60 * 1000);
  if (period === 'month') return `${iso(local.getTime()).slice(0, 7)}-01`;
  if (period === 'week') return iso(local.getTime() - ((local.getUTCDay() + 6) % 7) * DAY_MS);
  return iso(local.getTime());
}

function startBefore(period: ReportPeriod, start: string): string {
  const t = Date.parse(`${start}T00:00:00Z`);
  if (period === 'day') return iso(t - DAY_MS);
  if (period === 'week') return iso(t - 7 * DAY_MS);
  const d = new Date(t);
  return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
}

function endOf(period: ReportPeriod, start: string, offsetMinutes: number): number {
  const t = Date.parse(`${start}T00:00:00Z`);
  const d = new Date(t);
  const next = period === 'day' ? t + DAY_MS : period === 'week' ? t + 7 * DAY_MS : Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return next - offsetMinutes * 60 * 1000;
}

/** "08:00, Wed, Sep 23" in the building's time; the date is left off when it is the building's today. */
function moment(t: number, nowMs: number, always = false): string {
  const time = siteTimeShort(t);
  return !always && isSiteToday(t, nowMs) ? time : `${time}, ${siteDate(t, { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

function statusOf(state: PendingState, dueAt: number, byAt: number, nowMs: number): string {
  switch (state) {
    case 'in-progress':
      return `in progress — ready after ${moment(dueAt, nowMs, true)}`;
    case 'settling':
      return `ready after ${moment(dueAt, nowMs, true)}`;
    case 'due':
      return `being made — reports are made every ${HOURS} hours, so by ${moment(byAt, nowMs)}`;
    case 'overdue':
      return `overdue — expected by ${moment(byAt, nowMs, true)} and not made yet; the report service may not be running`;
  }
}

export interface PendingOptions {
  offsetMinutes?: number;
  /** When the list of stored reports was last read — `null` when unknown, which never reads as overdue. */
  listReadAt?: number | null;
}

/** The period just ended and the one running, whichever has no stored report — ended first. */
export function pendingPeriods(
  period: ReportPeriod,
  starts: readonly string[],
  nowMs: number,
  { offsetMinutes = Number(SITE.utc_offset_minutes), listReadAt = null }: PendingOptions = {}
): PendingPeriod[] {
  const stored = new Set(starts.map((s) => s.slice(0, 10)));
  const running = startHolding(period, nowMs, offsetMinutes);
  const out: PendingPeriod[] = [];
  for (const start of [startBefore(period, running), running]) {
    if (stored.has(start)) continue;
    const endsAt = endOf(period, start, offsetMinutes);
    const dueAt = periodSettlesAt(period, start, offsetMinutes);
    const byAt = dueAt + REPORT_CHECK_MS;
    const state: PendingState =
      nowMs < endsAt
        ? 'in-progress'
        : nowMs < dueAt
          ? 'settling'
          : listReadAt !== null && listReadAt >= byAt + OVERDUE_SLACK_MS
            ? 'overdue'
            : 'due';
    const name = formatPeriod(period, start);
    const status = statusOf(state, dueAt, byAt, nowMs);
    out.push({ period, start, name, state, endsAt, dueAt, byAt, status, label: `${name} — ${status}` });
  }
  return out;
}

/** The next moment any entry would say something different, or `null` when none will. */
export function nextChangeAt(entries: readonly PendingPeriod[], nowMs: number): number | null {
  const later = entries.flatMap((p) => [p.endsAt, p.dueAt, p.byAt + OVERDUE_SLACK_MS]).filter((t) => t > nowMs);
  return later.length === 0 ? null : Math.min(...later);
}
