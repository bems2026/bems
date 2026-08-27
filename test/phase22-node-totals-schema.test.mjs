/**
 * Guards supabase/phase22_node_totals.sql — RM-030.
 *
 * "How much did the lab use?" has never been answerable here: `readings` is per device,
 * `building_totals` is per building, and nothing sat between them because nothing knew what a
 * lab was. RM-028 gave rooms structure; this is what makes them add up.
 *
 * MOST OF THESE ASSERTIONS ARE ABOUT HONESTY, not arithmetic. This project's most expensive
 * failures have all been the same shape — a figure that looks plausible and is not observed —
 * and a per-node total is a fresh chance to make it. RM-024 and EX-107 established the rule:
 * a device with no evidence of reporting contributes nothing, and a scope with no observed
 * samples reports NULL rather than 0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase22_node_totals.sql'), 'utf8');
/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

test('the function is created idempotently', () => {
  assert.match(sql, /create or replace function public\.node_totals/i);
});

test('it walks the subtree rather than counting only the node clicked', () => {
  // A floor's total that ignored its rooms would be zero at every site that has floors, and
  // would look like a working feature. `space_subtree` already does this walk, depth-capped.
  assert.match(sql, /space_subtree\s*\(/i);
});

test('an offline sample is excluded, never averaged in', () => {
  // EX-107 / RM-024: a meter that stopped reporting keeps its last value in `readings`, so
  // including offline rows means charting a frozen figure as though it were observed.
  assert.match(sql, /where[\s\S]*online/i);
  assert.match(sql, /online\s*(=\s*true|is true)/i);
});

test('a scope with no observed samples reports NULL, not 0', () => {
  // The single most important line in the file. `sum()` over no rows is NULL in Postgres, but
  // `coalesce(..., 0)` anywhere here would turn "we saw nothing" into "it drew nothing" — the
  // exact lie the never-zero rule exists to prevent.
  assert.equal(
    /coalesce\s*\(\s*(sum|avg|max)\s*\([^)]*\)\s*,\s*0/i.test(sql),
    false,
    'coalescing an aggregate to 0 reports a reading nobody observed',
  );
});

test('the sample counts are returned, so a caller can judge coverage rather than trust a number', () => {
  // The Reports page already refuses to quote a bare total for a sparse month (EX-033). A node
  // total needs the same: the figure alone cannot distinguish a quiet room from an unplugged one.
  for (const col of ['sample_count', 'online_sample_count', 'device_count']) {
    assert.match(sql, new RegExp('\\b' + col + '\\b'), `missing ${col}`);
  }
});

test('it is security invoker, so RLS still decides which readings are visible', () => {
  assert.match(sql, /security invoker/i);
  assert.equal(/security definer/i.test(sql), false);
});

test('EXECUTE is revoked from public AND anon by name, then granted to authenticated', () => {
  // The phase21 lesson, applied on the first try this time: revoking from PUBLIC does not
  // remove a grant held directly by a role, and `supabase/rehearse.sh` cannot catch the
  // difference because a bare PostgreSQL has none of Supabase's default privileges.
  assert.match(sql, /revoke execute on function public\.node_totals[^;]*\bfrom\b[^;]*\bpublic\b/i);
  assert.match(sql, /revoke execute on function public\.node_totals[^;]*\banon\b/i);
  const revoke = sql.search(/revoke execute on function public\.node_totals/i);
  const grant = sql.search(/grant\s+execute on function public\.node_totals[\s\S]*?to authenticated/i);
  assert.ok(revoke >= 0 && grant >= 0);
  assert.ok(revoke < grant, 'granting before revoking undoes the grant');
});

test('nothing that holds data is dropped, and the rollups keep the shape they were built on', () => {
  // `building_totals` holds months of real rows and RM-009's rollups were built against its
  // shape. This is a NEW read path, not a migration of the old one.
  //
  // The check is deliberately about the PRIMARY KEY and about dropping data, not a blanket ban
  // on touching the table: this file legitimately drops phase20's transitional default from it,
  // which is a change to a default rather than to any row or to the rollups' assumptions.
  assert.equal(/drop\s+(table|column)/i.test(sql), false);
  assert.equal(/building_totals_pkey/i.test(sql), false, 'widening the PK belongs to a phase that tests it');
  assert.equal(/roll_up_and_prune/i.test(sql), false, 'the rollup functions are untouched');
  assert.equal(/\bdelete\s+from\b/i.test(sql), false);
});

test('the transitional site_id defaults are dropped, now that every writer is explicit', () => {
  // phase20 added them so the migration could land on a running system whose code did not yet
  // send a site_id. RM-027's Task 6 made every writer explicit and `1018bc5` shipped it, so the
  // net is no longer holding anything up — and in a shared project a default would silently
  // mis-stamp rows from a Pi that forgot to send one, which is worse than what it prevented.
  for (const t of ['dsm_thresholds', 'ingestion_health', 'building_totals']) {
    assert.match(
      sql,
      new RegExp(`alter table\\s+${t}\\s+alter column site_id drop default`, 'i'),
      `${t}: phase20 said RM-030 would drop this`,
    );
  }
});

test('no statement is left unterminated, which a hand-applied file cannot recover from', () => {
  assert.equal(sql.trim().endsWith(';'), true);
});
