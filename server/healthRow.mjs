/**
 * The `ingestion_health` row, and the one question about writing it that has a right answer.
 *
 * Pure, and separate from `server/ingest.mjs` for the reason `server/ingestCycle.mjs` already
 * is: that file calls `process.exit(1)` on missing configuration, so nothing in it can be
 * imported by a test, and logic that lives there is logic nobody checks. The orchestration
 * stays there; the decisions live here.
 */

/** phase30's columns. Named once so the writer and the error-matcher cannot disagree. */
export const SCRUB_COLUMNS = ['scrub_rejected_count', 'scrub_last_reason', 'scrub_last_at'];

/**
 * @param {{ok: boolean, lastError: string|null, rejections: object[], bufferedRowCount: number,
 *           siteId: string, nowIso: string, withScrubColumns?: boolean}} input
 */
export function buildHealthRow({
  ok, lastError, rejections = [], bufferedRowCount, siteId, nowIso, withScrubColumns = true,
}) {
  const row = {
    id: 1,
    // RM-027. phase20 gives this column a default so the migration could land on a running
    // system, but a writer that knows its own site is what lets RM-030 drop that default.
    // `onConflict` stays `id`: this table is a singleton per database, and `unique (site_id)`
    // means only one row can exist per site anyway.
    site_id: siteId,
    buffered_row_count: bufferedRowCount,
    last_error: ok ? null : lastError,
  };
  if (ok) row.last_success_at = nowIso;

  if (withScrubColumns) {
    // WHAT THE SCRUB REFUSED — phase30. A guard that discards silently is the same failure
    // shape as a radio survey printing a clean band it never measured: the reassuring output
    // and the broken output are identical.
    //
    // The count is written on EVERY tick, including as 0, so a trickle of rejections shows up
    // as a number that keeps being non-zero rather than as one that has to be caught in the
    // act. The reason and its timestamp are written ONLY when there is one, so they stay
    // sticky across the clean ticks that follow — a single rejection an hour ago is exactly
    // what a per-tick counter erases, and exactly what is worth seeing.
    row.scrub_rejected_count = rejections.length;
    if (rejections.length) {
      row.scrub_last_reason = String(rejections[0]);
      row.scrub_last_at = nowIso;
    }
  }
  return row;
}

/**
 * Whether an upsert failure means phase30 has not been applied to this database yet.
 *
 * WHY THIS QUESTION EXISTS. Migrations here are applied by hand in the SQL editor (see
 * `docs/replication.md`), so the code and the schema move independently and the code can
 * arrive first. `updateHealth` swallows its own failures on purpose — it is a derived status
 * snapshot, not data — so without this the entire health row would 400 on the unknown columns
 * and vanish into that catch, freezing `last_success_at` at the moment of deployment. The row
 * an operator opens to ask "is ingestion healthy?" would go stale *because* ingestion gained a
 * health feature, and nothing anywhere would say so.
 *
 * Matches the column names rather than the error code alone: PGRST204 covers every unknown
 * column, and a genuine outage misread as a missing migration would downgrade the row for the
 * life of the process.
 */
export function isMissingScrubColumnError(err) {
  const text = String(err ?? '');
  return SCRUB_COLUMNS.some((column) => text.includes(column));
}

/** The same row without phase30's columns, for the retry. */
export function withoutScrubColumns(row) {
  const out = { ...row };
  for (const column of SCRUB_COLUMNS) delete out[column];
  return out;
}
