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
  weeksNeedingReport,
  MAX_WEEKS_PER_PASS,
} from './reports.mjs';

/** A report the daemon itself would have written: generated after its month settled. This is the
 * shape the PURE function takes. */
function settled(month, generatedAt) {
  return { month, generated_at: generatedAt };
}

/**
 * The same fact in the shape the DATABASE returns it — `period_start`, not `month`.
 *
 * The two are separate on purpose. `runReportGeneration` reads `period_building_reports` and maps
 * its rows into the pure function's shape, so a fixture using the pure shape for the client made
 * every month look ungenerated and the daemon regenerated all of them. The failure was two RPC
 * calls where none were expected, which reads as a logic bug and was a fixture in the wrong
 * shape.
 */
function reported(periodStart, generatedAt) {
  return { period_start: periodStart, generated_at: generatedAt };
}

const NOW = Date.parse('2026-08-21T12:00:00.000Z');

/**
 * Every week that has settled by NOW, already reported — so a test about MONTHS is not derailed
 * by the weekly backlog also being empty. The daemon does both in one pass (RM-041), and a test
 * asserting "no RPC was called" has to satisfy both halves or it is asserting the wrong thing.
 *
 * Built from the same rule the daemon applies rather than hard-coded, so it cannot drift out of
 * agreement with `weeksNeedingReport` the way a literal list would.
 */
function allWeeksSettled(fromTs = '2026-01-01T00:00:00Z') {
  // Walked directly rather than via `weeksNeedingReport`, which caps at MAX_WEEKS_PER_PASS and
  // would leave a backlog behind — the cap is the daemon's pacing, not a statement about which
  // weeks exist.
  const out = [];
  const d = new Date(Date.parse(fromTs));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  for (let t = d.getTime(); t + 9 * 24 * 60 * 60 * 1000 <= NOW; t += 7 * 24 * 60 * 60 * 1000) {
    out.push({ period_start: new Date(t).toISOString().slice(0, 10), generated_at: '2099-01-01T00:00:00Z' });
  }
  return out;
}

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
    generatedMonths: [settled('2026-05-01', '2026-06-03T01:00:00Z'), settled('2026-06-01', '2026-07-03T01:00:00Z')],
    earliestDataTs: '2026-04-17T09:30:00.000Z',
    nowMs: NOW,
  });
  assert.deepEqual(months, ['2026-04-01', '2026-07-01']);
});

