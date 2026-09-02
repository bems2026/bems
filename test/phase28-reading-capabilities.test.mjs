/**
 * Guards supabase/phase28_reading_capabilities.sql.
 *
 * A file-text test, like its siblings: this project applies migrations by hand in the Supabase
 * SQL editor and has no runner, so what can be checked here is that the FILE is coherent and
 * says what the code around it assumes. Whether it has been applied is a separate question, and
 * `ROADMAP.md` is where that is recorded.
 *
 * The vocabularies matter most. `power_type` and `net_state` are closed sets taken from the
 * vendor's device model, and the capability catalogue is the other place they are written down —
 * if those two drift, a real reading starts failing to insert, which on a history table looks
 * like a gap rather than an error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CAPABILITY_PROFILES, capabilityFor } from '../shared/deviceCapabilities.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase28_reading_capabilities.sql'), 'utf8');

/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

const COLUMNS = ['total_energy_kwh', 'warn_power_w', 'power_type', 'net_state', 'fault', 'capabilities'];

test('every column is added idempotently, so a re-run is not an error', () => {
  // Applied by hand, so somebody WILL run it twice.
  for (const col of COLUMNS) {
    assert.match(sql, new RegExp(`add column if not exists ${col}\\b`), `${col} is add-if-not-exists`);
  }
});

test('constraints are dropped before being added, for the same reason', () => {
  for (const c of ['readings_power_type_check', 'readings_net_state_check']) {
    assert.ok(sql.includes(`drop constraint if exists ${c}`), `${c} is dropped first`);
    assert.ok(sql.includes(`add constraint ${c}`), `${c} is added`);
  }
});

test('nothing is NOT NULL and nothing is backfilled', () => {
  // Rows written before this migration do not know these values. Inventing them would be worse
  // than admitting it, and a NOT NULL would force exactly that.
  assert.equal(/not null/i.test(sql), false, 'no NOT NULL');
  assert.equal(/\bupdate\s+readings\b/i.test(sql), false, 'no backfill');
  assert.equal(/\bdrop\s+column\b/i.test(sql), false, 'nothing is dropped');
});

test('the power_type vocabulary matches the capability catalogue exactly', () => {
  const range = capabilityFor('cz_ct_single', 'power_type1').range;
  for (const value of range) {
    assert.ok(sql.includes(`'${value}'`), `power_type CHECK is missing ${value}`);
  }
  const inCheck = sql.match(/power_type in \(([^)]*)\)/)[1].match(/'([^']+)'/g).map((v) => v.slice(1, -1));
  assert.deepEqual(inCheck.sort(), [...range].sort(), 'CHECK and catalogue agree, both ways');
});

test('the net_state vocabulary matches the capability catalogue exactly', () => {
  const range = capabilityFor('cz_ct_double', 'net_state').range;
  const inCheck = sql.match(/net_state in \(([^)]*)\)/)[1].match(/'([^']+)'/g).map((v) => v.slice(1, -1));
  assert.deepEqual(inCheck.sort(), [...range].sort());
  // Both meter products must agree, or one of them would fail to insert.
  assert.deepEqual(
    [...capabilityFor('cz_ct_single', 'net_state').range].sort(),
    [...range].sort(),
    'the two meter profiles declare the same net_state vocabulary',
  );
});

test('every promoted column corresponds to a real capability', () => {
  // A column for something no device reports would be a schema claiming a fact nothing produces.
  const someProfileHas = (base) =>
    Object.values(CAPABILITY_PROFILES).some((p) => p.capabilities.some((c) => c.base === base));
  for (const base of ['total_energy', 'warn_power', 'power_type', 'net_state', 'fault']) {
    assert.ok(someProfileHas(base), `${base} is a capability some product actually reports`);
  }
});

test('each column carries a comment explaining what NULL means there', () => {
  for (const col of COLUMNS) {
    assert.match(sql, new RegExp(`comment on column readings.${col} is`), `${col} is documented`);
  }
});

test('the file says the ingestion daemon must not be widened before it is applied', () => {
  // PostgREST rejects an insert naming a column that does not exist, so widening shapeRows.mjs
  // first would stop ingestion outright — on the history of a real building. The sequencing has
  // to be written where the person applying it will read it.
  assert.match(raw, /shapeRows\.mjs/);
  assert.match(raw, /does NOT write these columns yet/i);
});

test('shapeRows.mjs has indeed not been widened yet', () => {
  // The half of the previous test that can actually be checked against the tree. When the
  // migration is applied and the daemon is widened, this test is what must be updated with it.
  const shapeRows = readFileSync(join(ROOT, 'server', 'shapeRows.mjs'), 'utf8');
  for (const col of ['total_energy_kwh', 'warn_power_w', 'net_state']) {
    assert.equal(shapeRows.includes(col), false, `shapeRows must not write ${col} until phase 28 is applied`);
  }
});
