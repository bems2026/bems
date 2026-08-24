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

// The "frontend option list agrees with the constraint" assertion used to live here. It moved
// to test/phase17-device-categories-sensor.test.mjs, because it pins the UI to a *specific*
// migration's vocabulary and therefore has to follow the newest one — left here it would fail
// the moment a category was added, reporting a correct change as a broken one. What stays are
// the checks about this file's own internal correctness, which do not expire.

test('adds no policy — device_config already has its three', () => {
  assert.equal(/create policy/i.test(sql), false);
  assert.equal(/\banon\b/i.test(sql), false);
});
