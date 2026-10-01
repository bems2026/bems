/**
 * Guards supabase/phase54_removed_restated.sql — RM-155d.
 *
 * WHY THIS FILE EXISTS. phase53 changed what `removed_kwh` measures: it was the day's highest counter
 * reading less the credited energy, and is now the clipped rises less their credits — exactly the jump
 * that was not counted. phase53 restated only rows whose ENERGY banking changed, so a row whose energy
 * stayed the same kept the old caveat: L.O Yellow's 23 Sep day said "a 4.75 kWh jump" while its week said
 * 5.03. phase54 gives such rows the figure as the rule now measures it, and keeps the old one.
 *
 * File-text tests. `supabase/rehearse.sh` runs it on a real Postgres, twice; this checks what a rehearsal
 * cannot see: it changes no rule, touches nothing but the caveat, and gives the SQL editor nothing to stop on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = join(ROOT, 'supabase', 'phase54_removed_restated.sql');
const file = existsSync(PATH) ? readFileSync(PATH, 'utf8').replace(/\r\n/g, '\n') : '';
const sql = file.replace(/--[^\n]*/g, '');

test('phase54 exists', () => {
  assert.ok(file.length > 0, 'supabase/phase54_removed_restated.sql is missing');
});

test('it changes no rule: no function is defined', () => {
  assert.doesNotMatch(sql, /create\s+(or\s+replace\s+)?function/i);
});

test('the old caveat is kept beside the new one', () => {
  assert.match(sql, /alter table period_reports add column if not exists energy_removed_kwh_before numeric;/);
  assert.match(sql, /energy_removed_kwh_before\s*=\s*coalesce\(p\.energy_removed_kwh_before, p\.energy_removed_kwh\)/);
});

test('the caveat is written as the generator writes it', () => {
  // generate_period_report: `case when bd.removed_kwh > 0.001 then bd.removed_kwh end`.
  assert.match(sql, /energy_removed_kwh\s*=\s*case when f\.removed > 0\.001 then f\.removed end/);
});

test('only a row that carries a caveat, and whose energy is still the rule\'s', () => {
  assert.match(sql, /p\.energy_removed_kwh is not null/);
  assert.match(sql, /abs\(p\.energy_kwh - f\.e\) <= 0\.0005/, 'a row built from other data is left alone');
  assert.match(sql, /> 0\.001;/, 'a caveat that would not change is not rewritten');
});

test('it touches nothing but the caveat', () => {
  const set = sql.slice(sql.indexOf('set energy_removed_kwh_before'), sql.indexOf('from measured f'));
  assert.ok(set.length > 0, 'no update');
  assert.doesNotMatch(set, /energy_kwh\s*=|energy_restated_at\s*=|generated_at\s*=|online_sample_count\s*=/);
});

test('nothing the SQL editor stops to ask about, and the API sees the column', () => {
  assert.doesNotMatch(sql, /create\s+(temporary\s+|temp\s+)?table/i);
  assert.doesNotMatch(sql, /\bdrop\s+/i);
  assert.doesNotMatch(sql, /create policy|create trigger/i);
  assert.match(sql, /notify pgrst, 'reload schema';\s*$/);
});
