#!/usr/bin/env node
/**
 * ibems-server ingestion daemon — architecture plan Phase 3, job 1 of `ibems-server`'s
 * three jobs (ingestion / authenticated proxy / command gate — see the plan doc for the
 * other two, added in later phases).
 *
 * Polls the *real* Node-RED bridge (untouched, read-only, unchanged by this file) at the
 * same cadence its own history ring buffer already samples at (`TIMING.HISTORY_SAMPLE_MS`,
 * `shared/registry.mjs`), and upserts normalized rows into Supabase — turning that
 * in-memory 24h ring buffer into durable, queryable history without touching anything
 * that drives relays. On Supabase failure, writes are buffered locally (`ingestBuffer.mjs`)
 * and drained oldest-first on reconnect; no data is dropped, just delayed.
 *
 *     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node server/ingest.mjs
 *
 * See `server/.env.example` for all environment variables. Deploy as a systemd unit —
 * template at `server/ibems-ingest.service`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMING, METERED } from '../shared/registry.mjs';
import { shapeDeviceRows, shapeAnomalyRows } from './shapeRows.mjs';
import { makeSupabaseClient } from './supabaseRest.mjs';
import { appendToBuffer, readBuffer, writeBuffer, bufferCount } from './ingestBuffer.mjs';
import { selectAnomalyCandidates, detectAnomaly, pushSample } from './anomalyStats.mjs';
import { runIngestCycle, msUntilNextTick } from './ingestCycle.mjs';
import {
  runRetention,
  runTotalsRetention,
  runAnomalyRetention,
  DEFAULT_RETENTION_DAYS,
  RETENTION_CHECK_MS,
} from './retention.mjs';
import { runReportGeneration, REPORT_CHECK_MS } from './reports.mjs';
import { createFleetAlarm } from './fleetAlarm.mjs';
import { createNotifier, fleetMessage } from './notify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BRIDGE_URL = (process.env.BRIDGE_HTTP_URL || 'http://127.0.0.1:1880/api').replace(/\/+$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.INGEST_POLL_MS) || TIMING.HISTORY_SAMPLE_MS;

const DEVICE_SYNC_MS = Number(process.env.INGEST_DEVICE_SYNC_MS) || 5 * 60 * 1000;
const BUFFER_PATH = process.env.INGEST_BUFFER_PATH || path.join(__dirname, 'data', 'ingest-buffer.ndjson');
const RETENTION_DAYS = Number(process.env.INGEST_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;

/**
 * The out-of-dashboard alarm (FI-005). Inert unless NTFY_TOPIC is set — a deployment never
 * given a channel loses the feature rather than failing, matching how the Tuya client and the
 * cloud-dispatch fallback already treat missing configuration.
 *
 * Edge-triggered: createFleetAlarm returns an event only on a transition, never on every tick.
 * This daemon ticks once a minute, so a level check would send the same notification 480 times
 * overnight and the channel would simply be muted.
 */
const notifier = createNotifier(process.env);
const fleetAlarm = createFleetAlarm();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[ibems-ingest] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required — see server/.env.example');
  process.exit(1);
}

const supabase = makeSupabaseClient({
  url: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  timeoutMs: TIMING.FETCH_TIMEOUT_MS,
});

let stopping = false;

// The 11 devices with real power_w metering — outlet_dual (co1..co7) + meter
// (mtr_co_yellow/mtr_lo_red/mtr_arec_acu/mtr_lo_yellow). Reused from the registry, not
// hand-listed, so it can never drift from shared/registry.mjs.
const ANOMALY_METERED_IDS = new Set(METERED.map((d) => d.id));

// The daemon's only in-memory history — device_id -> its most recent power_w samples
// (anomalyStats.mjs's ANOMALY_WINDOW_SIZE, capped). Warm-up-from-empty on every process
// start: this daemon has never read from Supabase (see docs/storage-contract.md), and
// seeding this from a startup query would make ticking depend on Supabase being reachable
// at boot — exactly what the outage-buffer design exists to avoid. The cost is a bounded
// ANOMALY_MIN_SAMPLES-tick blind spot after every restart, not indefinite silence.
const anomalyWindows = new Map();

/** Runs anomaly detection for this tick's readings, updating anomalyWindows in place, and
 * returns only the flagged rows, shaped for the `anomalies` table. */
