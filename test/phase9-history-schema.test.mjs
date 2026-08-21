/**
 * Guards supabase/phase9_history_buckets.sql and supabase/phase9_readings_hourly.sql
 * against the mistakes that produced the bugs they exist to fix, plus the two traps the
 * earlier phase files already had to be guarded against.
 *
 * File-text tests, not live-database ones — no migration runner, no test Supabase project
 * in this repo, same reasoning as device-config-schema.test.mjs and
 * phase8-anomalies-schema.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const buckets = readFileSync(join(ROOT, 'supabase', 'phase9_history_buckets.sql'), 'utf8');
const hourly = readFileSync(join(ROOT, 'supabase', 'phase9_readings_hourly.sql'), 'utf8');

/**
 * Negative assertions ("this dangerous thing must NOT appear") have to run against the
 * statements only. Both of these files explain in prose exactly which dangerous pattern
 * they avoid and why — `security definer`, `on conflict ... do update` — so a bare string
 * search over the whole file matches the warning and fails the very file that heeds it.
 * phase8-anomalies-schema.test.mjs hit the same trap and worked around it with a narrower
 * regex; stripping comments fixes the whole class instead of one instance.
 */
function statementsOnly(sql) {
  return sql.replace(/--[^\n]*/g, '');
}
const bucketsSql = statementsOnly(buckets);
const hourlySql = statementsOnly(hourly);

// --- readings_buckets ------------------------------------------------------------------

test('readings_buckets runs as SECURITY INVOKER, so RLS on readings still applies', () => {
  assert.match(buckets, /security invoker/i);
  // security definer would run as the owner and hand every reading to any caller,
  // silently undoing phase5_lockdown_rls.sql.
  assert.equal(/security\s+definer/i.test(bucketsSql), false);
});

test('readings_buckets revokes the default PUBLIC execute grant before granting', () => {
  assert.match(buckets, /revoke execute on function public\.readings_buckets[\s\S]*?from public/i);
  assert.match(buckets, /grant\s+execute on function public\.readings_buckets[\s\S]*?to authenticated/i);
  assert.equal(/grant[\s\S]*?readings_buckets[\s\S]*?to anon/i.test(bucketsSql), false);
});

test('readings_buckets averages only online samples — a disconnected meter contributes nothing', () => {
  // The whole secondary bug: the old query never selected `online`, so a frozen offline
  // reading was charted as real. shared/buildLatest.mjs already refuses to do this for
  // building totals (EX-063); this keeps the chart honest the same way.
  assert.match(buckets, /avg\(r\.power_w\)\s*filter\s*\(where r\.online\)/i);
  assert.match(buckets, /avg\(r\.voltage\)\s*filter\s*\(where r\.online\)/i);
  assert.match(buckets, /avg\(r\.current\)\s*filter\s*\(where r\.online\)/i);
});

test('readings_buckets reports online_count, so a gap can be told from a real zero', () => {
  assert.match(buckets, /online_count\s+int/i);
  assert.match(buckets, /count\(\*\) filter \(where r\.online\)::int/i);
});

test('readings_buckets RAISES rather than truncating when it would return too many rows', () => {
  // This is the entire lesson of the bug being fixed: silently returning a short array is
  // worse than failing, because a short array renders as a plausible chart.
  assert.match(buckets, /raise exception/i);
  assert.match(buckets, /max_buckets/i);
  const cap = buckets.match(/max_buckets\s+constant\s+int\s*:=\s*(\d+)/i);
  assert.ok(cap, 'the bucket cap should be a named constant');
  assert.ok(
    Number(cap[1]) < 1000,
    `the cap (${cap[1]}) must stay below PostgREST's db-max-rows of 1000, or the very cap ` +
      'that caused this bug would truncate the answer again'
  );
});

// --- readings_hourly -------------------------------------------------------------------

test('readings_hourly keys on (device_id, hour) as an unconditional composite PRIMARY KEY', () => {
  assert.match(hourly, /primary key \(device_id,\s*hour\)/i);
  assert.equal(/default\s+gen_random_uuid\(\)/i.test(hourlySql), false);
});

test('no partial unique index anywhere — the phase 6 ON CONFLICT trap', () => {
  assert.equal(/create unique index[\s\S]*?where/i.test(hourlySql), false);
});

test('RLS is on, with select-only access for authenticated', () => {
  assert.match(hourly, /alter table readings_hourly enable row level security/i);
  assert.match(hourly, /create policy readings_hourly_select_authenticated on readings_hourly/i);
  assert.equal(/create policy readings_hourly_insert/i.test(hourlySql), false);
  assert.equal(/create policy readings_hourly_update/i.test(hourlySql), false);
  assert.equal(/create policy [a-z_]*anon/i.test(hourlySql), false);
});

test('the rollup inserts before it deletes, in one function so the pair is atomic', () => {
  const insertAt = hourlySql.search(/insert into readings_hourly/i);
  const deleteAt = hourlySql.search(/delete from readings\b/i);
  assert.ok(insertAt > -1 && deleteAt > -1, 'both statements should be present');
  assert.ok(
    insertAt < deleteAt,
    'the delete must come after the rollup — a delete that commits without its rollup ' +
      'destroys the data permanently'
  );
});

test('the rollup keeps the first bucket on conflict, never overwriting with a fragment', () => {
  assert.match(hourly, /on conflict \(device_id,\s*hour\) do nothing/i);
  assert.equal(/on conflict[\s\S]{0,80}do update/i.test(hourlySql), false);
});

test('p_before is truncated to an hour boundary, so no partial hour is ever rolled up', () => {
  assert.match(hourly, /date_trunc\('hour',\s*p_before\)/i);
});

test('roll_up_and_prune_readings returns what it actually did, rather than asserting success', () => {
  assert.match(hourly, /returns table \(rolled int,\s*deleted int\)/i);
  assert.match(hourly, /get diagnostics n_rolled\s*=\s*row_count/i);
  assert.match(hourly, /get diagnostics n_deleted\s*=\s*row_count/i);
});

test('roll_up_and_prune_readings revokes PUBLIC execute — it deletes data', () => {
  assert.match(hourly, /revoke execute on function public\.roll_up_and_prune_readings[\s\S]*?from public/i);
  assert.match(hourly, /grant\s+execute on function public\.roll_up_and_prune_readings[\s\S]*?to service_role/i);
  assert.equal(/roll_up_and_prune_readings[\s\S]*?to authenticated/i.test(hourlySql), false);
});
