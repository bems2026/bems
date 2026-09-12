/**
 * Guards supabase/phase38_tariff_emissions.sql — what a kilowatt-hour costs and emits.
 *
 * The assertions are about what a FIGURE IN A DOCUMENT has to be able to survive. A cost is the
 * most quotable number a report carries: it is the one repeated in a meeting without the caveats
 * attached, and the one a funder checks. So the schema itself refuses a rate with no source,
 * refuses a rate that could be back-applied silently, and refuses to let a historical claim be
 * edited out from under a report that was priced by it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase38_tariff_emissions.sql'), 'utf8');

/** Negative assertions run against statements only — a comment must not satisfy them. */
const sql = raw.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

const TABLES = ['energy_tariffs', 'emission_factors'];

test('a figure cannot be stored without saying where it came from', () => {
  // The reason this is a table rather than a number in a config file. An unattributable cost is
  // exactly what a reviewer cannot check, so an empty source is a constraint violation.
  for (const t of TABLES) {
    const body = tableBody(t);
    assert.match(body, /source\s+text not null check \(btrim\(source\) <> ''\)/i, `${t} must require a non-empty source`);
  }
});

test('rates and factors are dated, so a past report keeps the price it was priced at', () => {
  // A single current rate would price August 2026 at whatever the rate is on the afternoon
  // somebody opens the report — an error that is invisible and grows.
  // `\s+` rather than a single space throughout this file: the two tables align their column
  // types to different widths, and a regex that assumed one space passed on the first table and
  // failed on the second — which reads as a missing column and is a missing quantifier.
  for (const t of TABLES) {
    assert.match(tableBody(t), /effective_from\s+date not null/i);
    assert.match(tableBody(t), /unique \(site_id, effective_from\)/i, `${t} must hold one rate per start date`);
  }
});

test('a rate is bounded, so a misplaced decimal is refused rather than reported', () => {
  assert.match(tableBody('energy_tariffs'), /rate_per_kwh\s+numeric not null check \(rate_per_kwh > 0 and rate_per_kwh <= 1000\)/i);
  // No grid on earth reaches ~1.1 kgCO2e/kWh, so 2.0 catches a typo without second-guessing a
  // published figure for a genuinely dirty grid.
  assert.match(tableBody('emission_factors'), /kg_co2e_per_kwh\s+numeric not null check \(kg_co2e_per_kwh > 0 and kg_co2e_per_kwh <= 2\.0\)/i);
});

test('the currency is stored, never assumed', () => {
  // A default of 'PHP' is exactly the assumption RM-033 spent a track removing from this
  // codebase — the replication framework exists to stand this up for another institution.
  assert.match(tableBody('energy_tariffs'), /currency\s+text not null check \(char_length\(currency\) = 3\)/i);
  assert.equal(/currency[^,]*default/i.test(tableBody('energy_tariffs')), false, 'the currency must not be defaulted');
});

test('who set it is stamped by the database, not supplied by the client', () => {
  for (const t of TABLES) {
    assert.match(tableBody(t), /set_by\s+uuid references auth\.users\(id\) default auth\.uid\(\)/i);
    assert.match(tableBody(t), /set_at\s+timestamptz not null default now\(\)/i);
    // The email is a client-written SNAPSHOT beside the authoritative id — provenance is who it
    // was at the time, not a live join that rewrites an old report's footnote later.
    assert.match(tableBody(t), /set_by_email\s+text/i);
  }
});

test('there is no UPDATE path, because a rate is a historical claim', () => {
  // Editing one in place rewrites what a past report was priced at with nothing to show it
  // happened. Correcting a mistake is a delete and a re-insert, which leaves both acts attributed.
  for (const t of TABLES) {
    assert.equal(
      new RegExp(`for update`, 'i').test(policiesFor(t)),
      false,
      `${t} must have no update policy`
    );
    assert.match(sql, new RegExp(`grant select, insert, delete on ${t}\\s+to authenticated`, 'i'));
    assert.equal(new RegExp(`grant[^;]*update[^;]*on ${t}`, 'i').test(sql), false);
  }
});

test('RLS is on and anon is named in the revoke', () => {
  // Revoking from PUBLIC does not remove a privilege Supabase granted `anon` directly — phase5
  // learned that once already, and the comment there says it never comes back.
  for (const t of TABLES) {
    assert.match(sql, new RegExp(`alter table ${t}\\s+enable row level security`, 'i'));
    // `authenticated` MUST be named in the revoke, not just `public, anon`. A grant is additive,
    // and Supabase's default privileges already hand ALL on a new public table to all three
    // roles — so granting select/insert/delete adds nothing and leaves the UPDATE and the
    // TRUNCATE this file's header says are unavailable. The first version of this assertion
    // matched `from public, anon` as a prefix and passed while exactly that was true.
    assert.match(sql, new RegExp(`revoke all on ${t}\\s+from public, anon, authenticated`, 'i'));
  }
  assert.equal(/grant[^;]*\bto\b[^;]*\banon\b/i.test(sql), false);
});

test('every policy is dropped before it is created, so the file is safe to paste twice', () => {
  // Migrations here are applied by hand into a SQL editor, and the reason to paste one twice is
  // usually that it changed. RM-072h is the same lesson for functions.
  const created = [...sql.matchAll(/create policy (\w+)/gi)].map((m) => m[1]);
  assert.ok(created.length >= 6);
  for (const name of created) {
    assert.match(sql, new RegExp(`drop policy if exists ${name}`, 'i'), `${name} is created without a preceding drop`);
  }
  assert.match(sql, /create table if not exists energy_tariffs/i);
  assert.match(sql, /create table if not exists emission_factors/i);
});

test('phase38 adds no function, so there is nothing to run as an owner', () => {
  // Two plain tables with row-level policies. `sites` needed a security-definer door because its
  // row also decides whether commands may leave the building; these have no such collision.
  assert.equal(/create (or replace )?function/i.test(sql), false);
  assert.equal(/security definer/i.test(sql), false);
});

/** The CREATE TABLE body for one table. */
function tableBody(name) {
  const start = sql.indexOf(`create table if not exists ${name}`);
  assert.notEqual(start, -1, `${name} is not created in phase38`);
  const end = sql.indexOf(');', start);
  return sql.slice(start, end);
}

/** Every policy statement mentioning one table. */
function policiesFor(name) {
  return [...sql.matchAll(/create policy[^;]+;/gi)]
    .map((m) => m[0])
    .filter((p) => p.includes(name))
    .join('\n');
}
