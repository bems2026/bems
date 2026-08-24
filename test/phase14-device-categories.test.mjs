/**
 * Guards supabase/phase14_device_categories.sql, and the one ordering mistake that would make
 * it fail against real data: swapping the CHECK before mapping the retired values. Any row
 * still holding `hvac` at that point aborts the ALTER, and the file is left half-applied.
 *
 * Also pins the vocabulary to `src/lib/deviceConfig.ts`. The option list and the constraint are
 * one fact in two places — deviceConfig.ts already carries a comment saying so, and this is
 * what makes that comment enforceable rather than advisory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(ROOT, 'supabase', 'phase14_device_categories.sql'), 'utf8');
const ts = readFileSync(join(ROOT, 'src', 'lib', 'deviceConfig.ts'), 'utf8');

const EXPECTED = ['lighting', 'aircon', 'outlet', 'branch_circuit', 'critical', 'other'];

test('retired values are mapped BEFORE the constraint is swapped', () => {
  const firstUpdate = sql.search(/update device_config set category/i);
  const dropConstraint = sql.search(/alter table device_config drop constraint/i);
  assert.ok(firstUpdate > -1 && dropConstraint > -1, 'both steps must be present');
  assert.ok(firstUpdate < dropConstraint, 'mapping must precede the constraint swap, or the ALTER fails on live rows');
});

test('office_equipment and kitchen go to NULL, not to other', () => {
  assert.match(sql, /set category = null\s+where category in \('office_equipment', 'kitchen'\)/i);
});

test('the constraint is dropped only if present, so the file is re-runnable', () => {
  assert.match(sql, /drop constraint if exists device_config_category_check/i);
});

test('the CHECK allows exactly the new vocabulary, and NULL', () => {
  assert.match(sql, /category is null or category in \('lighting','aircon','outlet','branch_circuit','critical','other'\)/i);
});

test('every retired value is gone from the CHECK', () => {
  const checkClause = sql.slice(sql.search(/add constraint device_config_category_check/i));
  for (const dead of ['hvac', 'office_equipment', 'kitchen']) {
    assert.equal(checkClause.includes(`'${dead}'`), false, `${dead} still accepted by the CHECK`);
  }
});

test('the frontend option list and the constraint agree exactly', () => {
  const values = [...ts.matchAll(/\{ value: '([a-z_]+)', label: '[^']+' \}/g)]
    .map((m) => m[1])
    .filter((v) => !v.startsWith('group_') && v !== 'never');
  assert.deepEqual(values, EXPECTED);
  for (const v of EXPECTED) assert.ok(sql.includes(`'${v}'`), `${v} missing from the migration`);
});

test('adds no policy — device_config already has its three', () => {
  assert.equal(/create policy/i.test(sql), false);
  assert.equal(/\banon\b/i.test(sql), false);
});
