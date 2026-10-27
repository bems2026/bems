/**
 * phase56 — notes on the Reports page (RM-164): one per day, one per report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase56_report_notes.sql'), 'utf8');
/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

test('creates the table idempotently, keyed by what the note is about', () => {
  assert.match(sql, /create table if not exists report_notes/i);
  assert.match(sql, /primary key \(site_id, kind, start\)/i);
  assert.match(sql, /check \(kind in \('day', 'week', 'month', 'year'\)\)/i);
  assert.match(sql, /check \(char_length\(note\) <= 2000\)/i);
});

test('signed-in users read and write; nobody deletes, and anon gets nothing', () => {
  assert.match(sql, /alter table report_notes enable row level security/i);
  for (const verb of ['select', 'insert', 'update']) {
    assert.match(sql, new RegExp(`create policy report_notes_${verb}_authenticated on report_notes\\s+for ${verb}`, 'i'));
  }
  assert.doesNotMatch(sql, /for delete/i);
  assert.match(sql, /revoke all on report_notes from public, anon, authenticated;\s*grant select, insert, update on report_notes to authenticated;/i);
});

test('every policy is dropped before it is created, so a re-run is not an error', () => {
  for (const m of sql.matchAll(/create policy (\w+)/gi)) {
    assert.match(sql, new RegExp(`drop policy if exists ${m[1]} on report_notes`, 'i'));
  }
});
