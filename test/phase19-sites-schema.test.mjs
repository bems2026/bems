/**
 * Guards supabase/phase19_sites.sql.
 *
 * The point of this table is that a SECOND ROW CAN EXIST. Most of what follows is therefore
 * about the migration not quietly reintroducing the single-deployment assumption it exists to
 * remove — `dsm_thresholds` carried one for months behind `check (id = 1)` and a comment
 * reading "One building, one Pi", and nothing noticed because there was only ever one building.
 *
 * The seed is checked against the committed site module rather than against literals, so the
 * database and `shared/siteConfig.mjs` cannot drift into disagreeing about what this site is.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SITE } from '../shared/siteConfig.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase19_sites.sql'), 'utf8');

/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

test('creates the table idempotently, so a re-run is not an error', () => {
  assert.match(sql, /create table if not exists sites/i);
});

test('there is no singleton constraint — that is the assumption this table exists to remove', () => {
  assert.equal(/check\s*\(\s*id\s*=\s*1\s*\)/i.test(sql), false);
  assert.equal(/_singleton/i.test(sql), false);
});

test('every field the code reads off SITE has a column to read it from', () => {
  for (const col of ['display_name', 'timezone', 'utc_offset_minutes', 'policy']) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `missing column ${col}`);
  }
});

test('the id is the primary key, so a site cannot be seeded twice under one name', () => {
  assert.match(sql, /id\s+text\s+primary key/i);
});

test('the seeded row matches the committed site module, so the two cannot disagree', () => {
  assert.ok(sql.includes(`'${SITE.id}'`), `the active site id (${SITE.id}) must be seeded`);
  assert.ok(sql.includes(`'${SITE.timezone}'`), 'the timezone must match shared/siteConfig.mjs');
  assert.ok(sql.includes(String(SITE.utc_offset_minutes)), 'the UTC offset must match');
});

test('the seeded policy carries the setpoint floor the command path enforces', () => {
  // The floor is enforced from SITE.policy today. Seeding it here is what lets a later phase
  // move the read to the database without the value having to be rediscovered.
  assert.ok(sql.includes('acu_min_setpoint_c'), 'the policy floor belongs in the seeded row');
  assert.ok(sql.includes(String(SITE.policy.acu_min_setpoint_c)), 'and must match the site module');
});

test('the seed is conflict-safe, so applying the file twice does not fail', () => {
  assert.match(sql, /on conflict\s*\(\s*id\s*\)\s*do nothing/i);
});

test('RLS is enabled and no anon policy is granted', () => {
  assert.match(sql, /alter table sites\s+enable row level security/i);
  assert.equal(/\bto anon\b/i.test(sql), false);
  assert.equal(/auth\.role\(\)\s*=\s*'anon'/i.test(sql), false);
});

test('authenticated users may read it and nothing may write it through the API', () => {
  // Written by hand or by the provisioner using the service role, which bypasses RLS. Granting
  // `authenticated` a write here would let any signed-in user retarget a whole deployment.
  const policies = sql.match(/create policy\s+\w+\s+on sites\s+for\s+(\w+)/gi) ?? [];
  assert.ok(policies.length > 0, 'at least one policy must exist');
  for (const p of policies) {
    assert.match(p, /for\s+select/i, `only select may be granted, found: ${p}`);
  }
});
