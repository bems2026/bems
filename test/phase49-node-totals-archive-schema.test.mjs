/**
 * Guards supabase/phase49_node_totals_archive.sql — RM-148, Stage 5.
 *
 * `node_totals` (phase22) read raw `readings` only. The Analytics page's Space totals card asks it
 * for 30 days and for a year, so its "1 y" has silently been the last 30 days since raw rows were
 * first pruned — and at RM-148's 14-day window its "30 d" would be 14. The fix reads hours the raw
 * table no longer holds from `readings_hourly`, by the rule `readings_archive` already uses: the
 * rolled hour wins the seam, and averages are weighted by each hour's samples.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(ROOT, 'supabase', 'phase49_node_totals_archive.sql'), 'utf8').replace(/--[^\n]*/g, '');

test('node_totals keeps its signature, so the existing grants and callers carry on', () => {
  assert.match(sql, /create or replace function public\.node_totals\(\s*p_node_id\s+uuid,\s*p_since\s+timestamptz,\s*p_until\s+timestamptz default now\(\)\s*\)/i);
  assert.match(sql, /returns table \(\s*device_count\s+int,\s*reporting_count\s+int,\s*sample_count\s+bigint,\s*online_sample_count\s+bigint,\s*avg_power_w\s+numeric,\s*peak_power_w\s+numeric\s*\)/i);
  assert.match(sql, /security invoker/i, 'RLS on readings and readings_hourly is what keeps this behind a login');
});

test('it reads the rollup for hours the raw table no longer holds, and the rollup wins the seam', () => {
  assert.match(sql, /from\s+readings_hourly\s+h/i);
  assert.match(sql, /from\s+readings\s+r/i);
  assert.match(sql, /not exists\s*\(\s*select 1\s+from readings_hourly h2\s+where h2\.device_id = rh\.device_id\s+and h2\.hour = rh\.hour\s*\)/i);
});

test('averages are weighted by samples and nothing observed stays NULL, never 0', () => {
  assert.match(sql, /sum\(m\.power_w_avg \* m\.power_samples\)/i);
  assert.match(sql, /nullif\(/i);
  assert.equal(/coalesce\([^)]*power/i.test(sql), false, 'a coalesce on power would turn "saw nothing" into "drew nothing"');
});

test('counts stay 0 over an empty window, as phase22 returned them — only power is NULL', () => {
  // `rowToNodeTotals` types these as numbers, and coverageOf reads 0 samples as "nothing to look at".
  assert.match(sql, /coalesce\(sum\(m\.sample_count\), 0\)::bigint/i);
  assert.match(sql, /coalesce\(sum\(m\.online_sample_count\), 0\)::bigint/i);
});

test('it changes that one function and nothing else', () => {
  assert.equal((sql.match(/create or replace function/gi) ?? []).length, 1);
  assert.equal(/\b(drop|delete|truncate|update|insert|alter)\b/i.test(sql), false);
});