function detectAnomalies(readings) {
  const entries = [];
  for (const r of selectAnomalyCandidates(readings, ANOMALY_METERED_IDS)) {
    const window = anomalyWindows.get(r.device_id) ?? [];
    const detection = detectAnomaly(window, r.power_w);
    if (detection?.isAnomaly) {
      entries.push({ deviceId: r.device_id, ts: r.ts, value: r.power_w, detection });
    }
    anomalyWindows.set(r.device_id, pushSample(window, r.power_w));
  }
  return shapeAnomalyRows(entries);
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function syncDevices() {
  const devices = await fetchJson(`${BRIDGE_URL}/devices`, TIMING.FETCH_TIMEOUT_MS);
  await supabase.upsert('devices', shapeDeviceRows(devices), { onConflict: 'id' });
}

/** Drains the local buffer oldest-first. Stops and re-persists the remainder at the first
 * failure, preserving order rather than reordering around a stuck entry. */
async function flushBuffer() {
  const entries = readBuffer(BUFFER_PATH);
  if (entries.length === 0) return;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      await supabase.upsert(entry.table, entry.rows, entry.onConflict ? { onConflict: entry.onConflict } : undefined);
    } catch (err) {
      writeBuffer(BUFFER_PATH, entries.slice(i));
      throw err;
    }
  }
  writeBuffer(BUFFER_PATH, []);
}

async function writeOrBuffer(table, rows, onConflict) {
  if (rows.length === 0) return;
  try {
    await supabase.upsert(table, rows, onConflict ? { onConflict } : undefined);
  } catch (err) {
    appendToBuffer(BUFFER_PATH, { table, rows, onConflict, buffered_at: new Date().toISOString() });
    throw err;
  }
}

async function updateHealth(ok, lastError = null) {
  const row = {
    id: 1,
    buffered_row_count: bufferCount(BUFFER_PATH),
    last_error: ok ? null : lastError,
  };
  if (ok) row.last_success_at = new Date().toISOString();
  try {
    // Best-effort only — if Supabase is down this also fails, and that's fine: the next
    // successful tick corrects it. Not buffered; it's a derived status snapshot, not data.
    await supabase.upsert('ingestion_health', [row], { onConflict: 'id' });
  } catch {
    /* see comment above */
  }
}

async function tick() {
  const result = await runIngestCycle({
    fetchLatest: () => fetchJson(`${BRIDGE_URL}/readings/latest`, TIMING.FETCH_TIMEOUT_MS),
    flushBuffer,
    write: writeOrBuffer,
    detectAnomalies,
    updateHealth,
  });

  // Judged only on a cycle that actually reached the bridge. A bridge outage means we have no
  // idea what the devices are doing, and reporting that as "every device dropped" would be the
  // loudest possible way to be wrong.
  if (result.ok) {
    const event = fleetAlarm.observe(result.readings);
    if (event) {
      const msg = fleetMessage(event);
      console.log(`[ibems-ingest] fleet ${event.kind}${event.devices.length ? `: ${event.devices.join(', ')}` : ''}`);
      await notifier.notify(msg.title, msg.body, msg.priority);
    }
  }

  const stamp = new Date().toISOString();
  if (result.ok) {
    console.log(`[ibems-ingest] ${stamp} wrote ${result.readingCount} readings${result.hasTotals ? ' + totals' : ''}${result.anomalyCount ? ` + ${result.anomalyCount} anomalies` : ''}`);
  } else if (result.stage === 'bridge') {
    // Distinguished from the Supabase case on purpose: these are different outages with
    // different fixes, and conflating them in the log is how a 2.4/5 GHz band mismatch ends
    // up looking like a database problem.
    console.error(`[ibems-ingest] ${stamp} bridge unreachable, nothing to write: ${result.error}`);
  } else {
    console.error(`[ibems-ingest] ${stamp} Supabase unreachable, buffered (${bufferCount(BUFFER_PATH)} pending): ${result.error}`);
  }
}

/** The three tables that age out, and what each pass writes to the journal when it does
 * something. `readings` and `building_totals` roll up before pruning; `anomalies` prunes
 * outright on a far longer window — see server/retention.mjs for why each is treated as it
 * is. `commands` is deliberately absent: it is the audit trail for anything that moved a
 * relay, and nothing prunes it. */
