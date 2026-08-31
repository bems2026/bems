import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteSeedSql } from '../scripts/site-sql.mjs';

const site = {
  id: 'mmsu-coe-lab',
  display_name: 'Some Other Building',
  timezone: 'Asia/Manila',
  utc_offset_minutes: 480,
  policy: { acu_min_setpoint_c: 25 },
};

test('the statement is built from the site, not from this building', () => {
  // The whole point: `phase19_sites.sql` seeds one id and a second deployment had to hand-edit a
  // migration to change it. Editing a migration that has already run somewhere is how two
  // databases stop agreeing about what has been applied.
  const sql = siteSeedSql(site);
  assert.match(sql, /'mmsu-coe-lab'/);
  assert.match(sql, /'Some Other Building'/);
  assert.match(sql, /480/);
  assert.doesNotMatch(sql, /mmsu-nberic-care/, 'no other site may appear in a site’s own seed');
});

test('re-running it is safe, because someone will', () => {
  // The migration-idempotency rule this repo already enforces on every phase file. An operator
  // who is unsure whether they ran it will run it again; that must not be a destructive act.
  const sql = siteSeedSql(site);
  assert.match(sql, /on conflict \(id\) do update/i);
});

test('a re-run updates the mutable fields but never invents a new id', () => {
  const sql = siteSeedSql(site);
  assert.match(sql, /display_name\s*=\s*excluded\.display_name/);
  assert.match(sql, /timezone\s*=\s*excluded\.timezone/);
  assert.match(sql, /utc_offset_minutes\s*=\s*excluded\.utc_offset_minutes/);
  assert.doesNotMatch(sql, /set[\s\S]*\bid\s*=\s*excluded\.id/, 'the conflict target must not reassign itself');
});

test('an apostrophe in a building name is escaped, not shipped raw', () => {
  // "St John's Annex" is an ordinary building name and an unescaped one ends the string literal
  // mid-statement. This output is meant to be pasted into a SQL console by someone who is not
  // reading it closely.
  const sql = siteSeedSql({ ...site, display_name: "St John's Annex" });
  assert.match(sql, /'St John''s Annex'/);
});

test('the policy is emitted as jsonb, with its quotes intact', () => {
  const sql = siteSeedSql(site);
  assert.match(sql, /'\{"acu_min_setpoint_c":25\}'::jsonb/);
});

test('an empty policy is an empty object, not null', () => {
  // `policy` is `not null default '{}'` — a null would be rejected, and a site with no rules yet
  // is a legitimate state that `site:new` scaffolds on purpose.
  const sql = siteSeedSql({ ...site, policy: undefined });
  assert.match(sql, /'\{\}'::jsonb/);
});

test('it refuses to generate anything for a site that is not describable', () => {
  // Emitting SQL with `undefined` interpolated would produce a statement that runs and writes
  // nonsense. Refusing is the only safe answer, and the message has to say which field.
  assert.throws(() => siteSeedSql({ ...site, id: '' }), /id/);
  assert.throws(() => siteSeedSql({ ...site, timezone: null }), /timezone/);
  assert.throws(() => siteSeedSql({ ...site, utc_offset_minutes: 'eight hours' }), /utc_offset_minutes/);
});

test('the slug is validated, because it is interpolated into a statement', () => {
  // Same rule `site-new.mjs` and `site-check.mjs` apply. An id is a directory name, a module
  // path and a primary key; here it is also SQL.
  assert.throws(() => siteSeedSql({ ...site, id: "x'; drop table sites; --" }), /id/);
  assert.throws(() => siteSeedSql({ ...site, id: 'Not A Slug' }), /id/);
});

test('the output carries no BEGIN or COMMIT it does not own', () => {
  // It is one statement meant to be pasted, possibly inside someone else's transaction. Opening
  // one here would either nest or fail depending on where it lands.
  const sql = siteSeedSql(site);
  assert.doesNotMatch(sql, /\bbegin\b/i);
  assert.doesNotMatch(sql, /\bcommit\b/i);
});
