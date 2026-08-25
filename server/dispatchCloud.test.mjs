import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudRouteFor, dispatchViaCloud } from './dispatchCloud.mjs';

const sw = { id: 'l1', class: 'switch', state_key: 'L1' };
const outlet = { id: 'co1', class: 'outlet_dual', sockets: ['CO1_1', 'CO1_2'] };
const meter = { id: 'mtr_lo_red', class: 'meter' };
const acu = { id: 'acu_main', class: 'acu_ir' };

test('a switch maps to the code the device itself reports', () => {
  assert.deepEqual(cloudRouteFor(sw, { action: 'on' }), { commands: [{ code: 'switch_1', value: true }] });
  assert.deepEqual(cloudRouteFor(sw, { action: 'off' }), { commands: [{ code: 'switch_1', value: false }] });
});

test('each outlet socket maps to its own code', () => {
  assert.deepEqual(cloudRouteFor(outlet, { action: 'on', socket: 1 }), { commands: [{ code: 'switch_1', value: true }] });
  assert.deepEqual(cloudRouteFor(outlet, { action: 'off', socket: 2 }), { commands: [{ code: 'switch_2', value: false }] });
});

test('an outlet command with no socket is refused rather than guessed', () => {
  // Switching both sockets would act beyond what was asked. Local dispatch resolves this via
  // the flow's wire key; there is no equivalent here, so refusing is the honest answer.
  assert.equal(cloudRouteFor(outlet, { action: 'off' }), null);
});

test('the aircon has no cloud route — its IR blaster is not in the cloud project', () => {
  assert.equal(cloudRouteFor(acu, { action: 'off' }), null);
});

test('read-only classes have no route either', () => {
  assert.equal(cloudRouteFor(meter, { action: 'off' }), null);
});

test('sends the command to the vendor id, not the registry id', () => {
  let seen = null;
  const client = { call: async (method, path, opts) => { seen = { method, path, opts }; } };
  return dispatchViaCloud(sw, { action: 'on' }, { client, tuyaDeviceIdFor: () => 'vendor-abc' }).then((r) => {
    assert.equal(r.ok, true);
    assert.equal(seen.method, 'POST');
    assert.equal(seen.path, '/v1.0/devices/vendor-abc/commands');
    assert.deepEqual(seen.opts.body, { commands: [{ code: 'switch_1', value: true }] });
  });
});

test('refuses when no vendor id is known, rather than sending to the registry id', async () => {
  // The registry id ("l1") is not a Tuya device id. Sending it would address nothing, or
  // worse, something else.
  const r = await dispatchViaCloud(sw, { action: 'on' }, { client: { call: async () => {} }, tuyaDeviceIdFor: () => undefined });
  assert.equal(r.ok, false);
  assert.match(r.detail, /no vendor device id/);
});

test('refuses when the cloud is not configured at all', async () => {
  const r = await dispatchViaCloud(sw, { action: 'on' }, { client: null, tuyaDeviceIdFor: () => 'x' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /not configured/);
});

test('reports a thrown API failure rather than propagating it', async () => {
  const client = { call: async () => { throw new Error('code 1106: permission deny'); } };
  const r = await dispatchViaCloud(sw, { action: 'on' }, { client, tuyaDeviceIdFor: () => 'v' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /permission deny/);
});

test('never throws, whatever the client does', async () => {
  const client = { call: async () => { throw new Error('boom'); } };
  await assert.doesNotReject(() => dispatchViaCloud(sw, { action: 'on' }, { client, tuyaDeviceIdFor: () => 'v' }));
});

/**
 * The fallback wrapper. What matters here is not that cloud works, but that local is tried
 * first and that cloud is never reached when local succeeded — a building control system that
 * quietly starts routing through a vendor because nobody checked the ordering would be a much
 * worse outcome than the hang this fixes.
 */
import { dispatchCommand } from './dispatchLight.mjs';

const bridgeOpts = (handler) => ({
  bridgeHost: '127.0.0.1', bridgePort: 1, lightApiToken: 't',
  cloud: { client: { call: handler }, tuyaDeviceIdFor: () => 'vendor-abc' },
});

test('does not touch the cloud when local dispatch succeeds', async () => {
  let cloudCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
  try {
    const r = await dispatchCommand(sw, { action: 'on' }, bridgeOpts(async () => { cloudCalled = true; }));
    assert.equal(r.ok, true);
    assert.equal(r.via, 'local');
    assert.equal(cloudCalled, false, 'the cloud must not be reached when local worked');
  } finally { globalThis.fetch = originalFetch; }
});

test('falls back to the cloud when local fails, and says which path worked', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const r = await dispatchCommand(sw, { action: 'on' }, bridgeOpts(async () => {}));
    assert.equal(r.ok, true);
    assert.equal(r.via, 'cloud');
    assert.match(r.detail, /local failed/);
  } finally { globalThis.fetch = originalFetch; }
});

