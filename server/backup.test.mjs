/**
 * Tests for server/backup.mjs — the Supabase data export (ROADMAP RM-006d).
 *
 * The pagination is what gets tested, because it is the part that can be wrong without
 * anyone noticing: an off-by-one drops or duplicates one row per page, and a backup only
 * reveals that on the day someone restores it.
 *
 * No mocking library, matching this repo's house style — the page fetcher is a plain
 * function the test supplies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageRange, isLastPage, fetchAll, BACKUP_TABLES, PAGE_SIZE } from './backup.mjs';

test('page ranges are contiguous and never overlap', () => {
  // PostgREST's Range header is INCLUSIVE at both ends, so page 0 is 0-999, not 0-1000.
  assert.deepEqual(pageRange(0, 1000), { from: 0, to: 999 });
  assert.deepEqual(pageRange(1, 1000), { from: 1000, to: 1999 });
  assert.deepEqual(pageRange(2, 1000), { from: 2000, to: 2999 });

  for (let p = 0; p < 5; p++) {
    assert.equal(pageRange(p + 1, 1000).from, pageRange(p, 1000).to + 1, `page ${p} must abut page ${p + 1}`);
  }
});

test('a full page is never treated as the last one', () => {
  // A full page is exactly what a silent db-max-rows cap also looks like — the Phase 9 bug.
  // Only a SHORT page proves the end of the data.
  assert.equal(isLastPage(1000, 1000), false);
  assert.equal(isLastPage(999, 1000), true);
  assert.equal(isLastPage(0, 1000), true);
});

test('fetchAll walks every page and returns the rows in order', async () => {
  const total = 2500;
  const all = Array.from({ length: total }, (_, i) => ({ i }));
  const asked = [];
  const rows = await fetchAll({
    table: 't',
    order: 'i',
    pageSize: 1000,
    fetchPage: async ({ from, to }) => {
      asked.push([from, to]);
      return all.slice(from, to + 1);
    },
  });

  assert.equal(rows.length, total, 'every row should survive the walk');
  assert.deepEqual(rows[0], { i: 0 });
  assert.deepEqual(rows[total - 1], { i: total - 1 });
  assert.deepEqual(asked, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('fetchAll stops after one request when the table is small', async () => {
  let calls = 0;
  const rows = await fetchAll({
    table: 't',
    order: 'i',
    pageSize: 1000,
    fetchPage: async () => {
      calls++;
      return [{ i: 1 }, { i: 2 }];
    },
  });
  assert.equal(calls, 1);
  assert.equal(rows.length, 2);
});

test('fetchAll asks a second time for an exactly-full table, then stops', async () => {
  // The boundary case: exactly PAGE_SIZE rows. One request looks full, so a second must
  // confirm the end — and it comes back empty.
  const pages = [Array.from({ length: 1000 }, (_, i) => ({ i })), []];
  let calls = 0;
  const rows = await fetchAll({ table: 't', order: 'i', pageSize: 1000, fetchPage: async () => pages[calls++] });
  assert.equal(calls, 2);
  assert.equal(rows.length, 1000);
});

test('a failing page propagates rather than returning a short, plausible backup', async () => {
  await assert.rejects(
    fetchAll({ table: 't', order: 'i', pageSize: 1000, fetchPage: async () => { throw new Error('403'); } }),
    /403/
  );
});

// --- what is and is not backed up --------------------------------------------------------

test('the audit trail is backed up — nothing prunes it and it cannot be recomputed', () => {
  assert.ok(BACKUP_TABLES.some((t) => t.table === 'commands'));
});

test('every permanent derived table is backed up, not just the hand-edited ones', () => {
  for (const required of ['readings_hourly', 'building_totals_hourly', 'monthly_reports', 'monthly_building_reports', 'period_reports', 'period_building_reports', 'energy_tariffs', 'emission_factors', 'device_config', 'schedules']) {
    assert.ok(BACKUP_TABLES.some((t) => t.table === required), `${required} should be backed up`);
  }
});

test('the pruned raw tables are deliberately NOT backed up', () => {
  // Their permanent form is the hourly rollup, which IS exported. Backing up rows the system
  // itself deletes on a 30-day schedule would be storing something nobody decided to keep.
  for (const excluded of ['readings', 'building_totals']) {
    assert.equal(BACKUP_TABLES.some((t) => t.table === excluded), false, `${excluded} should not be backed up`);
  }
});

test('every backup target names the column it is ordered by, so re-exports are diffable', () => {
  for (const t of BACKUP_TABLES) {
    assert.ok(typeof t.order === 'string' && t.order.length > 0, `${t.table} needs a stable order column`);
  }
  assert.equal(PAGE_SIZE, 1000);
});

/**
 * The restore rehearsal (`npm run restore:rehearse`, supabase/restore-rehearse.sh) is what turned
 * RM-006d's export from a belief into a backup on 2026-09-22. It needs docker, so it is not run
 * here; what can be held from here is that it restores in THIS module's order rather than a copy
 * of it — a table added to BACKUP_TABLES is then rehearsed without anyone remembering to add it
 * twice — and that every table it loads is checked against the manifest and read back whole.
 */
test('the restore rehearsal takes its table order from BACKUP_TABLES and checks every table it loads', async () => {
  const { readFileSync } = await import('node:fs');
  const script = readFileSync(new URL('../supabase/restore-rehearse.sh', import.meta.url), 'utf8');
  assert.match(script, /BACKUP_TABLES\.map\(\(t\) => t\.table\)/, 'the order comes from the module');
  for (const t of BACKUP_TABLES) {
    assert.doesNotMatch(script, new RegExp(`^\\s*(for|TABLES=).*\\b${t.table}\\b`, 'm'), `${t.table} must not be listed by hand`);
  }
  assert.match(script, /manifest\.json/, 'counts are checked against the manifest');
  assert.match(script, /to_jsonb\(t\) = i\.doc/, 'every row is read back and compared to what was exported');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['restore:rehearse'], 'bash supabase/restore-rehearse.sh');
});
