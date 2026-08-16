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
import { TIMING } from '../shared/registry.mjs';
import { splitLatestPayload, shapeDeviceRows } from './shapeRows.mjs';
import { makeSupabaseClient } from './supabaseRest.mjs';
import { appendToBuffer, readBuffer, writeBuffer, bufferCount } from './ingestBuffer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BRIDGE_URL = (process.env.BRIDGE_HTTP_URL || 'http://127.0.0.1:1880/api').replace(/\/+$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.INGEST_POLL_MS) || TIMING.HISTORY_SAMPLE_MS;
const DEVICE_SYNC_MS = Number(process.env.INGEST_DEVICE_SYNC_MS) || 5 * 60 * 1000;
const BUFFER_PATH = process.env.INGEST_BUFFER_PATH || path.join(__dirname, 'data', 'ingest-buffer.ndjson');

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
let lastError = null;

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

async function updateHealth(ok) {
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
  const latest = await fetchJson(`${BRIDGE_URL}/readings/latest`, TIMING.FETCH_TIMEOUT_MS);
  const { readings, totals } = splitLatestPayload(latest);

  // Drain any backlog first so buffered rows land before this cycle's, preserving order.
  try {
    await flushBuffer();
  } catch {
    // Still down — this cycle's writes below will also buffer; the flushBuffer error is
    // the same underlying failure, no need to log it twice.
  }

  let ok = true;
  try {
    await writeOrBuffer('readings', readings, 'device_id,ts');
  } catch (err) {
    ok = false;
    lastError = String(err);
  }
  if (totals) {
    try {
      await writeOrBuffer('building_totals', [totals], 'ts');
    } catch (err) {
      ok = false;
      lastError = String(err);
    }
  }

  await updateHealth(ok);

  const stamp = new Date().toISOString();
  if (ok) {
    console.log(`[ibems-ingest] ${stamp} wrote ${readings.length} readings${totals ? ' + totals' : ''}`);
  } else {
    console.error(`[ibems-ingest] ${stamp} Supabase unreachable, buffered (${bufferCount(BUFFER_PATH)} pending): ${lastError}`);
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

  const loop = async () => {
    if (stopping) return;
    try {
      await tick();
    } catch (err) {
      console.error('[ibems-ingest] tick error:', String(err));
    }
    if (!stopping) setTimeout(loop, POLL_MS);
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
