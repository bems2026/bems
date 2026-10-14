import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideWifiMove, ACTION, DEFAULT_BACKOFF_MS, moveSucceeded, deviceProbeAddresses } from './wifiPreference.mjs';

const DEVICE = { name: 'device-ap', ssid: 'device-ap', autoconnect: true, priority: 30 };
const OFFICE = { name: 'office', ssid: 'office', autoconnect: true, priority: 10 };
const SAVED = [OFFICE, DEVICE]; // deliberately not pre-sorted

test('moves back to the higher-priority network when it is in range again', () => {
  // The 2026-08-26 case exactly: sitting on the fallback while the preferred AP is healthy.
  const d = decideWifiMove({ savedWifi: SAVED, visible: { 'device-ap': 100, office: 65 }, currentSsid: 'office' });
  assert.equal(d.action, ACTION.SWITCH);
  assert.equal(d.target.ssid, 'device-ap');
  assert.equal(d.from, 'office');
});

test('does nothing when already on the preferred network', () => {
  const d = decideWifiMove({ savedWifi: SAVED, visible: { 'device-ap': 100 }, currentSsid: 'device-ap' });
  assert.equal(d.action, ACTION.NONE);
  assert.match(d.reason, /already on the preferred/);
});

test('does not abandon a working connection for a network that is not in range', () => {
  // The whole risk of this feature: leaving something that works for something that does not.
  const d = decideWifiMove({ savedWifi: SAVED, visible: { office: 65 }, currentSsid: 'office' });
  assert.equal(d.action, ACTION.NONE);
  assert.match(d.reason, /not in range/);
});

test('does not move for a preferred network that is barely audible', () => {
  // In range is not the same as usable. Associating at signal 12 loses the fallback and then
  // fails DHCP, which is the worst of both.
  const d = decideWifiMove({ savedWifi: SAVED, visible: { 'device-ap': 12, office: 70 }, currentSsid: 'office' });
  assert.equal(d.action, ACTION.NONE);
  assert.match(d.reason, /too weak: 12/);
});

test('backs off after a failure instead of retrying every tick', () => {
  const now = 1_000_000_000;
  const d = decideWifiMove({
    savedWifi: SAVED, visible: { 'device-ap': 100 }, currentSsid: 'office',
    now, lastFailureAt: now - 60_000,
  });
  assert.equal(d.action, ACTION.NONE);
  assert.match(d.reason, /backing off/);
});

test('retries once the backoff has elapsed', () => {
  const now = 1_000_000_000;
  const d = decideWifiMove({
    savedWifi: SAVED, visible: { 'device-ap': 100 }, currentSsid: 'office',
    now, lastFailureAt: now - DEFAULT_BACKOFF_MS - 1,
  });
  assert.equal(d.action, ACTION.SWITCH);
});

test('backoff is reported only when it is the actual reason', () => {
  // Checked last on purpose: if the preferred network is out of range AND we are in backoff,
  // saying "backing off" would hide the real state and send someone hunting the wrong problem.
  const now = 1_000_000_000;
  const d = decideWifiMove({
    savedWifi: SAVED, visible: { office: 65 }, currentSsid: 'office',
    now, lastFailureAt: now - 60_000,
  });
  assert.match(d.reason, /not in range/);
});

test('ignores profiles the operator has turned off', () => {
  const d = decideWifiMove({
    savedWifi: [OFFICE, { ...DEVICE, autoconnect: false }],
    visible: { 'device-ap': 100, office: 65 }, currentSsid: 'office',
  });
  assert.equal(d.action, ACTION.NONE);
  assert.match(d.reason, /already on the preferred/);
});

test('will not ping-pong between two equally-preferred networks', () => {
  // Equal priority means the operator expressed no preference. Acting on it would move the
  // radio on every timer tick, forever.
  // DEVICE first so it sorts to "preferred"; with equal priorities that ordering is arbitrary,
  // which is exactly why acting on it is unsafe.
  const d = decideWifiMove({
    savedWifi: [DEVICE, { ...OFFICE, priority: 30 }],
    visible: { 'device-ap': 100, office: 65 }, currentSsid: 'office',
  });
  assert.equal(d.action, ACTION.NONE);
  assert.match(d.reason, /equal priority/);
});

test('acts when the Pi is associated to nothing at all', () => {
  const d = decideWifiMove({ savedWifi: SAVED, visible: { 'device-ap': 100 }, currentSsid: null });
  assert.equal(d.action, ACTION.SWITCH);
});

test('refuses when no autoconnect profiles exist, rather than guessing', () => {
  const d = decideWifiMove({ savedWifi: [{ ...DEVICE, autoconnect: false }], visible: { 'device-ap': 100 } });
  assert.equal(d.action, ACTION.NONE);
  assert.match(d.reason, /no autoconnect/);
});

test('accepts a Map of visible networks as well as an object', () => {
  const d = decideWifiMove({ savedWifi: SAVED, visible: new Map([['device-ap', 90]]), currentSsid: 'office' });
  assert.equal(d.action, ACTION.SWITCH);
});

/* RM-163 (2026-10-14): logging first. The device network's uplink ran out of data; at 13:23 the device AP
 * dropped, the Pi fell back to the office SSID, and at 13:32 this timer moved it back, found no internet on
 * the device network, called that a failure and reverted — leaving every device dark, and backing off for two
 * hours. The devices need no internet. A move now succeeds when the Pi is on the target and either the
 * internet or the devices there answer. */

test('a move succeeds on the target network when the internet OR the devices answer', () => {
  assert.equal(moveSucceeded({ onTarget: true, internet: true, devicesAnswering: false }), true);
  assert.equal(moveSucceeded({ onTarget: true, internet: false, devicesAnswering: true }), true, 'the device network without internet is still the right network');
  assert.equal(moveSucceeded({ onTarget: true, internet: false, devicesAnswering: false }), false, 'neither: revert, as before');
  assert.equal(moveSucceeded({ onTarget: false, internet: true, devicesAnswering: true }), false, 'not associated to the target');
});

test('the devices to probe are the enabled tuya nodes\' own addresses, deduplicated, a handful at most', () => {
  const flows = [
    { type: 'tuya-smart-device', deviceIp: '192.0.2.10' },
    { type: 'tuya-smart-device', deviceIp: '192.0.2.10' },
    { type: 'tuya-smart-device', deviceIp: '192.0.2.11', disableAutoStart: true },
    { type: 'tuya-smart-device', deviceIp: 'not-an-address' },
    { type: 'tuya-smart-device' },
    { type: 'function', deviceIp: '192.0.2.99' },
    ...Array.from({ length: 8 }, (_, i) => ({ type: 'tuya-smart-device', deviceIp: `192.0.2.${20 + i}` })),
  ];
  const probes = deviceProbeAddresses(flows);
  assert.equal(probes[0], '192.0.2.10');
  assert.ok(!probes.includes('192.0.2.11'), 'a disabled node is not a device we expect to answer');
  assert.ok(!probes.includes('192.0.2.99'));
  assert.equal(new Set(probes).size, probes.length);
  assert.equal(probes.length, 5);
  assert.deepEqual(deviceProbeAddresses(null), []);
});

test('the timer\'s success test is moveSucceeded, with the devices probed only when the internet does not answer', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./wifi-prefer.mjs', import.meta.url), 'utf8');
  assert.match(src, /const devices = onTarget && !internet && devicesAnswering\(\);\s*if \(moveSucceeded\(\{ onTarget, internet, devicesAnswering: devices \}\)\)/);
  assert.match(src, /for \(const ip of deviceProbeAddresses\(flows\)\)/);
});