test('carries both reasons when both paths fail', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const r = await dispatchCommand(sw, { action: 'on' }, bridgeOpts(async () => { throw new Error('device offline'); }));
    assert.equal(r.ok, false);
    assert.equal(r.via, 'none');
    assert.match(r.detail, /local:/);
    assert.match(r.detail, /cloud:/);
  } finally { globalThis.fetch = originalFetch; }
});

test('with no cloud configured, reports the local failure unchanged', async () => {
  // The ordinary deployment. A second failure about a path nobody asked for would be noise.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const r = await dispatchCommand(sw, { action: 'on' }, { bridgeHost: 'h', bridgePort: 1, lightApiToken: 't' });
    assert.equal(r.ok, false);
    assert.equal(r.via, 'local');
    assert.match(r.detail, /bridge endpoint unreachable/);
    assert.equal(/cloud/.test(r.detail), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('the aircon never reaches the cloud, even when local fails', async () => {
  // Its IR blaster is not in the cloud project, so a cloud attempt would fail at the API and
  // bury the real local reason behind a second, misleading one.
  let cloudCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const r = await dispatchCommand(acu, { action: 'off' }, bridgeOpts(async () => { cloudCalled = true; }));
    assert.equal(r.ok, false);
    assert.equal(cloudCalled, false, 'no cloud attempt for a device with no cloud route');
  } finally { globalThis.fetch = originalFetch; }
});

/**
 * A 2xx from the bridge is NOT proof the relay moved.
 *
 * The Node-RED endpoint answers as soon as it accepts the message; the tuya node then fails
 * asynchronously, long after the HTTP response has gone. Observed on the Pi 2026-08-25:
 * commanding `co1` (which the bridge reported offline) returned `{ok:true, via:'local'}` in
 * 209 ms while Node-RED logged, at the same moment,
 * `[tuya-smart-device:CO1] Device not connected. Can't send the SET commmand`.
 *
 * Two consequences, both silent. The operator is told a command worked when it did not — and
 * because local never reports failure, THE CLOUD FALLBACK IS UNREACHABLE. The whole of RM-018
 * was dead code in practice, which is why it had never been seen to fire.
 *
 * The bridge's `online` flag is the evidence available: it is derived from the device's own
 * health signal, so "offline" means a local SET cannot land. Checking it before dispatching
 * also avoids adding to the retry noise of a node that is already failing.
 */
const onlineOpts = (handler, readOnline) => ({ ...bridgeOpts(handler), readOnline });

test('refuses to claim local success for a device the bridge reports offline', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
  try {
    let cloudCalled = false;
    const r = await dispatchCommand(sw, { action: 'on' }, onlineOpts(
      async () => { cloudCalled = true; },
      async () => false,
    ));
    assert.equal(cloudCalled, true, 'an offline device must fall through to the cloud');
    assert.equal(r.via, 'cloud');
  } finally { globalThis.fetch = originalFetch; }
});

test('names the reason, so the audit row does not read as an unexplained local failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
  try {
    const r = await dispatchCommand(sw, { action: 'on' }, onlineOpts(
      async () => { throw new Error('cloud down'); },
      async () => false,
    ));
    assert.equal(r.via, 'none');
    assert.match(r.detail, /offline/i);
  } finally { globalThis.fetch = originalFetch; }
});

test('still dispatches locally when the bridge reports the device online', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
  try {
    let cloudCalled = false;
    const r = await dispatchCommand(sw, { action: 'on' }, onlineOpts(
      async () => { cloudCalled = true; },
      async () => true,
    ));
    assert.equal(r.ok, true);
    assert.equal(r.via, 'local');
    assert.equal(cloudCalled, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('an unknown online state does not block the local attempt', async () => {
  // A bridge that cannot be asked is not evidence the device is dead. Failing closed here
  // would route every command through the vendor the moment the readings endpoint hiccuped.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
  try {
    const r = await dispatchCommand(sw, { action: 'on' }, onlineOpts(
      async () => {},
      async () => null,
    ));
    assert.equal(r.via, 'local');
  } finally { globalThis.fetch = originalFetch; }
});
