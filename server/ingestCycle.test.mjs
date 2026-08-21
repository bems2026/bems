/**
 * Tests for server/ingestCycle.mjs — the orchestration server/ingest.test.mjs's header used
 * to say could only be verified by hand against a live Supabase project.
 *
 * The headline case is `updates ingestion_health when the BRIDGE is unreachable`: that path
 * silently did nothing for the whole life of the daemon, because the bridge fetch sat
 * outside any try/catch and threw past the health update entirely.
 *
 * No mocking library, matching this repo's house style — every side effect is a plain
 * recording function passed in.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runIngestCycle } from './ingestCycle.mjs';

const LATEST = [
  { device_id: 'mtr_co_yellow', ts: 't1', voltage: 231.4, current: 6.5, power_w: 746.5, energy_kwh_today: 0, online: true },
  { device_id: 'co1', ts: 't1', voltage: 235.9, current: 0, power_w: 0, energy_kwh_today: 0.02, online: true },
  { device_id: '_totals', ts: 't1', total_power_w: 746.5, avg_voltage: 233, phase_current: { red: 1, yellow: 2, blue: null } },
];

function harness({ fetchLatest, write, flushBuffer, detectAnomalies } = {}) {
  const calls = { writes: [], health: [], flushes: 0 };
  const io = {
    fetchLatest: fetchLatest ?? (async () => LATEST),
    flushBuffer: flushBuffer ?? (async () => { calls.flushes++; }),
    write: write ?? (async (table, rows, onConflict) => { calls.writes.push({ table, rows, onConflict }); }),
    detectAnomalies: detectAnomalies ?? (() => []),
    updateHealth: async (ok, lastError) => { calls.health.push({ ok, lastError }); },
  };
  return { io, calls };
}

test('a healthy cycle writes readings and totals, and reports healthy', async () => {
  const { io, calls } = harness();
  const result = await runIngestCycle(io);

  assert.equal(result.ok, true);
  assert.equal(result.stage, null);
  assert.equal(result.readingCount, 2);
  assert.equal(result.hasTotals, true);
  assert.deepEqual(calls.writes.map((w) => w.table), ['readings', 'building_totals']);
  assert.deepEqual(calls.health, [{ ok: true, lastError: null }]);
});

test('updates ingestion_health when the BRIDGE is unreachable', async () => {
  // The regression this whole module exists for. Before the extraction, a throwing
  // fetchLatest escaped tick() entirely and updateHealth was never reached, so the health
  // row kept its last-known-good state while the bridge was down — observed live on
  // 2026-08-21 as `last_error: null` with 18 of 20 devices unreachable.
  const { io, calls } = harness({
    fetchLatest: async () => { throw new Error('AbortError: This operation was aborted'); },
  });
  const result = await runIngestCycle(io);

  assert.equal(result.ok, false);
  assert.equal(result.stage, 'bridge');
  assert.equal(calls.health.length, 1, 'the health row must be written on a bridge failure');
  assert.equal(calls.health[0].ok, false);
  assert.match(calls.health[0].lastError, /aborted/i);
});

test('a bridge failure writes nothing — no half-cycle, no fabricated rows', async () => {
  const { io, calls } = harness({ fetchLatest: async () => { throw new Error('ECONNREFUSED'); } });
  await runIngestCycle(io);
  assert.deepEqual(calls.writes, []);
});

test('distinguishes a bridge outage from a Supabase outage', async () => {
  // Different outages, different fixes. Collapsing them into one status is how a Wi-Fi band
  // mismatch ends up being investigated as a database problem.
  const bridge = harness({ fetchLatest: async () => { throw new Error('bridge down'); } });
  const supa = harness({ write: async () => { throw new Error('Supabase upsert readings -> 503'); } });

  assert.equal((await runIngestCycle(bridge.io)).stage, 'bridge');
  assert.equal((await runIngestCycle(supa.io)).stage, 'supabase');
});

test('a Supabase write failure still reports unhealthy with the error attached', async () => {
  const { io, calls } = harness({ write: async () => { throw new Error('Supabase upsert readings -> 503'); } });
  const result = await runIngestCycle(io);

  assert.equal(result.ok, false);
  assert.equal(result.stage, 'supabase');
  assert.equal(calls.health[0].ok, false);
  assert.match(calls.health[0].lastError, /503/);
});

test('drains the buffer before writing this cycle, so buffered rows keep their order', async () => {
  const order = [];
  const io = {
    fetchLatest: async () => LATEST,
    flushBuffer: async () => { order.push('flush'); },
    write: async (table) => { order.push(`write:${table}`); },
    detectAnomalies: () => [],
    updateHealth: async () => {},
  };
  await runIngestCycle(io);
  assert.equal(order[0], 'flush');
});

test('a still-failing buffer drain does not abort the cycle', async () => {
  // The drain failing and this cycle's writes failing are the same underlying outage; the
  // cycle should carry on and let writeOrBuffer append to the buffer as usual.
  const { io, calls } = harness({ flushBuffer: async () => { throw new Error('still down'); } });
  const result = await runIngestCycle(io);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.writes.map((w) => w.table), ['readings', 'building_totals']);
});

test('writes anomalies only when some were detected', async () => {
  const none = harness();
  await runIngestCycle(none.io);
  assert.equal(none.calls.writes.some((w) => w.table === 'anomalies'), false);

  const some = harness({ detectAnomalies: () => [{ device_id: 'co1', ts: 't1', metric: 'power_w' }] });
  const result = await runIngestCycle(some.io);
  assert.equal(result.anomalyCount, 1);
  const row = some.calls.writes.find((w) => w.table === 'anomalies');
  assert.equal(row.onConflict, 'device_id,ts,metric');
});

test('one failed table does not stop the others from being written', async () => {
  const { io, calls } = harness({
    write: async (table) => {
      calls.writes.push({ table });
      if (table === 'readings') throw new Error('readings failed');
    },
  });
  const result = await runIngestCycle(io);
  assert.deepEqual(calls.writes.map((w) => w.table), ['readings', 'building_totals']);
  assert.equal(result.ok, false);
});

test('uses the upsert conflict targets the schema actually declares', async () => {
  const { io, calls } = harness();
  await runIngestCycle(io);
  assert.equal(calls.writes.find((w) => w.table === 'readings').onConflict, 'device_id,ts');
  assert.equal(calls.writes.find((w) => w.table === 'building_totals').onConflict, 'ts');
});
