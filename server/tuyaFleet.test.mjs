import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPublicDevice, toPublicFleet, assertNoSecrets, claimedNodesFrom, orphanNodesFrom } from './tuyaFleet.mjs';

const raw = {
  id: 'dev1',
  name: 'CO1',
  online: true,
  category: 'cz',
  product_name: 'Smart Socket',
  local_key: 'THE-SECRET-KEY-1',
  uid: 'user-id',
  ip: '192.168.2.5',
};

test('copies only the allowlisted fields', () => {
  assert.deepEqual(toPublicDevice(raw), {
    id: 'dev1', name: 'CO1', online: true, category: 'cz', product_name: 'Smart Socket',
  });
});

test('drops the local key, which is the whole point', () => {
  assert.equal(JSON.stringify(toPublicFleet([raw])).includes('THE-SECRET-KEY-1'), false);
});

test('drops fields Tuya adds later by default, rather than passing them through', () => {
  // An allowlist fails closed. A denylist would have shipped whatever the next API version
  // introduced, which is exactly how a credential leaks without anyone editing this file.
  const withNewField = { ...raw, some_future_token: 'oops' };
  assert.equal('some_future_token' in toPublicDevice(withNewField), false);
});

test('assertNoSecrets throws rather than silently stripping', () => {
  // Quietly filtering would hide a wrong edit to the allowlist until it reappeared elsewhere.
  assert.throws(() => assertNoSecrets([{ id: 'a', local_key: 'x' }]), /credential-shaped/);
  assert.throws(() => assertNoSecrets([{ id: 'a', nested: { access_token: 'x' } }]), /credential-shaped/);
});

test('assertNoSecrets names where it found the problem', () => {
  assert.throws(() => assertNoSecrets([{ id: 'a' }, { id: 'b', secret: 1 }]), /payload\[1\]\.secret/);
});

test('a clean payload passes through unchanged', () => {
  const clean = [{ id: 'a', name: 'A', online: false }];
  assert.deepEqual(assertNoSecrets(clean), clean);
});

test('an empty fleet is not an error', () => {
  assert.deepEqual(toPublicFleet([]), []);
});

test('sub is served — the wizard needs it to refuse a virtual remote', () => {
  // Measured 2026-09-17: the aircon's "Air" remote is `sub: true`, a device with no network presence.
  const [row] = toPublicFleet([{ id: 'air', name: 'Air', category: 'infrared_ac', sub: true, local_key: 'SECRET' }]);
  assert.equal(row.sub, true);
  assert.equal(JSON.stringify(row).includes('SECRET'), false);
});

test('a claimed device names the flow node that claims it', () => {
  const claimed = new Map([['hub', 'NBRIC IR Blaster']]);
  const rows = toPublicFleet([{ id: 'hub', category: 'wnykq' }, { id: 'air', category: 'infrared_ac' }], claimed);
  assert.deepEqual(rows.map((r) => [r.claimed, r.claimed_by]), [[true, 'NBRIC IR Blaster'], [false, null]]);
});

test('a plain Set of claimed ids still works, with no node name to give', () => {
  const [row] = toPublicFleet([{ id: 'co1' }], new Set(['co1']));
  assert.deepEqual([row.claimed, row.claimed_by], [true, null]);
});

const FLOW = [
  { type: 'tuya-smart-device', deviceName: 'NBRIC IR Blaster', deviceId: 'hub-old' },
  { type: 'tuya-smart-device', deviceName: 'Outside Temp', deviceId: 'temp-gone' },
  { type: 'tuya-smart-device', deviceName: 'CO1', deviceId: 'co1-id' },
  { type: 'function', name: 'not a device' },
];
const classFor = (name) => ({ 'NBRIC IR Blaster': 'acu_ir', CO1: 'outlet_dual' })[name] ?? null;

test('claimed nodes map vendor id to node name', () => {
  assert.deepEqual([...claimedNodesFrom(FLOW)], [['hub-old', 'NBRIC IR Blaster'], ['temp-gone', 'Outside Temp'], ['co1-id', 'CO1']]);
});

test('an orphan is a node whose vendor id the project no longer has, named with its class', () => {
  const orphans = orphanNodesFrom(FLOW, ['co1-id', 'hub-new'], classFor);
  assert.deepEqual(orphans, [
    { name: 'NBRIC IR Blaster', class: 'acu_ir' },
    // No registry device is bound to it, so no class — and no rebind will ever be offered to it.
    { name: 'Outside Temp', class: null },
  ]);
});

test('orphans carry names and classes only — never the stale vendor id', () => {
  assert.equal(JSON.stringify(orphanNodesFrom(FLOW, [], classFor)).includes('hub-old'), false);
});
