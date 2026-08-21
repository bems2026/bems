/**
 * Guards supabase/phase10_history_archive.sql — the read path that spans `readings_hourly`
 * and `readings`, so history older than the retention window is reachable at all.
 *
 * WHY THIS FILE EXISTS: Phase 9 built `readings_hourly` to preserve long-range history past
 * the 30-day prune, but nothing ever read it. `readings_buckets` selects from `readings`
 * alone, and the frontend only ever called that. The archive was write-only — invisible
 * while every query still landed inside the raw window, and permanent data loss from the
 * application's point of view the moment one didn't.
 *
 * File-text tests, not live-database ones — no migration runner, no test Supabase project
 * in this repo, same reasoning as phase9-history-schema.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const archive = readFileSync(join(ROOT, 'supabase', 'phase10_history_archive.sql'), 'utf8');

/** Negative assertions run against statements only — these files explain in prose exactly
 * which dangerous pattern they avoid, so a bare search matches the warning and fails the
 * very file that heeds it. Same helper, same reason, as phase9-history-schema.test.mjs. */
function statementsOnly(sql) {
  return sql.replace(/--[^\n]*/g, '');
}
const sql = statementsOnly(archive);

test('readings_archive runs as SECURITY INVOKER, so RLS on both source tables still applies', () => {
  assert.match(archive, /security invoker/i);
  // Same trap phase9_history_buckets.sql documents: a definer function would run as its
  // owner and hand every reading to any caller, undoing phase5_lockdown_rls.sql.
  assert.equal(/security\s+definer/i.test(sql), false);
});

test('readings_archive revokes the default PUBLIC execute grant before granting', () => {
  assert.match(archive, /revoke execute on function public\.readings_archive[\s\S]*?from public/i);
  assert.match(archive, /grant\s+execute on function public\.readings_archive[\s\S]*?to authenticated/i);
  assert.equal(/grant[\s\S]*?readings_archive[\s\S]*?to anon/i.test(sql), false);
});

test('readings_archive reads BOTH the rollup and the raw table — the whole point of it', () => {
  assert.match(sql, /from readings_hourly/i);
  assert.match(sql, /from readings\b/i);
});

test('the seam is deduplicated: an hour present in the rollup is never also taken from raw', () => {
  // roll_up_and_prune_readings is atomic, so an overlap should be unreachable — but its own
  // header records that `on conflict do nothing` exists precisely because raw rows for an
  // already-rolled-up hour COULD come back. If that happens the hour must not be counted
  // twice, which would silently double a reported total.
  assert.match(sql, /not exists\s*\([\s\S]*?readings_hourly/i);
});

test('coarser buckets weight each hour by its own sample count, not a flat average', () => {
  // Averaging hourly averages treats an hour with 3 online samples as equal to one with 60.
  // The weighted form is the only correct way to roll an average of averages up a level.
  assert.match(sql, /sum\([\s\S]{0,60}?\*\s*[a-z_.]*online_sample_count\)\s*\/\s*nullif\(sum\([a-z_.]*online_sample_count\)/i);
  assert.equal(/avg\(\s*[a-z_.]*power_w_avg\s*\)/i.test(sql), false);
});

test('only online samples ever contribute — a disconnected meter yields a gap, not a value', () => {
  // Same invariant shared/buildLatest.mjs enforces for building totals (EX-063) and
  // readings_buckets restored for the 7d/30d charts.
  assert.match(sql, /filter\s*\(where\s+[a-z_.]*online\)/i);
});

test('readings_archive reports sample and online counts, so coverage can be stated', () => {
  // A monthly total computed from a half-offline month is a real number and a misleading
  // one. The report has to be able to say how much of the window it actually saw.
  assert.match(archive, /online_count\s+int/i);
  assert.match(archive, /sample_count\s+int/i);
});

test('readings_archive RAISES rather than truncating when it would return too many rows', () => {
  assert.match(archive, /raise exception/i);
  const cap = archive.match(/max_buckets\s+constant\s+int\s*:=\s*(\d+)/i);
  assert.ok(cap, 'the bucket cap should be a named constant');
  assert.ok(
    Number(cap[1]) < 1000,
    `the cap (${cap[1]}) must stay below PostgREST's db-max-rows of 1000, or the very cap ` +
      'that caused the Phase 9 bug would truncate this answer too'
  );
});

test('the bucket size cannot be finer than the rollup grain it may have to read from', () => {
  // readings_hourly has no sub-hour detail. Accepting p_bucket_seconds < 3600 would return
  // buckets that are real inside the raw window and fabricated outside it, with nothing in
  // the response to say which was which.
  assert.match(sql, /p_bucket_seconds\s*<\s*3600|mod\(p_bucket_seconds,\s*3600\)/i);
  assert.match(archive, /raise exception/i);
});
