/**
 * Guards supabase/phase13_device_functions.sql, and in particular the one distinction the
 * whole feature rests on: NULL ("nobody has said, use the class default") and '{}' ("somebody
 * said none") are different answers. A `not null default '{}'` would collapse them and
 * silently convert every unconfigured device into one deliberately given no role — which,
 * since the pages filter on these values, would empty Control, Analytics and Automation at
 * once.
 *
 * A file-text test, not a live-database one: this repo has no migration runner and no test
 * Supabase project. Same convention and same rationale as
 * test/device-config-schema.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(join(ROOT, 'supabase', 'phase13_device_functions.sql'), 'utf8');

test('adds the column to device_config rather than creating a rival table', () => {
  assert.match(sql, /alter table device_config\s+add column if not exists functions text\[\]/i);
  assert.equal(/create table/i.test(sql), false);
});

test('the column stays nullable — NULL and {} must remain distinguishable', () => {
  assert.equal(/functions\s+text\[\][^;]*not null/i.test(sql), false);
  assert.equal(/functions\s+text\[\][^;]*default/i.test(sql), false);
});

test('the CHECK validates elementwise, so it cannot drift from the code as combinations grow', () => {
  assert.match(sql, /functions is null or functions <@ array\['control','monitoring','scheduling'\]/i);
});

test('the CHECK is added only when absent, so the file is safe to re-run', () => {
  assert.match(sql, /select 1 from pg_constraint where conname = 'device_config_functions_valid'/i);
});

test('adds no policy — device_config already has its three, and a second set would compete', () => {
  assert.equal(/create policy/i.test(sql), false);
  assert.equal(/enable row level security/i.test(sql), false);
});

test('never grants anon anything — phase5_lockdown_rls.sql dropped those for good', () => {
  assert.equal(/\banon\b/i.test(sql), false);
});

test('the allowed values match the frontend union exactly', async () => {
  const fns = readFileSync(join(ROOT, 'src', 'lib', 'deviceFunctions.ts'), 'utf8');
  const declared = [...fns.matchAll(/'(control|monitoring|scheduling)'/g)].map((m) => m[1]);
  for (const f of ['control', 'monitoring', 'scheduling']) {
    assert.ok(declared.includes(f), `${f} missing from deviceFunctions.ts`);
    assert.ok(sql.includes(`'${f}'`), `${f} missing from the CHECK constraint`);
  }
});
