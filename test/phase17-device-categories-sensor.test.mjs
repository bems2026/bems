/**
 * Guards supabase/phase17_device_categories_sensor.sql.
 *
 * This file also owns the "frontend option list and the constraint agree exactly" assertion,
 * moved here from the phase 14 test. That assertion pins the UI to a *specific* migration's
 * vocabulary, so it has to follow the newest one — left on phase 14 it would fail the moment
 * any category was added, reporting a correct change as a broken one. Whichever migration last
 * touched the vocabulary is the one the frontend must match.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase17_device_categories_sensor.sql'), 'utf8');
const ts = readFileSync(join(ROOT, 'src', 'lib', 'deviceConfig.ts'), 'utf8');

/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

const EXPECTED = ['lighting', 'aircon', 'outlet', 'branch_circuit', 'sensor', 'critical', 'other'];

test('the CHECK accepts exactly the current vocabulary, and NULL', () => {
  assert.match(
    sql,
    /category is null or category in \('lighting','aircon','outlet','branch_circuit','sensor','critical','other'\)/i,
  );
});

test('the frontend option list and the constraint agree exactly', () => {
  const values = [...ts.matchAll(/\{ value: '([a-z_]+)', label: '[^']+' \}/g)]
    .map((m) => m[1])
    .filter((v) => !v.startsWith('group_') && v !== 'never');
  assert.deepEqual(values, EXPECTED);
  for (const v of EXPECTED) assert.ok(sql.includes(`'${v}'`), `${v} missing from the migration`);
});

test('needs no value mapping, because it only widens what is accepted', () => {
  // Phase 14 had to rewrite retired values before swapping its constraint or the ALTER would
  // fail on live rows. Nothing can fail a constraint that permits strictly more than the one
  // it replaces, so an UPDATE here would be cargo-culted ceremony.
  assert.equal(/update device_config set category/i.test(sql), false);
});

test('the constraint is dropped only if present, so the file is re-runnable', () => {
  assert.match(sql, /drop constraint if exists device_config_category_check/i);
});

test('reuses the existing constraint name rather than adding a second one', () => {
  // Two constraints on one column would both have to pass, so a stale one would silently
  // veto the new vocabulary — exactly the shape of the phase 6 unique-index trap.
  const added = [...sql.matchAll(/add constraint (\w+)/gi)].map((m) => m[1]);
  assert.deepEqual(added, ['device_config_category_check']);
});

test('every value phase 14 already accepted survives — this adds, it does not replace', () => {
  for (const kept of ['lighting', 'aircon', 'outlet', 'branch_circuit', 'critical', 'other']) {
    assert.ok(sql.includes(`'${kept}'`), `${kept} was dropped from the vocabulary`);
  }
});

test('adds no policy and grants anon nothing', () => {
  assert.equal(/create policy/i.test(sql), false);
  assert.equal(/\banon\b/i.test(sql), false);
});
