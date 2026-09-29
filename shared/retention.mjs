/**
 * How long the cloud keeps raw rows — RM-148.
 *
 * Since RM-148 the edge's archive keeps every raw row for good, so the hosted database needs raw
 * rows only for the recent charts and reports that read them directly. Fourteen days is the
 * operator's choice (2026-09-29): it covers a week's report with room to spare (a week settles two
 * days after it ends), and it keeps the Free plan's 500 MB database well clear of its cap (E-218).
 * Older history is read from the hourly rollups in the cloud, or from the edge.
 *
 * `server/ingest.mjs` prunes to it (through the verified janitor, `server/archiveJanitor.mjs`), and
 * the frontend reads it to know which tier holds a window. `INGEST_RETENTION_DAYS` on the edge
 * overrides it for the daemon.
 *
 * Without a working archive, the daemon falls back to the pre-RM-148 window of 30 days rather than
 * prune to 14 with nothing behind it (`server/retention.mjs`, `DEFAULT_RETENTION_DAYS`).
 */
export const RAW_RETENTION_DAYS = 14;
