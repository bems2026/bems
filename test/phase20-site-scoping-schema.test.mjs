/**
 * Guards supabase/phase20_site_scoping.sql.
 *
 * This is the first migration in this project to DROP a constraint, and it runs against tables
 * holding months of real data. So the assertions here are about ORDER as much as content: a
 * backfill that runs after `set not null` fails on the rows already there, and that failure
 * arrives halfway through a hand-applied file, with some statements committed and some not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SITE } from '../shared/siteConfig.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase20_site_scoping.sql'), 'utf8');
const sql = raw.replace(/^\s*--.*$/gm, '');

/** The three tables that carried no site dimension at all. */
const SCOPED = ['dsm_thresholds', 'ingestion_health', 'building_totals'];
/** The two that were additionally pinned to a single row. */
const SINGLETONS = ['dsm_thresholds', 'ingestion_health'];

for (const t of SCOPED) {
  test(`${t} gains site_id, added idempotently`, () => {
    assert.match(sql, new RegExp(`alter table ${t} add column if not exists site_id text`, 'i'));
  });

  test(`${t}.site_id references sites, so a typo cannot orphan a row`, () => {
    const stmt = sql.match(new RegExp(`alter table ${t}[^;]*site_id[^;]*;`, 'i'));
    assert.ok(stmt, `no add-column statement found for ${t}`);
    assert.match(stmt[0], /references sites\s*\(\s*id\s*\)/i);
  });

  test(`${t} is backfilled BEFORE not-null is imposed, or it fails on existing rows`, () => {
    const backfill = sql.search(new RegExp(`update ${t}\\s+set site_id`, 'i'));
    const notnull = sql.search(new RegExp(`alter table ${t} alter column site_id set not null`, 'i'));
    assert.ok(backfill >= 0, `${t} is never backfilled`);
    assert.ok(notnull >= 0, `${t}.site_id never becomes not-null`);
    assert.ok(backfill < notnull, `${t}: the backfill has to come first or the apply fails`);
  });

  test(`${t} is backfilled to the site this deployment actually is`, () => {
    assert.match(sql, new RegExp(`update ${t}\\s+set site_id\\s*=\\s*'${SITE.id}'`, 'i'));
  });
}

for (const t of SINGLETONS) {
  test(`${t}'s singleton constraint is dropped — the whole point of the migration`, () => {
    assert.match(sql, new RegExp(`alter table ${t}\\s+drop constraint if exists ${t}_singleton`, 'i'));
  });

  test(`${t} still allows only one settings row per site, just not one row overall`, () => {
    // Dropping the singleton without replacing it would let a second row for the SAME site
    // appear, and `.eq('site_id', …).maybeSingle()` would then start throwing.
    assert.match(sql, new RegExp(`add constraint ${t}_one_per_site\\s+unique\\s*\\(\\s*site_id\\s*\\)`, 'i'));
  });

  test(`${t}'s new unique constraint is dropped first, so re-applying is safe`, () => {
    const drop = sql.search(new RegExp(`drop constraint if exists ${t}_one_per_site`, 'i'));
    const add = sql.search(new RegExp(`add constraint ${t}_one_per_site`, 'i'));
    assert.ok(drop >= 0 && drop < add, `${t}: the drop must precede the add`);
  });
}

test('building_totals keeps its ts primary key — RM-009 rollups were built against that shape', () => {
  assert.equal(/alter table building_totals\s+drop constraint building_totals_pkey/i.test(sql), false);
});

test('building_totals gains an index on site_id, since every read will filter by it', () => {
  assert.match(sql, /create index if not exists building_totals_site_id/i);
});

test('nothing that holds data is dropped', () => {
  assert.equal(/drop\s+(table|column)/i.test(sql), false);
});

test('no statement is left unterminated, which a hand-applied file cannot recover from', () => {
  const statements = sql.split(';').map((x) => x.trim()).filter(Boolean);
  assert.ok(statements.length >= 12, `expected the full set of statements, saw ${statements.length}`);
  assert.equal(sql.trim().endsWith(';'), true, 'the file must end on a terminated statement');
});
