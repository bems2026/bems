/**
 * Capability writes through the vendor cloud, and the instruction-set split they turn on.
 *
 * MEASURED, NOT ASSUMED. `GET /v1.0/devices/{id}/specifications` answers for the light switch
 * (`tdq`) and the outlet (`pc`); both CT meters (`cz`) refuse it with `code 2009: not support
 * this device` and return an empty `{"category":"cz"}`. So the meters cannot be addressed by
 * code through the standard command endpoint at all, and their writes have to go through the
 * thing-model property endpoint. That is the whole reason this split exists rather than one
 * uniform call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { cloudCapabilityRouteFor, cloudPathFor, dispatchViaCloud } from './dispatchCloud.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { validateCommand } from '../shared/commands.mjs';

const dev = (id) => DEVICE_REGISTRY.find((d) => d.id === id);
const cmdFor = (body) => {
  const r = validateCommand(body, DEVICE_REGISTRY);
  assert.equal(r.ok, true, r.error);
  return r.cmd;
};

test('a product WITH a standard instruction set is commanded by code', () => {
  const route = cloudCapabilityRouteFor(dev('co3'), cmdFor({ device_id: 'co3', action: 'set', capability: 'child_lock', value: true }));
  assert.equal(route.instruction, 'standard');
  assert.deepEqual(route.body, { commands: [{ code: 'child_lock', value: true }] });
  assert.equal(cloudPathFor(route.instruction, 'abc123'), '/v1.0/devices/abc123/commands');
});

test('a product WITHOUT one is written through the thing-model property endpoint', () => {
  const route = cloudCapabilityRouteFor(dev('mtr_lo_red'), cmdFor({ device_id: 'mtr_lo_red', action: 'set', capability: 'warn_power', value: 1500 }));
  assert.equal(route.instruction, 'dp');
  assert.deepEqual(route.body, { properties: JSON.stringify({ warn_power1: 1500 }) });
  assert.equal(cloudPathFor(route.instruction, 'abc123'), '/v2.0/cloud/thing/abc123/shadow/properties/issue');
});

test('the dual-channel meter writes to the channel the logical device owns', () => {
  // Arming the wrong channel's over-power alarm would watch a different branch circuit while
  // reporting success — the failure this suffix exists to prevent.
  const ch1 = cloudCapabilityRouteFor(dev('mtr_co_yellow'), cmdFor({ device_id: 'mtr_co_yellow', action: 'set', capability: 'warn_power', value: 2000 }));
  const ch2 = cloudCapabilityRouteFor(dev('mtr_lo_yellow'), cmdFor({ device_id: 'mtr_lo_yellow', action: 'set', capability: 'warn_power', value: 2000 }));
  assert.deepEqual(ch1.body, { properties: JSON.stringify({ warn_power1: 2000 }) });
  assert.deepEqual(ch2.body, { properties: JSON.stringify({ warn_power2: 2000 }) });
});

test('a refused capability has no cloud route, even if a caller reaches this directly', () => {
  // Belt and braces: validation upstream already refuses these, but this function is one import
  // away from an API that moves relays, so it re-checks the allowlist itself.
  for (const capability of ['relay_status', 'cycle_time', 'switch_inching']) {
    assert.equal(cloudCapabilityRouteFor(dev('co3'), { action: 'set', capability, value: 'x' }), null, capability);
  }
  assert.equal(cloudCapabilityRouteFor(dev('mtr_lo_red'), { action: 'set', capability: 'sync_request', value: 'request' }), null);
});

test('a device with no capability profile has no capability route', () => {
  assert.equal(cloudCapabilityRouteFor(dev('acu_main'), { action: 'set', capability: 'child_lock', value: true }), null);
});

test('relay commands still take the standard endpoint, unchanged', () => {
  const calls = [];
  const client = { call: async (method, path, opts) => { calls.push({ method, path, body: opts?.body }); } };
  return dispatchViaCloud(dev('l1'), cmdFor({ device_id: 'l1', action: 'on' }), { client, tuyaDeviceIdFor: () => 'tid' })
    .then((r) => {
      assert.equal(r.ok, true);
      assert.equal(calls[0].path, '/v1.0/devices/tid/commands');
      assert.deepEqual(calls[0].body, { commands: [{ code: 'switch_1', value: true }] });
    });
});

test('a capability write reaches the endpoint its product requires', async () => {
  const calls = [];
  const client = { call: async (method, path, opts) => { calls.push({ path, body: opts?.body }); } };

  await dispatchViaCloud(dev('co3'), cmdFor({ device_id: 'co3', action: 'set', capability: 'countdown_1', value: 600 }),
    { client, tuyaDeviceIdFor: () => 'outlet-id' });
  await dispatchViaCloud(dev('mtr_co_yellow'), cmdFor({ device_id: 'mtr_co_yellow', action: 'set', capability: 'sync_response', value: 'ok' }),
    { client, tuyaDeviceIdFor: () => 'meter-id' });

  assert.equal(calls[0].path, '/v1.0/devices/outlet-id/commands');
  assert.deepEqual(calls[0].body, { commands: [{ code: 'countdown_1', value: 600 }] });
  assert.equal(calls[1].path, '/v2.0/cloud/thing/meter-id/shadow/properties/issue');
  assert.deepEqual(calls[1].body, { properties: JSON.stringify({ sync_response: 'ok' }) });
});

test('a vendor failure is reported, not thrown', async () => {
  const client = { call: async () => { throw new Error('Tuya POST failed (code 1106): permission deny'); } };
  const r = await dispatchViaCloud(dev('co3'), cmdFor({ device_id: 'co3', action: 'set', capability: 'child_lock', value: true }),
    { client, tuyaDeviceIdFor: () => 'tid' });
  assert.equal(r.ok, false);
  assert.match(r.detail, /permission deny/);
});

test('an unknown vendor id refuses before any call is made', async () => {
  let called = false;
  const client = { call: async () => { called = true; } };
  const r = await dispatchViaCloud(dev('co3'), cmdFor({ device_id: 'co3', action: 'set', capability: 'child_lock', value: true }),
    { client, tuyaDeviceIdFor: () => undefined });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});
