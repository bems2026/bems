/**
 * Guards supabase/phase43_readings_policy_speed.sql — RM-091a.
 *
 * The readings policies called `auth.role()` bare, which Postgres evaluates once per row. phase40 fixed
 * the same shape on the totals tables after it made a report query time out for signed-in readers;
 * RM-094 and RM-098 then began reading whole months of `readings` signed in. A bare `auth.role()` slipped
 * back into either policy would be a policy that is right and scans slowly, which no functional test sees.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(ROOT, 'supabase', 'phase43_readings_policy_speed.sql'), 'utf8').replace(/--[^\n]*/g, '');

test('both readings policies evaluate auth.role() once per statement', () => {
  for (const [table, policy] of [
    ['readings', 'readings_select_authenticated'],
    ['readings_hourly', 'readings_hourly_select_authenticated'],
  ]) {
    assert.match(sql, new RegExp(`drop policy if exists ${policy} on ${table};`, 'i'), `${policy} must be dropped first`);
    assert.match(
      sql,
      new RegExp(`create policy ${policy} on ${table}\\s+for select using \\(\\(select auth\\.role\\(\\)\\) = 'authenticated'\\);`, 'i'),
      `${policy} must wrap auth.role() in a select`
    );
  }
  assert.equal(/using\s*\(\s*auth\.role\(\)/i.test(sql), false, 'a bare auth.role() is evaluated per row');
});

test('it changes those two policies and nothing else', () => {
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  const kinds = statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
  assert.deepEqual(kinds, ['drop policy', 'create policy', 'drop policy', 'create policy', 'notify pgrst,']);
  assert.equal(/\b(grant|revoke|alter table|create table|function|cascade)\b/i.test(sql), false);
});
