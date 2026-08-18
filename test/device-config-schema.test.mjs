/**
 * Guards supabase/phase7_device_config.sql against the two mistakes this project has already
 * made once each, both of which only surfaced live:
 *
 *   1. a PARTIAL unique index as the upsert target (supabase/phase6_schedules_unique_fix.sql)
 *      — supabase-js generates `ON CONFLICT (device_id) DO UPDATE`, which Postgres refuses to
 *      match against anything conditional;
 *   2. an RLS-enabled table missing one of the policies the app's path needs, which PostgREST
 *      reports as a silent 200-with-empty-array rather than an error (src/lib/supabaseConfig.ts).
 *
 * A file-text test, not a live-database one: this repo has no migration runner and no test
 * Supabase project. It catches the class of error that survives code review, which is the
 * class that cost this project two commits already.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(ROOT, 'supabase', 'phase7_device_config.sql'), 'utf8');

test('device_config keys on device_id as a PRIMARY KEY, so upsert onConflict can target it', () => {
  assert.match(sql, /device_id\s+text\s+primary key\s+references devices\(id\)/i);
});

test('no partial unique index anywhere — the phase 6 ON CONFLICT trap', () => {
  assert.equal(/create unique index[\s\S]*?where/i.test(sql), false);
});

test('RLS is on and all three policies the app needs exist, named per schema.sql convention', () => {
  assert.match(sql, /alter table device_config enable row level security/i);
  for (const verb of ['select', 'insert', 'update']) {
    assert.match(sql, new RegExp(`create policy device_config_${verb}_authenticated on device_config`, 'i'));
  }
  assert.match(sql, /auth\.role\(\) = 'authenticated'/);
});

test('no anon policy — phase5_lockdown_rls.sql dropped those for good', () => {
  assert.equal(/create policy [a-z_]*anon/i.test(sql), false);
});

test('both enumerated columns are constrained in the database, not only in TypeScript', () => {
  assert.match(sql, /category[\s\S]*?check[\s\S]*?'lighting','hvac','office_equipment','critical','kitchen','other'/);
  assert.match(sql, /load_shed_group[\s\S]*?check[\s\S]*?'group_1','group_2','group_3','never'/);
});

test('devices itself is untouched — nothing user-editable lands in the table ingest.mjs overwrites every 5 minutes', () => {
  assert.equal(/alter table devices/i.test(sql), false);
});
