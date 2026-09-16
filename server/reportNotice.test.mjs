/**
 * FI-011 — what the alert channel says when a monthly report is generated.
 *
 * The wording is the whole feature: a push that overstates a partial month is worse than no push,
 * because it is read on a phone by someone who will not open the page to check. So these tests are
 * mostly about the figures the message must NOT state plainly — the same rules the Reports page
 * keeps, carried into one line of text.
 *
 * No mocking library, matching this repo's house style: the pure wording function is called
 * directly, and the read is exercised against a hand-rolled fake client that records its query.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportNotice, monthlyReportNotices } from './reportNotice.mjs';

/** A fully observed August, as `period_building_reports` stores it. */
const row = (o = {}) => ({
  period: 'month',
  period_start: '2026-08-01',
  energy_kwh: 390.5,
  peak_total_power_w: 4551,
  online_sample_count: 44640,
  expected_sample_count: 44640,
  generated_at: '2026-09-03T00:00:00Z',
  ...o,
});

function fakeClient(rows = []) {
  const calls = [];
  return { calls, select: async (table, query) => { calls.push({ table, query }); return rows; } };
}

test('names the month and its headline figures', () => {
  const m = reportNotice(row());
  assert.match(m.title, /August 2026/);
  assert.match(m.body, /390\.50 kWh/);
  assert.match(m.body, /4\.55 kW/);
});

test('is not an alarm', () => {
  // `fleetMessage` reserves 'high' for devices going dark. A report arriving is good news, and a
  // channel that shouts about good news is a channel that gets muted.
  assert.equal(reportNotice(row()).priority, 'default');
});

test('a partly observed month says so, and calls its total a floor', () => {
  const m = reportNotice(row({ online_sample_count: 12006 }));
  assert.match(m.body, /27%/);
  assert.match(m.body, /floor/i);
});

test('never calls the stored share "readings coverage", because it counts rows', () => {
  // RM-073: `online_sample_count` counts rows written, not rows that held a real reading. August
  // 2026 is 48% by rows and 27% by readings, and the page shows the second. Naming this one
  // "readings coverage" in a push would state the larger figure under the smaller one's name.
  const m = reportNotice(row({ online_sample_count: 21427 }));
  assert.doesNotMatch(m.body, /readings coverage/i);
  assert.match(m.body, /expected samples/i);
});

test('a month with no samples reads as not observed, never as an idle building', () => {
  const m = reportNotice(row({ energy_kwh: 0, online_sample_count: 0 }));
  assert.match(m.body, /not observed/i);
  assert.doesNotMatch(m.body, /0\.00 kWh/, 'a stored zero from nothing observed is not a measurement');
});

test('a missing energy figure says so rather than printing a zero', () => {
  const m = reportNotice(row({ energy_kwh: null }));
  assert.doesNotMatch(m.body, /0\.00/);
  assert.match(m.body, /no energy figure/i);
});

test('a missing peak is left out rather than printed as zero', () => {
  assert.doesNotMatch(reportNotice(row({ peak_total_power_w: null })).body, /\bkW\b/);
});

test('points at the page that qualifies the figures', () => {
  assert.match(reportNotice(row()).body, /Reports/);
});

test('reads the stored rows for the months just generated, in one query, oldest first', async () => {
  const client = fakeClient([row(), row({ period_start: '2026-07-01', energy_kwh: 410.2 })]);
  const notices = await monthlyReportNotices({ client, months: ['2026-08-01', '2026-07-01'] });
  assert.equal(client.calls.length, 1, 'one select for the whole pass');
  assert.equal(client.calls[0].table, 'period_building_reports');
  assert.match(client.calls[0].query, /period=eq\.month/, 'weekly reports are not announced — FI-011 is the monthly one');
  assert.match(client.calls[0].query, /2026-07-01/);
  assert.equal(notices.length, 2);
  assert.match(notices[0].title, /July 2026/);
  assert.match(notices[1].title, /August 2026/);
});

test('asks the database nothing when no month was generated', async () => {
  const client = fakeClient();
  assert.deepEqual(await monthlyReportNotices({ client, months: [] }), []);
  assert.equal(client.calls.length, 0);
});

test('skips a month whose row did not come back, rather than inventing its figures', async () => {
  const client = fakeClient([row({ period_start: '2026-08-01' })]);
  const notices = await monthlyReportNotices({ client, months: ['2026-07-01', '2026-08-01'] });
  assert.equal(notices.length, 1);
  assert.match(notices[0].title, /August 2026/);
});
