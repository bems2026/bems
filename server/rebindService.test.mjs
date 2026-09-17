/**
 * The rebind service: pointing an orphaned flow node at the re-paired device that replaced it.
 *
 * Mostly refusals, because a rebind writes a local key into a live flow and repoints a device other
 * services read. What must never happen: repointing a node that still works, stealing a device another
 * node polls, binding an aircon node to an outlet, binding to a virtual remote, guessing a version,
 * or showing the key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rebindDevice } from './rebindService.mjs';

const FLOW = [
  { id: 'tab', type: 'tab', label: 'Aircon' },
  { id: 'ir', type: 'tuya-smart-device', z: 'tab', deviceName: 'NBRIC IR Blaster', deviceId: 'old-hub', deviceKey: 'old', tuyaVersion: '3.3', findTimeout: '10000', disableAutoStart: true },
  { id: 'co1', type: 'tuya-smart-device', z: 'tab', deviceName: 'CO1', deviceId: 'co1-id', deviceKey: 'k', tuyaVersion: '3.4', findTimeout: '10000' },
];
const CLOUD = [
  { id: 'new-hub', name: 'Smart IR', category: 'wnykq', online: true },
  { id: 'co1-id', name: 'CO1', category: 'pc', online: true },
  { id: 'air', name: 'Air', category: 'infrared_ac', sub: true, online: true },
  { id: 'new-outlet', name: 'CO8', category: 'pc', online: true },
];
const CLASS = { 'NBRIC IR Blaster': 'acu_ir', CO1: 'outlet_dual' };

function harness(over = {}) {
  const written = { flows: null };
  const deps = {
    cloud: {
      listDevices: async () => CLOUD,
      describeDevice: async () => ({ local_key: 'x'.repeat(16) }),
    },
    admin: {
      login: async () => 'auth',
      getFlows: async () => ({ flows: structuredClone(FLOW), rev: 'r1' }),
      postFlows: async (_a, flows) => { written.flows = flows; return { ok: true, status: 200 }; },
    },
    discoverVersion: async () => '3.3',
    classForNode: (name) => CLASS[name] ?? null,
    declaredVersionFor: (name) => ({ 'NBRIC IR Blaster': '3.3' })[name],
    ...over,
  };
  return { deps, written };
}

const draft = (over = {}) => ({ nodeName: 'NBRIC IR Blaster', tuyaDeviceId: 'new-hub', ...over });

test('a dry run describes the rebind and writes nothing', async () => {
  const { deps, written } = harness();
  const r = await rebindDevice(draft(), deps);
  assert.equal(r.ok, true);
  assert.equal(r.stage, 'dry-run');
  assert.equal(written.flows, null);
  assert.deepEqual(
    [r.summary.nodeName, r.summary.vendorName, r.summary.kind, r.summary.tuyaVersion, r.summary.declaredVersion, r.summary.versionMatchesDeclaration, r.summary.localKeyLength],
    ['NBRIC IR Blaster', 'Smart IR', 'IR hub (temperature + humidity)', '3.3', '3.3', true, 16],
  );
});

test('applying writes exactly the rebound node', async () => {
  const { deps, written } = harness({ apply: true });
  const r = await rebindDevice(draft(), deps);
  assert.equal(r.stage, 'applied');
  const ir = written.flows.find((n) => n.id === 'ir');
  assert.deepEqual([ir.deviceId, ir.tuyaVersion, ir.disableAutoStart, ir.findTimeout], ['new-hub', '3.3', false, '10000']);
  assert.deepEqual(written.flows.find((n) => n.id === 'co1'), FLOW[2]);
});

test('never returns the local key', async () => {
  const { deps } = harness();
  assert.equal(JSON.stringify(await rebindDevice(draft(), deps)).includes('xxxxxxxx'), false);
});

test('refuses to repoint a node whose device is still in the project', async () => {
  const { deps } = harness();
  const r = await rebindDevice(draft({ nodeName: 'CO1', tuyaDeviceId: 'new-outlet' }), deps);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'validate');
  assert.match(r.problems.join(' '), /still in the cloud project/);
});

test('refuses a device another node already polls', async () => {
  const { deps } = harness();
  const r = await rebindDevice(draft({ tuyaDeviceId: 'co1-id' }), deps);
  assert.match(r.problems.join(' '), /already polled by "CO1"/);
});

test('refuses a device of another kind — an aircon node is never bound to an outlet', async () => {
  const { deps } = harness();
  const r = await rebindDevice(draft({ tuyaDeviceId: 'new-outlet' }), deps);
  assert.match(r.problems.join(' '), /Outlet.*cannot back.*acu_ir/);
});

test('refuses the virtual aircon remote', async () => {
  const { deps } = harness();
  const r = await rebindDevice(draft({ tuyaDeviceId: 'air' }), deps);
  assert.match(r.problems.join(' '), /no network presence/);
});

test('refuses a node no registry device is bound to — its kind cannot be checked', async () => {
  const { deps } = harness({ classForNode: () => null });
  const r = await rebindDevice(draft(), deps);
  assert.match(r.problems.join(' '), /no registry device is bound/);
});

test('refuses a device the project cannot see', async () => {
  const { deps } = harness();
  const r = await rebindDevice(draft({ tuyaDeviceId: 'ghost' }), deps);
  assert.match(r.problems.join(' '), /not in this cloud project/);
});

test('refuses when neither the cloud nor the network gives a version', async () => {
  const { deps } = harness({ discoverVersion: async () => null });
  const r = await rebindDevice(draft(), deps);
  assert.equal(r.stage, 'credentials');
  assert.match(r.problems.join(' '), /announce/);
});

test('a version that differs from the declaration is reported, so TUYA_NODE_VERSIONS is updated with it', async () => {
  const { deps } = harness({ discoverVersion: async () => '3.5' });
  const r = await rebindDevice(draft(), deps);
  assert.equal(r.ok, true);
  assert.equal(r.summary.versionMatchesDeclaration, false);
  assert.match(r.summary.notes.join(' '), /TUYA_NODE_VERSIONS/);
});

test('a flow edited between the read and the write is reported, not clobbered', async () => {
  const { deps } = harness({
    apply: true,
    admin: {
      login: async () => 'auth',
      getFlows: async () => ({ flows: structuredClone(FLOW), rev: 'r1' }),
      postFlows: async () => ({ ok: false, status: 409 }),
    },
  });
  const r = await rebindDevice(draft(), deps);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'flow');
  assert.match(r.problems.join(' '), /changed between/);
});
