/**
 * When a stored report comes due — RM-138.
 *
 * WHY THIS FILE EXISTS. The daemon decides when a period has settled (`server/reports.mjs`) and the
 * page never knew. A week that had just ended was simply absent from the period picker — "indistinguishable,
 * to me, from a broken pipeline", the operator said on 2026-09-22 of the week of 14 September, which was
 * not late: it settles at 08:00 Manila on the 23rd. The page can only say when a report is due if it
 * waits by the same numbers the daemon waits by, so they live here and `server/reports.mjs` re-exports
 * them.
 *
 * THE ARITHMETIC IS THE DAEMON'S, stated once more as `periodSettlesAt` — the daemon's loops are not
 * rewritten to call it. `server/reports.test.mjs` sweeps the clock minute by minute across each kind of
 * period's settle point and fails the first minute the two disagree.
 *
 * Plain `.mjs` in `shared/` because both halves import it, as `scheduleDays.mjs` is: the browser through
 * vite's `@shared` alias, the daemon directly. No dependencies.
 */

/** Days to wait after a week or month ends before reporting it. `server/reports.mjs`'s header has the
 * reason: rows buffered during an outage flush late, and the hourly rollup runs every six hours. */
export const REPORT_GRACE_DAYS = 2;

/**
 * A day settles this long after its LOCAL midnight — RM-124. Not the weeks' two-day grace: the point of
 * a daily report is yesterday, and the ingest cadence is a minute, so an hour is ample for the last rows
 * to land and for a restart's second row to be written over.
 */
export const DAY_GRACE_HOURS = 1;

/** How often the daemon looks for missing reports. A settled period therefore appears at the first look
 * after it settles — up to this long after — which is what the page means by "by". */
export const REPORT_CHECK_MS = 6 * 60 * 60 * 1000; // 6h

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Pure. The instant, in ms, from which the daemon will generate this period's report.
 *
 * Weeks and months are reckoned in UTC and days at the site's offset — exactly as the daemon's loops do,
 * for the reasons their headers give: a local week or month ends BEFORE its UTC boundary here, so the UTC
 * wait is conservative, and a day reckoned in UTC would keep yesterday off the page until nine.
 *
 * @param {'day'|'week'|'month'} period
 * @param {string} start `YYYY-MM-DD`: a local date for a day, a Monday for a week, the 1st for a month.
 * @param {number} offsetMinutes The site's `utc_offset_minutes`; only a day uses it.
 * @returns {number}
 */
export function periodSettlesAt(period, start, offsetMinutes) {
  const startMs = Date.parse(`${String(start).slice(0, 10)}T00:00:00Z`);
  if (period === 'day') return startMs + DAY_MS - offsetMinutes * 60 * 1000 + DAY_GRACE_HOURS * HOUR_MS;
  if (period === 'week') return startMs + 7 * DAY_MS + REPORT_GRACE_DAYS * DAY_MS;
  const d = new Date(startMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) + REPORT_GRACE_DAYS * DAY_MS;
}
