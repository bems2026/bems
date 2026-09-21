/**
 * The aircon's IR protocol, generated rather than captured — 2026-09-22.
 *
 * The sixteen codes in the live `AC Master Logic` decode, every one, as TCL112AC frames (header
 * 23 CB 26 01 00, 112 bits, byte 13 the sum of bytes 0..12, transmitted LSB-first), and the fifteen
 * ON codes are cool, fan auto, swing off at 16..30 °C. The field layout is IRremoteESP8266's
 * `Tcl112Protocol` (src/ir_Tcl.h): byte 5 bit 2 power, byte 6 bits 0-3 mode, byte 7 bits 0-3
 * 31 - setpoint, byte 8 bits 0-2 fan and bits 3-5 vertical swing.
 *
 * So a state the captured library lacks — dry, fan high, swing on — can be built from one captured
 * ON frame, with no learning session and no vendor cloud. The test that makes that trustworthy is
 * the first one: the encoder must reproduce every captured code, byte for byte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { tcl112Code, decodeTcl112, TCL112_MODES, TCL112_FANS } from '../shared/irTcl112.mjs';
import { extractIrLibrary } from '../node-red-bridge/airconSources.mjs';
import { AC_MODES, AC_FANS } from '../shared/acState.mjs';

const LIVE_TAB = JSON.parse(readFileSync(new URL('./fixtures/aircon-tab-live-2026-09-17.json', import.meta.url), 'utf8'));
const { library } = extractIrLibrary(LIVE_TAB.find((n) => n.name === 'AC Master Logic').func);
const TEMPLATE = library['24'];
const on = (over = {}) => ({ power: 'on', mode: 'cool', setpoint_c: 24, fan: 'auto', swing: false, ...over });

test('every captured ON code is reproduced exactly from any other one', () => {
  for (const [key, code] of Object.entries(library)) {
    if (key === 'OFF') continue;
    for (const template of [TEMPLATE, library['16'], library['30']]) {
      assert.equal(tcl112Code(template, on({ setpoint_c: Number(key) })), code, `${key} °C from another captured frame`);
    }
  }
});

test('the captured library decodes as the state it was assumed to be', () => {
  for (const [key, code] of Object.entries(library)) {
    const d = decodeTcl112(code);
    assert.ok(d, `${key} decodes`);
    assert.equal(d.checksumOk, true, `${key} checksum`);
    if (key === 'OFF') {
      assert.equal(d.power, 'off');
      continue;
    }
    assert.deepEqual({ power: d.power, mode: d.mode, setpoint_c: d.setpoint_c, fan: d.fan, swing: d.swing }, on({ setpoint_c: Number(key) }));
  }
});

test('a state outside the captured library is built with only its own fields changed', () => {
  const code = tcl112Code(TEMPLATE, on({ mode: 'dry', setpoint_c: 26, fan: 'high', swing: true }));
  const d = decodeTcl112(code);
  assert.deepEqual({ power: d.power, mode: d.mode, setpoint_c: d.setpoint_c, fan: d.fan, swing: d.swing }, on({ mode: 'dry', setpoint_c: 26, fan: 'high', swing: true }));
  assert.equal(d.checksumOk, true);
  // Everything the state does not name is the captured frame's own: header, byte 5's other bits,
  // timers, byte 12.
  const base = decodeTcl112(TEMPLATE).bytes;
  for (const i of [0, 1, 2, 3, 4, 5, 9, 10, 11, 12]) assert.equal(d.bytes[i], base[i], `byte ${i}`);
});

test('every mode and fan in the app vocabulary has a TCL112 value, and round-trips', () => {
  assert.deepEqual(Object.keys(TCL112_MODES).sort(), [...AC_MODES].sort());
  assert.deepEqual(Object.keys(TCL112_FANS).sort(), [...AC_FANS].sort());
  for (const mode of AC_MODES) {
    for (const fan of AC_FANS) {
      for (const swing of [false, true]) {
        const d = decodeTcl112(tcl112Code(TEMPLATE, on({ mode, fan, swing, setpoint_c: 21 })));
        assert.deepEqual([d.mode, d.fan, d.swing, d.setpoint_c, d.checksumOk], [mode, fan, swing, 21, true]);
      }
    }
  }
});

test('refuses rather than guesses: OFF, an out-of-range setpoint, an unknown field, a non-TCL112 template', () => {
  assert.equal(tcl112Code(TEMPLATE, { power: 'off' }), null, 'OFF is the captured OFF frame, never a generated one');
  assert.equal(tcl112Code(TEMPLATE, on({ setpoint_c: 15 })), null);
  assert.equal(tcl112Code(TEMPLATE, on({ setpoint_c: 31 })), null);
  assert.equal(tcl112Code(TEMPLATE, on({ setpoint_c: 24.5 })), null);
  assert.equal(tcl112Code(TEMPLATE, on({ mode: 'turbo' })), null);
  assert.equal(tcl112Code(TEMPLATE, on({ mode: 'toString' })), null, 'no prototype keys');
  assert.equal(tcl112Code(TEMPLATE, on({ fan: 'min' })), null);
  assert.equal(tcl112Code(TEMPLATE, on({ swing: 'yes' })), null);
  assert.equal(tcl112Code(library.OFF, on()), null, 'an OFF frame is not a template for an ON one');
  assert.equal(tcl112Code('001&^0070FFFF@%', on()), null);
  assert.equal(tcl112Code(undefined, on()), null);
});

test('the encoder is self-contained, so the flow generator can inline its source', () => {
  // AC Master Logic is a Node-RED function node: no imports. The generator writes
  // `const tcl112Code = ${tcl112Code.toString()};` — which only works if nothing outside the function
  // is referenced. Rebuilt from its own text, it must behave identically.
  const rebuilt = new Function(`return ${tcl112Code.toString()};`)();
  const state = on({ mode: 'heat', setpoint_c: 19, fan: 'low', swing: true });
  assert.equal(rebuilt(TEMPLATE, state), tcl112Code(TEMPLATE, state));
});
