/**
 * The re-paired IR blaster, as the catalogue and the site file describe it.
 *
 * Measured 2026-09-17 from the vendor cloud (`/v2.0/cloud/thing/{id}/model`, `/specification`,
 * `/shadow/properties`) and from the device's own LAN discovery broadcast:
 *
 *   "Smart IR" — product "Lasco Wifi IR Pro Max", category `wnykq`, announces v3.3.
 *     dp 101 temp_current   value, scale 1, ℃   (standard code va_temperature; 286 = 28.6 °C)
 *     dp 102 humidity_value value, scale 0, %    (standard code va_humidity)
 *     dp 201 ir_send        string ≤ 3072
 *     dp 202 ir_study_code  raw
 *     no standard instruction set (`functions: []`)
 *
 *   "Air" — category `infrared_ac`, `sub: true`: a VIRTUAL remote with no network presence of its
 *     own. Its thing model carries the hub's IR dps (1..13, 201, 202) and the aircon's state:
 *     dp 101 switch_power bool · 102 mode enum "0".."4" · 103 temperature value 10..40 ·
 *     104 fan enum "0".."3" · 105 swing bool. It also offers a standard set (PowerOn, PowerOff,
 *     T, M, F) — which has no swing, so the DP set is the one iBEMS uses.
 *
 * NOTHING HERE IS WRITABLE THROUGH THE `set` VERB. The aircon's state is written only as a whole,
 * through the `acu_ir` command (`shared/acState.mjs`), and the raw IR dps would let a caller emit
 * any code at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITY_PROFILES,
  capabilityFor,
  decodeDps,
  canonicalUnitFor,
  writableCapabilities,
  profileFor,
} from '../shared/deviceCapabilities.mjs';
import { DEVICE_REGISTRY, SITE } from '../shared/registry.mjs';
import { TUYA_NODE_VERSIONS, TUYA_VERSION_UNVERIFIED } from '../shared/tuyaNodeSettings.mjs';
import { matchProfiles } from '../server/tuyaSpecDiff.mjs';

const device = (id) => DEVICE_REGISTRY.find((d) => d.id === id);

test('the IR hub profile carries its two sensors and its two IR dps', () => {
  const p = CAPABILITY_PROFILES.wnykq_ir_hub;
  assert.ok(p, 'wnykq_ir_hub profile exists');
  assert.equal(p.standard_instruction, false);

  const t = capabilityFor('wnykq_ir_hub', 'temp_current');
  assert.deepEqual([t.dp, t.kind, t.scale, t.unit, t.access], [101, 'value', 1, '℃', 'ro']);
  const h = capabilityFor('wnykq_ir_hub', 'humidity_value');
  assert.deepEqual([h.dp, h.kind, h.scale, h.unit, h.access], [102, 'value', 0, '%', 'ro']);
  assert.equal(capabilityFor('wnykq_ir_hub', 'ir_send').dp, 201);
  assert.equal(capabilityFor('wnykq_ir_hub', 'ir_study_code').dp, 202);
  assert.equal(capabilityFor('wnykq_ir_hub', 'ir_study_code').kind, 'raw');
});

test('the hub decodes to degrees Celsius and percent, exactly as the cloud shadow read', () => {
  assert.deepEqual(decodeDps('wnykq_ir_hub', { 101: 286, 102: 59 }), { temp_current: 28.6, humidity_value: 59 });
  assert.equal(canonicalUnitFor(capabilityFor('wnykq_ir_hub', 'temp_current')), '°C');
  assert.equal(canonicalUnitFor(capabilityFor('wnykq_ir_hub', 'humidity_value')), '%');
});

test('the Air remote profile carries the five aircon state dps with the vendor ranges', () => {
  const p = CAPABILITY_PROFILES.tuya_ir_ac_remote;
  assert.ok(p, 'tuya_ir_ac_remote profile exists');
  const got = Object.fromEntries(
    ['switch_power', 'mode', 'temperature', 'fan', 'swing'].map((code) => {
      const c = capabilityFor('tuya_ir_ac_remote', code);
      return [code, [c.dp, c.kind]];
    }),
  );
  assert.deepEqual(got, {
    switch_power: [101, 'bool'],
    mode: [102, 'enum'],
    temperature: [103, 'value'],
    fan: [104, 'enum'],
    swing: [105, 'bool'],
  });
  assert.deepEqual(capabilityFor('tuya_ir_ac_remote', 'mode').range, ['0', '1', '2', '3', '4']);
  assert.deepEqual(capabilityFor('tuya_ir_ac_remote', 'fan').range, ['0', '1', '2', '3']);
  assert.equal(capabilityFor('tuya_ir_ac_remote', 'control').dp, 1);
  assert.equal(capabilityFor('tuya_ir_ac_remote', 'ir_code').dp, 3);
});

test('nothing on either IR profile is writable through the set verb', () => {
  assert.deepEqual(writableCapabilities('wnykq_ir_hub'), []);
  assert.deepEqual(writableCapabilities('tuya_ir_ac_remote'), []);
});

test('the site aircon points at both profiles, its flow node, and measures room air', () => {
  const acu = device('acu_main');
  assert.equal(acu.capability_profile, 'wnykq_ir_hub');
  assert.equal(acu.remote_profile, 'tuya_ir_ac_remote');
  assert.ok(profileFor(acu));
  assert.ok(CAPABILITY_PROFILES[acu.remote_profile]);
  assert.equal(acu.flow_node, 'NBRIC IR Blaster');
  // The hub is mounted in the room, away from the indoor unit — operator, 2026-09-17.
  assert.equal(acu.measures, 'room_air');
});

test('the uninstalled outside sensor is left exactly as it was', () => {
  const s = device('sens_outside_temp');
  assert.equal(s.capability_profile, null);
  assert.equal(s.measures, 'outdoor_air');
  assert.equal(s.state_field, 'outTemp');
  assert.equal(TUYA_NODE_VERSIONS['Outside Temp'], '3.3');
  assert.ok(TUYA_VERSION_UNVERIFIED.has('Outside Temp'));
});

test("the blaster's protocol version is measured now, not inherited", () => {
  assert.equal(TUYA_NODE_VERSIONS['NBRIC IR Blaster'], '3.3');
  assert.equal(TUYA_VERSION_UNVERIFIED.has('NBRIC IR Blaster'), false);
});

test('local IR is verified on the unit, by the on-site acceptance test', () => {
  // RM-120, 2026-09-22/23: the unit beeped and its display followed every step — the captured OFF and
  // cool frames, generated cool/dry/fan/heat frames with fan and swing, and the loop's 19..16 °C steps.
  // So ON states go local-first like every other device; the cloud is the fallback, not the first try.
  assert.equal(SITE.aircon?.local_ir_verified, true);
  assert.equal(SITE.aircon?.ir_protocol, 'tcl112', 'verified with generated frames, so the protocol is part of what was verified');
});

test('npm run tuya:spec pairs each IR profile with its own product, not the other', () => {
  // The two share dps 201 and 202, so a careless fingerprint could pair them crosswise.
  const product = (key, caps) => ({ key, label: key, capabilities: caps.map(([dp, code]) => ({ dp, code })) });
  const hub = product('hub', [[101, 'temp_current'], [102, 'humidity_value'], [201, 'ir_send'], [202, 'ir_study_code']]);
  const air = product('air', [
    [1, 'control'], [2, 'study_code'], [3, 'ir_code'], [4, 'key_code'], [5, 'key_code2'], [6, 'key_code3'],
    [7, 'key_study'], [8, 'key_study2'], [9, 'key_study3'], [10, 'delay_time'], [11, 'key_code4'],
    [12, 'key_study4'], [13, 'type'], [101, 'switch_power'], [102, 'mode'], [103, 'temperature'],
    [104, 'fan'], [105, 'swing'], [201, 'ir_send'], [202, 'ir_study_code'],
  ]);
  const { matched } = matchProfiles([CAPABILITY_PROFILES.wnykq_ir_hub, CAPABILITY_PROFILES.tuya_ir_ac_remote], [hub, air]);
  const pairs = Object.fromEntries(matched.map((m) => [m.profile.id, m.product.key]));
  assert.deepEqual(pairs, { tuya_ir_ac_remote: 'air', wnykq_ir_hub: 'hub' });
});
