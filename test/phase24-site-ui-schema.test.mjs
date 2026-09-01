/**
 * Guards supabase/phase24_site_ui_prefs.sql — RM-035, per-site card visibility.
 *
 * Most of these assertions defend one decision: that this is a SIBLING table rather than a
 * column on `sites`. `sites` is deliberately unwritable from the browser, and the same row holds
 * `policy.acu_min_setpoint_c` — the aircon floor `shared/commands.mjs` enforces server-side.
 * PostgreSQL's RLS is row-level, so an UPDATE policy admitting a display preference would admit
 * the energy policy with it. A future edit that "simplifies" this into a column on `sites` would
 * open that hole silently, and every unit test would still pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase24_site_ui_prefs.sql'), 'utf8');
/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

test('creates the table idempotently, so a re-run is not an error', () => {
  assert.match(sql, /create table if not exists site_ui_prefs/i);
});

test('it NEVER grants write access to the sites table itself', () => {
  // The decision this file exists to protect. `sites` carries the aircon policy floor, and RLS
  // cannot scope an UPDATE to one column.
  assert.doesNotMatch(sql, /create policy[^;]*on\s+sites\b/i);
  assert.doesNotMatch(sql, /grant[^;]*\bon\s+sites\b/i);
  assert.doesNotMatch(sql, /alter table\s+sites\b/i);
});

test('one row per site, keyed by the site itself', () => {
  // A surrogate id with a unique index would not satisfy supabase-js's upsert, which emits
  // ON CONFLICT (site_id) — and Postgres only matches that against an unconditional constraint.
  assert.match(sql, /site_id\s+text\s+primary key\s+references\s+sites\s*\(\s*id\s*\)/i);
});

test('deleting a site takes its preferences, rather than leaving them for the next deployment', () => {
  assert.match(sql, /references\s+sites\s*\(\s*id\s*\)\s+on delete cascade/i);
});

test('preferences are jsonb, so a new card never needs a migration', () => {
  assert.match(sql, /prefs\s+jsonb\s+not null\s+default\s+'\{\}'::jsonb/i);
});

test('a site with no row is a valid state — the default is an empty object, not a seeded row', () => {
  // This is what makes the migration invisible until somebody opts in: no row reads as
  // all-defaults, which `siteUi.ts` resolves to all-visible.
  assert.doesNotMatch(sql, /insert into site_ui_prefs/i);
});

test('row level security is on, with select, insert and update for authenticated', () => {
  assert.match(sql, /alter table site_ui_prefs enable row level security/i);
  for (const action of ['select', 'insert', 'update']) {
    assert.match(sql, new RegExp(`create policy site_ui_prefs_${action}_authenticated`, 'i'), `missing ${action} policy`);
  }
});

test('DELETE is not granted, because clearing a preference is a write of defaults', () => {
  // Same distinction device_config draws. Deleting the row would also discard `updated_by`, the
  // only record of who changed what the office screen shows.
  assert.doesNotMatch(sql, /create policy site_ui_prefs_delete/i);
  assert.doesNotMatch(sql, /grant[^;]*delete[^;]*on site_ui_prefs/i);
});

test('every policy is dropped before it is created, which is what earns the re-run claim', () => {
  // PostgreSQL has no `create policy if not exists`. phase21 promised idempotency without this
  // and the operator hit 42710 while re-applying it to pick up a security fix.
  const created = [...sql.matchAll(/create policy\s+(\S+)/gi)].map((m) => m[1]);
  assert.ok(created.length > 0, 'expected policies to exist');
  for (const name of created) {
    assert.match(sql, new RegExp(`drop policy if exists\\s+${name}\\b`, 'i'), `${name} is created without being dropped first`);
  }
});

test('anon is revoked explicitly, and revoked before authenticated is granted', () => {
  // Granting before revoking undoes the grant — the ordering trap phase21 records.
  const revoke = sql.search(/revoke all on site_ui_prefs from public, anon/i);
  const grant = sql.search(/grant select, insert, update on site_ui_prefs to authenticated/i);
  assert.ok(revoke !== -1, 'expected an explicit revoke');
  assert.ok(grant !== -1, 'expected an explicit grant');
  assert.ok(revoke < grant, 'the revoke must come first or it undoes the grant');
});

test('the jsonb keys the app writes are the ones this file documents', () => {
  // The table is shapeless by design, so the only thing tying it to `siteUi.ts` is prose. If
  // that prose stops naming the real keys, the next reader has nothing.
  assert.match(raw, /control_plan_card/);
  assert.match(raw, /overview_scene_card/);
  assert.match(raw, /siteUi\.ts/);
});