test('accepts generated months however PostgREST rendered the date', () => {
  // A `date` column can come back as '2026-05-01' or as a full timestamp depending on the
  // client; treating those as different months would regenerate every report every pass.
  const months = monthsNeedingReport({
    generatedMonths: [
      settled('2026-05-01T00:00:00+00:00', '2026-06-03T01:00:00Z'),
      settled('2026-06-01', '2026-07-03T01:00:00Z'),
    ],
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

function fakeClient({ generated = [], generatedWeeks = [], hourly = [], raw = [], onRpc } = {}) {
  const calls = { select: [], rpc: [] };
  return {
    calls,
    select: async (table, query) => {
      calls.select.push({ table, query });
      // RM-041: the daemon asks `period_building_reports`, not phase12's table, because that is
      // what the Reports page reads — a month "done" in the old table and absent from the new
      // one is a month the page shows nothing for.
      if (table === 'period_building_reports') return query.includes('period=eq.week') ? generatedWeeks : generated;
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

  const monthCalls = client.calls.rpc.filter((c) => c.fn === 'generate_period_report' && c.args.p_period === 'month');
  assert.deepEqual(monthCalls.map((c) => c.args.p_start), ['2026-06-01', '2026-07-01']);
  assert.equal(r.generated.length, 2);
  // phase12's function is still called alongside, on purpose and temporarily — its tables are
  // no longer read but keeping them current is what makes the two aggregations comparable.
  assert.equal(client.calls.rpc.filter((c) => c.fn === 'generate_monthly_report').length, 2);
});

test('takes the earliest of the rollup and the raw table, not whichever it asked first', async () => {
  // readings is pruned at 30 days, so its oldest row is NEWER than the archive's. Trusting
  // it alone would silently skip every month that has already been rolled up.
  const client = fakeClient({
    hourly: [{ hour: '2026-05-04T00:00:00Z' }],
    raw: [{ ts: '2026-07-22T00:00:00Z' }],
  });
  await runReportGeneration({ client, nowMs: NOW });
  assert.equal(client.calls.rpc[0].args.p_start, '2026-05-01');
});

test('does nothing, and calls no RPC, when every complete month is already reported', async () => {
  const client = fakeClient({
    hourly: [{ hour: '2026-07-02T00:00:00Z' }],
    generated: [reported('2026-07-01', '2026-08-03T01:00:00Z')],
    // Every settled WEEK too, or the pass would still have weeks to generate and call the RPC.
    generatedWeeks: allWeeksSettled(),
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
      // Scoped to the MONTH: 2026-06-01 is also a Monday, so an unscoped throw would fail
      // that week too and this test would be about two failures rather than one.
      if (args.p_month === '2026-06-01' || (args.p_period === 'month' && args.p_start === '2026-06-01')) throw new Error('boom');
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

// --- regenerating a report that was built too early --------------------------------------

test('regenerates a month whose report was built before the month finished settling', () => {
  // The trap this closes: generate a report by hand mid-month and the old rule - "months
  // with no row" - would never look at it again, freezing that month at partial data even
  // though generate_monthly_report upserts and would happily rebuild it.
  const months = monthsNeedingReport({
    generatedMonths: [settled('2026-07-01', '2026-07-15T00:00:00Z')], // mid-July, before July ended
    earliestDataTs: '2026-07-01T00:00:00.000Z',
    nowMs: NOW,
  });
  assert.deepEqual(months, ['2026-07-01']);
});

test('leaves a report alone once it was generated after its month settled', () => {
  // Self-limiting: the daemon only ever generates at or after the settle point, so its own
  // reports are never rebuilt. Without this the pass would regenerate every month forever.
  const months = monthsNeedingReport({
    generatedMonths: [settled('2026-07-01', '2026-08-03T01:00:00Z')],
    earliestDataTs: '2026-07-01T00:00:00.000Z',
    nowMs: NOW,
  });
  assert.deepEqual(months, []);
});

test('a report generated exactly at the settle point counts as current', () => {
  const settleMs = Date.parse('2026-08-01T00:00:00.000Z') + REPORT_GRACE_DAYS * 86400000;
  const months = monthsNeedingReport({
    generatedMonths: [settled('2026-07-01', new Date(settleMs).toISOString())],
    earliestDataTs: '2026-07-01T00:00:00.000Z',
    nowMs: NOW,
  });
  assert.deepEqual(months, []);
});

test('an unparseable or missing generated_at is treated as stale, not as current', () => {
  // Ambiguity resolves toward regenerating, because regenerating is idempotent and cheap
  // while skipping leaves a wrong number in place - the opposite direction from
  // shouldRunRetention, whose only destructive branch is a DELETE.
  for (const bad of [settled('2026-07-01', 'not-a-date'), { month: '2026-07-01' }, '2026-07-01']) {
    const months = monthsNeedingReport({
      generatedMonths: [bad],
      earliestDataTs: '2026-07-01T00:00:00.000Z',
      nowMs: NOW,
    });
    assert.deepEqual(months, ['2026-07-01'], `expected ${JSON.stringify(bad)} to be treated as stale`);
  }
});

// --- the "nothing to do" reason ----------------------------------------------------------

test('says no month has settled yet, rather than claiming every month has a report', () => {
  // The old line read "every complete month already has one", which is vacuously true when
  // there are no complete months at all - and reads to whoever is scanning the journal as
  // though reports exist.
  // Data recent enough that NOTHING has settled — not a month and not a week either. An earlier
  // version seeded every week as already reported, which after RM-041 means reports DO exist and
  // made this assert the opposite sentence.
  const client = fakeClient({ hourly: [{ hour: '2026-08-19T00:00:00Z' }] });
  return runReportGeneration({ client, nowMs: NOW }).then((r) => {
    assert.deepEqual(r.generated, []);
    assert.deepEqual(r.generatedWeeks, [], 'the week containing 19 August has not ended by the 21st');
    assert.match(r.reason, /no period has finished settling/i);
  });
});

test('says reports are current only when some actually exist', async () => {
  const client = fakeClient({
    hourly: [{ hour: '2026-07-02T00:00:00Z' }],
    generated: [reported('2026-07-01', '2026-08-03T01:00:00Z')],
    generatedWeeks: allWeeksSettled('2026-07-02T00:00:00Z'),
  });
  const r = await runReportGeneration({ client, nowMs: NOW });
  assert.match(r.reason, /already has a current report/i);
});

test('says there are no readings at all when the tables are empty', async () => {
  const client = fakeClient({});
  const r = await runReportGeneration({ client, nowMs: NOW });
  assert.match(r.reason, /no readings/i);
});

test('asks for generated_at, not just the month — staleness cannot be judged without it', async () => {
  const client = fakeClient({ hourly: [{ hour: '2026-06-02T00:00:00Z' }] });
  await runReportGeneration({ client, nowMs: NOW });
  // `period_building_reports` now, not phase12's table — see the fake client's comment.
  const call = client.calls.select.find((c) => c.table === 'period_building_reports');
  assert.match(call.query, /generated_at/);
});

// --- weeksNeedingReport (pure) — RM-041 ---------------------------------------------------

test('a week is named by its Monday, whatever day the data starts on', () => {
  // 2026-07-02 is a Thursday. The report is for the week it falls in, not for a Thursday-to-
  // Wednesday span that would agree with no other caller's idea of that week.
  const weeks = weeksNeedingReport({ generatedWeeks: [], earliestDataTs: '2026-07-02T00:00:00Z', nowMs: NOW });
  assert.equal(weeks[0], '2026-06-29');
  assert.equal(new Date(`${weeks[0]}T00:00:00Z`).getUTCDay(), 1, 'every key must be a Monday');
});

test('a Sunday steps back six days, not one', () => {
  // `getUTCDay()` is 0 for Sunday, so `- getUTCDay()` would leave Sunday as its own week start
  // and split a week in two. This is the off-by-one the expression exists to avoid.
  const weeks = weeksNeedingReport({ generatedWeeks: [], earliestDataTs: '2026-07-05T12:00:00Z', nowMs: NOW });
  assert.equal(weeks[0], '2026-06-29');
});

test('does not report a week until it has ended and been given the grace period', () => {
  // The week beginning 2026-08-17 has not ended by the 21st, so nothing may claim it.
  const weeks = weeksNeedingReport({ generatedWeeks: [], earliestDataTs: '2026-08-01T00:00:00Z', nowMs: NOW });
  assert.ok(!weeks.includes('2026-08-17'), 'an unfinished week must not be reported');
  // ...and 2026-08-10 IS settled by then: it ended on the 17th and its two grace days were up on
  // the 19th. A first version of this test asserted it was still pending, which was an assertion
  // about arithmetic I had got wrong rather than about the code.
  assert.ok(weeks.includes('2026-08-10'), 'a week whose grace period has elapsed must be reported');

  // The grace period itself, shown at a moment when a week is actually inside it: 2026-08-10
  // ended on the 17th, so on the 18th it has ended but late-flushing rows may still be landing.
  const duringGrace = weeksNeedingReport({
    generatedWeeks: [], earliestDataTs: '2026-08-01T00:00:00Z', nowMs: Date.parse('2026-08-18T12:00:00Z'),
  });
  assert.ok(!duringGrace.includes('2026-08-10'), 'a week inside its grace period must not be reported');
});

test('rebuilds a week whose report was generated before it settled, exactly once', () => {
  const early = [{ period_start: '2026-06-29', generated_at: '2026-07-01T00:00:00Z' }];
  assert.ok(weeksNeedingReport({ generatedWeeks: early, earliestDataTs: '2026-06-29T00:00:00Z', nowMs: NOW }).includes('2026-06-29'));

  const afterSettling = [{ period_start: '2026-06-29', generated_at: '2026-07-09T00:00:00Z' }];
  assert.ok(!weeksNeedingReport({ generatedWeeks: afterSettling, earliestDataTs: '2026-06-29T00:00:00Z', nowMs: NOW }).includes('2026-06-29'));
});

test('caps a backlog rather than looping through a year of history in one pass', () => {
  const weeks = weeksNeedingReport({ generatedWeeks: [], earliestDataTs: '2025-01-01T00:00:00Z', nowMs: NOW });
  assert.equal(weeks.length, MAX_WEEKS_PER_PASS);
});

test('says nothing to do when there are no readings, rather than guessing a start', () => {
  assert.deepEqual(weeksNeedingReport({ generatedWeeks: [], earliestDataTs: null, nowMs: NOW }), []);
  assert.deepEqual(weeksNeedingReport({ generatedWeeks: [], earliestDataTs: 'not-a-date', nowMs: NOW }), []);
});

test('generates missing weeks through the period RPC, oldest first', async () => {
  const client = fakeClient({
    hourly: [{ hour: '2026-07-02T00:00:00Z' }],
    generated: [reported('2026-07-01', '2026-08-03T01:00:00Z')],
  });
  const r = await runReportGeneration({ client, nowMs: NOW });
  const weekCalls = client.calls.rpc.filter((c) => c.fn === 'generate_period_report' && c.args.p_period === 'week');
  assert.deepEqual(weekCalls.slice(0, 2).map((c) => c.args.p_start), ['2026-06-29', '2026-07-06']);
  assert.ok(r.generatedWeeks.length > 0, 'the pass must report which weeks it generated');
});

test('one week failing does not abandon the rest, nor the months', async () => {
  const client = fakeClient({
    hourly: [{ hour: '2026-07-02T00:00:00Z' }],
    generated: [reported('2026-07-01', '2026-08-03T01:00:00Z')],
    onRpc: (fn, args) => {
      if (args.p_period === 'week' && args.p_start === '2026-07-06') throw new Error('boom');
      return [{ device_rows: 11, building_rows: 1 }];
    },
  });
  const r = await runReportGeneration({ client, nowMs: NOW });
  assert.ok(r.generatedWeeks.includes('2026-06-29'), 'the week before the bad one must still be generated');
  assert.ok(r.generatedWeeks.includes('2026-07-13'), 'and so must the one after it');
  assert.deepEqual(r.failed.map((f) => f.month), ['2026-07-06']);
});

test('counts weeks towards "reports exist", not only months', async () => {
  // OBSERVED ON THE LIVE PI. Two weeks were reported and current while no month had settled, and
  // the daemon logged "no period has finished settling yet" — untrue, and reassuring in the
  // wrong direction. A deployment younger than a month is precisely when weekly reports are the
  // only ones there are.
  const client = fakeClient({
    hourly: [{ hour: '2026-08-02T00:00:00Z' }],
    generated: [],
    generatedWeeks: allWeeksSettled('2026-08-02T00:00:00Z'),
  });
  const r = await runReportGeneration({ client, nowMs: NOW });
  assert.deepEqual(r.generated, [], 'no month has settled, so none should be generated');
  assert.match(r.reason, /already has a current report/i);
});
