/**
 * Tests for server/retention.mjs — the `readings` retention pass (Phase 9, ROADMAP RM-006).
 *
 * No mocking library, matching this repo's house style: the pure decision function is
 * called directly, and `runRetention`'s I/O is exercised against a hand-rolled fake client
 * that records what it was asked to do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRunRetention,
  runRetention,
  runTotalsRetention,
  runAnomalyRetention,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_ANOMALY_RETENTION_DAYS,
} from './retention.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-21T12:00:00.000Z');

// --- shouldRunRetention (pure) ---------------------------------------------------------

test('does not run when the table is empty', () => {
  const d = shouldRunRetention({ oldestTs: null, nowMs: NOW, retentionDays: 30 });
  assert.equal(d.run, false);
  assert.match(d.reason, /no readings/i);
});

test('does not run when every row is inside the window', () => {
  const d = shouldRunRetention({ oldestTs: new Date(NOW - 5 * DAY).toISOString(), nowMs: NOW, retentionDays: 30 });
  assert.equal(d.run, false);
  assert.match(d.reason, /nothing older/i);
});

test('runs when the oldest row predates the window', () => {
  const d = shouldRunRetention({ oldestTs: new Date(NOW - 45 * DAY).toISOString(), nowMs: NOW, retentionDays: 30 });
  assert.equal(d.run, true);
  assert.equal(d.cutoffIso, new Date(NOW - 30 * DAY).toISOString());
});

test('an unparseable timestamp resolves to "do nothing", never to a guess', () => {
  // The only destructive consequence of a `true` here is a DELETE, so ambiguity has exactly
  // one safe direction.
  const d = shouldRunRetention({ oldestTs: 'not-a-date', nowMs: NOW, retentionDays: 30 });
  assert.equal(d.run, false);
  assert.match(d.reason, /unparseable/i);
});

test('a row exactly at the cutoff is kept, not pruned', () => {
  const d = shouldRunRetention({ oldestTs: new Date(NOW - 30 * DAY).toISOString(), nowMs: NOW, retentionDays: 30 });
  assert.equal(d.run, false);
});

test('defaults to a 30-day window when none is given', () => {
  assert.equal(DEFAULT_RETENTION_DAYS, 30);
  const inside = shouldRunRetention({ oldestTs: new Date(NOW - 29 * DAY).toISOString(), nowMs: NOW });
  const outside = shouldRunRetention({ oldestTs: new Date(NOW - 31 * DAY).toISOString(), nowMs: NOW });
  assert.equal(inside.run, false);
  assert.equal(outside.run, true);
});

// --- runRetention (I/O against a fake client) ------------------------------------------

function fakeClient({ oldestTs, rpcResult = [{ rolled: 7, deleted: 120 }], onRpc } = {}) {
  const calls = { select: [], rpc: [] };
  return {
    calls,
    select: async (table, query) => {
      calls.select.push({ table, query });
      return oldestTs === null ? [] : [{ ts: oldestTs }];
    },
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args });
      if (onRpc) return onRpc(fn, args);
      return rpcResult;
    },
  };
}

test('asks for the oldest row with an explicit limit — never an uncapped select', async () => {
  // PostgREST silently caps at db-max-rows and gives no signal that it did; an explicit
  // limit is what makes "this is all of it" a claim the caller actually made. See
  // supabase/phase9_history_buckets.sql for the bug that taught this.
  const client = fakeClient({ oldestTs: new Date(NOW - 5 * DAY).toISOString() });
  await runRetention({ client, nowMs: NOW });
  assert.equal(client.calls.select.length, 1);
  assert.match(client.calls.select[0].query, /limit=1\b/);
});

test('does not call the destructive RPC when nothing is due', async () => {
  const client = fakeClient({ oldestTs: new Date(NOW - 5 * DAY).toISOString() });
  const result = await runRetention({ client, nowMs: NOW });
  assert.equal(result.ran, false);
  assert.equal(client.calls.rpc.length, 0, 'a no-op pass must not issue a DELETE');
});

test('calls the RPC with the hour-window cutoff and reports the real counts', async () => {
  const client = fakeClient({ oldestTs: new Date(NOW - 45 * DAY).toISOString() });
  const result = await runRetention({ client, nowMs: NOW });
  assert.equal(client.calls.rpc.length, 1);
  assert.equal(client.calls.rpc[0].fn, 'roll_up_and_prune_readings');
  assert.equal(client.calls.rpc[0].args.p_before, new Date(NOW - 30 * DAY).toISOString());
  assert.deepEqual({ ran: result.ran, rolled: result.rolled, deleted: result.deleted }, {
    ran: true, rolled: 7, deleted: 120,
  });
});

test('reads the counts from the response rather than assuming the call did anything', async () => {
  // A PostgREST call can return 200 with an empty result — the write-path lesson from
  // commit 2e4c0c2. Reporting "pruned!" off a bare 200 would repeat it.
  const client = fakeClient({ oldestTs: new Date(NOW - 45 * DAY).toISOString(), rpcResult: [] });
  const result = await runRetention({ client, nowMs: NOW });
  assert.equal(result.ran, true);
  assert.equal(result.rolled, 0);
  assert.equal(result.deleted, 0);
});

test('propagates a real Supabase failure rather than reporting a silent success', async () => {
  const client = fakeClient({
    oldestTs: new Date(NOW - 45 * DAY).toISOString(),
    onRpc: () => { throw new Error('Supabase POST /rpc/roll_up_and_prune_readings -> 503'); },
  });
  await assert.rejects(() => runRetention({ client, nowMs: NOW }), /503/);
});

test('a second pass right after a successful one is a no-op — the trigger is stateless', async () => {
  // No last-run file, no cron: the first pass leaves nothing older than the window, so the
  // second pass's own query answers "nothing to do". A restart cannot double-run or skip.
  const afterPrune = fakeClient({ oldestTs: new Date(NOW - 29 * DAY).toISOString() });
  const result = await runRetention({ client: afterPrune, nowMs: NOW });
  assert.equal(result.ran, false);
  assert.equal(afterPrune.calls.rpc.length, 0);
});

// --- Phase 11: the two tables Phase 9 left unbounded ------------------------------------

test('the totals pass reads building_totals and calls its own rollup function', async () => {
  const client = fakeClient({ oldestTs: new Date(NOW - 45 * DAY).toISOString() });
  const r = await runTotalsRetention({ client, retentionDays: 30, nowMs: NOW });

  assert.equal(client.calls.select[0].table, 'building_totals');
  assert.match(client.calls.select[0].query, /limit=1/);
  assert.equal(client.calls.rpc[0].fn, 'roll_up_and_prune_building_totals');
  assert.equal(client.calls.rpc[0].args.p_before, new Date(NOW - 30 * DAY).toISOString());
  assert.equal(r.ran, true);
  assert.equal(r.deleted, 120);
});

test('the anomaly pass prunes on its own, much longer window — not the readings one', async () => {
  // An anomaly 60 days old is still inside the anomaly window and must survive a pass that
  // would have pruned a reading of the same age.
  const client = fakeClient({ oldestTs: new Date(NOW - 60 * DAY).toISOString() });
  const r = await runAnomalyRetention({ client, nowMs: NOW });

  assert.equal(r.ran, false);
  assert.equal(client.calls.rpc.length, 0, 'nothing older than 365d, so nothing to delete');
  assert.equal(DEFAULT_ANOMALY_RETENTION_DAYS, 365);
});

test('the anomaly pass does prune once rows pass its own window', async () => {
  const client = fakeClient({ oldestTs: new Date(NOW - 400 * DAY).toISOString(), rpcResult: [{ rolled: 0, deleted: 9 }] });
  const r = await runAnomalyRetention({ client, nowMs: NOW });

  assert.equal(client.calls.select[0].table, 'anomalies');
  assert.equal(client.calls.rpc[0].fn, 'prune_anomalies');
  assert.equal(r.ran, true);
  assert.equal(r.deleted, 9);
  assert.equal(r.rolled, 0, 'anomalies are pruned outright — there is no rollup to report');
});

test('every pass refuses to call its destructive RPC when nothing is due', async () => {
  // The guarantee that matters most: a pass that has nothing to do must touch nothing.
  for (const run of [runRetention, runTotalsRetention, runAnomalyRetention]) {
    const client = fakeClient({ oldestTs: new Date(NOW - 1 * DAY).toISOString() });
    const r = await run({ client, nowMs: NOW });
    assert.equal(r.ran, false);
    assert.equal(client.calls.rpc.length, 0);
  }
});

test('every pass is a no-op on an empty table rather than pruning a window it cannot see', async () => {
  for (const run of [runRetention, runTotalsRetention, runAnomalyRetention]) {
    const client = fakeClient({ oldestTs: null });
    const r = await run({ client, nowMs: NOW });
    assert.equal(r.ran, false);
    assert.equal(client.calls.rpc.length, 0);
  }
});

test('each pass names its own table in the "nothing to do" reason, not always "readings"', async () => {
  // The three run on one schedule and log to one journal. A reason that always said
  // "readings" would make an anomaly-pass no-op indistinguishable from a readings one.
  const client = fakeClient({ oldestTs: new Date(NOW - 1 * DAY).toISOString() });
  const totals = await runTotalsRetention({ client, nowMs: NOW });
  assert.match(totals.reason, /building_totals/i);
});
