/**
 * Guards supabase/phase32_building_totals_summed.sql — RM-057.
 *
 * The building's energy totals became the SUM of its branch meters, so the headline figure and
 * the per-branch split are one number. This migration exists for what was NOT thrown away:
 * `energy_kwh_*_integrated`, the legacy two-second integration of the same circuits, which is
 * the only independent measurement of that load this system has. Without it the RM-054
 * disagreement guard would compare a number against itself, and the fault class it exists for
 * has now bitten three times (RM-047, RM-053, RM-056).
 *
 * THESE ASSERTIONS ARE ABOUT HONESTY, not syntax — `supabase/rehearse.sh` is what proves the SQL
 * parses, and this file's own header trap applies: these are TEXT tests, so they check intent.
 * The intent worth pinning is that the new columns are nullable and undefaulted. A default would
 * invent a measurement for every row written before this existed, and this project's most
 * expensive failures have all been a plausible figure nobody observed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = readFileSync(join(ROOT, 'supabase', 'phase32_building_totals_summed.sql'), 'utf8');
/** Assertions run against the SQL with `--` comments stripped: prose is not code. */
const sql = raw.replace(/^\s*--.*$/gm, '');

const PERIODS = ['today', 'week', 'month'];

test('all three periods keep their independent cross-check', () => {
  // One period left behind would leave that tile's guard comparing a number with itself, which
  // is the exact regression RM-057 introduced and this column set prevents.
  for (const period of PERIODS) {
    assert.match(
      sql,
      new RegExp(`alter table building_totals add column if not exists\\s+energy_kwh_${period}_integrated\\s+numeric`, 'i'),
      `building_totals is missing energy_kwh_${period}_integrated`,
    );
  }
});

test('the hourly rollup carries them too, or long-range history loses the comparison', () => {
  // `building_totals` is pruned; `building_totals_hourly` is what survives (phase11). A cross
  // check that exists only in the retained table cannot be made about last month.
  for (const period of PERIODS) {
    assert.match(
      sql,
      new RegExp(`alter table building_totals_hourly add column if not exists\\s+energy_kwh_${period}_integrated_max\\s+numeric`, 'i'),
      `building_totals_hourly is missing energy_kwh_${period}_integrated_max`,
    );
  }
});

test('the rollup aggregates the counter as a MAXIMUM, the way phase9 and phase11 already insist', () => {
  // Averaging a counter that resets at midnight is meaningless. The column NAME is what carries
  // that decision to whoever writes the rollup query, so `_max` is load-bearing rather than
  // decorative — hence the assertion above, and this one about the reasoning being recorded.
  assert.match(raw, /within-hour MAXIMUM/i);
});

test('every added column is nullable and undefaulted — absent means not measured', () => {
  // A default would fabricate an integrated reading for every row written before phase32.
  // "No data" and "zero kWh" are different facts and every reader in this project renders them
  // differently; `types.ts` and `buildLatest.mjs` both state that rule for these same fields.
  const adds = sql.match(/add column if not exists[^;]+;/gi) ?? [];
  assert.equal(adds.length, 6, 'expected exactly six added columns');
  for (const add of adds) {
    assert.doesNotMatch(add, /\bdefault\b/i, `a default would invent a measurement: ${add.trim()}`);
    assert.doesNotMatch(add, /not null/i, `not null forces a value where none was measured: ${add.trim()}`);
  }
});

test('it is idempotent, because these files are pasted by hand', () => {
  // There is no migration runner here (supabase/rehearse.sh's own header says so), so a file
  // that cannot be run twice is a file that breaks the second person to apply it.
  const alters = sql.match(/alter table \w+ add column[^;]+;/gi) ?? [];
  for (const alter of alters) {
    assert.match(alter, /if not exists/i, `not idempotent: ${alter.trim()}`);
  }
});

test('the columns say what they are, so the next reader does not have to guess which is which', () => {
  // Two figures of the same unit for the same period is exactly the ambiguity RM-057 set out to
  // remove. A comment on the column is where that survives a schema dump.
  for (const period of PERIODS) {
    assert.match(
      sql,
      new RegExp(`comment on column building_totals\\.energy_kwh_${period}_integrated is`, 'i'),
      `energy_kwh_${period}_integrated is undocumented in the schema itself`,
    );
  }
});

test('the migration records that it must be applied BEFORE the server that writes it', () => {
  // PostgREST fails the whole insert when a named column is missing, so an unmigrated database
  // plus new server code stores no totals at all — silently, until someone reads
  // `ingestion_health`. That ordering is the one operational fact this file must carry.
  assert.match(raw, /APPLY THIS BEFORE DEPLOYING THE SERVER/i);
});
