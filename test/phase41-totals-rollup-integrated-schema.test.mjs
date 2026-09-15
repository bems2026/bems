/**
 * Guards supabase/phase41_totals_rollup_integrated.sql — RM-087.
 *
 * WHY THIS FILE EXISTS. phase32 (RM-057) made the building total the sum of its branch meters and
 * kept the legacy two-second integration beside it as `building_totals.energy_kwh_*_integrated` —
 * "the only INDEPENDENT measurement of those circuits this system has". It added the matching
 * `building_totals_hourly.energy_kwh_*_integrated_max` columns, and said the hourly rollup keeps the
 * same shape. The rollup itself was never redefined: `roll_up_and_prune_building_totals` is still
 * phase11's, which names neither column. So the first prune of a row that carries the series stores
 * NULL in its hourly bucket and deletes the raw row, and the cross-check is gone for that hour for
 * good. The series starts on 2026-09-08, so the thirty-day window reaches it on 2026-10-08 — found
 * on 2026-09-15 while checking the first real retention pass, before anything was lost.
 *
 * File-text tests, not live-database ones, like phase11's. `supabase/rehearse.sh` runs the function
 * on a real Postgres and asserts the maxima it stores; this checks the intent that rehearsal cannot
 * see, above all that each integrated counter lands in ITS OWN column — every one of them is
 * `numeric`, so a swapped pair would run cleanly and store the week in the day.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = readFileSync(join(ROOT, 'supabase', 'phase41_totals_rollup_integrated.sql'), 'utf8');

/** Negative assertions run against statements only — see phase9-history-schema.test.mjs. */
const sql = file.replace(/--[^\n]*/g, '');

const PERIODS = ['today', 'week', 'month'];

/** Splits a select list on commas outside parentheses. */
function topLevelList(text) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The insert's column list and its select list, position for position. */
function insertPairs() {
  const m = /insert into building_totals_hourly\s*\(([\s\S]*?)\)\s*select([\s\S]*?)\bfrom building_totals\b/i.exec(sql);
  assert.ok(m, 'the rollup should insert into building_totals_hourly from a select over building_totals');
  const columns = topLevelList(m[1]).map((c) => c.toLowerCase());
  const expressions = topLevelList(m[2]).map((e) => e.toLowerCase().replace(/\s+/g, ''));
  return { columns, expressions };
}

test('it redefines the totals rollup under the same signature, so its callers and grants stand', () => {
  assert.match(sql, /create or replace function public\.roll_up_and_prune_building_totals\(p_before timestamptz\)/i);
  assert.match(sql, /returns table \(rolled int,\s*deleted int\)/i);
  assert.match(sql, /security invoker/i);
  assert.equal(/\bcascade\b/i.test(sql), false, 'nothing here should be dropped, least of all by cascade');
});

test('each integrated counter is rolled up into its own column, as a maximum', () => {
  const { columns, expressions } = insertPairs();
  assert.equal(columns.length, expressions.length, 'the column list and the select list must be the same length');
  for (const period of PERIODS) {
    const i = columns.indexOf(`energy_kwh_${period}_integrated_max`);
    assert.ok(i > -1, `energy_kwh_${period}_integrated_max is not in the insert`);
    assert.match(expressions[i], new RegExp(`^max\\([a-z_.]*energy_kwh_${period}_integrated\\)$`), `energy_kwh_${period}_integrated_max is filled from ${expressions[i]}`);
  }
});

test('every column phase11 kept is still filled from the same source', () => {
  const { columns, expressions } = insertPairs();
  const expected = {
    hour: /^date_trunc\('hour',[a-z_.]*ts\)$/,
    total_power_w_avg: /^avg\([a-z_.]*total_power_w\)$/,
    total_power_w_max: /^max\([a-z_.]*total_power_w\)$/,
    avg_voltage_avg: /^avg\([a-z_.]*avg_voltage\)$/,
    phase_current_red_avg: /^avg\([a-z_.]*phase_current_red\)$/,
    phase_current_yellow_avg: /^avg\([a-z_.]*phase_current_yellow\)$/,
    phase_current_blue_avg: /^avg\([a-z_.]*phase_current_blue\)$/,
    energy_kwh_today_max: /^max\([a-z_.]*energy_kwh_today\)$/,
    energy_kwh_week_max: /^max\([a-z_.]*energy_kwh_week\)$/,
    energy_kwh_month_max: /^max\([a-z_.]*energy_kwh_month\)$/,
    sample_count: /^count\(\*\)::int$/,
  };
  for (const [column, source] of Object.entries(expected)) {
    const i = columns.indexOf(column);
    assert.ok(i > -1, `${column} is no longer in the insert`);
    assert.match(expressions[i], source, `${column} is filled from ${expressions[i]}`);
  }
});

test('no counter is averaged, and nothing unmeasured becomes a zero', () => {
  for (const period of PERIODS) {
    assert.equal(new RegExp(`avg\\([a-z_.]*energy_kwh_${period}(_integrated)?\\)`, 'i').test(sql), false);
  }
  // Null before phase32 means "not measured" (phase32's own header). A coalesce would invent a reading.
  assert.equal(/coalesce\s*\([^)]*integrated/i.test(sql), false);
  assert.equal(/coalesce\s*\(\s*[a-z_.]*phase_current_blue\s*,\s*0/i.test(sql), false);
});

test('the rules phase11 proved still hold', () => {
  assert.match(sql, /date_trunc\('hour',\s*p_before\)/i, 'a partial hour must never be rolled up');
  assert.match(sql, /on conflict \(hour\) do nothing/i, 'the first bucket is kept, never overwritten by a fragment');
  assert.equal(/on conflict[\s\S]{0,80}do update/i.test(sql), false);
  const insertAt = sql.search(/insert into building_totals_hourly/i);
  const deleteAt = sql.search(/delete from building_totals\b/i);
  assert.ok(insertAt > -1 && deleteAt > insertAt, 'the delete must follow the rollup, inside the same function');
  assert.match(sql, /get diagnostics/i);
});

test('it stays callable by the service role alone', () => {
  assert.match(sql, /revoke execute on function public\.roll_up_and_prune_building_totals\(timestamptz\) from public/i);
  assert.match(sql, /grant\s+execute on function public\.roll_up_and_prune_building_totals\(timestamptz\) to service_role/i);
  assert.equal(/roll_up_and_prune_building_totals[\s\S]{0,120}?to (authenticated|anon)/i.test(sql), false);
});
