/**
 * Draining the archive to Supabase — RM-148's uploader.
 *
 * Every tick commits locally first (`server/archiveDb.mjs`); this sends whatever the cloud does
 * not have yet, oldest first, in batches, and moves each stream's cursor only over rows the
 * cloud accepted. It replaces the NDJSON outage buffer for telemetry, and fixes three things that
 * buffer got wrong:
 *
 * - A BACKLOG CANNOT STARVE THE LIVE TICK. The tick waits for this, and a tick that overruns its
 *   minute skips the next sample. So the drain stops starting batches once `budgetMs` is spent,
 *   and carries on next tick.
 * - ONE BAD ROW CANNOT WEDGE EVERYTHING BEHIND IT. `readingCapabilities.mjs`'s header describes
 *   the wedge: a constraint violation rejects the whole batch, and the buffer replayed it at the
 *   head of every cycle for ever. A refusal that is about the data is bisected down to the row,
 *   which is quarantined in the archive, and the rest go up.
 * - A REFUSAL THAT IS ABOUT THE TABLE IS NOT BLAMED ON ROWS. A missing column fails every row
 *   alike; bisecting it to single rows and quarantining them all would discard an outage's worth
 *   of data for a deployment mistake. If isolation finds no row the cloud accepts, nothing is
 *   quarantined, nothing is skipped, and the error is reported instead.
 */

import { STREAMS } from './archiveDb.mjs';

export const UPLOAD_BATCH = 2000;
/** Well inside one 60 s tick, leaving room for the bridge fetch and one slow request. */
export const UPLOAD_BUDGET_MS = 20_000;

/**
 * How often the archive is drained to the cloud — RM-149. Every request to the hosted database is
 * a line in its log, and the Free plan's log quota was the tight one (0.97 of 1 GB, 2026-09-30).
 * The archive already holds every minute, so the cloud takes them five at a time. Nothing that acts
 * on the building reads these rows: the scheduler and the fleet alarm read the bridge.
 */
export const UPLOAD_INTERVAL_MS = 5 * 60_000;
/** Ticks are a minute apart and land a little either side of it; a tick this close counts as on time. */
const EARLY_SLACK_MS = 5_000;

/**
 * Is an upload due this tick? On the first tick, once the interval has passed, and at once when this
 * tick found an anomaly — the kiosk shows the last fifteen minutes of those, and five minutes late
 * would be a third of that window.
 */
export function uploadDue({ nowMs, lastUploadMs, intervalMs = UPLOAD_INTERVAL_MS, hasAnomalies = false }) {
  if (hasAnomalies || lastUploadMs === null || lastUploadMs === undefined) return true;
  return nowMs - lastUploadMs >= intervalMs - EARLY_SLACK_MS;
}

/**
 * `INGEST_UPLOAD_MS` as an interval. 0 is honoured (every tick, as before RM-149); anything that is
 * not a non-negative number falls back to the default, because NaN would make `uploadDue` false for
 * ever and leave the cloud waiting on anomalies alone.
 */
export function uploadIntervalFrom(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return UPLOAD_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : UPLOAD_INTERVAL_MS;
}

/** Worth trying again later, as opposed to a refusal of these particular rows. */
export function isTransientFailure(err) {
  const status = err?.status;
  if (typeof status !== 'number') return true; // no HTTP answer at all: the network or a timeout
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

class TableRefusal extends Error {
  constructor(cause) {
    super(String(cause?.message ?? cause));
    this.cause = cause;
  }
}

/**
 * @param {{
 *   archive: ReturnType<import('./archiveDb.mjs').openArchive>,
 *   send: (stream: string, rows: object[], onConflict: string) => Promise<void>,
 *   batchSize?: number, budgetMs?: number, now?: () => number,
 * }} io
 * @returns {Promise<{ ok: boolean, error: string|null, uploaded: Record<string, number>, rejected: number }>}
 */
export async function drainArchive({ archive, send, batchSize = UPLOAD_BATCH, budgetMs = UPLOAD_BUDGET_MS, now = Date.now }) {
  const start = now();
  const uploaded = Object.fromEntries(Object.keys(STREAMS).map((s) => [s, 0]));
  let rejected = 0;
  const errors = [];

  for (const [stream, { onConflict }] of Object.entries(STREAMS)) {
    for (;;) {
      if (now() - start >= budgetMs) break;
      const batch = archive.pending(stream, batchSize);
      if (batch.length === 0) break;
      const lastId = batch[batch.length - 1].id;

      try {
        await send(stream, batch.map((b) => b.row), onConflict);
        archive.advance(stream, lastId);
        uploaded[stream] += batch.length;
        continue;
      } catch (err) {
        if (isTransientFailure(err)) {
          // The network or the database is down: every stream would fail the same way.
          return { ok: false, error: String(err?.message ?? err), uploaded, rejected };
        }
      }

      // Refused for good. Find out whether it is some rows or the table.
      const state = { accepted: 0, streak: 0, limit: Math.ceil(Math.log2(batch.length)) + 1, failed: [] };
      try {
        await isolate(stream, batch, onConflict, send, state);
      } catch (err) {
        if (err instanceof TableRefusal) {
          errors.push(`${stream}: ${err.message}`);
          break; // this stream is stuck; the others may not be
        }
        return { ok: false, error: String(err?.message ?? err), uploaded, rejected };
      }
      if (state.accepted === 0) {
        errors.push(`${stream}: ${String(state.failed[0]?.err?.message ?? 'refused')}`);
        break;
      }
      for (const { item, err } of state.failed) archive.reject(stream, item.id, err?.message ?? err);
      archive.advance(stream, lastId);
      uploaded[stream] += state.accepted;
      rejected += state.failed.length;
    }
  }

  return { ok: errors.length === 0, error: errors.length ? errors.join('; ') : null, uploaded, rejected };
}

/**
 * Depth-first halving. A run of refusals with nothing accepted, longer than it takes to reach a
 * single row from the whole batch, means the table refuses everything — stop asking.
 */
async function isolate(stream, items, onConflict, send, state) {
  try {
    await send(stream, items.map((b) => b.row), onConflict);
    state.accepted += items.length;
    state.streak = 0;
    return;
  } catch (err) {
    if (isTransientFailure(err)) throw err;
    state.streak++;
    if (state.accepted === 0 && state.streak > state.limit) throw new TableRefusal(err);
    if (items.length === 1) {
      state.failed.push({ item: items[0], err });
      return;
    }
  }
  const mid = Math.ceil(items.length / 2);
  await isolate(stream, items.slice(0, mid), onConflict, send, state);
  await isolate(stream, items.slice(mid), onConflict, send, state);
}
