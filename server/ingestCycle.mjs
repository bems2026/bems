/**
 * One ingestion cycle, extracted from `server/ingest.mjs` so it can actually be tested.
 *
 * WHY THIS FILE EXISTS — the bug it fixes:
 * `tick()` used to call the bridge as its FIRST statement, outside any try/catch:
 *
 *     async function tick() {
 *       const latest = await fetchJson(`${BRIDGE_URL}/readings/latest`, ...);   // <- throws
 *       ...
 *       await updateHealth(ok);                                                 // <- never reached
 *     }
 *
 * A bridge timeout therefore threw straight out of `tick()`, was caught by `loop()`'s
 * catch, and logged — so `updateHealth` never ran and `ingestion_health` never recorded it.
 * The table that exists to answer "is ingestion healthy?" could only ever report
 * Supabase-side trouble, never bridge-side. Observed live on 2026-08-21: a clean health row
 * (`last_error: null`) while 18 of 20 devices were unreachable. A bridge outage was
 * indistinguishable from "hasn't ticked yet" — from the one row an operator would check.
 *
 * `server/ingest.test.mjs`'s own header used to note that this orchestration was untested
 * because it needs a live Supabase project. It doesn't: it needs its I/O passed in. Every
 * side effect is a parameter here, so the failure paths — the one that broke, especially —
 * are reachable from a plain unit test with no network and no mocking library.
 */

import { splitLatestPayload } from './shapeRows.mjs';

/**
 * Milliseconds until the next wall-clock multiple of `periodMs`.
 *
 * The loop used to reschedule with a flat `setTimeout(loop, POLL_MS)` AFTER awaiting the
 * tick, so each cycle's own duration was added to the interval. Measured on the live Pi:
 * 60.2s per cycle, about 0.2s of drift each time — roughly five minutes a day. Harmless
 * while every row stood alone, but Phase 9 groups these rows into hourly buckets, and a
 * cadence that slides relative to the clock puts a varying number of samples in each bucket.
 *
 * Always returns a value in (0, periodMs], so a tick that overran its own period schedules
 * the next one at the following boundary rather than firing immediately.
 *
 * Pure — exported for its own tests.
 */
export function msUntilNextTick(periodMs, nowMs = Date.now()) {
  const remainder = nowMs % periodMs;
  return remainder === 0 ? periodMs : periodMs - remainder;
}

/**
 * @param {{
 *   fetchLatest: () => Promise<unknown[]>,
 *   flushBuffer: () => Promise<void>,
 *   write: (table: string, rows: object[], onConflict: string) => Promise<void>,
 *   detectAnomalies: (readings: object[]) => object[],
 *   updateHealth: (ok: boolean, lastError: string|null, rejections: object[]) => Promise<void>,
 *   nowMs?: number,
 * }} io
 * @returns {Promise<{ok: boolean, stage: 'bridge'|'payload'|'supabase'|null, error: string|null,
 *                     readingCount: number, hasTotals: boolean, anomalyCount: number,
 *                     rejectionCount: number, readings: object[]}>}
 */
export async function runIngestCycle(io) {
  let latest;
  try {
    latest = await io.fetchLatest();
  } catch (err) {
    // The path that used to vanish. Record it before giving up, so `ingestion_health`
    // reflects the failure an operator is most likely to be looking for.
    const error = String(err);
    await io.updateHealth(false, error, []);
    return { ok: false, stage: 'bridge', error, readingCount: 0, hasTotals: false, anomalyCount: 0, rejectionCount: 0, rejections: [], readings: [] };
  }

  // INSIDE a try, unlike before. `splitLatestPayload` sat bare between the two guarded
  // sections, so a malformed bridge body threw straight past `updateHealth` and out of the
  // cycle — the exact shape of the bug this file's header describes for the fetch path, left
  // standing one line below the fix for it. It matters more now that the payload is scrubbed
  // here rather than merely reshaped: this is where new code runs.
  let readings, totals, rejections;
  try {
    ({ readings, totals, rejections } = splitLatestPayload(latest, io.nowMs ?? Date.now()));
  } catch (err) {
    const error = String(err);
    await io.updateHealth(false, error, []);
    // Its own stage, not 'bridge': "the bridge is unreachable" and "the bridge answered with
    // something unusable" are different faults with different fixes, and the daemon's journal
    // is where somebody goes to tell them apart.
    return { ok: false, stage: 'payload', error, readingCount: 0, hasTotals: false, anomalyCount: 0, rejectionCount: 0, rejections: [], readings: [] };
  }

  // Drain any backlog first so buffered rows land before this cycle's, preserving order.
  try {
    await io.flushBuffer();
  } catch {
    // Still down — this cycle's writes below will also buffer; the flushBuffer error is
    // the same underlying failure, no need to log it twice.
  }

  let ok = true;
  let error = null;
  const record = (err) => {
    ok = false;
    error = String(err);
  };

  try {
    await io.write('readings', readings, 'device_id,ts');
  } catch (err) {
    record(err);
  }

  if (totals) {
    try {
      await io.write('building_totals', [totals], 'ts');
    } catch (err) {
      record(err);
    }
  }

  const anomalyRows = io.detectAnomalies(readings);
  if (anomalyRows.length > 0) {
    try {
      await io.write('anomalies', anomalyRows, 'device_id,ts,metric');
    } catch (err) {
      record(err);
    }
  }

  await io.updateHealth(ok, error, rejections);

  return {
    ok,
    stage: ok ? null : 'supabase',
    error,
    readingCount: readings.length,
    hasTotals: Boolean(totals),
    anomalyCount: anomalyRows.length,
    // Fields the scrub refused this tick. Deliberately NOT folded into `ok`: a refused field
    // is the guard working, not the cycle failing, and conflating them would make a single
    // bad reading look like a database outage.
    rejectionCount: rejections.length,
    // The rejections themselves, not just the tally: `ingestion_health` can only record these
    // when Supabase is reachable, and a scrub firing DURING an outage is exactly when somebody
    // will want to know what it threw away. The journal is the record that survives that.
    rejections,
    // The rows themselves, for callers that need to judge the fleet rather than count it —
    // today the out-of-dashboard alarm (server/fleetAlarm.mjs). Returned rather than given its
    // own injected hook: this function's job is one cycle's worth of truth, and deciding what
    // to do with it belongs to the daemon, not here.
    readings,
  };
}
