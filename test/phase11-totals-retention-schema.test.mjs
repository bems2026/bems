/**
 * Guards supabase/phase11_totals_retention.sql — retention for the two tables Phase 9 left
 * growing.
 *
 * WHY THIS FILE EXISTS: RM-006 was scoped to `readings`, and Phase 9 bounded exactly that.
 * `building_totals` kept taking one row per minute (~525k/year) and `anomalies` kept
 * accumulating, with nothing rolling up, pruning, or reading either. That leaves the same
 * failure mode Phase 9 was built to prevent — ingestion's own writes failing at the storage
 * ceiling — alive in two smaller tables.
 *
 * File-text tests, not live-database ones — no migration runner, no test Supabase project
 * in this repo, same reasoning as phase9-history-schema.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const totals = readFileSync(join(ROOT, 'supabase', 'phase11_totals_retention.sql'), 'utf8');

/** Negative assertions run against statements only — see phase9-history-schema.test.mjs. */
function statementsOnly(sql) {
  return sql.replace(/--[^\n]*/g, '');
}
const sql = statementsOnly(totals);

// --- building_totals_hourly ------------------------------------------------------------

test('building_totals_hourly keys on hour as an unconditional PRIMARY KEY', () => {
  // building_totals is building-wide, so there is no device dimension — hour alone is the
  // key. Unconditional, so the rollup's ON CONFLICT has something to target.
  assert.match(totals, /hour\s+timestamptz\s+primary key/i);
  assert.equal(/default\s+gen_random_uuid\(\)/i.test(sql), false);
});

test('no partial unique index anywhere — the phase 6 ON CONFLICT trap', () => {
  assert.equal(/create unique index[\s\S]*?where/i.test(sql), false);
});

test('RLS is on, with select-only access for authenticated', () => {
  assert.match(totals, /alter table building_totals_hourly enable row level security/i);
  assert.match(totals, /create policy building_totals_hourly_select_authenticated on building_totals_hourly/i);
  assert.equal(/create policy building_totals_hourly_insert/i.test(sql), false);
  assert.equal(/create policy building_totals_hourly_update/i.test(sql), false);
  assert.equal(/create policy [a-z_]*anon/i.test(sql), false);
});

test('phase_current_blue is never coerced to zero — no Blue-phase meter is installed', () => {
  // schema.sql:59 and shapeRows.mjs both preserve this as NULL rather than 0, and
  // ingest.test.mjs asserts it. A rollup that coalesced it would invent a meter.
  assert.equal(/coalesce\s*\(\s*[a-z_.]*phase_current_blue\s*,\s*0/i.test(sql), false);
  assert.match(sql, /avg\([a-z_.]*phase_current_blue\)/i);
});

test('the cumulative energy counters are rolled up as maxima, never averaged', () => {
  // energy_kwh_today/week/month are counters that reset. Averaging a counter is meaningless
  // — the same trap phase9_readings_hourly.sql's energy_kwh_today_max already avoids.
  for (const col of ['energy_kwh_today', 'energy_kwh_week', 'energy_kwh_month']) {
    assert.match(sql, new RegExp(`max\\([a-z_.]*${col}\\)`, 'i'));
    assert.equal(new RegExp(`avg\\([a-z_.]*${col}\\)`, 'i').test(sql), false);
  }
});

// --- the rollup/prune function ----------------------------------------------------------

test('the totals rollup inserts before it deletes, in one function so the pair is atomic', () => {
  const insertAt = sql.search(/insert into building_totals_hourly/i);
  const deleteAt = sql.search(/delete from building_totals\b/i);
  assert.ok(insertAt > -1 && deleteAt > -1, 'both statements should be present');
  assert.ok(
    insertAt < deleteAt,
    'the delete must come after the rollup — a delete that commits without its rollup ' +
      'destroys the data permanently'
  );
});

test('the totals rollup keeps the first bucket on conflict, never overwriting with a fragment', () => {
  assert.match(totals, /on conflict \(hour\) do nothing/i);
  assert.equal(/on conflict[\s\S]{0,80}do update/i.test(sql), false);
});

test('p_before is truncated to an hour boundary, so no partial hour is ever rolled up', () => {
  assert.match(totals, /date_trunc\('hour',\s*p_before\)/i);
});

test('both functions report what they actually did rather than asserting success', () => {
  assert.match(totals, /returns table \(rolled int,\s*deleted int\)/i);
  assert.match(totals, /get diagnostics/i);
});

test('both destructive functions revoke PUBLIC execute and grant only to service_role', () => {
  for (const fn of ['roll_up_and_prune_building_totals', 'prune_anomalies']) {
    assert.match(totals, new RegExp(`revoke execute on function public\\.${fn}[\\s\\S]*?from public`, 'i'));
    assert.match(totals, new RegExp(`grant\\s+execute on function public\\.${fn}[\\s\\S]*?to service_role`, 'i'));
    assert.equal(new RegExp(`${fn}[\\s\\S]{0,200}?to authenticated`, 'i').test(sql), false);
  }
});

// --- indexes and the deliberate exemption ------------------------------------------------

test('the prune predicates are indexed — readings had only (device_id, ts desc)', () => {
  // A composite index leading with device_id cannot serve a ts-only predicate, so today's
  // prune seq-scans the whole table every pass.
  assert.match(totals, /create index if not exists\s+readings_ts_idx\s+on readings\s+\(ts\)/i);
  assert.match(totals, /create index if not exists\s+anomalies_ts_idx\s+on anomalies\s+\(ts\)/i);
});

test('commands is never pruned — it is the audit trail for anything that moved a relay', () => {
  // Stated as a test so a later "finish the job" pass has to argue with a failing assertion
  // rather than a comment it might not read.
  assert.equal(/delete from commands/i.test(sql), false);
  assert.match(totals, /commands/i, 'the file should say out loud that commands is exempt');
});
