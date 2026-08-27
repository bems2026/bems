/**
 * The electrical tree — RM-029.
 *
 * A SECOND TREE, NOT A BRANCH OF THE FIRST, and conflating the two is the mistake this exists to
 * avoid. Where a device *is* and what it is *wired to* are independent facts: a lighting circuit
 * crosses rooms, and a room is fed by several circuits. RM-028 gave the first one structure;
 * this gives the second one structure, and neither is a parent of the other.
 *
 * `PHASE_MAP` was a constant naming four specific meters, which is the most direct statement in
 * the codebase that this building's panel is the only panel that will ever exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePhaseMap, circuitPath, meteredCircuits, PHASES } from '../shared/circuits.mjs';
import { CIRCUITS } from '../shared/sites/mmsu-nberic-care/circuits.mjs';
import { PHASE_MAP, DEVICE_REGISTRY } from '../shared/registry.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every phase is present even when nothing is wired to it', () => {
  // The Blue phase has no meter installed. It must still be a KEY with an empty list, because
  // `buildLatest` reads `PHASE_MAP.blue` and the UI has to say "not metered" rather than 0 —
  // an absent key and an empty one are different facts to every consumer downstream.
  const map = derivePhaseMap([]);
  assert.deepEqual(Object.keys(map).sort(), ['blue', 'red', 'yellow']);
  for (const phase of PHASES) assert.deepEqual(map[phase], []);
});

test('a circuit contributes its meter to its own phase', () => {
  const map = derivePhaseMap([
    { id: 'a', parent_id: null, kind: 'branch', name: 'A', phase: 'red', meter_device_id: 'mtr_a' },
    { id: 'b', parent_id: null, kind: 'branch', name: 'B', phase: 'yellow', meter_device_id: 'mtr_b' },
  ]);
  assert.deepEqual(map.red, ['mtr_a']);
  assert.deepEqual(map.yellow, ['mtr_b']);
  assert.deepEqual(map.blue, []);
});

test('an unmetered circuit contributes nothing rather than an undefined entry', () => {
  // Panels and service entrances carry no meter of their own. A null slipping into the list
  // would be looked up in `byId` and silently contribute nothing — or worse, `undefined`.
  const map = derivePhaseMap([
    { id: 'panel', parent_id: null, kind: 'panel', name: 'CHNT', phase: null, meter_device_id: null },
    { id: 'a', parent_id: 'panel', kind: 'branch', name: 'A', phase: 'red', meter_device_id: 'mtr_a' },
  ]);
  assert.deepEqual(map.red, ['mtr_a']);
});

test('an unknown phase is ignored rather than inventing a key', () => {
  const map = derivePhaseMap([{ id: 'x', parent_id: null, kind: 'branch', name: 'X', phase: 'purple', meter_device_id: 'mtr_x' }]);
  assert.deepEqual(Object.keys(map).sort(), ['blue', 'red', 'yellow']);
});

test('the derived map matches what the hand-written constant said, meter for meter', () => {
  // THE ACCEPTANCE. The constant was correct for this building; the point of RM-029 is that it
  // is now derived from a description of the panel rather than asserted. If these disagree,
  // the site's circuit file is wrong, not this test.
  const derived = derivePhaseMap(CIRCUITS);
  assert.deepEqual([...derived.red].sort(), ['mtr_arec_acu', 'mtr_lo_red']);
  assert.deepEqual([...derived.yellow].sort(), ['mtr_co_yellow', 'mtr_lo_yellow']);
  assert.deepEqual(derived.blue, [], 'no Blue-phase meter is installed and that must survive');
});

test('the registry exports the derived map, not a second hand-written copy', () => {
  assert.deepEqual(PHASE_MAP, derivePhaseMap(CIRCUITS));
  // deepEqual alone CANNOT tell a derivation from an identical constant — it passed against the
  // old hand-written map, which is exactly the regression this test exists to prevent. Read the
  // source: no meter id may be spelled out beside PHASE_MAP any more.
  const src = readFileSync(join(ROOT, 'shared', 'registry.mjs'), 'utf8');
  const decl = src.slice(src.indexOf('export const PHASE_MAP'));
  for (const meter of ['mtr_lo_red', 'mtr_arec_acu', 'mtr_co_yellow', 'mtr_lo_yellow']) {
    assert.equal(decl.includes(`'${meter}'`), false, `${meter} is still hand-listed at PHASE_MAP`);
  }
});

test('every meter named by a circuit is a real device in the registry', () => {
  // A typo here would silently drop a branch out of the building total — the reading would look
  // plausible and be short by one circuit, which is the failure shape this project keeps paying
  // for. Nothing else checks this: `buildLatest` looks the id up and finds nothing.
  const ids = new Set(DEVICE_REGISTRY.map((d) => d.id));
  for (const circuit of meteredCircuits(CIRCUITS)) {
    assert.ok(ids.has(circuit.meter_device_id), `circuit ${circuit.id} names ${circuit.meter_device_id}, which is not a device`);
  }
});

test('every metered circuit declares a phase, or its meter reaches no total at all', () => {
  for (const circuit of meteredCircuits(CIRCUITS)) {
    assert.ok(PHASES.includes(circuit.phase), `circuit ${circuit.id} has no usable phase`);
  }
});

test('every branch meter in the registry is claimed by exactly one circuit', () => {
  // The other direction, and the one that catches a meter added to the fleet and then forgotten
  // here: it would report readings on the Devices page and contribute nothing to the building.
  const claimed = meteredCircuits(CIRCUITS).map((c) => c.meter_device_id);
  const meters = DEVICE_REGISTRY.filter((d) => d.class === 'meter').map((d) => d.id);
  assert.deepEqual([...claimed].sort(), [...meters].sort());
  assert.equal(new Set(claimed).size, claimed.length, 'a meter claimed twice would be double-counted');
});

test('circuitPath reads from the service entrance down, the way an electrician says it', () => {
  assert.equal(circuitPath(CIRCUITS, 'lo_red').at(-1).id, 'lo_red');
  assert.ok(circuitPath(CIRCUITS, 'lo_red').length >= 2, 'a branch sits under at least a panel');
  assert.deepEqual(circuitPath(CIRCUITS, 'nope'), []);
});

test('circuitPath terminates on a cycle instead of looping', () => {
  const cyclic = [
    { id: 'a', parent_id: 'b', kind: 'branch', name: 'A', phase: null, meter_device_id: null },
    { id: 'b', parent_id: 'a', kind: 'branch', name: 'B', phase: null, meter_device_id: null },
  ];
  assert.ok(circuitPath(cyclic, 'a').length <= 34);
});

/**
 * The link between the two files that name the same circuits.
 *
 * `branch_circuit` on a device is the circuit's NAME, typed into `registry.mjs` by hand. It
 * already matches, and nothing enforced that — rename a circuit in one file and the other drifts
 * silently, leaving the Control page and the 3D scene labelling devices with a branch that no
 * longer exists.
 *
 * WHY THIS IS A CROSS-CHECK AND NOT A `circuit_id` COLUMN IN SUPABASE: the electrical tree is
 * WIRING, and RM-027 settled where wiring lives. Rooms are operator-editable and change often, so
 * the spatial tree went to Supabase. A panel changes when an electrician changes it — a deploy-
 * level event, not an operator-level one — and putting it behind a network read would make the
 * building totals depend on the internet, which is the property EX-130 exists to protect.
 */
test('every device names a branch circuit that actually exists in the panel', () => {
  const names = new Set(CIRCUITS.map((c) => c.name));
  for (const device of DEVICE_REGISTRY) {
    if (!device.branch_circuit) continue;
    assert.ok(
      names.has(device.branch_circuit),
      `${device.id} is on "${device.branch_circuit}", which is not a circuit in this site's panel`,
    );
  }
});

test('every metered circuit is named by the device that measures it, so the two agree both ways', () => {
  const byId = new Map(DEVICE_REGISTRY.map((d) => [d.id, d]));
  for (const circuit of meteredCircuits(CIRCUITS)) {
    const meter = byId.get(circuit.meter_device_id);
    assert.equal(
      meter.branch_circuit,
      circuit.name,
      `${meter.id} says it is on "${meter.branch_circuit}" but measures the circuit named "${circuit.name}"`,
    );
  }
});
