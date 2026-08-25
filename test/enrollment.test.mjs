/**
 * Enrolment validation.
 *
 * The tests below are mostly about *refusals*, because a bad enrolment does not fail at
 * enrolment time — it fails weeks later as a device that reads `online: false` forever, which
 * this project has repeatedly shown is indistinguishable from a network fault. Every refusal
 * here is a failure mode that would otherwise be discovered by packet capture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnrollment, registryEntryFor, ENROLLABLE_CLASSES } from '../shared/enrollment.mjs';

const registry = [
  { id: 'co1', class: 'outlet_dual', tuya_device_id: 'vendor-co1' },
  { id: 'l1', class: 'switch' },
];
const cloudDeviceIds = ['vendor-new', 'vendor-co1'];
const draft = (over = {}) => ({
  deviceId: 'co8', class: 'outlet_dual', displayName: 'Outlet 8',
  room: 'Lab', tuyaDeviceId: 'vendor-new', ...over,
});
const check = (over) => validateEnrollment(draft(over), { registry, cloudDeviceIds });

test('accepts a well-formed draft', () => {
  assert.deepEqual(check({}), { ok: true, problems: [] });
});

test('refuses a duplicate registry id', () => {
  assert.match(check({ deviceId: 'co1' }).problems.join(), /already in the registry/);
});

test('refuses a vendor device already enrolled under another id', () => {
  // Two registry entries polling one device is how the duplicate-session problem started.
  assert.match(check({ tuyaDeviceId: 'vendor-co1' }).problems.join(), /already enrolled/);
});

test('refuses a vendor device the cloud project cannot see', () => {
  // The node would never connect, and permanent `find() timed out` reads as a network fault.
  assert.match(check({ tuyaDeviceId: 'vendor-ghost' }).problems.join(), /not in this cloud project/);
});

test('refuses ids that would not survive being a context key', () => {
  for (const bad of ['CO8', 'co 8', '8co', 'co-8', 'c', '']) {
    assert.equal(check({ deviceId: bad }).ok, false, `"${bad}" should be refused`);
  }
});

test('refuses a class that cannot be enrolled this way', () => {
  // A meter's identity is a logical channel chosen by which CT clamp is on which circuit —
  // an electrical decision a wizard cannot validate.
  assert.match(check({ class: 'meter' }).problems.join(), /class must be one of/);
  assert.match(check({ class: 'acu_ir' }).problems.join(), /class must be one of/);
  assert.deepEqual(ENROLLABLE_CLASSES, ['outlet_dual', 'switch']);
});

test('requires a display name — the fleet table has no other way to name it', () => {
  assert.match(check({ displayName: '   ' }).problems.join(), /display name is required/);
});

test('reports every problem at once rather than the first', () => {
  const r = validateEnrollment({ deviceId: 'CO1', class: 'meter' }, { registry, cloudDeviceIds });
  assert.ok(r.problems.length >= 3, `expected several, got ${JSON.stringify(r.problems)}`);
});

test('skips the cloud check when no device list was supplied', () => {
  // Offline use — validating a draft without a cloud round-trip must not invent a failure.
  assert.equal(validateEnrollment(draft(), { registry }).ok, true);
});

describe_entry();
function describe_entry() {
  test('derives ctx from the id so the two cannot drift', () => {
    // Every parser and the totals engine key off ctx. Letting it be set independently is
    // exactly the silent misbinding this module exists to prevent.
    assert.equal(registryEntryFor(draft()).ctx, 'co8');
  });

  test('an outlet gets both socket keys', () => {
    assert.deepEqual(registryEntryFor(draft()).sockets, ['CO8_1', 'CO8_2']);
  });

  test('a switch gets a state_key derived from its id, and no ctx', () => {
    const e = registryEntryFor(draft({ deviceId: 'l8', class: 'switch', displayName: 'Light 8' }));
    assert.equal(e.state_key, 'L8');
    assert.equal(e.ctx, null, 'switches read from bems_lights_state, not a ctx prefix');
    assert.equal(e.sockets, undefined);
  });

  test('trims the display name and collapses an empty room to null', () => {
    const e = registryEntryFor(draft({ displayName: '  Outlet 8  ', room: '   ' }));
    assert.equal(e.display_name, 'Outlet 8');
    assert.equal(e.room, null);
  });

  test('an outlet carries the dps map its class actually uses', () => {
    assert.equal(registryEntryFor(draft()).dps_map, 'type_b');
    assert.equal(registryEntryFor(draft({ deviceId: 'l8', class: 'switch' })).dps_map, null);
  });
}
