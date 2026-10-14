/**
 * Rows that reached the cloud late — RM-163, 2026-10-14.
 *
 * WHY. The site was offline from 7 to 14 October. When the link answered, ingest built the day reports for
 * 7 to 13 October and the week of 5 October from a cloud holding rows only to 7 Oct 15:29; the 200,000 rows
 * the edge had kept went up afterwards, and nothing would have rebuilt those reports. Ingest now records
 * every upload of rows older than `LATE_AFTER_MS` here, and the report pass rebuilds any period that overlaps
 * them and was built before they arrived (`server/reports.mjs`), once all its rows are up.
 *
 * ONE RECORD, widened as late uploads continue: `{ fromMs, untilMs, arrivedAtMs }`. A catch-up moves
 * `arrivedAtMs` on with every upload, but the report pass also waits for the edge to owe nothing from a
 * period before building it, so each period is rebuilt once, after its last late row. Normal uploads are
 * minutes old and never touch it.
 *
 * Kept in `server/data/report-late.json`, so a restart in the middle of a catch-up does not forget it.
 */

import fs from 'node:fs';
import path from 'node:path';

/** A day settles an hour after it ends (`DAY_GRACE_HOURS`); a row older than this may already be reported. */
export const LATE_AFTER_MS = 60 * 60 * 1000;

/**
 * The record after one upload. `span` is the drain's `uploadedSpan` (`server/archiveUpload.mjs`), or null.
 * @returns {{ fromMs: number, untilMs: number, arrivedAtMs: number } | null}
 */
export function noteLateUpload(late, span, nowMs, { lateAfterMs = LATE_AFTER_MS } = {}) {
  if (!span || !(nowMs - span.fromMs > lateAfterMs)) return late ?? null;
  const untilMs = Math.min(span.toMs, nowMs - lateAfterMs);
  return {
    fromMs: late ? Math.min(late.fromMs, span.fromMs) : span.fromMs,
    untilMs: late ? Math.max(late.untilMs, untilMs, span.fromMs) : Math.max(untilMs, span.fromMs),
    arrivedAtMs: nowMs,
  };
}

/** The kept record, or null when there is none or it cannot be read (a broken file is no record). */
export function readLate(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return ['fromMs', 'untilMs', 'arrivedAtMs'].every((k) => Number.isFinite(v?.[k])) ? v : null;
  } catch {
    return null;
  }
}

export function writeLate(file, late) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(late)}\n`);
  fs.renameSync(tmp, file);
}
