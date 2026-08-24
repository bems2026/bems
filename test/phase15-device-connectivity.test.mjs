/**
 * Guards supabase/phase15_device_connectivity.sql.
 *
 * The two mistakes worth catching here are both silent ones. `security definer` would hand
 * every device's history to any caller who could reach the function, with RLS none the wiser —
 * the same trap phase9_history_buckets.sql documents at length. And counting transitions with
 * `<>` rather than `is distinct from` would drop every comparison involving the NULL that
 * `lag()` produces for the first sample, undercounting flaps without erroring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase15_device_connectivity.sql'), 'utf8');

/**
 * Assertions run against the SQL with `--` comments stripped. This file explains at length why
 * it is NOT `security definer`, and a naive substring check reads that explanation as the thing
 * it warns about — the test would fail on a correct file for quoting the danger it avoids.
 * Prose is not code; check the code.
 */
const sql = raw.replace(/^s*--.*$/gm, '');

test('runs as the invoker, so RLS still decides what the caller may read', () => {
  assert.match(sql, /security invoker/i);
  assert.equal(/security definer/i.test(sql), false);
});

test('execute is revoked from public before being granted to authenticated', () => {
  const revoke = sql.search(/revoke execute on function public\.device_connectivity/i);
  const grant = sql.search(/grant\s+execute on function public\.device_connectivity/i);
  assert.ok(revoke > -1 && grant > -1, 'both statements must be present');
  assert.ok(revoke < grant, 'revoke must precede grant, or the grant is undone');
  assert.equal(/grant[\s\S]*to\s+anon/i.test(sql), false);
});

test('transitions use `is distinct from`, so a NULL predecessor cannot silently swallow a flap', () => {
  assert.match(sql, /online is distinct from w?\.?prev_online/i);
  assert.equal(/online\s*<>\s*w?\.?prev_online/i.test(sql), false);
});

test('the first sample in a window is excluded from the transition count', () => {
  // lag() yields NULL there; counting it would report a phantom change for every device on
  // every call, which would make the number useless precisely when it mattered.
  assert.match(sql, /prev_online is not null/i);
});

test('the window is clamped, so one caller cannot ask for an unbounded scan', () => {
  // Substring checks over whitespace-collapsed SQL, not a regex: the pattern is full of
  // parentheses that would need escaping, and an over-escaped regex silently matches nothing.
  const clamp = sql.replace(/\s+/g, ' ');
  assert.ok(clamp.includes('least(p_window_hours, 168)'), 'upper bound missing');
  assert.ok(clamp.includes('greatest(1,'), 'lower bound missing');
});

test('reads readings.online rather than inventing storage', () => {
  assert.match(sql, /from readings/i);
  assert.equal(/create table/i.test(sql), false);
  assert.equal(/alter table/i.test(sql), false);
});

test('is re-runnable', () => {
  assert.match(sql, /create or replace function/i);
});
