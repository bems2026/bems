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
 * that drives relays. Since RM-148 every tick is committed to the Pi's own archive first
 * (`archiveDb.mjs`) and the cloud is fed from it (`archiveUpload.mjs`), so a Supabase or WAN
 * outage costs delay, not data. If the archive cannot be opened or written, the tick falls back
 * to the older path: straight to Supabase, buffered locally (`ingestBuffer.mjs`) on failure.
 *
 *     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node server/ingest.mjs
 *
 * See `server/.env.example` for all environment variables. Deploy as a systemd unit —
 * template at `server/ibems-ingest.service`.
 */

import './netDefaults.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIMING, METERED, SITE, DEVICE_REGISTRY } from '../shared/registry.mjs';
import { shapeDeviceRows, shapeAnomalyRows } from './shapeRows.mjs';
import { buildHealthRow, isMissingScrubColumnError, withoutScrubColumns } from './healthRow.mjs';
import { isMissingCapabilityColumnError, withoutCapabilityColumns } from './readingCapabilities.mjs';
import { makeSupabaseClient } from './supabaseRest.mjs';
import { appendToBuffer, readBuffer, writeBuffer, bufferCount } from './ingestBuffer.mjs';
import { takeBufferedCommands, restoreUndrained } from './auditQueue.mjs';
import { selectAnomalyCandidates, detectAnomaly, pushSample } from './anomalyStats.mjs';
import { runIngestCycle, msUntilNextTick } from './ingestCycle.mjs';
import { openArchive } from './archiveDb.mjs';
import { drainArchive } from './archiveUpload.mjs';
import { readingsForCloud } from './cloudCapabilities.mjs';
import { runHotTierPass } from './hotTier.mjs';
import { makeStorageClient } from './supabaseStorage.mjs';
import { RAW_RETENTION_DAYS } from '../shared/retention.mjs';
import {
  runRetention,
  runTotalsRetention,
  runAnomalyRetention,
  DEFAULT_RETENTION_DAYS,
  RETENTION_CHECK_MS,
} from './retention.mjs';
import { runReportGeneration, REPORT_CHECK_MS, retryingPass } from './reports.mjs';
import { monthlyReportNotices } from './reportNotice.mjs';
import { createFleetAlarm, loadKnownOnline, KNOWN_ONLINE_DAYS } from './fleetAlarm.mjs';
import { createNotifier, fleetMessage } from './notify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BRIDGE_URL = (process.env.BRIDGE_HTTP_URL || 'http://127.0.0.1:1880/api').replace(/\/+$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.INGEST_POLL_MS) || TIMING.HISTORY_SAMPLE_MS;

const DEVICE_SYNC_MS = Number(process.env.INGEST_DEVICE_SYNC_MS) || 5 * 60 * 1000;
const BUFFER_PATH = process.env.INGEST_BUFFER_PATH || path.join(__dirname, 'data', 'ingest-buffer.ndjson');
/**
 * Command audit rows the proxy recorded locally because Supabase was unreachable. A SEPARATE
 * file from the readings buffer above, deliberately: this one has two processes touching it
 * (the proxy appends, this drains), and mixing it into a buffer whose read-modify-write
 * assumes a single writer would put audit rows at risk of being dropped by a concurrent
 * rewrite. See auditQueue.mjs — these are the rows that say a relay moved.
 */
