/**
 * Guards supabase/phase39_privilege_lockdown.sql — RM-074.
 *
 * The real guard is in `supabase/rehearse.sh`, which asserts the invariant against a live
 * `information_schema` and names every drifted table when it fails. This file guards the things
 * a text read can see and a fresh database cannot: that the file revokes before it grants, that
 * it leaves `service_role` alone, and that the two tables whose privileges are a deliberate
 * judgement rather than a transcription keep that judgement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase39_privilege_lockdown.sql'), 'utf8');
const sql = raw.replace(/--[^\n]*/g, '');

/** Every table the file touches, taken from the file itself rather than from a second list. */
const tables = [...new Set([...sql.matchAll(/revoke all on (\w+)/g)].map((m) => m[1]))];

test('it touches every table in the schema', () => {
  // 23 tables were surveyed; phase38's two were already correct and are restated so this file
  // is the whole picture rather than a diff against something a reader has to reconstruct.
  assert.ok(tables.length >= 23, `expected at least 23 tables, found ${tables.length}`);
});

test('every table is revoked before it is granted', () => {
  // A grant is additive. Supabase's default privileges already hand ALL on every new public
  // table to anon, authenticated and service_role, so a file that only granted would change
  // nothing at all — which is exactly how this went unnoticed since phase4.
  for (const t of tables) {
    const revokeAt = sql.indexOf(`revoke all on ${t} `);
    const grantAt = sql.search(new RegExp(`grant [^;]*on ${t}\\s`));
    assert.notEqual(revokeAt, -1, `${t} is never revoked`);
    if (grantAt !== -1) {
      assert.ok(revokeAt < grantAt, `${t} is granted before it is revoked, so the revoke undoes the grant`);
    }
  }
});

test('every revoke names authenticated, anon and public', () => {
  for (const t of tables) {
    assert.match(sql, new RegExp(`revoke all on ${t}\\s+from public, anon, authenticated`), `${t}`);
  }
});

test('the audit trail cannot be deleted or truncated by a signed-in account', () => {
  // `commands` is exempt from every retention pass on purpose. The whole value of an audit
  // trail is that the thing being audited cannot remove it — and TRUNCATE is not filtered by
  // row security, so the grant is the only thing standing between a session and an empty table.
  const line = grantFor('commands');
  assert.match(line, /select, insert, update/);
  assert.equal(/delete/.test(line), false, 'commands must not grant DELETE');
});

test('the aircon rules stay write-only through their SECURITY DEFINER functions', () => {
  // phase36's `upsert_acu_rule` and `set_acu_rule_enabled` are definer precisely so a rule
  // cannot be written around their validation. An INSERT or UPDATE grant here reopens that door.
  const line = grantFor('acu_rules');
  assert.match(line, /select, delete/);
  assert.equal(/insert|update/.test(line), false, 'acu_rules must not grant INSERT or UPDATE');
});

test('service_role is left alone', () => {
  // It bypasses RLS by design, the daemons run as it, and narrowing it is a different question
  // with a different blast radius. Touching it here would be scope this file has not measured.
  assert.equal(/service_role/.test(sql), false);
});

test('no table gets a privilege back for anon or public', () => {
  assert.equal(/grant[^;]*\bto\b[^;]*\b(anon|public)\b/i.test(sql), false);
});

test('it adds no table, policy or function — it only changes who may do what', () => {
  assert.equal(/create (table|policy|function)/i.test(sql), false);
  assert.equal(/drop (table|policy|function)/i.test(sql), false);
});

/** The grant statement for one table, or '' when it is revoked without being granted back. */
function grantFor(table) {
  const m = sql.match(new RegExp(`grant ([^;]*) on ${table}\\s+to authenticated`));
  return m ? m[1] : '';
}
