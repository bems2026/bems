import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverage, dailyEnergy, hourProfile, renderDataset, renderReport } from './baselineReport.mjs';

// The building is at UTC+8. Every test states the offset explicitly rather than relying on the
// runtime's zone — two existing tests could not catch a 12-hour timezone fault precisely because
// they set the clock with bare local strings and the runtime happened to agree.
const OFF = 480;

const at = (iso, w, kwh = null) => ({ ts: iso, total_power_w: w, energy_kwh_today: kwh });

test('coverage reports what is missing, not only what is present', () => {
  // Four samples across an hour that should hold sixty. A baseline computed over 7% of a window
  // is not wrong, but it is not a baseline either, and the number has to say so.
  const rows = [
    at('2026-08-01T00:00:00Z', 100),
    at('2026-08-01T00:01:00Z', 100),
    at('2026-08-01T00:02:00Z', 100),
    at('2026-08-01T00:59:00Z', 100),
  ];
  const c = coverage(rows, { fromMs: Date.parse('2026-08-01T00:00:00Z'), toMs: Date.parse('2026-08-01T01:00:00Z') });
  assert.equal(c.observed, 4);
  assert.equal(c.expected, 60);
  assert.ok(c.pct < 0.07, `expected a low fraction, got ${c.pct}`);
  assert.equal(c.longestGapMinutes, 57, 'the gap between 00:02 and 00:59 is the story of this window');
});

test('coverage of an empty window is null, never zero percent of nothing', () => {
  const c = coverage([], { fromMs: 0, toMs: 0 });
  assert.equal(c.observed, 0);
  assert.equal(c.pct, null);
  assert.equal(c.longestGapMinutes, null);
});

test('an hour nobody measured reads null, not zero watts', () => {
  // The RM-024 rule, extended to the baseline: a building that was not observed at 03:00 did not
  // draw 0 W at 03:00. A funder reading a benchmark table must be able to see the difference.
  const rows = [at('2026-08-01T01:00:00Z', 500), at('2026-08-01T01:30:00Z', 700)];
  const prof = hourProfile(rows, OFF);
  assert.equal(prof.length, 24);
  const nine = prof.find((h) => h.hour === 9); // 01:00Z is 09:00 at the building
  assert.equal(nine.n, 2);
  assert.equal(nine.p50, 500, 'nearest rank, the same convention demandProfile.mjs already uses');
  const three = prof.find((h) => h.hour === 3);
  assert.equal(three.n, 0);
  assert.equal(three.p50, null);
  assert.equal(three.mean, null);
});

test('the hour profile buckets by the building clock, not the runtime one', () => {
  // 17:00Z is 01:00 the NEXT day at the building. A report about a building that says "peak at
  // 17:00" when the office was shut is worse than no report.
  const prof = hourProfile([at('2026-08-01T17:00:00Z', 42)], OFF);
  assert.equal(prof.find((h) => h.hour === 1).n, 1);
  assert.equal(prof.find((h) => h.hour === 17).n, 0);
});

test('a day the meters missed half of is flagged partial, not quietly averaged in', () => {
  const rows = [
    at('2026-08-01T01:00:00Z', 400, 1.5), // 09:00 local
    at('2026-08-01T05:00:00Z', 400, 4.0), // 13:00 local
  ];
  const days = dailyEnergy(rows, OFF);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '2026-08-01');
  assert.equal(days[0].kwh, 4.0, 'the counter is a running daily total; its maximum is the day so far');
  assert.equal(days[0].partial, true);
  assert.match(days[0].note, /partial|incomplete/i);
});

test('a day with no energy counter at all reports null kWh rather than zero', () => {
  // A day the meters were up but the counter never arrived is not a day the building used
  // nothing. `reduce(..., 0)` over an empty list is the exact bug that once made a building with
  // no meters report 0.00 kWh.
  const days = dailyEnergy([at('2026-08-01T01:00:00Z', 400, null)], OFF);
  assert.equal(days[0].kwh, null);
});

test('daily energy splits on the building date, so a 23:00 local sample is not tomorrow', () => {
  const rows = [
    at('2026-08-01T15:30:00Z', 100, 9.0), // 23:30 on 08-01 local
    at('2026-08-01T16:30:00Z', 100, 0.2), // 00:30 on 08-02 local — the counter has reset
  ];
  const days = dailyEnergy(rows, OFF);
  assert.deepEqual(days.map((d) => d.date), ['2026-08-01', '2026-08-02']);
  assert.equal(days[0].kwh, 9.0);
  assert.equal(days[1].kwh, 0.2);
});

