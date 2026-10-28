/**
 * phase57 — energy a held meter counted but did not report, as an estimate (RM-165).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase57_energy_estimates.sql'), 'utf8');
/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

test('creates the table idempotently, one row per device, day and hold', () => {
  assert.match(sql, /create table if not exists energy_estimates/i);
  assert.match(sql, /primary key \(site_id, device_id, local_day, held_from\)/i);
  assert.match(sql, /check \(kwh >= 0 and kwh <= 240\)/i, 'a day of one branch at 10 kW is 240 kWh');
});

test('signed-in users read; only the edge (the service role) writes; anon gets nothing', () => {
  assert.match(sql, /alter table energy_estimates enable row level security/i);
  assert.match(sql, /create policy energy_estimates_select_authenticated on energy_estimates\s+for select/i);
  assert.doesNotMatch(sql, /for (insert|update|delete)/i);
  assert.match(sql, /revoke all on energy_estimates from public, anon, authenticated;\s*grant select on energy_estimates to authenticated;/i);
});

test('every policy is dropped before it is created, so a re-run is not an error', () => {
  for (const m of sql.matchAll(/create policy (\w+)/gi)) {
    assert.match(sql, new RegExp(`drop policy if exists ${m[1]} on energy_estimates`, 'i'));
  }
});

test('the server spreads within the table\'s bound', async () => {
  const { MAX_BRANCH_W } = await import('../server/heldEnergy.mjs');
  assert.equal((MAX_BRANCH_W * 24) / 1000, 240);
});
