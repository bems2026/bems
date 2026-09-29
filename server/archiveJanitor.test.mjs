/**
 * Tests for server/archiveJanitor.mjs — the verify-then-prune retention of RM-148, Stage 4.
 *
 * The only destructive thing in RM-148 is here: deleting raw rows from the cloud. So what is pinned
 * is when it does NOT: while a row older than the step is still waiting to upload, while the
 * archive holds fewer rows than the cloud for any device and hour it cannot fill, and while the
 * day is not sealed and copied off the edge.
 *
 * The cloud is a hand-rolled fake holding rows in an array: `select` answers the oldest-row query,
 * the manifest RPC counts per device and hour, and the rollup RPC deletes what is older than
 * `p_before` — which is all the janitor can observe of the real functions.
 *
 *     node --test server/archiveJanitor.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openArchive, ORIGIN } from './archiveDb.mjs';
import { runVerifiedPrune } from './archiveJanitor.mjs';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
const D0 = Date.parse('2026-09-01T00:00:00Z');
const NOW = D0 + 20 * DAY + 30 * MIN; // 14 days back is D0 + 6 days, 00:30 -> cutoff D0 + 6 days, 00:00

function tempArchive(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-janitor-test-'));
  const archive = openArchive(path.join(dir, 'archive.sqlite'));
  t.after(() => { archive.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return archive;
}

const reading = (ms, device = 'co1') => ({
  device_id: device, ts: new Date(ms).toISOString(), voltage: 230, current: 0.1, power_w: 10, energy_kwh_today: 0.1,
  online: true, total_energy_kwh: null, warn_power_w: null, power_type: null, net_state: null, fault: null, capabilities: null,
});

/** A cloud of readings, with the three calls the janitor makes. */
function cloud(rows, { selectShort = 0 } = {}) {
  const calls = { prunes: [], manifests: 0, selects: 0 };
  const client = {
    async select(table, query) {
      calls.selects++;
      if (query.startsWith('select=ts&order=ts.asc&limit=1')) {
        const oldest = rows.map((r) => Date.parse(r.ts)).sort((a, b) => a - b)[0];
        return oldest === undefined ? [] : [{ ts: new Date(oldest).toISOString() }];
      }
      // A window read by the backfill: device, gte and lt, as windowQuery writes them.
      const p = new URLSearchParams(query);
      const device = p.get('device_id')?.replace(/^eq\./, '');
      const [gte, lt] = p.getAll('ts').map((v) => Date.parse(v.replace(/^(gte|lt)\./, '')));
      const hit = rows.filter((r) => (!device || r.device_id === device) && Date.parse(r.ts) >= gte && Date.parse(r.ts) < lt);
      return hit.slice(0, Math.max(0, hit.length - selectShort));
    },
    async rpc(fn, args) {
      if (fn === 'readings_manifest') {
        calls.manifests++;
        const counts = new Map();
        for (const r of rows) {
          const ms = Date.parse(r.ts);
          if (ms < Date.parse(args.p_since) || ms >= Date.parse(args.p_until)) continue;
          const key = `${r.device_id}|${Math.floor(ms / HOUR) * HOUR}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return [...counts].map(([k, n]) => ({ device_id: k.split('|')[0], hour: new Date(Number(k.split('|')[1])).toISOString(), n }));
      }
      if (fn === 'roll_up_and_prune_readings') {
        calls.prunes.push(args.p_before);
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (Date.parse(rows[i].ts) < Date.parse(args.p_before)) rows.splice(i, 1);
        return [{ rolled: 1, deleted: before - rows.length }];
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return { client, calls, rows };
}

/** Three days older than the cutoff, one row an hour each, already in the archive as uploaded rows. */
function history(archive, { days = 3, from = D0 + 3 * DAY } = {}) {
  const rows = [];
  for (let ms = from; ms < from + days * DAY; ms += HOUR) rows.push(reading(ms));
  archive.insertRows('readings', rows, { origin: ORIGIN.cloud });
  return rows.map((r) => ({ ...r }));
}

const open = () => ({ sealed: true, reason: null });

test('nothing older than the window: nothing is asked and nothing is pruned', async (t) => {
  const archive = tempArchive(t);
  const { client, calls } = cloud([reading(NOW - HOUR)]);
  const result = await runVerifiedPrune({ client, archive, stream: 'readings', retentionDays: 14, nowMs: NOW, gate: open });
  assert.equal(result.ran, false);
  assert.deepEqual(calls.prunes, []);
  assert.equal(calls.manifests, 0);
});

test('an old backlog is pruned one UTC day at a time, up to an hour-aligned cutoff and never past it', async (t) => {
  const archive = tempArchive(t);
  const { client, calls, rows } = cloud(history(archive));
  const result = await runVerifiedPrune({ client, archive, stream: 'readings', retentionDays: 14, nowMs: NOW, gate: open });
  assert.deepEqual(calls.prunes, [
    new Date(D0 + 4 * DAY).toISOString(), new Date(D0 + 5 * DAY).toISOString(), new Date(D0 + 6 * DAY).toISOString(),
  ]);
  assert.equal(result.steps, 3);
  assert.equal(result.deleted, 72);
  assert.equal(result.blocked, null);
  assert.equal(rows.length, 0);
});

test('a cutoff that falls mid-day is taken down to the hour, so no partial hour is rolled up', async (t) => {
  // roll_up_and_prune_* rolls whole hours; a cutoff at 10:30 would roll 10:00-10:30 now and the rest never.
  const archive = tempArchive(t);
  const { client, calls } = cloud(history(archive, { days: 2, from: D0 + 5 * DAY }));
  const nowMs = D0 + 20 * DAY + 10 * HOUR + 30 * MIN;
  await runVerifiedPrune({ client, archive, stream: 'readings', retentionDays: 14, nowMs, gate: open });
  assert.deepEqual(calls.prunes, [new Date(D0 + 6 * DAY).toISOString(), new Date(D0 + 6 * DAY + 10 * HOUR).toISOString()]);
});

test('a row older than the step still waiting to upload blocks the prune', async (t) => {
  const archive = tempArchive(t);
  const { client, calls } = cloud(history(archive, { days: 1 }));
  archive.insertTick({ readings: [reading(D0 + 3 * DAY + 5 * MIN, 'co2')] }); // an ingest row the cloud has not had
  const result = await runVerifiedPrune({ client, archive, stream: 'readings', retentionDays: 14, nowMs: NOW, gate: open });
  assert.deepEqual(calls.prunes, []);
  assert.match(result.blocked, /still to upload/);
});

test('rows the archive lacks are copied down from the cloud first, then the day is pruned', async (t) => {
  const archive = tempArchive(t);
  const cloudRows = history(archive, { days: 1 });
  cloudRows.push(reading(D0 + 3 * DAY + 10 * MIN, 'co3')); // only in the cloud
  const { client, calls } = cloud(cloudRows);
  const result = await runVerifiedPrune({ client, archive, stream: 'readings', retentionDays: 14, nowMs: NOW, gate: open });
  assert.equal(result.backfilled, 1);
  assert.equal(archive.countRange('readings', { sinceMs: D0 + 3 * DAY, untilMs: D0 + 4 * DAY, deviceId: 'co3' }), 1);
  assert.equal(calls.prunes.length, 1);
});

test('a shortfall the cloud cannot fill blocks the prune rather than deleting rows the edge does not hold', async (t) => {
  const archive = tempArchive(t);
  const cloudRows = history(archive, { days: 1 });
  cloudRows.push(reading(D0 + 3 * DAY + 10 * MIN, 'co3'));
  const { client, calls } = cloud(cloudRows, { selectShort: 1 });
  const result = await runVerifiedPrune({ client, archive, stream: 'readings', retentionDays: 14, nowMs: NOW, gate: open });
  assert.deepEqual(calls.prunes, []);
  assert.match(result.blocked, /co3.*holds 0 of 1/);
});

test('a day not sealed and copied off the edge blocks the prune, and says why', async (t) => {
  const archive = tempArchive(t);
  const { client, calls } = cloud(history(archive, { days: 1 }));
  const gate = () => ({ sealed: false, reason: '2026-09-04 readings is sealed but not yet copied off the edge' });
  const result = await runVerifiedPrune({ client, archive, stream: 'readings', retentionDays: 14, nowMs: NOW, gate });
  assert.deepEqual(calls.prunes, []);
  assert.match(result.blocked, /not yet copied off the edge/);
});

test('a pass stops after its step budget and leaves the rest for the next', async (t) => {
  const archive = tempArchive(t);
  const { client, calls } = cloud(history(archive));
  const result = await runVerifiedPrune({ client, archive, stream: 'readings', retentionDays: 14, nowMs: NOW, gate: open, maxSteps: 2 });
  assert.equal(calls.prunes.length, 2);
  assert.match(result.reason, /budget/);
  assert.equal(result.blocked, null);
});

test('an unparseable oldest timestamp prunes nothing', async (t) => {
  const archive = tempArchive(t);
  const client = { select: async () => [{ ts: 'not-a-date' }], rpc: async () => { throw new Error('must not be called'); } };
  const result = await runVerifiedPrune({ client, archive, stream: 'readings', retentionDays: 14, nowMs: NOW, gate: open });
  assert.equal(result.ran, false);
  assert.match(result.blocked, /unparseable/);
});
