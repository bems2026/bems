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
import { readFileSync } from 'node:fs';
import { SITE } from '../shared/registry.mjs';

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

// --- msUntilNextTick --------------------------------------------------------------------

test('schedules against the wall clock rather than "period after the last tick finished"', async () => {
  const { msUntilNextTick } = await import('./ingestCycle.mjs');
  const minute = 60_000;
  // 12:00:20.000 -> 40s until 12:01:00.000
  assert.equal(msUntilNextTick(minute, Date.parse('2026-08-21T12:00:20.000Z')), 40_000);
  assert.equal(msUntilNextTick(minute, Date.parse('2026-08-21T12:00:59.500Z')), 500);
});

test('never returns 0, so a tick landing exactly on a boundary does not fire twice', async () => {
  const { msUntilNextTick } = await import('./ingestCycle.mjs');
  assert.equal(msUntilNextTick(60_000, Date.parse('2026-08-21T12:00:00.000Z')), 60_000);
});

test('a tick that overran its period waits for the next boundary, not zero', async () => {
  const { msUntilNextTick } = await import('./ingestCycle.mjs');
  // Whatever the input, the answer is always a real wait inside one period.
  for (const offset of [1, 59_999, 30_000, 123_456_789]) {
    const d = msUntilNextTick(60_000, offset);
    assert.ok(d > 0 && d <= 60_000, `${offset} -> ${d}`);
  }
});

/**
 * RM-027 Task 6 — every writer names its own site instead of relying on the column default.
 *
 * The default added in phase20 exists so the migration and this deploy could happen in either
 * order; it is transitional, and RM-030 removes it. These assertions are what make removing it
 * safe: once the writers are explicit, dropping the default is a no-op rather than an outage.
 */
test('the building_totals row names the site it came from', async () => {
  const { io, calls } = harness();
  await runIngestCycle(io);
  const write = calls.writes.find((w) => w.table === 'building_totals');
  assert.equal(write.rows[0].site_id, SITE.id);
});

test('the site is taken from the site module, not spelled out a second time here', () => {
  // A literal would be a second place to edit when a site is stood up, and the two would
  // drift silently — which is the whole failure mode RM-027 exists to remove.
  const src = readFileSync(new URL('./ingestCycle.mjs', import.meta.url), 'utf8');
  assert.equal(/site_id:\s*'[a-z0-9-]+'/.test(src), false, 'site_id must not be a literal');
});
