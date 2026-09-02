/**
 * Guards supabase/phase29_command_capability.sql.
 *
 * The vocabulary is the thing. This migration decides which device capabilities this system is
 * willing to WRITE, on the one table that records every relay that moved — and the vendor marks
 * four more as writable than we allow. If the SQL and `shared/deviceCapabilities.mjs` ever
 * disagree, the disagreement is silent in the direction that matters: the catalogue would offer
 * a control the database then refuses, or worse, the database would accept a capability the
 * catalogue never meant to expose.
 *
 * So both directions are asserted, from the catalogue rather than from a second hardcoded list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { CAPABILITY_PROFILES, CAPABILITY_PROFILE_IDS, writableCapabilities } from '../shared/deviceCapabilities.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase29_command_capability.sql'), 'utf8');

/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

const listIn = (column) => {
  const m = sql.match(new RegExp(`${column} in \\(([^)]*)\\)`, 's'));
  return m ? m[1].match(/'([^']+)'/g).map((v) => v.slice(1, -1)) : [];
};

test('adds both columns idempotently, so a re-run is not an error', () => {
  for (const col of ['capability', 'capability_value']) {
    assert.match(sql, new RegExp(`add column if not exists ${col}\\b`));
  }
});

test('relay commands keep their existing shape', () => {
  // `server/reports.mjs` and the Control page's command log both read this table. A relay row
  // must look exactly as it did, or both have to learn a second shape to keep working.
  const actions = listIn('action');
  assert.ok(actions.includes('on') && actions.includes('off'), 'on/off survive');
  assert.ok(actions.includes('set'), "'set' joins them rather than replacing them");
});

test('the writable allowlist matches the capability catalogue exactly, both ways', () => {
  const fromCatalogue = new Set(
    CAPABILITY_PROFILE_IDS.flatMap((id) => writableCapabilities(id).map((c) => c.code)),
  );
  // Relay switching travels as action on/off, not as a capability write — it is the one
  // writable capability with its own representation already.
  fromCatalogue.delete('switch_1');
  fromCatalogue.delete('switch_2');

  assert.deepEqual(listIn('capability').sort(), [...fromCatalogue].sort());
});

test('the four hazardous vendor-writable settings are absent', () => {
  // Each installs unattended switching INSIDE the device, where the Supabase scheduler cannot
  // see it and this audit table cannot record it. The vendor marks all four `rw`; that is
  // exactly why the refusal has to be stated somewhere rather than inherited.
  const allowed = listIn('capability');
  for (const refused of ['relay_status', 'switch_inching', 'cycle_time', 'random_time']) {
    assert.equal(allowed.includes(refused), false, `${refused} must not be writable`);
    // ...and the catalogue must agree, or one of them is lying.
    for (const id of CAPABILITY_PROFILE_IDS) {
      const cap = CAPABILITY_PROFILES[id].capabilities.find((c) => c.code === refused);
      if (cap) assert.equal(cap.writable, false, `${id}.${refused} must be writable:false`);
    }
  }
});

test('a capability and its value can only arrive together', () => {
  // A capability with no value is an instruction with no content; a value with no capability has
  // nowhere to go. And `action = 'set'` is exactly the capability case, so the three are one fact.
  assert.match(sql, /commands_capability_shape_check/);
  assert.match(sql, /action = 'set' and capability is not null and capability_value is not null/);
  assert.match(sql, /action in \('on','off'\) and capability is null and capability_value is null/);
});

test('nothing is NOT NULL, nothing is backfilled, nothing is dropped', () => {
  assert.equal(/add column[^;]*not null/i.test(sql), false);
  assert.equal(/\bupdate\s+commands\b/i.test(sql), false);
  assert.equal(/\bdrop\s+column\b/i.test(sql), false);
});

test('both columns carry a comment explaining what they hold', () => {
  for (const col of ['capability', 'capability_value']) {
    assert.match(sql, new RegExp(`comment on column commands.${col} is`));
  }
});
