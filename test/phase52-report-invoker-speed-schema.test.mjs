/**
 * Guards supabase/phase52_report_invoker_speed.sql — RM-151.
 *
 * Signed in, row-level security kept PostgreSQL from bounding the reports' hour-by-hour probes. Five
 * functions went from about 0.6 s to 3.6-5.4 s each, and the page's five together crossed the 8 s
 * limit (E-229). This phase runs them as their owner.
 *
 * phase37's own test explains why that is normally dangerous: a definer bypasses row security. Here
 * it is safe for one reason only. The tables they read admit exactly `authenticated`, and exactly
 * `authenticated` may execute them. So this file pins that equality from both sides: if a later
 * migration narrows a policy, or redefines one of these functions without `security definer`, a test
 * here fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'supabase');
const strip = (text) => text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const sql = strip(readFileSync(join(DIR, 'phase52_report_invoker_speed.sql'), 'utf8'));

const SIGNATURES = [
  'report_daily_series(text, date, text)',
  'report_demand_summary(text, date, text)',
  'report_hour_profile(text, date, text, text)',
  'report_hour_matrix(text, date, text)',
  'report_demand_curve(text, date, text, int)',
];
const esc = (s) => s.replace(/[()[\]]/g, (c) => `\\${c}`);

/** Every phase file in the order they are applied (`sort -V`). */
const phases = readdirSync(DIR)
  .filter((f) => /^phase\d+_.*\.sql$/.test(f))
  .sort((a, b) => Number(a.match(/^phase(\d+)/)[1]) - Number(b.match(/^phase(\d+)/)[1]) || a.localeCompare(b));

test('exactly the five page functions run as their owner, with a fixed search path', () => {
  for (const sig of SIGNATURES) {
    assert.match(sql, new RegExp(`alter function public\\.${esc(sig)}\\s+security definer;`, 'i'), sig);
    assert.match(sql, new RegExp(`alter function public\\.${esc(sig)}\\s+set search_path = public, pg_temp;`, 'i'), sig);
  }
  assert.equal((sql.match(/security definer/gi) ?? []).length, SIGNATURES.length);
});

test('no function body is written here, so the bodies stay the ones their own phases guard', () => {
  assert.equal(/create\s+(or\s+replace\s+)?function/i.test(sql), false);
  assert.equal(/\b(insert|update|delete|truncate|drop)\b/i.test(sql), false);
});

test('only the signed-in role may execute them: nothing for anon or public', () => {
  for (const sig of SIGNATURES) {
    assert.match(sql, new RegExp(`revoke execute on function public\\.${esc(sig)}\\s+from public, anon;`, 'i'), sig);
    assert.match(sql, new RegExp(`grant\\s+execute on function public\\.${esc(sig)}\\s+to authenticated;`, 'i'), sig);
  }
  assert.equal(/grant[^;]*\bto\b[^;]*\b(anon|public)\b/i.test(sql), false);
});

test('every table these functions read still admits exactly the signed-in role, so bypassing row security changes nothing', () => {
  // The latest policy statement per table, across every migration in apply order. A narrower one
  // (per site, per user) would make these definers a way around it. Rethink this file before
  // relaxing this test.
  for (const table of ['building_totals', 'building_totals_hourly', 'readings', 'readings_hourly']) {
    let latest = null;
    for (const file of phases) {
      const text = strip(readFileSync(join(DIR, file), 'utf8'));
      const re = new RegExp(`create policy \\w+ on (?:public\\.)?${table}\\b([^;]*);`, 'gi');
      for (const m of text.matchAll(re)) latest = { file, body: m[1] };
    }
    assert.ok(latest, `no policy found for ${table}`);
    assert.match(latest.body, /for select using \(\s*\(select auth\.role\(\)\) = 'authenticated'\s*\)/i,
      `${table}'s latest policy (${latest.file}) is no longer exactly "authenticated": phase52's definers would bypass it`);
  }
});

test('a later migration that redefines one of these five must keep it a definer', () => {
  // `create or replace function` resets a function to security invoker. Without this, a future fix
  // to one of the five would silently bring the timeouts back.
  const later = phases.filter((f) => Number(f.match(/^phase(\d+)/)[1]) > 52);
  for (const file of later) {
    const text = strip(readFileSync(join(DIR, file), 'utf8'));
    for (const sig of SIGNATURES) {
      const name = sig.slice(0, sig.indexOf('('));
      const at = text.search(new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${name}\\s*\\(`, 'i'));
      if (at < 0) continue;
      const header = text.slice(at, text.indexOf('$', at));
      assert.match(header, /security definer/i, `${file} redefines ${name} without security definer`);
    }
  }
});

test('PostgREST is told to reload', () => {
  assert.match(sql, /notify pgrst, 'reload schema';/i);
});
