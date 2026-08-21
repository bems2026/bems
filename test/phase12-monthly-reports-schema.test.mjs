/**
 * Guards supabase/phase12_monthly_reports.sql — the stored monthly energy report.
 *
 * The assertions that matter most here are about honesty rather than shape. A monthly kWh
 * figure computed from a half-offline month is real, small, and misleading; the whole design
 * rests on coverage travelling with the number, and on energy being summed from daily maxima
 * of a resetting counter rather than averaged.
 *
 * File-text tests, not live-database ones — no migration runner, no test Supabase project in
 * this repo, same reasoning as phase9-history-schema.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const reports = readFileSync(join(ROOT, 'supabase', 'phase12_monthly_reports.sql'), 'utf8');

/** Negative assertions run against statements only — see phase9-history-schema.test.mjs. */
function statementsOnly(sql) {
  return sql.replace(/--[^\n]*/g, '');
}
const sql = statementsOnly(reports);

// --- shape --------------------------------------------------------------------------------

test('per-device rows key on (month, device_id) with a real FK to devices', () => {
  // A sentinel device_id for the building-wide row would break this FK, which is why the
  // building figures live in their own table instead.
  assert.match(sql, /device_id\s+text\s+not null references devices\(id\)/i);
  assert.match(sql, /primary key \(month,\s*device_id\)/i);
  assert.equal(/default\s+gen_random_uuid\(\)/i.test(sql), false);
});

test('building-wide rows are a separate table keyed on month alone', () => {
  assert.match(sql, /create table if not exists monthly_building_reports/i);
  assert.match(sql, /month\s+date not null primary key/i);
});

test('no partial unique index anywhere — the phase 6 ON CONFLICT trap', () => {
  assert.equal(/create unique index[\s\S]*?where/i.test(sql), false);
});

test('RLS is on for both tables, select-only for authenticated, never anon', () => {
  for (const t of ['monthly_reports', 'monthly_building_reports']) {
    assert.match(reports, new RegExp(`alter table ${t}\\s+enable row level security`, 'i'));
    assert.match(reports, new RegExp(`create policy ${t}_select_authenticated on ${t}`, 'i'));
    assert.equal(new RegExp(`create policy ${t}_insert`, 'i').test(sql), false);
    assert.equal(new RegExp(`create policy ${t}_update`, 'i').test(sql), false);
  }
  assert.equal(/create policy [a-z_]*anon/i.test(sql), false);
});

// --- honesty ------------------------------------------------------------------------------

test('every report row carries both observed and expected sample counts', () => {
  // Without the pair there is no way to say "this month is 6% observed", and a bare kWh
  // figure from a mostly-offline month reads as fact. Both tables, not just the device one.
  const deviceTable = sql.slice(sql.search(/create table if not exists monthly_reports/i), sql.search(/create table if not exists monthly_building_reports/i));
  const buildingTable = sql.slice(sql.search(/create table if not exists monthly_building_reports/i));
  for (const [name, block] of [['monthly_reports', deviceTable], ['monthly_building_reports', buildingTable]]) {
    assert.match(block, /online_sample_count\s+int/i, `${name} must record what it observed`);
    assert.match(block, /expected_sample_count\s+int/i, `${name} must record what full coverage would have been`);
  }
});

test('expected_sample_count is derived from the real month length, not a hardcoded 30 days', () => {
  // February and July are not the same length, and a fixed divisor would report February as
  // over-covered and July as under-covered, every year, forever.
  assert.match(sql, /extract\(epoch from \(month_end - month_start\)\)\s*\/\s*60/i);
  assert.equal(/expected[\s\S]{0,40}?:=\s*(30|31|43200|44640)\b/i.test(sql), false);
});

test('energy is summed from daily maxima of the resetting counter, never averaged', () => {
  assert.match(sql, /max\(energy_kwh_today_max\)/i);
  assert.match(sql, /sum\(day_kwh\)/i);
  assert.equal(/avg\([a-z_.]*energy_kwh/i.test(sql), false);
});

test('days are grouped in the site timezone, because the counter resets at local midnight', () => {
  // Grouping in UTC would split every device-day across two report-days and undercount the
  // month's last day.
  assert.match(sql, /at time zone p_tz/i);
  assert.match(sql, /p_tz\s+text\s+default\s+'Asia\/Manila'/i);
});

test('average power is weighted by sample count, not a flat average of hourly averages', () => {
  assert.match(sql, /sum\([\s\S]{0,40}?\*\s*[a-z_.]*online_sample_count\)\s*\/\s*nullif\(sum\([a-z_.]*online_sample_count\)/i);
});

test('only online samples contribute — an offline meter is a gap, not a reading', () => {
  assert.match(sql, /filter\s*\(where\s+[a-z_.]*online\)/i);
});

test('phase_current_blue is never coerced to zero — no Blue-phase meter exists', () => {
  assert.equal(/coalesce\s*\(\s*[a-z_.]*phase_current_blue[a-z_]*\s*,\s*0/i.test(sql), false);
});

test('the seam between the rollup and the raw table is deduplicated in both halves', () => {
  // Same trap as phase10: an hour present in both tables would be counted twice, silently
  // doubling a reported total. Once for readings, once for building_totals.
  const notExists = sql.match(/not exists\s*\(/gi) ?? [];
  assert.ok(notExists.length >= 2, `expected a seam guard in both halves, found ${notExists.length}`);
  assert.match(sql, /not exists[\s\S]{0,200}?readings_hourly/i);
  assert.match(sql, /not exists[\s\S]{0,200}?building_totals_hourly/i);
});

// --- regeneration and grants -------------------------------------------------------------

test('regenerating a month REPLACES it, unlike the rollups which keep the first value', () => {
  // The rollups keep the first value because a recomputation would be built from a fragment.
  // A report is the opposite: regenerated later it sees more of its month, not less.
  assert.match(sql, /on conflict \(month,\s*device_id\) do update/i);
  assert.match(sql, /on conflict \(month\) do update/i);
  assert.match(sql, /generated_at/i);
});

test('generate_monthly_report reports what it wrote rather than asserting success', () => {
  assert.match(reports, /returns table \(device_rows int,\s*building_rows int\)/i);
  assert.match(reports, /get diagnostics/i);
});

test('generate_monthly_report revokes PUBLIC execute — it writes, and no browser calls it', () => {
  assert.match(reports, /revoke execute on function public\.generate_monthly_report[\s\S]*?from public/i);
  assert.match(reports, /grant\s+execute on function public\.generate_monthly_report[\s\S]*?to service_role/i);
  assert.equal(/generate_monthly_report[\s\S]{0,200}?to authenticated/i.test(sql), false);
});