const RETENTION_PASSES = [
  {
    run: runRetention,
    // Both raw tables share INGEST_RETENTION_DAYS: they are written by the same tick and
    // there is no coherent reading of "keep totals longer than the readings behind them".
    usesConfiguredWindow: true,
    describe: (r) => `rolled ${r.rolled} hour(s) into readings_hourly, pruned ${r.deleted} raw reading(s)`,
  },
  {
    run: runTotalsRetention,
    usesConfiguredWindow: true,
    describe: (r) => `rolled ${r.rolled} hour(s) into building_totals_hourly, pruned ${r.deleted} raw total(s)`,
  },
  {
    // Keeps its own much longer default window — see DEFAULT_ANOMALY_RETENTION_DAYS.
    run: runAnomalyRetention,
    usesConfiguredWindow: false,
    describe: (r) => `pruned ${r.deleted} anomal(ies) past the retention window`,
  },
];

/** One retention pass over every table that ages out, each guarded so it can never take the
 * daemon down with it — and, since Phase 11 made this three passes rather than one, so that
 * one table's failure cannot stop the other two from running. Ingesting is this process's
 * job; pruning is housekeeping, and housekeeping failing is not a reason to stop recording
 * the building's electricity. */
async function retentionPass() {
  for (const { run, usesConfiguredWindow, describe } of RETENTION_PASSES) {
    try {
      const result = await run({
        client: supabase,
        ...(usesConfiguredWindow ? { retentionDays: RETENTION_DAYS } : {}),
      });
      if (result.ran) {
        console.log(`[ibems-ingest] retention: ${describe(result)}`);
      } else {
        console.log(`[ibems-ingest] retention: nothing to do (${result.reason})`);
      }
    } catch (err) {
      console.error('[ibems-ingest] retention pass failed (will retry on the next check):', String(err));
    }
  }
}

/** One report-generation pass, guarded like the retention pass and for the same reason:
 * ingesting is this process's job, and a monthly summary failing is not a reason to stop
 * recording the building's electricity. */
async function reportPass() {
  try {
    const { generated, failed, reason } = await runReportGeneration({ client: supabase });
    if (generated.length > 0) {
      console.log(`[ibems-ingest] reports: generated ${generated.join(', ')}`);
    }
    for (const f of failed) {
      console.error(`[ibems-ingest] reports: ${f.month} failed (will retry on the next check): ${f.error}`);
    }
    if (generated.length === 0 && failed.length === 0) {
      // The real reason, not the most reassuring one — "every complete month already has a
      // report" is vacuously true when no month has finished at all, and reads to whoever is
      // scanning this journal as though reports exist.
      console.log(`[ibems-ingest] reports: nothing to do (${reason})`);
    }
  } catch (err) {
    console.error('[ibems-ingest] report pass failed (will retry on the next check):', String(err));
  }
}

async function main() {
  console.log(`[ibems-ingest] starting — bridge=${BRIDGE_URL} poll=${POLL_MS}ms buffer=${BUFFER_PATH}`);

  try {
    await syncDevices();
  } catch (err) {
    console.error('[ibems-ingest] initial device sync failed (will retry on the periodic sync):', String(err));
  }
  // Deliberately NOT .unref()'d — these timers ARE the daemon's heartbeat. Unref'ing them
  // told Node's event loop nothing depended on them, so the process exited cleanly right
  // after the first tick under systemd (no shell keeping it alive) instead of looping
  // forever. Caught via `systemctl status` showing "Deactivated successfully" after one
  // tick — manual smoke tests had been wrapped in `timeout`, which masked this.
  setInterval(() => {
    syncDevices().catch((err) => console.error('[ibems-ingest] device sync failed:', String(err)));
  }, DEVICE_SYNC_MS);

  // Retention asks the database whether anything has aged out — a question whose answer
  // changes once a day, so checking every 6h is generous. Not .unref()'d, for the same
  // reason the other two timers aren't (see the comment above).
  retentionPass();
  setInterval(retentionPass, RETENTION_CHECK_MS);

  // Same stateless shape as retention: ask which complete months lack a report and generate
  // those. See server/reports.mjs for why it waits out a grace period after a month ends.
  reportPass();
  setInterval(reportPass, REPORT_CHECK_MS);

  const loop = async () => {
    if (stopping) return;
    try {
      await tick();
    } catch (err) {
      console.error('[ibems-ingest] tick error:', String(err));
    }
    // Scheduled against the wall clock, not "POLL_MS after this tick finished" — see
    // msUntilNextTick. Keeps samples landing on consistent boundaries, which is what makes
    // an hourly rollup bucket hold a consistent number of them.
    if (!stopping) setTimeout(loop, msUntilNextTick(POLL_MS));
  };
  loop();
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[ibems-ingest] received ${sig}, shutting down`);
    stopping = true;
    process.exit(0);
  });
}

main();
