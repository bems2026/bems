#!/usr/bin/env node
/**
 * Supabase data export — architecture plan Phase 13, ROADMAP RM-006d.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT:
 * this exports the ROWS of the tables that cannot be reconstructed. It is not a `pg_dump`
 * and does not pretend to be one: it captures no schema, no RLS policies, no functions, and
 * no `auth.users`. That is a deliberate division of labour, not an oversight — the schema,
 * the policies and the functions are already under version control in `supabase/*.sql`, which
 * is a better home for them than a nightly tarball. Data is the half that exists nowhere
 * else, so data is what this covers.
 *
 * A restore is therefore two steps: apply `supabase/*.sql` in order against a fresh project,
 * then load these files back. `docs/backup-policy.md` has the procedure, and states plainly
 * which parts of a restore this does NOT give you.
 *
 * WHY POSTGREST RATHER THAN pg_dump:
 * the Pi has no Postgres client installed and no direct database connection — it reaches
 * Supabase over HTTPS with a service-role key, which is exactly what this daemon fleet
 * already does. Adding a `postgresql-client` dependency and a second credential path to run
 * one command would be a larger change than the export itself.
 *
 * WHAT IS DELIBERATELY NOT EXPORTED:
 * `readings` and `building_totals` — the raw, high-volume tables that retention prunes at 30
 * days anyway. Their permanent form is `readings_hourly` / `building_totals_hourly`, which
 * ARE exported. Backing up rows that the system itself deletes on a schedule would be
 * storing something nobody has decided to keep.
 *
 *     SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node server/backup.mjs --out=/path/to/dir
 *
 * See `server/.env.example`. Safe to run at any time: it only reads.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * The tables worth keeping, and the column each is ordered by so a re-export is stable and
 * two backups can be diffed. Ordered smallest blast-radius first is irrelevant here; this is
 * simply the order they are written.
 *
 * `commands` is on this list and near the top of it on purpose: it is the audit trail for
 * every attempt to move a relay, nothing prunes it (supabase/phase11_totals_retention.sql),
 * and losing it loses accountability for physical actions taken in a building.
 */
export const BACKUP_TABLES = [
  { table: 'devices', order: 'id' },
  { table: 'device_config', order: 'device_id' },
  { table: 'schedules', order: 'id' },
  { table: 'dsm_thresholds', order: 'id' },
  { table: 'commands', order: 'requested_at' },
  { table: 'anomalies', order: 'ts' },
  { table: 'readings_hourly', order: 'hour' },
  { table: 'building_totals_hourly', order: 'hour' },
  { table: 'monthly_reports', order: 'month' },
  { table: 'monthly_building_reports', order: 'month' },
];

/** PostgREST caps every response at `db-max-rows` and gives no signal that it did — the bug
 * Phase 9 was built around. Pagination here is explicit for that reason: each page is
 * requested by range and the loop stops only when a short page proves the end was reached. */
export const PAGE_SIZE = 1000;

/**
 * Pure. The `Range` header pair for page `n`.
 * Exported for its own test: an off-by-one here silently drops or duplicates a row per page,
 * which would be invisible until a restore.
 */
export function pageRange(page, pageSize = PAGE_SIZE) {
  const from = page * pageSize;
  return { from, to: from + pageSize - 1 };
}

/**
 * Pure. Was that the last page?
 *
 * A page SHORTER than the requested size proves the end. A FULL page proves nothing — it is
 * exactly what a silent cap also looks like — so a full page always means "ask again".
 */
export function isLastPage(rowsInPage, pageSize = PAGE_SIZE) {
  return rowsInPage < pageSize;
}

/** Fetches one table in full, page by page. */
export async function fetchAll({ fetchPage, table, order, pageSize = PAGE_SIZE }) {
  const rows = [];
  for (let page = 0; ; page++) {
    const { from, to } = pageRange(page, pageSize);
    const batch = await fetchPage({ table, order, from, to });
    rows.push(...batch);
    if (isLastPage(batch.length, pageSize)) return rows;
  }
}

function makePageFetcher({ url, serviceRoleKey, timeoutMs = 30_000 }) {
  const base = url.replace(/\/+$/, '');
  return async ({ table, order, from, to }) => {
    const endpoint = `${base}/rest/v1/${table}?select=*&order=${encodeURIComponent(order)}.asc`;
    const res = await fetch(endpoint, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Range: `${from}-${to}`,
        'Range-Unit': 'items',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GET ${table} -> ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[ibems-backup] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required — see server/.env.example');
    process.exit(1);
  }

  const outArg = process.argv.find((a) => a.startsWith('--out='));
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.resolve(outArg ? outArg.slice('--out='.length) : path.join(process.cwd(), `ibems-backup-${stamp}`));
  fs.mkdirSync(outDir, { recursive: true });

  const fetchPage = makePageFetcher({ url, serviceRoleKey: key });
  const manifest = { exported_at: new Date().toISOString(), tables: {} };
  let failed = 0;

  for (const { table, order } of BACKUP_TABLES) {
    try {
      const rows = await fetchAll({ fetchPage, table, order });
      // NDJSON: one row per line, so a truncated file loses one row rather than becoming
      // unparseable, and a diff between two backups reads per-row. Same format and same
      // reasoning as server/ingestBuffer.mjs.
      fs.writeFileSync(path.join(outDir, `${table}.ndjson`), rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
      manifest.tables[table] = rows.length;
      console.log(`[ibems-backup] ${table}: ${rows.length} row(s)`);
    } catch (err) {
      // Keep going: one unreadable table should not cost the other nine. The manifest
      // records the failure so a backup that is missing something says so rather than
      // looking complete.
      failed++;
      manifest.tables[table] = { error: String(err) };
      console.error(`[ibems-backup] ${table} FAILED: ${String(err)}`);
    }
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[ibems-backup] wrote ${outDir}`);
  if (failed > 0) {
    console.error(`[ibems-backup] ${failed} table(s) failed — this backup is INCOMPLETE. See manifest.json.`);
    process.exit(1);
  }
}

// Only run when invoked directly, so the pure helpers above can be imported by tests.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('backup.mjs')) {
  main();
}