const COMMAND_BUFFER_PATHS = [
  process.env.COMMAND_AUDIT_BUFFER_PATH || path.join(__dirname, 'data', 'command-audit-buffer.ndjson'),
  process.env.SCHEDULER_AUDIT_BUFFER_PATH || path.join(__dirname, 'data', 'command-audit-buffer-scheduler.ndjson'),
];
const RETENTION_DAYS = Number(process.env.INGEST_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
/**
 * RM-148: the permanent raw archive. Under `server/data/` with the other live state, so CI's
 * "tests left no state behind" check and server/testStatePaths.test.mjs cover it too.
 */
const ARCHIVE_PATH = process.env.ARCHIVE_DB_PATH || path.join(__dirname, 'data', 'archive', 'archive.sqlite');
/** Each sealed UTC day, beside the archive, before and after it is copied off the edge. */
const SEALED_DIR = path.join(path.dirname(ARCHIVE_PATH), 'sealed');
/** The private bucket in the project's file storage that holds the sealed days. */
const ARCHIVE_BUCKET = process.env.ARCHIVE_BUCKET || 'ibems-archive';
/**
 * With an archive behind it, the cloud keeps RAW_RETENTION_DAYS (14) of raw rows; without one the
 * daemon keeps the pre-RM-148 window (RETENTION_DAYS, 30) rather than prune with nothing behind it.
 */
const HOT_DAYS = Number(process.env.INGEST_RETENTION_DAYS) || RAW_RETENTION_DAYS;
/**
 * RM-148 Stage 4 is the operator's to switch on, in `server/.env`, after the backfill (Stage 2) has
 * been read back and the bucket exists: `ARCHIVE_HOT_TIER=1`. Until then the raw tables keep the
 * 30-day window they have always had, whatever else is deployed — a restart for another stage must
 * not start pruning to 14 days.
 */
const HOT_TIER = process.env.ARCHIVE_HOT_TIER === '1';
/**
 * RM-148's operator switch for the one-time hot-tier reset. While this file exists the daemon keeps
 * archiving every tick but sends nothing to the cloud and runs no retention or reports, so the
 * cloud's raw tables can be emptied and reloaded from the archive without a gap or a half-read day.
 */
const PAUSE_PATH = process.env.INGEST_PAUSE_PATH || path.join(__dirname, 'data', 'ingest.pause');
const paused = () => fs.existsSync(PAUSE_PATH);

/**
 * The out-of-dashboard alarm (FI-005). Inert unless NTFY_TOPIC is set — a deployment never
 * given a channel loses the feature rather than failing, matching how the Tuya client and the
 * cloud-dispatch fallback already treat missing configuration.
 *
 * Edge-triggered: createFleetAlarm returns an event on a settled transition, a growth step or a
 * reminder interval (FLEET_ALARM_OPTIONS below), never on every tick.
 * This daemon ticks once a minute, so a level check would send the same notification 480 times
 * overnight and the channel would simply be muted.
 */
const notifier = createNotifier(process.env);
/**
 * Seeded at startup — see `loadKnownOnline`. `let`, not `const`, because the seed is a database
 * read and the alarm has to exist before it completes; an unseeded alarm is the pre-2026-09-03
 * behaviour, which is safe but blind to an outage that predates this process.
 */
/**
 * Settled, not instantaneous — 2026-09-26. The plain edge trigger sent 23 notices in two days while
 * one flaky outlet held the fleet at the threshold, then said nothing for three days while the
 * outage grew from 3 devices to 15. Entering takes 5 minutes of trouble and leaving 10 minutes of
 * health, at one tick a minute. A growth of 3 devices is reported, and a standing outage is repeated
 * every 12 hours, so nobody finds a weekend's outage on Monday.
 */
const FLEET_ALARM_OPTIONS = { enterAfter: 5, leaveAfter: 10, growBy: 3, remindEveryMs: 12 * 3600 * 1000 };
let fleetAlarm = createFleetAlarm(FLEET_ALARM_OPTIONS);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[ibems-ingest] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required — see server/.env.example');
  process.exit(1);
}

const supabase = makeSupabaseClient({
  url: SUPABASE_URL,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  timeoutMs: TIMING.FETCH_TIMEOUT_MS,
});
const storage = makeStorageClient({ url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY });

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
      // Through sendToCloud, so a buffered reading is slimmed exactly as a live one is (RM-148).
      await sendToCloud(entry.table, entry.rows, entry.onConflict);
    } catch (err) {
      writeBuffer(BUFFER_PATH, entries.slice(i));
      throw err;
    }
  }
  writeBuffer(BUFFER_PATH, []);
}

/**
 * Uploads the command audit rows the proxy recorded during an outage.
 *
 * Claimed by rotation rather than read-then-truncate, so a command arriving mid-drain cannot
 * be lost; anything that fails to upload is put straight back. Deliberately does NOT throw
 * into the ingest cycle: readings and the audit backlog fail independently, and a stuck audit
 * row must not stop telemetry being written.
 */
