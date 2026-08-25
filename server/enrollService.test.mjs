/**
 * The enrolment service.
 *
 * Most of these are about what it refuses and what it says when the second write fails, because
 * those are the paths a caller has to handle correctly and the ones nobody exercises by hand.
 * The success path is the easy one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrollDevice } from './enrollService.mjs';

const VENDOR = 'vendor-new';
const registry = [{ id: 'co1', class: 'outlet_dual', tuya_device_id: 'vendor-co1' }];
const draft = (over = {}) => ({
  deviceId: 'co8', class: 'outlet_dual', displayName: 'Outlet 8', tuyaDeviceId: VENDOR, ...over,
});

const ENROLLED_SRC = 'export const ENROLLED_DEVICES = [];\n';

function deps(over = {}) {
  const written = { source: null, flows: null };
  return {
    written,
    deps: {
      registry,
      cloud: {
        listDevices: async () => [{ id: VENDOR, name: 'New Outlet', online: true }],
        describeDevice: async () => ({ version: '3.4', local_key: 'k'.repeat(16) }),
      },
      admin: {
        login: async () => 'auth',
        getFlows: async () => ({ flows: [{ id: 'tab', type: 'tab', label: 'Outlet' }], rev: 'r1' }),
        postFlows: async (_a, flows) => { written.flows = flows; return { ok: true, status: 200 }; },
      },
      readEnrolled: () => ({ source: ENROLLED_SRC, devices: [] }),
      writeEnrolled: (s) => { written.source = s; },
      placementFor: () => ({ z: 'tab', x: 0, y: 0 }),
      ...over,
    },
  };
}

test('a dry run reports the plan and writes nothing', async () => {
  const { deps: d, written } = deps();
  const r = await enrollDevice(draft(), d);
  assert.equal(r.ok, true);
  assert.equal(r.stage, 'dry-run');
  assert.equal(written.source, null, 'registry untouched');
  assert.equal(written.flows, null, 'flow untouched');
  assert.equal(r.summary.deviceId, 'co8');
});

test('applying writes the registry and then the flow', async () => {
  const { deps: d, written } = deps({ apply: true });
  const r = await enrollDevice(draft(), d);
  assert.equal(r.ok, true);
  assert.equal(r.stage, 'applied');
  assert.match(written.source, /"id": "co8"/);
  assert.equal(written.flows.length, 3, 'tab plus device plus parser');
});

test('never returns the local key — a rendered secret is a leaked one', async () => {
  const { deps: d } = deps();
  const r = await enrollDevice(draft(), d);
  assert.equal(JSON.stringify(r).includes('kkkk'), false);
  assert.equal(r.summary.localKeyLength, 16, 'length only');
});

test('refuses an invalid draft before touching the cloud detail or the flow', async () => {
  let described = false;
  const { deps: d } = deps({ cloud: {
    listDevices: async () => [{ id: VENDOR }],
    describeDevice: async () => { described = true; return {}; },
  } });
  const r = await enrollDevice(draft({ class: 'meter' }), d);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'validate');
  assert.equal(described, false, 'must not fetch a key for a draft it will reject');
});

test('refuses when the cloud reports no protocol version, rather than defaulting one', async () => {
  // A guessed version fails as `find() timed out`, indistinguishable from a network fault.
  const { deps: d } = deps({ cloud: {
    listDevices: async () => [{ id: VENDOR }],
    describeDevice: async () => ({ local_key: 'k'.repeat(16) }),
  } });
  const r = await enrollDevice(draft(), d);
  assert.equal(r.stage, 'credentials');
  assert.match(r.problems.join(), /protocol version/);
});

test('refuses when the cloud returns no local key', async () => {
  const { deps: d } = deps({ cloud: {
    listDevices: async () => [{ id: VENDOR }],
    describeDevice: async () => ({ version: '3.4' }),
  } });
  const r = await enrollDevice(draft(), d);
  assert.equal(r.stage, 'credentials');
  assert.match(r.problems.join(), /local key/);
});

test('a 409 on the flow write says the registry was already written', async () => {
  // Without that, re-running looks unsafe and someone hand-edits instead.
  const { deps: d, written } = deps({
    apply: true,
    admin: {
      login: async () => 'auth',
      getFlows: async () => ({ flows: [{ id: 'tab', type: 'tab' }], rev: 'r1' }),
      postFlows: async () => ({ ok: false, status: 409 }),
    },
  });
  const r = await enrollDevice(draft(), d);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'flow');
  assert.match(r.problems.join(), /registry entry was written/);
  assert.ok(written.source, 'the registry really was written');
});

test('reports a refused registry rewrite without touching the flow', async () => {
  const { deps: d, written } = deps({ apply: true, readEnrolled: () => ({ source: 'nothing to match', devices: [] }) });
  const r = await enrollDevice(draft(), d);
  assert.equal(r.stage, 'registry');
  assert.equal(written.flows, null, 'the flow must not be written when the registry could not be');
});

test('carries the version the device announced into the plan', async () => {
  const { deps: d, written } = deps({
    apply: true,
    cloud: {
      listDevices: async () => [{ id: VENDOR, name: 'X', online: false }],
      describeDevice: async () => ({ version: '3.5', local_key: 'k'.repeat(16) }),
    },
  });
  const r = await enrollDevice(draft(), d);
  assert.equal(r.summary.tuyaVersion, '3.5');
  assert.equal(written.flows.find((n) => n.type === 'tuya-smart-device').tuyaVersion, '3.5');
});

test('enrolling an offline device is allowed, and says so', async () => {
  // Offline now does not mean offline forever, and refusing would make a device unaddable
  // exactly when someone is trying to fix it.
  const { deps: d } = deps({ cloud: {
    listDevices: async () => [{ id: VENDOR, name: 'X', online: false }],
    describeDevice: async () => ({ version: '3.4', local_key: 'k'.repeat(16) }),
  } });
  const r = await enrollDevice(draft(), d);
  assert.equal(r.ok, true);
  assert.equal(r.summary.vendorOnline, false);
});
