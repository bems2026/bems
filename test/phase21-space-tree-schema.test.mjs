/**
 * Guards supabase/phase21_space_tree.sql — RM-028, the spatial hierarchy.
 *
 * The thing this migration exists to prevent is a hierarchy that cannot bend. `room` was free
 * text in two tables with no rooms table behind it, so an office, a lab and a floor could not be
 * grouped, rolled up or scoped. The fix has to work for a site that is one room AND for a site
 * that is a campus, which is why most of these assertions are about the shape staying open
 * rather than about any particular depth.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase21_space_tree.sql'), 'utf8');
/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

test('creates the table idempotently, so a re-run is not an error', () => {
  assert.match(sql, /create table if not exists space_nodes/i);
});

test('the tree is ONE self-referencing table, not one table per level', () => {
  // A table per level fixes the depth at schema time, which is exactly what makes a hierarchy
  // rigid — a single room and a campus could not both fit. This is the whole design decision.
  assert.match(sql, /parent_id\s+uuid\s+references\s+space_nodes\s*\(\s*id\s*\)/i);
  for (const forbidden of ['create table if not exists buildings', 'create table if not exists floors', 'create table if not exists rooms']) {
    assert.equal(sql.toLowerCase().includes(forbidden), false, `${forbidden} would fix the depth`);
  }
});

test('every node belongs to a site, so two deployments cannot share a tree by accident', () => {
  assert.match(sql, /site_id\s+text\s+not null\s+references\s+sites\s*\(\s*id\s*\)/i);
});

test('deleting a site or a parent takes its subtree with it rather than orphaning nodes', () => {
  const stmt = sql.match(/create table if not exists space_nodes[\s\S]*?\n\);/i)[0];
  assert.match(stmt, /references\s+sites\s*\(\s*id\s*\)\s+on delete cascade/i);
  assert.match(stmt, /references\s+space_nodes\s*\(\s*id\s*\)\s+on delete cascade/i);
});

test('kind is constrained, because a typo would silently create a level nobody can query', () => {
  assert.match(sql, /kind\s+text\s+not null\s+check\s*\(\s*kind in \(/i);
  for (const k of ['building', 'floor', 'zone', 'room']) {
    assert.ok(sql.includes(`'${k}'`), `kind must permit '${k}'`);
  }
});

test('siblings cannot share a name, or the tree becomes ambiguous to a human reading it', () => {
  assert.match(sql, /create unique index if not exists space_nodes_sibling_name/i);
});

// ---------------------------------------------------------------------------
// The subtree RPC
// ---------------------------------------------------------------------------

test('subtree reads go through a recursive CTE, not a materialized path or ltree', () => {
  assert.match(sql, /with recursive/i);
  assert.equal(/\bltree\b/i.test(sql), false, 'no ltree until one is measured to be needed');
});

test('the RPC is security invoker, so RLS still decides who sees the tree', () => {
  // Same reasoning as readings_buckets: a security definer function would hand the tree to
  // anyone who can call it, bypassing the policies below.
  assert.match(sql, /security invoker/i);
  assert.equal(/security definer/i.test(sql), false);
});

test('EXECUTE is revoked from public before being granted, so anon never inherits it', () => {
  const revoke = sql.search(/revoke execute on function public\.space_subtree/i);
  const grant = sql.search(/grant\s+execute on function public\.space_subtree[\s\S]*?to authenticated/i);
  assert.ok(revoke >= 0, 'Postgres grants EXECUTE to PUBLIC by default — revoke it');
  assert.ok(grant >= 0, 'authenticated must be granted explicitly');
  assert.ok(revoke < grant, 'the revoke has to come first or the grant is undone');
});

test('the recursion is depth-limited, so a cycle cannot hang the database', () => {
  // parent_id is user-editable. Nothing in a self-referencing table prevents A->B->A, and an
  // unbounded recursive CTE against a cycle does not error, it runs forever.
  assert.match(sql, /depth\s*<\s*\d+/i);
});

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

test('device_config gains space_node_id, added idempotently', () => {
  assert.match(sql, /alter table device_config add column if not exists space_node_id uuid/i);
});

test('deleting a node clears the placement rather than deleting the device metadata', () => {
  // A device outliving the room it was in is normal — a room gets renamed or restructured and
  // the device stays put. Cascading here would silently discard someone's notes and shed tier.
  assert.match(sql, /space_node_id uuid references space_nodes\s*\(\s*id\s*\)\s+on delete set null/i);
});

test('room is kept, not dropped — it stays as the denormalised label', () => {
  assert.equal(/alter table device_config drop column\s+room/i.test(sql), false);
});

// ---------------------------------------------------------------------------
// RLS
// ---------------------------------------------------------------------------

test('RLS is enabled and no anon policy is granted', () => {
  assert.match(sql, /alter table space_nodes\s+enable row level security/i);
  assert.equal(/to anon\b/i.test(sql), false);
  assert.equal(/auth\.role\(\)\s*=\s*'anon'/i.test(sql), false);
});

test('authenticated may read and write the tree, matching device_config', () => {
  for (const verb of ['select', 'insert', 'update', 'delete']) {
    assert.match(
      sql,
      new RegExp(`create policy space_nodes_${verb}_authenticated on space_nodes`, 'i'),
      `missing ${verb} policy`,
    );
  }
});

test('nothing that holds data is dropped', () => {
  assert.equal(/drop\s+(table|column)/i.test(sql), false);
});

test('no statement is left unterminated, which a hand-applied file cannot recover from', () => {
  assert.equal(sql.trim().endsWith(';'), true);
});

/**
 * Added 2026-08-27 after the live anon probe caught what the rehearsal structurally cannot.
 *
 * `revoke ... from public` removes only the PUBLIC grant. Measured against the real project:
 * with just that, `anon` could still call `space_subtree` (HTTP 200), while `readings_buckets`
 * correctly answered 404. No data leaked — the function is `security invoker` and RLS returns
 * anon zero rows — but the file's own comment claimed a defence it was not providing, and a
 * false comment is worse than an absent one.
 *
 * A bare PostgreSQL has none of Supabase's default privileges, so `supabase/rehearse.sh` will
 * never reproduce this. Naming the role explicitly is correct whatever granted it.
 */
test('EXECUTE is revoked from anon by name, not only from public', () => {
  assert.match(
    sql,
    /revoke execute on function public\.space_subtree\(uuid\) from [^;]*\banon\b/i,
    'revoking from public alone does not remove a direct grant to anon',
  );
});