async function drainCommandAudit() {
  // One file per writing process — the proxy and the scheduler each amend their own entries
  // after dispatch, and two processes read-modify-writing one file would race. Draining a
  // list is what makes that separation free. See auditQueue.mjs.
  for (const bufferPath of COMMAND_BUFFER_PATHS) {
    const taken = takeBufferedCommands(bufferPath);
    if (taken.entries.length === 0) continue;

    const remaining = [];
    let uploaded = 0;
    for (let i = 0; i < taken.entries.length; i++) {
      const entry = taken.entries[i];
      try {
        await supabase.upsert(entry.table, entry.rows, entry.onConflict ? { onConflict: entry.onConflict } : undefined);
        uploaded++;
      } catch {
        // Stop at the first failure and keep the rest in order, matching flushBuffer. Retrying
        // the tail now would reorder the audit trail around a stuck row.
        remaining.push(...taken.entries.slice(i));
        break;
      }
    }
    restoreUndrained(bufferPath, taken, remaining);
    if (uploaded) {
      console.log(`[ibems-ingest] uploaded ${uploaded} command audit row(s) recorded during an outage${remaining.length ? `, ${remaining.length} still pending` : ''}`);
    }
  }
}

/**
 * Whether this database has had `supabase/phase28_reading_capabilities.sql` applied.
 *
 * `true` until something says otherwise. Settled by the first failure rather than a probe at
 * startup, exactly like `scrubColumnsPresent` — see `server/readingCapabilities.mjs` for why the
 * question has to be asked at all, and what it costs to get the answer wrong.
 */
let capabilityColumnsPresent = true;

/**
 * One upsert to Supabase, tolerating a database that predates phase28. Used by the archive's
 * uploader and by the direct fallback path alike, so both write the same thing.
 */
async function sendToCloud(table, rows, onConflict) {
  if (rows.length === 0) return;
  // RM-148: the cloud's copy of `capabilities` keeps measurements, switch state and the codes read
  // back out of it; the archive keeps everything (server/cloudCapabilities.mjs).
  const cloudRows = table === 'readings' ? readingsForCloud(rows) : rows;
  const payload = table === 'readings' && !capabilityColumnsPresent
    ? withoutCapabilityColumns(cloudRows)
    : cloudRows;
  try {
    await supabase.upsert(table, payload, onConflict ? { onConflict } : undefined);
  } catch (err) {
    // THE ORDERING HAZARD phase28's own header describes: PostgREST rejects an insert naming a
    // column that does not exist, so widening this daemon before the migration is applied "would
    // stop ingestion outright — on a table that is the history of a real building". Migrations
    // here are hand-applied, so the order is a human step. Rather than depend on getting it
    // right, say so once and keep writing everything that was written before.
    if (table === 'readings' && capabilityColumnsPresent && isMissingCapabilityColumnError(err)) {
      console.warn('[ibems-ingest] readings has no capability columns — apply supabase/phase28_reading_capabilities.sql. Recording without them; every pre-phase28 field is unaffected.');
      capabilityColumnsPresent = false;
      await supabase.upsert(table, withoutCapabilityColumns(cloudRows), onConflict ? { onConflict } : undefined);
      return;
    }
    throw err;
  }
}

/** The direct path's write: straight to Supabase, buffered to NDJSON when that fails. */
async function writeOrBuffer(table, rows, onConflict) {
  if (rows.length === 0) return;
  try {
    await sendToCloud(table, rows, onConflict);
  } catch (err) {
    // The full rows: the buffer is drained through sendToCloud, which slims them, and a buffer left
    // at a restart is taken into the archive, which keeps everything.
    appendToBuffer(BUFFER_PATH, { table, rows, onConflict, buffered_at: new Date().toISOString() });
    throw err;
  }
}

/**
 * RM-148. `null` when the archive could not be opened — the daemon then runs the pre-RM-148 way
 * rather than not at all, and says so loudly.
 */
let archive = null;
/** Edge-triggered, like the fleet alarm: one notice when the archive starts failing, one when it recovers. */
let archiveFailing = false;

