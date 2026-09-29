/**
 * Guards supabase/phase48_hot_tier.sql — RM-148, Stage 3.
 *
 * The database stood at 392 of the Free plan's 500 MB (E-218), and `readings` carried a second index
 * identical to its primary key. This phase removes indexes that duplicate a key, tunes vacuum on the
 * two raw tables, and adds the counts the edge's janitor compares with its archive before it prunes
 * anything. It must do exactly that: no data touched, no key or constraint dropped, and the counts
 * callable only by the service role that runs the janitor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase48_hot_tier.sql'), 'utf8');
const sql = raw.replace(/--[^\n]*/g, '');

const DUPLICATES = [
  'readings_device_id_ts_idx',
  'readings_hourly_device_id_hour_idx',
  'building_totals_hourly_hour_idx',
  'anomalies_device_id_ts_idx',
  'monthly_reports_month_idx',
  'period_reports_lookup_idx',
  'energy_tariffs_site_from_idx',
  'emission_factors_site_from_idx',
];

test('it drops exactly the eight indexes that duplicate a key, and nothing else', () => {
  const dropped = [...sql.matchAll(/drop index if exists (?:public\.)?(\w+)\s*;/gi)].map((m) => m[1]);
  assert.deepEqual(dropped.sort(), [...DUPLICATES].sort());
  assert.equal(/drop\s+(table|constraint|column|schema|policy)/i.test(sql), false);
  assert.equal(/\b(delete|truncate|update)\b/i.test(sql), false, 'this phase touches no rows');
  assert.equal(/cascade/i.test(sql), false);
});

test('every dropped index names its covering key in the file, so the claim can be checked', () => {
  for (const name of DUPLICATES) {
    assert.match(raw, new RegExp(`${name}[^\\n]*covered by`, 'i'), `${name} needs a "covered by" note`);
  }
});

test('vacuum runs on the raw tables after about 2 % of rows change, not the default 20 %', () => {
  for (const table of ['readings', 'building_totals']) {
    assert.match(sql, new RegExp(`alter table (?:public\\.)?${table} set \\(\\s*autovacuum_vacuum_scale_factor = 0\\.02`, 'i'));
  }
});

test('the manifests count per hour, refuse a window too big to answer in one page, and belong to the service role', () => {
  for (const [fn, args] of [['readings_manifest', 'timestamptz, timestamptz'], ['building_totals_manifest', 'timestamptz, timestamptz']]) {
    assert.match(sql, new RegExp(`create or replace function (?:public\\.)?${fn}\\(`, 'i'));
    assert.match(sql, new RegExp(`revoke all on function (?:public\\.)?${fn}\\(${args}\\) from public, anon, authenticated;`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function (?:public\\.)?${fn}\\(${args}\\) to service_role;`, 'i'));
  }
  assert.match(sql, /interval '48 hours'/i);
  assert.match(sql, /date_trunc\('hour', \w+\.ts\)/i);
  assert.match(sql, /security invoker/i);
});

test('PostgREST is told to reload, so the new functions are callable at once', () => {
  assert.match(sql, /notify pgrst, 'reload schema';/i);
});
