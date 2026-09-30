/**
 * Guards supabase/phase51_edge_watchdog.sql — RM-150, finding F-034.
 *
 * Every notice this system sends came from the edge, so an edge that died said nothing. This phase
 * has the database watch the edge's health row and post to the site's ntfy topic. What it must get
 * right: the topic stays out of the browser's reach, the check is edge-triggered, its thresholds
 * respect how often the edge writes, and the housekeeping touches only this project's jobs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase51_edge_watchdog.sql'), 'utf8');
const sql = raw.replace(/--[^\n]*/g, '');

test('the extensions are created with Supabase\'s own statements, and their absence stops the paste', () => {
  assert.match(sql, /create extension if not exists pg_net with schema extensions;/i);
  assert.match(sql, /create extension if not exists pg_cron with schema pg_catalog;/i);
  assert.match(sql, /to_regprocedure\('net\.http_post\(text, jsonb, jsonb, jsonb, integer\)'\) is null then\s+raise exception/i);
  assert.match(sql, /to_regprocedure\('cron\.schedule\(text, text, text\)'\) is null then\s+raise exception/i);
});

test('the topic is out of the browser\'s reach: RLS on, no policy, nothing granted to anon or authenticated', () => {
  assert.match(sql, /alter table (?:public\.)?edge_watchdog enable row level security;/i);
  assert.equal(/create policy/i.test(sql), false);
  assert.match(sql, /revoke all on (?:public\.)?edge_watchdog from anon, authenticated;/i);
});

test('every function runs as its owner with a pinned search path, and only the service role may call it', () => {
  for (const [fn, args] of [['edge_watchdog_check', ''], ['edge_watchdog_ping', 'text'], ['edge_watchdog_ping_result', 'bigint']]) {
    const body = sql.slice(sql.search(new RegExp(`create or replace function (?:public\\.)?${fn}\\(`, 'i')));
    assert.match(body.slice(0, 300), /security definer\s+set search_path = public/i, `${fn} must pin its search path`);
    assert.match(sql, new RegExp(`revoke all on function (?:public\\.)?${fn}\\(${args}\\) from public, anon, authenticated;`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function (?:public\\.)?${fn}\\(${args}\\) to service_role;`, 'i'));
  }
});

test('silence is 15 minutes by default and never under 10, because the edge writes every 5', () => {
  assert.match(sql, /stale_after\s+interval not null default interval '15 minutes' check \(stale_after >= interval '10 minutes'\)/i);
  assert.match(sql, /remind_every\s+interval not null default interval '6 hours'/i);
});

test('the check is edge-triggered: a notice when silence starts, a reminder, one on recovery', () => {
  const check = sql.slice(sql.indexOf('function public.edge_watchdog_check'), sql.indexOf('function public.edge_watchdog_ping('));
  assert.match(check, /if silent and \(w\.state = 'ok' or w\.alerted_at is null or now\(\) - w\.alerted_at >= w\.remind_every\) then/i);
  assert.match(check, /elsif not silent and w\.state = 'silent' then/i);
  assert.equal((check.match(/net\.http_post\(/g) ?? []).length, 2, 'two notices: silent and recovered');
  assert.match(check, /from ingestion_health h\s+where h\.site_id = w\.site_id/i);
});

test('it runs every ten minutes, and the cleanup deletes only this project\'s run history', () => {
  assert.match(sql, /cron\.schedule\('ibems-edge-watchdog', '\*\/10 \* \* \* \*', \$cron\$select public\.edge_watchdog_check\(\)\$cron\$\)/i);
  assert.match(sql, /delete from cron\.job_run_details\s+where end_time < now\(\) - interval '7 days'\s+and jobid in \(select jobid from cron\.job where jobname like 'ibems-%'\)/i);
  assert.equal(/\b(truncate|drop)\b/i.test(sql), false);
  assert.equal((sql.match(/\bdelete from\b/gi) ?? []).length, 1, 'the one delete is the run-history cleanup');
});

test('PostgREST is told to reload, so the setup command can call the new functions at once', () => {
  assert.match(sql, /notify pgrst, 'reload schema';/i);
});
