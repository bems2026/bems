/**
 * Guards supabase/phase55_request_budget_edge.sql — RM-159.
 *
 * WHY THIS FILE EXISTS. `ingest_upload` replaces three or four PostgREST upserts per upload with one
 * request. It must write exactly what those upserts wrote: the same columns, on the same keys, and the
 * health row's merge semantics (a field the payload leaves out keeps its value). A column the edge
 * sends that the function forgets would be silently dropped from the cloud's copy; one the function
 * names that the edge does not send would be nulled on every conflict.
 *
 * File-text tests. `supabase/rehearse.sh` runs the file on a real Postgres, twice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STREAMS } from '../server/archiveDb.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PATH = join(ROOT, 'supabase', 'phase55_request_budget_edge.sql');
const file = existsSync(PATH) ? readFileSync(PATH, 'utf8').replace(/\r\n/g, '\n') : '';
const sql = file.replace(/--[^\n]*/g, '');

const words = (list) => list.split(',').map((s) => s.trim()).filter(Boolean);

/** The `insert into <table> (<cols>)` column list, and the `on conflict (<key>) do update set` targets. */
function upsertOf(table) {
  const m = sql.match(new RegExp(`insert into ${table} \\(([^)]*)\\)[\\s\\S]*?on conflict \\(([^)]*)\\) do update set([\\s\\S]*?);`));
  assert.ok(m, `no upsert into ${table}`);
  const updated = [...m[3].matchAll(/(\w+)\s*=\s*excluded\.(\w+)/g)].map((x) => {
    assert.equal(x[1], x[2], `${table}.${x[1]} is set from another column`);
    return x[1];
  });
  return { columns: words(m[1]), key: words(m[2]), updated };
}

test('phase55 exists', () => {
  assert.ok(file.length > 0, 'supabase/phase55_request_budget_edge.sql is missing');
});

for (const [table, { onConflict, columns }] of Object.entries(STREAMS)) {
  test(`${table}: the edge's columns, on the edge's key, and every other column updated on conflict`, () => {
    const u = upsertOf(table);
    assert.deepEqual([...u.columns].sort(), Object.keys(columns).sort(), 'exactly the columns the edge sends');
    assert.deepEqual(u.key, words(onConflict), 'the key the uploader names');
    assert.deepEqual([...u.updated].sort(), Object.keys(columns).filter((c) => !u.key.includes(c)).sort(),
      'merge-duplicates updates every column the payload carries');
  });
}

test('the health row keeps what the payload leaves out, as merge-duplicates did', () => {
  for (const col of ['last_success_at', 'scrub_rejected_count', 'scrub_last_reason', 'scrub_last_at']) {
    assert.match(sql, new RegExp(`${col}\\s*= case when p_health \\? '${col}' then excluded\\.${col} else ingestion_health\\.${col} end`), col);
  }
  assert.match(sql, /on conflict \(id\) do update set/);
});

test('the service role\'s alone', () => {
  for (const fn of ['ingest_upload(jsonb, jsonb, jsonb, jsonb)', 'usage_by_table(int)']) {
    const esc = fn.replace(/[()]/g, '\\$&');
    assert.match(sql, new RegExp(`revoke all on function public\\.${esc} from public, anon, authenticated;`), fn);
    assert.match(sql, new RegExp(`grant execute on function public\\.${esc} to service_role;`), fn);
  }
  assert.doesNotMatch(sql, /security definer/i, 'invoker: the service role already bypasses row security');
});

test('nothing the SQL editor stops to ask about, and the API sees the functions', () => {
  assert.doesNotMatch(sql, /create\s+(temporary\s+|temp\s+)?table/i);
  assert.doesNotMatch(sql, /\bdrop\s+/i);
  assert.doesNotMatch(sql, /create policy|create trigger|alter table/i);
  assert.match(sql, /notify pgrst, 'reload schema';\s*$/);
});
