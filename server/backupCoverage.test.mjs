/**
 * What server/backup.mjs exports, asked of the migrations rather than of a hand-kept list.
 *
 * `backup.test.mjs` tests the paging. This tests the two things a list cannot keep true by
 * itself, and both were measured false on 2026-09-13:
 *
 *   - COVERAGE. The export still named phase12's monthly tables a fortnight after the Reports
 *     page moved to phase27's period tables, and it had never named `energy_tariffs` or
 *     `emission_factors` — the only copy of an operator-entered rate and the source it cites —
 *     nor `sites`, `acu_rules`, `space_nodes`, `socket_config` or `site_ui_prefs`.
 *   - PAGE SAFETY. Several tables were paged by a column that is not unique, which is exactly the
 *     case Postgres documents as returning tied rows in no promised order between two queries.
 *
 * Both rules read `supabase/schema.sql` and every `phase*.sql`, so a table added next year is
 * covered without anyone remembering this file exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKUP_TABLES, NOT_BACKED_UP } from './backup.mjs';

const SUPABASE = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');

/** schema.sql, then every phase file in numeric order, with comments stripped. */
function migrationsSql() {
  const phase = (f) => Number(f.match(/^phase(\d+)/)[1]);
  const files = readdirSync(SUPABASE)
    .filter((f) => /^phase\d+.*\.sql$/.test(f))
    .sort((a, b) => phase(a) - phase(b));
  return ['schema.sql', ...files]
    .map((f) => readFileSync(join(SUPABASE, f), 'utf8').replace(/--[^\n]*/g, ''))
    .join('\n');
}

/** Every table the migrations leave standing: its primary key, and the tables it references. */
function schemaTables() {
  const sql = migrationsSql();
  const tables = new Map();

  for (const [, name, body] of sql.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/gi)) {
    const constraint = body.match(/primary key\s*\(([^)]*)\)/i);
    const inline = body.match(/^\s*([a-z_][a-z0-9_]*)\s[^,\n]*\bprimary key\b/im);
    const pk = constraint ? constraint[1].split(',').map((c) => c.trim()) : inline ? [inline[1]] : [];
    const refs = new Set([...body.matchAll(/references\s+(?:public\.)?([a-z_][a-z0-9_.]*)/gi)].map((r) => r[1]));
    tables.set(name, { pk, refs });
  }

  // A foreign key added later by `alter table` restricts a restore exactly as much as one
  // declared up front.
  for (const [, name, rest] of sql.matchAll(/alter table (?:if exists )?(?:only )?(?:public\.)?([a-z_][a-z0-9_]*)([^;]*);/gi)) {
    for (const r of rest.matchAll(/references\s+(?:public\.)?([a-z_][a-z0-9_.]*)/gi)) tables.get(name)?.refs.add(r[1]);
  }

  for (const [, name] of sql.matchAll(/drop table (?:if exists )?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) tables.delete(name);
  return tables;
}

test('the migrations parse into the schema these rules reason about', () => {
  // A parser that found nothing would let every rule below pass vacuously, so it is pinned to
  // facts read off the SQL by hand.
  const t = schemaTables();
  assert.ok(t.size >= 23, `expected at least 23 tables, parsed ${t.size}: ${[...t.keys()].join(', ')}`);
  assert.deepEqual(t.get('readings_hourly')?.pk, ['device_id', 'hour']);
  assert.deepEqual(t.get('anomalies')?.pk, ['device_id', 'ts', 'metric']);
  assert.deepEqual(t.get('period_reports')?.pk, ['period', 'period_start', 'device_id']);
  assert.deepEqual(t.get('commands')?.pk, ['id']);
  assert.deepEqual(t.get('building_totals_hourly')?.pk, ['hour']);
  assert.deepEqual(t.get('site_ui_prefs')?.pk, ['site_id']);
  assert.ok(t.get('energy_tariffs')?.refs.has('sites'));
  assert.ok(t.get('space_nodes')?.refs.has('space_nodes'));
});

test('every table the migrations create is either backed up or excluded with a reason', () => {
  const backedUp = new Set(BACKUP_TABLES.map((b) => b.table));
  for (const name of schemaTables().keys()) {
    const excluded = Object.hasOwn(NOT_BACKED_UP, name);
    assert.ok(backedUp.has(name) || excluded, `${name} is neither backed up nor excluded — decide which, and say why`);
    assert.ok(!(backedUp.has(name) && excluded), `${name} is both backed up and excluded`);
  }
  for (const [name, reason] of Object.entries(NOT_BACKED_UP)) {
    assert.ok(typeof reason === 'string' && reason.length > 40, `${name} needs a reason, not a label`);
  }
});

test('nothing is listed that the migrations no longer create', () => {
  // The other direction. When RM-042 drops phase12's tables, a backup still asking for them
  // fails on every run — so the list has to follow the schema down as well as up.
  const tables = schemaTables();
  for (const name of [...BACKUP_TABLES.map((b) => b.table), ...Object.keys(NOT_BACKED_UP)]) {
    assert.ok(tables.has(name), `${name} is listed, but no migration leaves it standing`);
  }
});

test('every table is paged by a key covering its primary key, so a page boundary cannot duplicate or drop a row', () => {
  // Pages are requested by Range over `order=`. When that column is not unique, Postgres promises
  // nothing about the order of tied rows from one query to the next — its own LIMIT documentation
  // says so — so a row can land on both sides of a page boundary, or on neither, and the backup
  // still counts itself complete. `readings_hourly` ordered by `hour` alone ties every device at
  // every hour.
  const tables = schemaTables();
  for (const { table, order } of BACKUP_TABLES) {
    const cols = new Set(order.split(',').map((c) => c.trim()));
    const pk = tables.get(table)?.pk ?? [];
    assert.ok(pk.length > 0, `${table}: no primary key parsed`);
    for (const c of pk) {
      assert.ok(cols.has(c), `${table} is paged by "${order}", which omits primary-key column "${c}"`);
    }
  }
});

test('a table is exported after every table it references, so a restore can load the files in list order', () => {
  // docs/backup-policy.md loads the files in the order this list gives. A row whose foreign key
  // points at a table not loaded yet is refused — and one pointing at a table never exported
  // cannot be restored at all.
  const tables = schemaTables();
  const position = new Map(BACKUP_TABLES.map((b, i) => [b.table, i]));
  for (const { table } of BACKUP_TABLES) {
    for (const ref of tables.get(table)?.refs ?? []) {
      if (ref === table || ref.startsWith('auth.')) continue; // parents-first within a table is the restore's job
      assert.ok(position.has(ref), `${table} references ${ref}, which is not exported`);
      assert.ok(position.get(ref) < position.get(table), `${table} references ${ref}, which is exported after it`);
    }
  }
});
