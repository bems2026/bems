/**
 * `ingestion_health`'s row shape, and the migration-order hazard around it.
 *
 *     node --test server/healthRow.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHealthRow, isMissingScrubColumnError, withoutScrubColumns, SCRUB_COLUMNS,
} from './healthRow.mjs';

const NOW = '2026-09-07T14:00:00.000Z';
const base = (over = {}) => ({
  ok: true, lastError: null, rejections: [], bufferedRowCount: 0,
  siteId: 'mmsu-nberic-care', nowIso: NOW, ...over,
});

test('a healthy tick clears last_error and stamps the success', () => {
  const row = buildHealthRow(base());
  assert.equal(row.last_error, null);
  assert.equal(row.last_success_at, NOW);
});

test('a failed tick records the error and does NOT stamp a success', () => {
  // Stamping `last_success_at` on a failure would make an outage read as healthy, which is the
  // fault `server/ingestCycle.mjs` exists to have fixed.
  const row = buildHealthRow(base({ ok: false, lastError: 'ECONNREFUSED' }));
  assert.equal(row.last_error, 'ECONNREFUSED');
  assert.equal('last_success_at' in row, false);
});

test('the row names its own site rather than leaning on the column default', () => {
  assert.equal(buildHealthRow(base()).site_id, 'mmsu-nberic-care');
});

// ---------------------------------------------------------------------------
// phase30's counters.
// ---------------------------------------------------------------------------

test('a clean tick still writes the count, as zero', () => {
  // Omitting it would leave yesterday's number in place, so "nothing was refused" and "nothing
  // has been checked since the last refusal" would look identical.
  const row = buildHealthRow(base());
  assert.equal(row.scrub_rejected_count, 0);
});

test('a clean tick does NOT overwrite the reason, so it stays readable afterwards', () => {
  // The sticky half. A per-tick counter erases exactly the case worth seeing — one rejection,
  // an hour ago — and this is what keeps it on the row an operator opens.
  const row = buildHealthRow(base());
  assert.equal('scrub_last_reason' in row, false);
  assert.equal('scrub_last_at' in row, false);
});

test('a rejection is recorded with its reason and when it happened', () => {
  const row = buildHealthRow(base({ rejections: ['lo_yel2.energy_kwh_today=3625.108 outside [0, 100]'] }));
  assert.equal(row.scrub_rejected_count, 1);
  assert.equal(row.scrub_last_reason, 'lo_yel2.energy_kwh_today=3625.108 outside [0, 100]');
  assert.equal(row.scrub_last_at, NOW);
});

test('the reason is stringified, not stored as an object', () => {
  // Rejections arrive as class instances; the column is `text`.
  const row = buildHealthRow(base({ rejections: [{ toString: () => 'co5.power_w=NaN is not a finite number' }] }));
  assert.equal(typeof row.scrub_last_reason, 'string');
  assert.match(row.scrub_last_reason, /co5/);
});

// ---------------------------------------------------------------------------
// The migration-order hazard. Migrations here are applied by hand, so code can arrive first.
// ---------------------------------------------------------------------------

test('the row can be built without phase30 columns at all', () => {
  const row = buildHealthRow(base({ rejections: ['x'], withScrubColumns: false }));
  for (const column of SCRUB_COLUMNS) assert.equal(column in row, false);
  // Everything that predates phase30 must still be there — this is the fallback that keeps
  // `last_success_at` moving on a database the migration has not reached.
  assert.equal(row.last_success_at, NOW);
  assert.equal(row.site_id, 'mmsu-nberic-care');
});

test('withoutScrubColumns strips exactly those columns and nothing else', () => {
  const full = buildHealthRow(base({ rejections: ['x'] }));
  const stripped = withoutScrubColumns(full);
  assert.deepEqual(stripped, buildHealthRow(base({ rejections: ['x'], withScrubColumns: false })));
});

test('withoutScrubColumns does not mutate the row it was given', () => {
  const full = buildHealthRow(base({ rejections: ['x'] }));
  withoutScrubColumns(full);
  assert.equal(full.scrub_rejected_count, 1);
});

test('a PostgREST unknown-column failure is recognised as the missing migration', () => {
  assert.equal(isMissingScrubColumnError(
    new Error("ingestion_health -> 400 {\"code\":\"PGRST204\",\"message\":\"Could not find the 'scrub_rejected_count' column of 'ingestion_health' in the schema cache\"}"),
  ), true);
});

test('each of phase30\'s columns is recognised on its own', () => {
  // A partially-applied migration is a real state — the file has three separate statements.
  for (const column of SCRUB_COLUMNS) {
    assert.equal(isMissingScrubColumnError(`PGRST204 could not find the '${column}' column`), true, column);
  }
});

test('a real outage is NOT mistaken for the missing migration', () => {
  // This is the one that matters. Downgrading on a genuine failure would drop the scrub
  // counters for the life of the process, and the operator would be told the migration is
  // missing when it is not.
  for (const err of [
    new Error('fetch failed'),
    new Error('ingestion_health -> 503'),
    new Error("PGRST204 could not find the 'buffered_row_count' column"),
    new Error('AbortError: The operation was aborted'),
    null,
    undefined,
  ]) {
    assert.equal(isMissingScrubColumnError(err), false, String(err));
  }
});
