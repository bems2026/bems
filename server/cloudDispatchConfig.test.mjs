import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCloudDispatch, vendorIdMapFrom, registryIdForNodeName } from './cloudDispatchConfig.mjs';

const FLOW = JSON.stringify([
  { type: 'tuya-smart-device', deviceName: 'Light Switch 1', deviceId: 'vendor-l1' },
  { type: 'tuya-smart-device', deviceName: 'CO4', deviceId: 'vendor-co4' },
  { type: 'tuya-smart-device', deviceName: 'L.O red', deviceId: 'vendor-meter' },
  { type: 'function', name: 'not a device' },
]);
const env = { TUYA_ACCESS_ID: 'id', TUYA_ACCESS_SECRET: 'secret', TUYA_REGION: 'sg' };
const opts = (flow = FLOW) => ({ readFile: () => flow, flowPath: 'x' });

test('maps registry ids to vendor ids from the flow', () => {
  const map = vendorIdMapFrom(JSON.parse(FLOW), registryIdForNodeName);
  assert.equal(map.l1, 'vendor-l1');
  assert.equal(map.co4, 'vendor-co4');
});

test('leaves unmapped node names out rather than guessing', () => {
  // "L.O red" is a meter and has no registry id derivable from its name. Including it under a
  // guessed key would point a command at a meter.
  const map = vendorIdMapFrom(JSON.parse(FLOW), registryIdForNodeName);
  assert.equal(Object.keys(map).sort().join(','), 'co4,l1');
});

test('a renamed node maps to nothing, so it loses its cloud route rather than gaining a wrong one', () => {
  assert.equal(registryIdForNodeName('Light Switch A'), null);
  assert.equal(registryIdForNodeName('Lightswitch 1'), null);
  assert.equal(registryIdForNodeName(undefined), null);
});

test('returns null when the cloud is not configured — the ordinary deployment', () => {
  assert.equal(buildCloudDispatch({}, opts()), null);
  assert.equal(buildCloudDispatch({ ...env, TUYA_ACCESS_SECRET: '' }, opts()), null);
});

test('returns null for an unknown region rather than defaulting to one', () => {
  // Defaulting would authenticate against the wrong data centre and fail as `sign invalid`,
  // which reads as a bad secret.
  assert.equal(buildCloudDispatch({ ...env, TUYA_REGION: 'atlantis' }, opts()), null);
});

test('an unreadable flow disables the fallback instead of failing the proxy', () => {
  // The fallback is a recovery path. A proxy that refuses to start because its recovery path
  // is unavailable is worse than one that simply lacks it.
  const throws = { readFile: () => { throw new Error('ENOENT'); }, flowPath: 'x' };
  assert.equal(buildCloudDispatch(env, throws), null);
  assert.equal(buildCloudDispatch(env, opts('not json')), null);
});

test('a flow with no mappable devices disables it too', () => {
  assert.equal(buildCloudDispatch(env, opts(JSON.stringify([{ type: 'function' }]))), null);
});

test('when configured, it exposes a client and a vendor-id lookup', () => {
  const cd = buildCloudDispatch(env, opts());
  assert.ok(cd.client, 'client present');
  assert.equal(cd.tuyaDeviceIdFor('l1'), 'vendor-l1');
  assert.equal(cd.tuyaDeviceIdFor('unknown'), undefined);
});