test('the report states its coverage before it states any figure', () => {
  const rows = Array.from({ length: 200 }, (_, i) => at(new Date(Date.parse('2026-08-01T00:00:00Z') + i * 60_000).toISOString(), 500 + i, 1));
  const md = renderReport({ rows, offsetMinutes: OFF, siteName: 'CARE Office', timezone: 'Asia/Manila', generatedMs: Date.parse('2026-08-02T00:00:00Z') });
  const coverageAt = md.indexOf('Coverage');
  const figureAt = md.indexOf('p95');
  assert.ok(coverageAt > -1, 'the report must carry a coverage section');
  assert.ok(coverageAt < figureAt, 'coverage has to precede the statistics it qualifies');
});

test('the report refuses to summarise a window it barely observed', () => {
  const md = renderReport({
    rows: [at('2026-08-01T00:00:00Z', 500, 1)],
    offsetMinutes: OFF,
    siteName: 'CARE Office',
    timezone: 'Asia/Manila',
    generatedMs: Date.parse('2026-08-02T00:00:00Z'),
  });
  assert.match(md, /not a baseline/i, 'one reading is a sample, not a benchmark, and must say so');
});

test('the report names the site and the building timezone, not the reader s', () => {
  const rows = [at('2026-08-01T00:00:00Z', 500, 1), at('2026-08-01T00:01:00Z', 520, 1)];
  const md = renderReport({ rows, offsetMinutes: OFF, siteName: 'CARE Office', timezone: 'Asia/Manila', generatedMs: 0 });
  assert.match(md, /CARE Office/);
  assert.match(md, /Asia\/Manila/);
});

test('an empty dataset renders a report that says so instead of a table of dashes', () => {
  const md = renderReport({ rows: [], offsetMinutes: OFF, siteName: 'CARE Office', timezone: 'Asia/Manila', generatedMs: 0 });
  assert.match(md, /no readings/i);
  assert.doesNotMatch(md, /\b0\.00 W\b/, 'nothing observed must not render as a measured zero');
});

test('the dataset is the readings themselves, with a stable column order', () => {
  const csv = renderDataset([at('2026-08-01T00:00:00Z', 500, 1.25)], OFF);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'ts_utc,ts_site,site_date,site_hour,total_power_w,energy_kwh_today');
  assert.equal(lines[1], '2026-08-01T00:00:00Z,2026-08-01T08:00,2026-08-01,8,500,1.25');
});

test('a null in the dataset is an empty cell, not a zero', () => {
  const csv = renderDataset([at('2026-08-01T00:00:00Z', 500, null)], OFF);
  assert.match(csv.trim().split('\n')[1], /,500,$/);
});

test('a day with no readings at all still gets a row, rather than vanishing from the table', () => {
  // Found by reading a real report back: 2026-08-18 was simply absent between the 17th and the
  // 19th. Every other honesty rule here renders a gap as an em dash; a missing row is the one
  // way a gap renders as nothing at all, and a reader scanning dates will not notice it.
  const days = dailyEnergy(
    [at('2026-08-01T01:00:00Z', 400, 2), at('2026-08-04T01:00:00Z', 400, 3)],
    OFF,
  );
  assert.deepEqual(days.map((d) => d.date), ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']);
  const blank = days[1];
  assert.equal(blank.samples, 0);
  assert.equal(blank.kwh, null);
  assert.equal(blank.peakW, null);
  assert.match(blank.note, /nothing observed/i);
});

test('filled-in blank days do not count towards the three needed for a baseline', () => {
  // Otherwise a single reading either side of a fortnight's outage would promote itself to a
  // benchmark by counting the days nobody watched.
  const md = renderReport({
    rows: [at('2026-08-01T01:00:00Z', 400, 2), at('2026-08-04T01:00:00Z', 400, 3)],
    offsetMinutes: OFF,
    siteName: 'CARE Office',
    timezone: 'Asia/Manila',
    generatedMs: 0,
  });
  assert.match(md, /not a baseline/i);
});
