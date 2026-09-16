/**
 * Which branch circuit every device in this building hangs from — as the operator confirmed it on
 * 2026-09-15.
 *
 * WHY THIS EXISTS. The site file transcribed its circuit map from a comment in a 2019 dashboard, and
 * two things in it were wrong for years without anything noticing. L.O Yellow was described as the
 * "OUTDOOR ACU (separate unit, right side outside the room)" — it is lighting: switches L5, L6 and L7,
 * which is also why its meter reads about 120 W rather than an aircon's kilowatts. And every one of the
 * seven light switches was filed under L.O Red, so narrowing a report to L.O Yellow showed a branch
 * with no devices on it, and narrowing to L.O Red showed three lights that are not on it. The aircon's
 * IR endpoint was on no branch at all, although CARE ACU carries the aircon and nothing else.
 *
 * `branch_circuit` is the one fact here nothing can derive: it is how the building is wired. So it is
 * written down twice — in `shared/sites/mmsu-nberic-care/devices.mjs` and in this test — and a change
 * to either has to be a decision about the wiring rather than an accident.
 *
 * `test/circuit-tree.test.mjs` separately checks that every name here is a circuit on the panel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILT_IN_DEVICES, CIRCUITS } from '../shared/siteConfig.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const onBranch = (name) =>
  BUILT_IN_DEVICES.filter((d) => d.branch_circuit === name)
    .map((d) => d.id)
    .sort();

test('L.O Red carries light switches L1 to L4, and its own meter', () => {
  assert.deepEqual(onBranch('L.O Red'), ['l1', 'l2', 'l3', 'l4', 'mtr_lo_red']);
});

test('L.O Yellow carries light switches L5 to L7, and its own meter', () => {
  assert.deepEqual(onBranch('L.O Yellow'), ['l5', 'l6', 'l7', 'mtr_lo_yellow']);
});

test('C.O Yellow carries every convenience outlet, and its own meter', () => {
  assert.deepEqual(onBranch('C.O Yellow'), ['co1', 'co2', 'co3', 'co4', 'co5', 'co6', 'co7', 'mtr_co_yellow']);
});

test('CARE ACU carries the aircon and nothing else', () => {
  // The IR endpoint that commands the unit, and the meter that measures it — one appliance.
  assert.deepEqual(onBranch('CARE ACU'), ['acu_main', 'mtr_arec_acu']);
});

test('the ambient sensor is on no branch until someone says which', () => {
  // Nobody has said what feeds it. A guessed branch would put it inside a report narrowed to that
  // branch, stated as wiring.
  assert.equal(BUILT_IN_DEVICES.find((d) => d.id === 'sens_outside_temp')?.branch_circuit ?? null, null);
});

test('each branch meter describes the branch the operator confirmed', () => {
  const described = (meterId) => ({
    circuit: CIRCUITS.find((c) => c.meter_device_id === meterId)?.description ?? '',
    device: BUILT_IN_DEVICES.find((d) => d.id === meterId)?.description ?? '',
  });
  for (const text of Object.values(described('mtr_lo_red'))) assert.match(text, /L1.*L4/, `L.O Red is described as "${text}"`);
  for (const text of Object.values(described('mtr_lo_yellow'))) {
    assert.match(text, /L5.*L7/, `L.O Yellow is described as "${text}"`);
    assert.doesNotMatch(text, /ACU|aircon/i, `L.O Yellow is lighting, but is described as "${text}"`);
  }
});

test('no site file or install guide still calls L.O Yellow an outdoor aircon', () => {
  for (const file of ['shared/sites/mmsu-nberic-care/devices.mjs', 'shared/sites/mmsu-nberic-care/circuits.mjs', 'docs/physical-install.md']) {
    assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), /outdoor ACU/i, `${file} still says L.O Yellow is an outdoor ACU`);
  }
});

test('each branch carries the load category the operator gave it — RM-092', async () => {
  const { loadOf, buildingMetersByLoad } = await import('../shared/circuits.mjs');
  const loadOfMeter = (meterId) => loadOf(CIRCUITS, CIRCUITS.find((c) => c.meter_device_id === meterId)?.id);
  assert.equal(loadOfMeter('mtr_lo_red'), 'lighting');
  assert.equal(loadOfMeter('mtr_lo_yellow'), 'lighting');
  assert.equal(loadOfMeter('mtr_arec_acu'), 'aircon');
  assert.equal(loadOfMeter('mtr_co_yellow'), 'other');
  // Others is the outlet branch's meter alone: the outlets are inside it, so adding theirs would count
  // the same energy twice.
  assert.deepEqual(
    buildingMetersByLoad(CIRCUITS).map((g) => [g.load, [...g.meterIds].sort()]),
    [
      ['lighting', ['mtr_lo_red', 'mtr_lo_yellow']],
      ['aircon', ['mtr_arec_acu']],
      ['other', ['mtr_co_yellow']],
    ]
  );
});
