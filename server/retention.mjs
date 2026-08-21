/**
 * Retention for the tables that grow without bound — Phase 9 (`readings`, closing ROADMAP
 * RM-006) and Phase 11 (`building_totals` and `anomalies`, which Phase 9 left untouched).
 *
 * `commands` is deliberately NOT among them: it is the audit trail for every attempt to move
 * a relay, and it is small. See supabase/phase11_totals_retention.sql's header.
 *
 * THE PROBLEM THIS SOLVES:
 * `server/ingest.mjs` has written one row per device per 60s tick since Phase 3 and nothing
 * has ever deleted one. Measured on the live Pi on 2026-08-21: 130,367 rows in 4.7 days,
 * ~27,700/day. Unbounded, and in the one table the whole Analytics page reads — when the
 * storage ceiling is reached, ingest's own writes start failing, which is the history record
 * stopping, not just a chart getting slow.
 *
 * THE POLICY: keep RETENTION_DAYS (default 30) of per-minute resolution; roll everything
 * older into permanent hourly buckets. The rollup and the prune happen inside one Postgres
 * function (`roll_up_and_prune_readings`, `supabase/phase9_readings_hourly.sql`) so they
 * share a transaction — a delete that commits without its rollup destroys the data. The
 * aggregation also stays in Postgres so this Pi never pulls ~800k rows over the uplink to
 * summarize them.
 *
 * WHY THE TRIGGER IS STATELESS:
 * there is no last-run timestamp on disk and no cron. Each pass asks the database a
 * question it can always answer — "is the oldest reading older than the window?" — and acts
 * on the answer. A restart cannot double-run it (the first pass left nothing old behind)
 * and cannot skip it (the next pass asks again). One less piece of state to get out of sync
 * with reality, in a daemon whose whole design already avoids depending on remembered state
 * across restarts (see ingest.mjs's `anomalyWindows` comment for the same reasoning).
 */

export const DEFAULT_RETENTION_DAYS = 30;

/**
 * `anomalies` gets a far longer window than `readings`, and no rollup — Phase 11.
 *
 * It is one row per FLAGGED tick rather than one per tick, so it grows in a different order
 * of magnitude, and it is derived from readings that are themselves retained. A year is long
 * enough that "was this device misbehaving last season?" stays answerable, and short enough
 * that the table is still bounded.
 */
export const DEFAULT_ANOMALY_RETENTION_DAYS = 365;

/** Don't re-ask the database on every 60s tick — the answer only changes once a day. */
export const RETENTION_CHECK_MS = 6 * 60 * 60 * 1000; // 6h

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pure. Should a retention pass run right now?
 *
 * @param {{ oldestTs: string|null, nowMs: number, retentionDays: number }} args
 *   `oldestTs` is the `ts` of the oldest surviving row, or null when the table is empty.
 * @returns {{ run: boolean, cutoffIso: string, reason: string }}
 */
export function shouldRunRetention({ oldestTs, nowMs, retentionDays = DEFAULT_RETENTION_DAYS, label = 'readings' }) {
  const cutoffMs = nowMs - retentionDays * DAY_MS;
  const cutoffIso = new Date(cutoffMs).toISOString();

  if (oldestTs === null || oldestTs === undefined) {
    return { run: false, cutoffIso, reason: `no ${label} yet` };
  }
  const oldestMs = Date.parse(oldestTs);
  if (Number.isNaN(oldestMs)) {
    // An unparseable timestamp is a reason to do nothing and say so, not a reason to guess.
    // This function's only destructive consequence is a DELETE; ambiguity resolves to "no".
    return { run: false, cutoffIso, reason: `unparseable oldest ts: ${oldestTs}` };
  }
  if (oldestMs >= cutoffMs) {
    return { run: false, cutoffIso, reason: `nothing older than the ${label} retention window` };
  }
  return { run: true, cutoffIso, reason: `oldest ${label} row ${oldestTs} predates the ${retentionDays}d window` };
}

/**
 * Runs one retention pass over one table, if one is due. Never throws for an ordinary
 * "nothing to do" — only a real Supabase failure propagates, and the caller in `ingest.mjs`
 * catches even that, because retention failing must never stop the daemon from ingesting.
 *
 * Generic over the table because Phase 11 added two more passes with identical shape. One
 * body rather than three near-copies, for the same reason `src/stores/retrySchedule.ts`
 * replaced four hand-copied backoff schedules (EX-030): three copies of a function whose
 * only destructive branch is a DELETE is three places for the guard to drift.
 *
 * @param {{ client: {select: Function, rpc: Function}, table: string, rpc: string,
 *           retentionDays: number, nowMs: number }} args
 * @returns {Promise<{ ran: boolean, rolled: number, deleted: number, reason: string }>}
 */
async function runPass({ client, table, rpc, retentionDays, nowMs }) {
  const oldest = await client.select(table, 'select=ts&order=ts.asc&limit=1');
  const oldestTs = Array.isArray(oldest) && oldest.length > 0 ? oldest[0].ts : null;

  const decision = shouldRunRetention({ oldestTs, nowMs, retentionDays, label: table });
  if (!decision.run) return { ran: false, rolled: 0, deleted: 0, reason: decision.reason };

  const result = await client.rpc(rpc, { p_before: decision.cutoffIso });
  // Every one of these functions `returns table (rolled int, deleted int)`, which PostgREST
  // serializes as a one-element array. Read the counts rather than assuming the call did
  // anything — the same "verify the affected-row count, never trust a bare 200" lesson as
  // commit 2e4c0c2.
  const row = Array.isArray(result) ? result[0] : result;
  return {
    ran: true,
    rolled: Number(row?.rolled ?? 0),
    deleted: Number(row?.deleted ?? 0),
    reason: decision.reason,
  };
}

/** `readings` — 30 days of per-minute resolution, rolled into permanent hourly buckets. */
export function runRetention({ client, retentionDays = DEFAULT_RETENTION_DAYS, nowMs = Date.now() } = {}) {
  return runPass({ client, table: 'readings', rpc: 'roll_up_and_prune_readings', retentionDays, nowMs });
}

/**
 * `building_totals` — same window and same rollup-then-prune treatment as `readings`.
 *
 * Rolled up rather than simply deleted because it holds `energy_kwh_week`,
 * `energy_kwh_month` and the per-phase currents: the building-wide figures a report has to
 * quote, which exist nowhere else once these rows are gone.
 */
export function runTotalsRetention({ client, retentionDays = DEFAULT_RETENTION_DAYS, nowMs = Date.now() } = {}) {
  return runPass({
    client,
    table: 'building_totals',
    rpc: 'roll_up_and_prune_building_totals',
    retentionDays,
    nowMs,
  });
}

/** `anomalies` — pruned outright on its own, much longer window. No rollup; see
 * DEFAULT_ANOMALY_RETENTION_DAYS. `rolled` always comes back 0 and means it. */
export function runAnomalyRetention({
  client,
  retentionDays = DEFAULT_ANOMALY_RETENTION_DAYS,
  nowMs = Date.now(),
} = {}) {
  return runPass({ client, table: 'anomalies', rpc: 'prune_anomalies', retentionDays, nowMs });
}
