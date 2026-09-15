/**
 * Guards supabase/phase40_report_curve_speed.sql — RM-086.
 *
 * File-text tests, as for every phase: `supabase/rehearse.sh` proves the SQL runs and that the new
 * curve equals phase37's point for point; this proves the file still says what it was written to
 * say. Two of these guard the fix itself, because both regressions would be silent — a correlated
 * percentile slipped back in is a curve that is right and times out, and a bare `auth.role()` in a
 * policy is a policy that is right and scans slowly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase40_report_curve_speed.sql'), 'utf8');

/** Statements only: a comment quoting the old form must not satisfy or fail an assertion. */
const sql = raw.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const SIGNATURE = /public\.report_demand_curve\(text,\s*date,\s*text,\s*int\)/i;

test('the curve is computed by one percentile over an array of fractions, not one per point', () => {
  const calls = sql.match(/percentile_cont\s*\(/gi) ?? [];
  assert.equal(calls.length, 1, `expected exactly one percentile_cont, found ${calls.length}`);
  assert.match(sql, /percentile_cont\s*\(\s*fs\s*\)/i, 'the percentile must take the fractions array');
  assert.match(sql, /fs\s+double precision\[\]/i, 'the fractions must be an array of double precision');
  // The phase37 form took one fraction per row — `percentile_cont(fractions.f)` inside a scalar
  // subquery — which re-evaluated and resorted the samples for every point. Its tell is the argument:
  // a column of a fractions row, not the array. (A first version of this assertion looked for
  // `(select percentile_cont`, and matched the opening parenthesis of the new CTE instead.)
  assert.equal(/percentile_cont\s*\(\s*[a-z_]+\.[a-z_]+\s*\)/i.test(sql), false, 'no per-row fraction argument');
});

test('the function keeps its shape, its read-only declaration and invoker security', () => {
  assert.match(sql, /returns table\s*\(\s*pct\s+numeric,\s*power_w\s+numeric,\s*resolution\s+text\s*\)/i);
  assert.match(sql, /\bstable\b/i);
  assert.match(sql, /security\s+invoker/i);
  assert.equal(/security\s+definer/i.test(sql), false, 'a definer function would bypass RLS for every caller');
});

test('it is dropped by its exact signature before it is created, and never with cascade', () => {
  const drop = sql.search(new RegExp(`drop function if exists ${SIGNATURE.source}`, 'i'));
  const create = sql.search(/create function public\.report_demand_curve\s*\(/i);
  assert.ok(drop > -1, 'drop by explicit signature is missing');
  assert.ok(create > drop, 'the drop must come before the create');
  assert.equal(/\bcascade\b/i.test(sql), false);
});

test('execute is revoked from public and anon by name, then granted to authenticated', () => {
  assert.match(sql, new RegExp(`revoke execute on function ${SIGNATURE.source}\\s+from public,\\s*anon`, 'i'));
  assert.match(sql, new RegExp(`grant execute on function ${SIGNATURE.source}\\s+to authenticated`, 'i'));
});

test('both totals policies evaluate auth.role() once per statement', () => {
  for (const table of ['building_totals', 'building_totals_hourly']) {
    const policy = `${table}_select_authenticated`;
    assert.match(sql, new RegExp(`drop policy if exists ${policy} on ${table};`, 'i'), `${policy} must be dropped first`);
    assert.match(
      sql,
      new RegExp(`create policy ${policy} on ${table}\\s+for select using \\(\\(select auth\\.role\\(\\)\\) = 'authenticated'\\);`, 'i'),
      `${policy} must wrap auth.role() in a select`
    );
  }
  // And no bare comparison anywhere in the file's statements.
  assert.equal(/using\s*\(\s*auth\.role\(\)/i.test(sql), false, 'a bare auth.role() is evaluated per row');
});

test('the header names what was measured and how to read it back', () => {
  assert.match(raw, /statement timeout/i);
  assert.match(raw, /READ BACK/);
});
