/**
 * Guards supabase/phase50_request_budget.sql — RM-149.
 *
 * The scheduler re-read its configuration in seven requests a minute, and every request is a line in
 * the hosted database's log, whose Free-plan quota was the tight one (0.97 of 1 GB, 2026-09-30). This
 * phase returns the same rows in one call, and reports the two sizes the plan caps. It must stay
 * read-only, return exactly what the scheduler's own reads returned, and belong to the service role.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase50_request_budget.sql'), 'utf8');
const sql = raw.replace(/--[^\n]*/g, '');
const scheduler = readFileSync(join(ROOT, 'server', 'scheduler.mjs'), 'utf8');

test('it changes no rows and no tables', () => {
  assert.equal(/\b(delete|truncate|update|insert)\b/i.test(sql), false);
  assert.equal(/\b(drop|alter)\b/i.test(sql), false);
  assert.equal(/security definer/i.test(sql), false, 'both run as the caller');
  assert.equal((sql.match(/security invoker/gi) ?? []).length, 2);
  assert.equal((sql.match(/\bstable\b/gi) ?? []).length, 2);
});

test('both functions belong to the service role alone', () => {
  for (const [fn, args] of [['scheduler_snapshot', 'text'], ['usage_bytes', '']]) {
    assert.match(sql, new RegExp(`revoke all on function (?:public\\.)?${fn}\\(${args}\\) from public, anon, authenticated;`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function (?:public\\.)?${fn}\\(${args}\\) to service_role;`, 'i'));
  }
});

/** The `select=` column list of one of the scheduler's table reads. */
function columnsRead(table) {
  const m = scheduler.match(new RegExp(`sb\\(\`?'?${table}\\?select=([a-z_,]+)`));
  assert.ok(m, `scheduler.mjs no longer reads ${table} with an explicit column list`);
  return m[1].split(',');
}

/** The keys one jsonb_build_object block puts on each row of a snapshot key. */
function columnsReturned(key) {
  const start = sql.indexOf(`'${key}',`);
  assert.ok(start >= 0, `the snapshot has no '${key}' key`);
  const block = sql.slice(start, sql.indexOf('from ', start));
  return [...block.matchAll(/'([a-z_]+)',\s*\w+\.\w+/g)].map((m) => m[1]);
}

test('each snapshot key returns exactly the columns the scheduler reads from that table', () => {
  // The two paths must feed the scheduler the same rows: one it runs, one it falls back to. A
  // column added to one read and not the other would make the loop behave differently depending on
  // whether a migration had been pasted.
  const pairs = [
    ['schedules', 'schedules'],
    ['dsm_thresholds', 'dsm'],
    ['device_config', 'device_config'],
    ['socket_config', 'socket_config'],
    ['acu_rules', 'acu_rules'],
    ['acu_loop_state', 'acu_loop_state'],
    ['commands', 'acu_commands'],
  ];
  for (const [table, key] of pairs) {
    assert.deepEqual(columnsReturned(key).sort(), columnsRead(table).sort(), `${key} vs the ${table} read`);
  }
});

test('the thresholds are this site\'s, and the aircon commands are the newest fifty, newest first', () => {
  assert.match(sql, /from dsm_thresholds t\s+where t\.site_id = p_site_id/i);
  assert.match(scheduler, /dsm_thresholds\?select=[a-z_,]+&site_id=eq\./, 'the fallback reads the same site');
  assert.match(sql, /where c\.device_id in \(select r\.acu_device_id from acu_rules r\)/i);
  assert.match(sql, /order by c\.requested_at desc\s+limit 50/i);
  assert.match(scheduler, /&order=requested_at\.desc&limit=50/);
  assert.match(sql, /order by x\.requested_at desc\)/i, 'jsonb_agg keeps the order only when told');
});

test('an empty table is an empty list, never null', () => {
  for (const key of ['schedules', 'device_config', 'socket_config', 'acu_rules', 'acu_loop_state', 'acu_commands']) {
    const start = sql.indexOf(`'${key}', coalesce((`);
    assert.ok(start >= 0, `${key} must be coalesced`);
  }
});

test('usage counts what the plan counts: the database size and every stored object', () => {
  assert.match(sql, /pg_database_size\(current_database\(\)\)/i);
  assert.match(sql, /sum\(\(o\.metadata->>'size'\)::bigint\) from storage\.objects o/i);
});

test('PostgREST is told to reload, so the new functions are callable at once', () => {
  assert.match(sql, /notify pgrst, 'reload schema';/i);
});