function openArchiveOrFallBack() {
  try {
    archive = openArchive(ARCHIVE_PATH);
  } catch (err) {
    console.error(`[ibems-ingest] ARCHIVE UNAVAILABLE at ${ARCHIVE_PATH} — writing straight to Supabase instead: ${String(err)}`);
    return;
  }
  // The old NDJSON buffer's rows never reached the cloud. Take them into the archive, which now
  // owes them to the cloud, and set the file aside rather than deleting it.
  const leftover = readBuffer(BUFFER_PATH);
  if (leftover.length === 0) return;
  try {
    const counts = archive.importBufferEntries(leftover);
    const setAside = `${BUFFER_PATH}.imported-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.renameSync(BUFFER_PATH, setAside);
    console.log(`[ibems-ingest] took the outage buffer into the archive: ${counts.readings} readings, ${counts.building_totals} totals, ${counts.anomalies} anomalies (${counts.skipped} other entr${counts.skipped === 1 ? 'y' : 'ies'} left in ${setAside})`);
  } catch (err) {
    console.error(`[ibems-ingest] could not take the outage buffer into the archive; it stays where it is and drains the old way: ${String(err)}`);
  }
}

async function noteArchiveHealth(archiveError) {
  if (archiveError && !archiveFailing) {
    archiveFailing = true;
    await notifier.notify('iBEMS archive failing', `The Pi's raw archive refused a tick; readings are going straight to the cloud. ${archiveError}`, 'high');
  } else if (!archiveError && archiveFailing) {
    archiveFailing = false;
    await notifier.notify('iBEMS archive recovered', 'The Pi is archiving readings again.', 'default');
  }
}

function pendingCount() {
  let n = bufferCount(BUFFER_PATH);
  if (archive) {
    try {
      n += Object.values(archive.lag()).reduce((a, b) => a + b, 0);
    } catch { /* the health row is best-effort; the tick reports archive trouble itself */ }
  }
  return n;
}

/**
 * Whether this database has had `supabase/phase30_ingestion_scrub.sql` applied.
 *
 * `true` until something says otherwise, and settled by the first failure rather than by a
 * probe at startup — a probe costs a query on every boot to answer a question that is
 * permanently "yes" everywhere the migration has been applied. See
 * `server/healthRow.mjs` for why the question has to be asked at all.
 */
let scrubColumnsPresent = true;

async function updateHealth(ok, lastError = null, rejections = []) {
  const row = buildHealthRow({
    ok,
    lastError,
    rejections,
    // Since RM-148: rows the archive still owes the cloud, plus anything left in the old buffer.
    bufferedRowCount: pendingCount(),
    siteId: SITE.id,
    nowIso: new Date().toISOString(),
    withScrubColumns: scrubColumnsPresent,
  });
  try {
    // Best-effort only — if Supabase is down this also fails, and that's fine: the next
    // successful tick corrects it. Not buffered; it's a derived status snapshot, not data.
    await supabase.upsert('ingestion_health', [row], { onConflict: 'id' });
  } catch (err) {
    if (!isMissingScrubColumnError(err)) return; /* see comment above */
    // Loud, and once. The whole point of the scrub counters is that discarding data silently
    // is indistinguishable from not discarding it — a counter that silently fails to record
    // has the identical defect one level up.
    console.warn('[ibems-ingest] ingestion_health has no scrub columns — apply supabase/phase30_ingestion_scrub.sql. Recording health without them; the scrub itself is running and its rejections are in this journal.');
    scrubColumnsPresent = false;
    try {
      await supabase.upsert('ingestion_health', [withoutScrubColumns(row)], { onConflict: 'id' });
    } catch { /* the next tick corrects it, exactly as above */ }
  }
}

