/**
 * Tests for server/reports.mjs — the monthly report generator (Phase 12).
 *
 * No mocking library, matching this repo's house style: the pure decision function is called
 * directly, and the I/O is exercised against a hand-rolled fake client that records what it
 * was asked to do. Same shape as retention.test.mjs, which this generator's stateless trigger
 * is modelled on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthsNeedingReport,
  runReportGeneration,
  REPORT_GRACE_DAYS,
  MAX_MONTHS_PER_PASS,
} from './reports.mjs';

const NOW = Date.parse('2026-08-21T12:00:00.000Z');

// --- monthsNeedingReport (pure) ----------------------------------------------------------

test('generates nothing when there is no data at all', () => {
  assert.deepEqual(monthsNeedingReport({ generatedMonths: [], earliestDataTs: null, nowMs: NOW }), []);
});

test('never reports the current month — it is not over yet', () => {
  // A partial month reported as a month is the same error as a truncated chart: a real
  // number presented as a complete one.
  const months = monthsNeedingReport({
    generatedMonths: [],
    earliestDataTs: '2026-08-01T00:00:00.000Z',
    nowMs: NOW,
  });
  assert.deepEqual(months, []);
});

test('waits out a grace period after a month ends before reporting it', () => {
  // Buffered rows flush late (ingestBuffer.mjs) and the rollup runs every 6h, so a month
  // reported at 00:01 on the 1st can be missing its own last hours.
  const earliest = '2026-07-01T00:00:00.000Z';
  const justAfter = Date.parse('2026-08-01T06:00:00.000Z');
  assert.deepEqual(monthsNeedingReport({ generatedMonths: [], earliestDataTs: earliest, nowMs: justAfter }), []);

  const afterGrace = Date.parse('2026-08-01T00:00:00.000Z') + (REPORT_GRACE_DAYS + 0.5) * 86400000;
  assert.deepEqual(monthsNeedingReport({ generatedMonths: [], earliestDataTs: earliest, nowMs: afterGrace }), ['2026-07-01']);
});

test('reports every complete month from where the data starts, oldest first', () => {
  const months = monthsNeedingReport({
    generatedMonths: [],
    earliestDataTs: '2026-04-17T09:30:00.000Z',
    nowMs: NOW,
  });
  assert.deepEqual(months, ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01']);
});

test('skips months already generated — the trigger is stateless, not incremental', () => {
  // Same property retention.mjs relies on: ask the database what is missing rather than
  // remember what was done, so a restart can neither double-run nor skip.
  const months = monthsNeedingReport({
    generatedMonths: ['2026-05-01', '2026-06-01'],
    earliestDataTs: '2026-04-17T09:30:00.000Z',
    nowMs: NOW,
  });
  assert.deepEqual(months, ['2026-04-01', '2026-07-01']);
});

test('accepts generated months however PostgREST rendered the date', () => {
  // A `date` column can come back as '2026-05-01' or as a full timestamp depending on the
  // client; treating those as different months would regenerate every report every pass.
  const months = monthsNeedingReport({
    generatedMonths: ['2026-05-01T00:00:00+00:00', '2026-06-01'],
    earliestDataTs: '2026-05-01T00:00:00.000Z',
    nowMs: NOW,
  });
  assert.deepEqual(months, ['2026-07-01']);
});

test('caps how many months one pass will generate', () => {
  // A first run against years of history should not hold the daemon in one long loop; the
  // next pass picks up where this one stopped, because nothing is remembered between them.
  const months = monthsNeedingReport({
    generatedMonths: [],
    earliestDataTs: '2015-01-01T00:00:00.000Z',
    nowMs: NOW,
  });
  assert.equal(months.length, MAX_MONTHS_PER_PASS);
  assert.equal(months[0], '2015-01-01', 'oldest first, so the backlog drains in order');
});

test('an unparseable earliest timestamp resolves to "do nothing", never to a guess', () => {
  assert.deepEqual(monthsNeedingReport({ generatedMonths: [], earliestDataTs: 'not-a-date', nowMs: NOW }), []);
});

// --- runReportGeneration (I/O against a fake client) --------------------------------------

function fakeClient({ generated = [], hourly = [], raw = [], onRpc } = {}) {
  const calls = { select: [], rpc: [] };
  return {
    calls,
    select: async (table, query) => {
      calls.select.push({ table, query });
      if (table === 'monthly_building_reports') return generated;
      if (table === 'readings_hourly') return hourly;
      return raw;
    },
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args });
      if (onRpc) return onRpc(fn, args);
      return [{ device_rows: 11, building_rows: 1 }];
    },
  };
}

test('generates each missing month through the RPC, oldest first', async () => {
  const client = fakeClient({ hourly: [{ hour: '2026-06-02T00:00:00Z' }] });
  const r = await runReportGeneration({ client, nowMs: NOW });

  assert.deepEqual(client.calls.rpc.map((c) => c.args.p_month), ['2026-06-01', '2026-07-01']);
  assert.equal(client.calls.rpc[0].fn, 'generate_monthly_report');
  assert.equal(r.generated.length, 2);
});

test('takes the earliest of the rollup and the raw table, not whichever it asked first', async () => {
  // readings is pruned at 30 days, so its oldest row is NEWER than the archive's. Trusting
  // it alone would silently skip every month that has already been rolled up.
  const client = fakeClient({
    hourly: [{ hour: '2026-05-04T00:00:00Z' }],
    raw: [{ ts: '2026-07-22T00:00:00Z' }],
  });
  await runReportGeneration({ client, nowMs: NOW });
  assert.equal(client.calls.rpc[0].args.p_month, '2026-05-01');
});

test('does nothing, and calls no RPC, when every complete month is already reported', async () => {
  const client = fakeClient({
    hourly: [{ hour: '2026-07-02T00:00:00Z' }],
    generated: [{ month: '2026-07-01' }],
  });
  const r = await runReportGeneration({ client, nowMs: NOW });
  assert.equal(client.calls.rpc.length, 0);
  assert.deepEqual(r.generated, []);
});

test('one month failing does not abandon the rest of the backlog', async () => {
  // A report is per-month and independent; a bad month should not cost the good ones, the
  // same reasoning useAnalyticsHistory's Promise.allSettled follows for per-device fetches.
  const client = fakeClient({
    hourly: [{ hour: '2026-05-02T00:00:00Z' }],
    onRpc: (_fn, args) => {
      if (args.p_month === '2026-06-01') throw new Error('boom');
      return [{ device_rows: 11, building_rows: 1 }];
    },
  });
  const r = await runReportGeneration({ client, nowMs: NOW });

  assert.deepEqual(r.generated, ['2026-05-01', '2026-07-01']);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].month, '2026-06-01');
});

test('asks for the oldest row with an explicit limit — never an uncapped select', async () => {
  // PostgREST silently caps at db-max-rows and gives no signal that it did.
  const client = fakeClient({ hourly: [{ hour: '2026-07-02T00:00:00Z' }] });
  await runReportGeneration({ client, nowMs: NOW });
  for (const call of client.calls.select) {
    assert.match(call.query, /limit=/, `${call.table} select should be explicitly bounded`);
  }
});
