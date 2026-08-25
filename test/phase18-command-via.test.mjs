/**
 * Guards supabase/phase18_command_via.sql.
 *
 * The value of this column is that it is queryable — "which devices needed the cloud fallback
 * this week" is the question that spots a device going bad before it goes dark, and it cannot
 * be asked of prose. So the assertions here are mostly about the vocabulary staying pinned to
 * the dispatch code that produces it: if `dispatchCommand` ever returns a fourth `via` value,
 * the constraint must be the thing that notices, not a row that silently fails to insert.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase18_command_via.sql'), 'utf8');
const dispatchSrc = readFileSync(join(ROOT, 'server', 'dispatchLight.mjs'), 'utf8');

/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

const EXPECTED = ['local', 'cloud', 'none'];

test('adds the column idempotently, so a re-run is not an error', () => {
  assert.match(sql, /alter table commands add column if not exists via text/i);
});

test('the CHECK accepts exactly the dispatch vocabulary, and NULL', () => {
  assert.match(sql, /via is null or via in \('local','cloud','none'\)/i);
});

test('the constraint is dropped before being added, so applying twice is safe', () => {
  const drop = sql.search(/drop constraint if exists commands_via_check/i);
  const add = sql.search(/add constraint\s+commands_via_check/i);
  assert.ok(drop >= 0 && add >= 0, 'both halves must be present');
  assert.ok(drop < add, 'the drop has to come first or the second apply fails');
});

test('every value the dispatcher can return is permitted by the constraint', () => {
  // The real coupling: `dispatchCommand` returns these literals, and a value it can produce
  // but the table rejects would fail the audit UPDATE — losing the outcome of a command that
  // already moved a relay. Read from the source rather than restated, so drift shows up here.
  const produced = [...dispatchSrc.matchAll(/via:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert.ok(produced.length >= 3, 'expected to find the via literals in dispatchLight.mjs');
  for (const v of new Set(produced)) {
    assert.ok(sql.includes(`'${v}'`), `dispatchLight can return via='${v}', which the CHECK rejects`);
  }
});

test('the vocabulary is exactly the closed set, with nothing extra', () => {
  const inCheck = /via in \(([^)]+)\)/i
    .exec(sql)[1]
    .split(',')
    .map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(inCheck, EXPECTED);
});

test('does not backfill — a row written before this migration does not know its path', () => {
  // Inventing a value for historical rows would be worse than admitting ignorance: NULL reads
  // as "not recorded", which is honestly different from 'none', a positive claim that both
  // paths were tried and both failed.
  assert.equal(/update commands set via/i.test(sql), false);
});

test('the column is nullable, because dry runs attempt no path at all', () => {
  assert.equal(/via text not null/i.test(sql), false);
});