async function tick() {
  let synced = null;
  const result = await runIngestCycle({
    fetchLatest: () => fetchJson(`${BRIDGE_URL}/readings/latest`, TIMING.FETCH_TIMEOUT_MS),
    flushBuffer,
    write: writeOrBuffer,
    detectAnomalies,
    updateHealth,
    ...(archive ? {
      archive: (batch) => archive.insertTick(batch),
      sync: async () => (paused()
        ? { ok: false, error: `cloud upload paused by the operator (${PAUSE_PATH}); archiving continues` }
        : (synced = await drainArchive({ archive, send: sendToCloud }))),
    } : {}),
  });

  if (archive) await noteArchiveHealth(result.archiveError);
  if (result.archiveError) {
    console.error(`[ibems-ingest] archive refused this tick, sent straight to Supabase instead: ${result.archiveError}`);
  }
  if (synced?.rejected) {
    console.error(`[ibems-ingest] ${synced.rejected} row(s) refused by Supabase for good and quarantined in the archive (upload_rejects)`);
  }

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

  // Independent of the ingest cycle above: a command audit row is evidence that a relay moved,
  // so it must not be held hostage by a bridge outage that has nothing to do with it.
  await drainCommandAudit().catch((err) => console.error(`[ibems-ingest] command audit drain failed: ${err?.message ?? err}`));

  const stamp = new Date().toISOString();
  // Logged whatever else this tick did, and at error level: a refused field is data this
  // building produced and this system chose not to keep, so it belongs in the journal even on
  // an otherwise healthy tick. Silence here would make the guard indistinguishable from its
  // own absence, which is the thing it was built to end.
  if (result.rejectionCount) {
    console.error(`[ibems-ingest] ${stamp} scrub refused ${result.rejectionCount} field(s): ${result.rejections.map(String).join('; ')}`);
  }
  if (result.ok) {
    // A backlog drained this tick is said, so an outage's recovery is visible in the journal.
    const extra = synced ? synced.uploaded.readings - result.readingCount : 0;
    console.log(`[ibems-ingest] ${stamp} wrote ${result.readingCount} readings${result.hasTotals ? ' + totals' : ''}${result.anomalyCount ? ` + ${result.anomalyCount} anomalies` : ''}${result.archived ? ' (archived first)' : ''}${extra > 0 ? `, plus ${extra} backlog reading(s) from the archive` : ''}`);
  } else if (result.stage === 'payload') {
    console.error(`[ibems-ingest] ${stamp} bridge answered with an unusable payload, nothing to write: ${result.error}`);
  } else if (result.stage === 'bridge') {
    // Distinguished from the Supabase case on purpose: these are different outages with
    // different fixes, and conflating them in the log is how a 2.4/5 GHz band mismatch ends
    // up looking like a database problem.
    console.error(`[ibems-ingest] ${stamp} bridge unreachable, nothing to write: ${result.error}`);
  } else if (result.archived && paused()) {
    console.log(`[ibems-ingest] ${stamp} cloud upload paused by the operator (${PAUSE_PATH}); archived ${result.readingCount} readings, ${pendingCount()} row(s) waiting to upload`);
  } else if (result.archived) {
    console.error(`[ibems-ingest] ${stamp} Supabase unreachable, archived locally (${pendingCount()} row(s) waiting to upload): ${result.error}`);
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
  if (paused()) {
    console.log(`[ibems-ingest] retention: skipped, paused by the operator (${PAUSE_PATH})`);
    return;
  }
  // RM-148: with the archive behind it, the raw tables go through the verified janitor to HOT_DAYS,
  // after the pass seals complete days and copies them off the edge. Anomalies keep their own pass.
  const hot = Boolean(archive) && HOT_TIER;
  const passes = hot ? RETENTION_PASSES.filter((p) => !p.usesConfiguredWindow) : RETENTION_PASSES;
  if (hot) await hotTierPass();
  for (const { run, usesConfiguredWindow, describe } of passes) {
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

/** RM-148's hot tier: seal and copy off the edge, then prune the cloud where the edge holds it. */
async function hotTierPass() {
  const r = await runHotTierPass({
    client: supabase, archive, storage, bucket: ARCHIVE_BUCKET, siteId: SITE.id, sealedDir: SEALED_DIR, hotDays: HOT_DAYS,
  });
  if (r.seal.sealed.length || r.seal.uploaded.length) {
    console.log(`[ibems-ingest] archive: sealed ${r.seal.sealed.length} day-stream(s), copied ${r.seal.uploaded.length} off the edge`);
  }
  for (const e of r.seal.errors) console.error(`[ibems-ingest] archive: ${e}`);
  for (const stream of ['readings', 'building_totals']) {
    const s = r[stream];
    if (s.error) console.error(`[ibems-ingest] retention ${stream} failed (will retry on the next check): ${s.error}`);
    else if (s.steps) console.log(`[ibems-ingest] retention ${stream}: pruned ${s.deleted} raw row(s) in ${s.steps} verified step(s), rolled ${s.rolled} hour(s)${s.backfilled ? `, after copying ${s.backfilled} missing row(s) down` : ''}`);
    if (s.blocked) console.warn(`[ibems-ingest] retention ${stream}: held back — ${s.blocked}`);
    else if (!s.steps && !s.error) console.log(`[ibems-ingest] retention ${stream}: nothing to do (${s.reason})`);
  }
}

/** One report-generation pass, guarded like the retention pass and for the same reason:
 * ingesting is this process's job, and a monthly summary failing is not a reason to stop
 * recording the building's electricity. Resolves whether it succeeded, so a failure can be asked
 * again within minutes (RM-143, `retryingPass`) rather than at the next six-hourly check. */
async function reportPass() {
  if (paused()) {
    // Not a failure: a report made while the raw tables are being reloaded would read half a day.
    console.log(`[ibems-ingest] reports: skipped, paused by the operator (${PAUSE_PATH})`);
    return true;
  }
  try {
    const { generated, generatedWeeks = [], generatedDays = [], failed, reason } = await runReportGeneration({ client: supabase });
    if (generated.length > 0) {
      console.log(`[ibems-ingest] reports: generated months ${generated.join(', ')}`);
      // FI-011: the month goes to the alert channel, for the reader who will never open the
      // dashboard. Its own try/catch, because a push that failed is not a report that failed, and
      // logging it as one would send somebody looking for a missing report that exists.
      try {
        for (const notice of await monthlyReportNotices({ client: supabase, months: generated })) {
          await notifier.notify(notice.title, notice.body, notice.priority);
        }
      } catch (err) {
        console.error(`[ibems-ingest] reports: generated, but could not push the notice: ${String(err)}`);
      }
    }
    if (generatedWeeks.length > 0) {
      // Named as weeks, because a bare list of dates beside a list of first-of-months reads as
      // one list with some odd entries in it.
      console.log(`[ibems-ingest] reports: generated weeks ${generatedWeeks.join(', ')}`);
    }
    for (const f of failed) {
      console.error(`[ibems-ingest] reports: ${f.month} failed: ${f.error}`);
    }
    if (generatedDays.length > 0) {
      console.log(`[ibems-ingest] reports: generated days ${generatedDays.join(', ')}`);
    }
    if (generated.length === 0 && generatedWeeks.length === 0 && generatedDays.length === 0 && failed.length === 0) {
      // The real reason, not the most reassuring one — "every complete month already has a
      // report" is vacuously true when no month has finished at all, and reads to whoever is
      // scanning this journal as though reports exist.
      console.log(`[ibems-ingest] reports: nothing to do (${reason})`);
    }
    return failed.length === 0;
  } catch (err) {
    console.error('[ibems-ingest] report pass failed:', String(err));
    return false;
  }
}

/** RM-143: a failed pass is asked again after 10 min, 30 min, then hourly — see `REPORT_RETRY_MS`. */
const reportPassWithRetry = retryingPass(reportPass);

/**
 * Which devices have a history of working, so the fleet alarm can tell "broken" from "never set
 * up" on the very first tick after a restart.
 *
 * WHY IT EXISTS, measured 2026-09-03: the fleet fell from 18 devices to 4 and stayed there for
 * nine hours with no alert at all. This daemon had restarted with sixteen already offline, and
 * `createFleetAlarm` only counts a device as down once it has seen it UP — so none of them ever
 * qualified. The alarm was blind to the largest outage this system has had, and the case it
 * missed is exactly "the fleet came back up wrong".
 *
 * Seven days rather than all history: a device decommissioned a month ago should not raise an
 * alarm for being absent, and a week comfortably covers a weekend plus a public holiday.
 *
 * A FAILURE HERE IS NOT FATAL and must not be. It returns null, the alarm starts unseeded, and
 * the daemon behaves exactly as it did before — blind to a pre-existing outage, but never
 * alarming on devices it has no evidence about.
 */
async function main() {
  console.log(`[ibems-ingest] starting — bridge=${BRIDGE_URL} poll=${POLL_MS}ms archive=${ARCHIVE_PATH} buffer=${BUFFER_PATH} ` +
    `raw retention=${HOT_TIER ? `${HOT_DAYS} days, verified (hot tier on)` : `${RETENTION_DAYS} days (hot tier off)`}`);
  openArchiveOrFallBack();

  const knownOnline = await loadKnownOnline({
    select: supabase.select,
    deviceIds: DEVICE_REGISTRY.map((d) => d.id),
  });
  if (knownOnline?.length) {
    fleetAlarm = createFleetAlarm({ knownOnline, ...FLEET_ALARM_OPTIONS });
    console.log(`[ibems-ingest] fleet alarm seeded with ${knownOnline.length} of ${DEVICE_REGISTRY.length} device(s) seen online in the last ${KNOWN_ONLINE_DAYS} days`);
  } else {
    console.warn('[ibems-ingest] fleet alarm NOT seeded — it cannot report an outage that started before this process did');
  }

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
  reportPassWithRetry();
  setInterval(reportPassWithRetry, REPORT_CHECK_MS);

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
    // WAL already makes an interrupted tick all-or-nothing; closing checkpoints it tidily.
    try { archive?.close(); } catch { /* exiting regardless */ }
    process.exit(0);
  });
}

main();
