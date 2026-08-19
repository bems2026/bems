/**
 * Guards supabase/phase8_anomalies.sql against the same mistakes
 * test/device-config-schema.test.mjs already guards phase7 against, plus one specific to
 * this table: writeOrBuffer()'s upsert-with-onConflict retry semantics need
 * (device_id, ts, metric) to be an UNCONDITIONAL composite primary key, not a
 * gen_random_uuid() PK — see the SQL file's own header.
 *
 * A file-text test, not a live-database one — no migration runner, no test Supabase
 * project in this repo, same reasoning as device-config-schema.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(ROOT, 'supabase', 'phase8_anomalies.sql'), 'utf8');

test('anomalies keys on (device_id, ts, metric) as a composite PRIMARY KEY, not a random uuid', () => {
  assert.match(sql, /primary key \(device_id,\s*ts,\s*metric\)/i);
  // Checks for the actual dangerous pattern (a column defaulted to a random uuid), not a
  // bare string search — this file's own header comment explains why gen_random_uuid()
  // ISN'T used, and a naive "does this string appear anywhere" check can't tell that prose
  // apart from a real column default using it.
  assert.equal(/default\s+gen_random_uuid\(\)/i.test(sql), false);
});

test('no partial unique index anywhere — the phase 6 ON CONFLICT trap', () => {
  assert.equal(/create unique index[\s\S]*?where/i.test(sql), false);
});

test('RLS is on, with select-only access for authenticated — server-computed, never frontend-written', () => {
  assert.match(sql, /alter table anomalies enable row level security/i);
  assert.match(sql, /create policy anomalies_select_authenticated on anomalies/i);
  assert.match(sql, /auth\.role\(\) = 'authenticated'/);
});

test("no insert/update policy — only ibems-server's service-role key writes this table", () => {
  assert.equal(/create policy anomalies_insert/i.test(sql), false);
  assert.equal(/create policy anomalies_update/i.test(sql), false);
});

test('no anon policy — phase5_lockdown_rls.sql dropped those for good', () => {
  assert.equal(/create policy [a-z_]*anon/i.test(sql), false);
});

test('method is constrained in the database to the values server/anomalyStats.mjs can produce', () => {
  assert.match(sql, /method[\s\S]*?check[\s\S]*?'zscore',\s*'iqr',\s*'both'/);
});
