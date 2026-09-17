/**
 * Guards supabase/phase45_command_ac_state.sql — the aircon's full commanded state on the audit row.
 *
 * File-text tests of intent; `supabase/rehearse.sh` executes the file against a real PostgreSQL,
 * twice, and checks the constraints refuse what they should. Same split as every phase before it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AC_MODES, AC_FANS } from '../shared/acState.mjs';

const sql = readFileSync(new URL('../supabase/phase45_command_ac_state.sql', import.meta.url), 'utf8');
const statements = sql.replace(/--[^\n]*/g, '');

test('adds the three columns, guarded so a second paste changes nothing', () => {
  for (const col of ['ac_mode text', 'ac_fan text', 'ac_swing boolean']) {
    assert.match(statements, new RegExp(`alter table commands add column if not exists ${col}`, 'i'), col);
  }
});

test('the mode and fan constraints spell exactly the vocabulary shared/acState.mjs enforces', () => {
  const listIn = (name) => {
    const m = new RegExp(`${name}[\\s\\S]*?in \\(([^)]*)\\)`, 'i').exec(statements);
    return m ? m[1].split(',').map((s) => s.trim().replace(/'/g, '')) : null;
  };
  assert.deepEqual(listIn('commands_ac_mode_check'), [...AC_MODES]);
  assert.deepEqual(listIn('commands_ac_fan_check'), [...AC_FANS]);
});

test('every constraint is dropped before it is added, so a re-run cannot fail on a duplicate', () => {
  for (const name of ['commands_ac_mode_check', 'commands_ac_fan_check', 'commands_ac_state_shape_check']) {
    const drop = statements.search(new RegExp(`drop constraint if exists ${name}`, 'i'));
    const add = statements.search(new RegExp(`add constraint ${name}`, 'i'));
    assert.ok(drop >= 0 && add > drop, `${name}: drop before add`);
  }
});

test('the state travels whole, and only on an ON command', () => {
  // All three or none; and an OFF, a capability write or a relay command carries none of them.
  assert.match(statements, /commands_ac_state_shape_check[\s\S]*ac_mode is null\) = \(ac_fan is null\)/i);
  assert.match(statements, /commands_ac_state_shape_check[\s\S]*action = 'on'/i);
});

test('no backfill: a pre-migration row does not know, and inventing a value would be worse', () => {
  assert.equal(/\bupdate\s+commands\b/i.test(statements), false);
});

test('grants nothing — new columns inherit the table privileges phase39 locked down', () => {
  assert.equal(/\bgrant\b/i.test(statements), false);
});
