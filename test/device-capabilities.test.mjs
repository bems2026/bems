/**
 * The capability catalogue is the first thing in this project that claims to describe what the
 * hardware can DO, rather than what class it belongs to. These tests exist to keep that claim
 * honest against the two ways it can rot: the vendor changing a device model under us (which
 * `npm run tuya:spec` catches against the live cloud), and somebody widening the write
 * allowlist by hand (which nothing else would catch, and which reaches real relays).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITY_PROFILES,
  CAPABILITY_PROFILE_IDS,
  SEMANTICS,
  profileFor,
  capabilityFor,
  divisorFor,
  writableCapabilities,
  decodeDps,
  channelCodesFor,
} from '../shared/deviceCapabilities.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

test('every profile declares well-formed capabilities', () => {
  for (const id of CAPABILITY_PROFILE_IDS) {
    const profile = CAPABILITY_PROFILES[id];
    assert.equal(profile.id, id, `${id}: profile.id must match its key`);
    assert.ok(profile.capabilities.length > 0, `${id}: has capabilities`);

    for (const cap of profile.capabilities) {
      assert.match(cap.code, /^[a-z0-9_]+$/, `${id}.${cap.code}: snake_case code`);
      assert.ok(Number.isInteger(cap.dp) && cap.dp > 0, `${id}.${cap.code}: integer dp`);
      assert.ok(['ro', 'rw'].includes(cap.access), `${id}.${cap.code}: access ro|rw`);
      assert.ok(
        ['bool', 'value', 'enum', 'string', 'bitmap'].includes(cap.kind),
        `${id}.${cap.code}: known kind`,
      );
      assert.ok(SEMANTICS.includes(cap.semantic), `${id}.${cap.code}: known semantic`);
      assert.equal(typeof cap.writable, 'boolean', `${id}.${cap.code}: explicit writable flag`);
      if (cap.kind === 'value') {
        assert.ok(Number.isInteger(cap.scale), `${id}.${cap.code}: value needs a scale`);
        // Declared, not truthy: a dimensionless counter's unit is '' and saying so is the point.
        assert.ok(Object.hasOwn(cap, 'unit'), `${id}.${cap.code}: value must state a unit, even ''`);
      }
      if (cap.kind === 'enum') assert.ok(Array.isArray(cap.range), `${id}.${cap.code}: enum range`);
    }
  }
});

test('a dp is claimed by at most one code within a profile', () => {
  // The double meter reuses dp 113 for something the single meter calls `net_state`. Keying the
  // catalogue by profile is what makes that expressible; this test is what proves it stayed so.
  for (const id of CAPABILITY_PROFILE_IDS) {
    const seen = new Map();
    for (const cap of CAPABILITY_PROFILES[id].capabilities) {
      assert.equal(seen.get(cap.dp), undefined, `${id}: dp ${cap.dp} claimed twice (${seen.get(cap.dp)} / ${cap.code})`);
      seen.set(cap.dp, cap.code);
    }
  }
});

test('dp 113 means different things on the two meter products', () => {
  // Measured 2026-09-02 against /v2.0/cloud/thing/{id}/shadow/properties for both meters.
  assert.equal(capabilityFor('cz_ct_single', 'net_state').dp, 113);
  assert.equal(capabilityFor('cz_ct_double', 'device_state2').dp, 113);
  assert.equal(capabilityFor('cz_ct_double', 'net_state').dp, 124);
});

test('only the agreed-safe capabilities are writable', () => {
  // DELIBERATELY a hardcoded list, not derived from `access`. The vendor marks relay_status,
  // switch_inching, cycle_time and random_time `rw`, and they are exactly the ones we refuse:
  // each puts unattended switching inside the device, where the Supabase scheduler and the
  // command audit trail cannot see or override it. Widening this set reaches real relays.
  const writable = CAPABILITY_PROFILE_IDS.flatMap((id) =>
    writableCapabilities(id).map((c) => `${id}.${c.code}`),
  );
  assert.deepEqual(writable.sort(), [
    'cz_ct_double.sync_response',
    'cz_ct_double.warn_power1',
    'cz_ct_double.warn_power2',
    'cz_ct_single.sync_response',
    'cz_ct_single.warn_power1',
    'pc_outlet.child_lock',
    'pc_outlet.countdown_1',
    'pc_outlet.countdown_2',
    'pc_outlet.switch_1',
    'pc_outlet.switch_2',
    'tdq_switch.countdown_1',
    'tdq_switch.switch_1',
  ]);

  for (const id of CAPABILITY_PROFILE_IDS) {
    for (const cap of CAPABILITY_PROFILES[id].capabilities) {
      if (cap.writable) assert.equal(cap.access, 'rw', `${id}.${cap.code}: cannot write a read-only dp`);
    }
  }
});

test('sync_request is read-only; sync_response is the writable one', () => {
  // The brief asked to "trigger a sync_request". The thing model marks dp 101 accessMode "ro".
  assert.equal(capabilityFor('cz_ct_single', 'sync_request').access, 'ro');
  assert.equal(capabilityFor('cz_ct_single', 'sync_request').writable, false);
  assert.equal(capabilityFor('cz_ct_single', 'sync_response').access, 'rw');
  assert.equal(capabilityFor('cz_ct_single', 'sync_response').writable, true);
});

test('divisorFor folds scale and unit into one canonical-SI divisor', () => {
  // The outlet reports current in mA at scale 0; the meter reports it in A at scale 3. Both must
  // come out in amps, and the existing hand-written parsers agree on both (/1000).
  assert.equal(divisorFor(capabilityFor('pc_outlet', 'cur_current')), 1000);
  assert.equal(divisorFor(capabilityFor('cz_ct_single', 'cur_current1')), 1000);
  assert.equal(divisorFor(capabilityFor('pc_outlet', 'cur_power')), 10);
  assert.equal(divisorFor(capabilityFor('pc_outlet', 'cur_voltage')), 10);
  // The outlet energy fault: add_ele is scale 3, so /1000 — the live parser divides by 100.
  assert.equal(divisorFor(capabilityFor('pc_outlet', 'add_ele')), 1000);
  assert.equal(divisorFor(capabilityFor('cz_ct_single', 'add_ele1')), 100);
  assert.equal(divisorFor(capabilityFor('cz_ct_single', 'today_acc_energy1')), 1000);
  assert.equal(divisorFor(capabilityFor('cz_ct_single', 'warn_power1')), 1);
  assert.equal(divisorFor(capabilityFor('cz_ct_single', 'today_energy_add1')), 100);
});

test('add_ele is an increment, today_acc_energy is cumulative', () => {
  // This distinction is the whole point of `semantic`: assigning an increment to a cumulative
  // field is precisely the live fault in the outlet parser.
  assert.equal(capabilityFor('pc_outlet', 'add_ele').semantic, 'increment');
  assert.equal(capabilityFor('cz_ct_single', 'add_ele1').semantic, 'increment');
  assert.equal(capabilityFor('cz_ct_single', 'today_acc_energy1').semantic, 'cumulative_daily');
  assert.equal(capabilityFor('cz_ct_single', 'total_energy1').semantic, 'cumulative_total');
  assert.equal(capabilityFor('pc_outlet', 'cur_power').semantic, 'instant');
});

test('decodeDps scales known dps and ignores the rest', () => {
  // Real values, read off co3 on 2026-09-02.
  const decoded = decodeDps('pc_outlet', {
    1: true, 2: true, 17: 8, 18: 526, 19: 748, 20: 2270, 41: false, 999: 'unknown',
  });
  assert.equal(decoded.switch_1, true);
  assert.equal(decoded.cur_current, 0.526);
  assert.equal(decoded.cur_power, 74.8);
  assert.equal(decoded.cur_voltage, 227);
  assert.equal(decoded.add_ele, 0.008);
  assert.equal(decoded.child_lock, false);
  assert.equal(Object.hasOwn(decoded, '999'), false, 'unknown dps are dropped, not passed through');
});

test('decodeDps accepts string dps keys, which is how the wire delivers them', () => {
  const decoded = decodeDps('cz_ct_double', { '115': 0, '117': 2256, '123': 40421923 });
  assert.equal(decoded.cur_power2, 0);
  assert.equal(decoded.cur_voltage2, 225.6);
  assert.equal(decoded.all_energy, 40421.923);
});

test('decodeDps omits absent values rather than zeroing them', () => {
  const decoded = decodeDps('pc_outlet', { 19: 0 });
  assert.equal(decoded.cur_power, 0, 'a real zero survives');
  assert.equal(Object.hasOwn(decoded, 'cur_voltage'), false, 'an absent dp is absent, not 0');
});

test('channelCodesFor resolves a logical meter to its own channel', () => {
  // One physical double meter is two logical devices in the registry. Which dps belong to which
  // is the thing that would silently swap two branch circuits if it were wrong.
  assert.equal(channelCodesFor('cz_ct_double', 2).cur_power, 'cur_power2');
  assert.equal(channelCodesFor('cz_ct_double', 1).total_energy, 'total_energy1');
  assert.equal(channelCodesFor('cz_ct_single', 1).today_acc_energy, 'today_acc_energy1');
});

test('every registry device resolves to a profile, or declares it has none', () => {
  // Classes that speak dps MUST name a profile. `null` is reserved for the two devices that
  // genuinely have none — the IR blaster and the ambient sensor, both read from flow context —
  // so an enrolled device arriving without one fails here rather than silently rendering blank.
  const DPS_CLASSES = ['outlet_dual', 'switch', 'meter'];

  for (const device of DEVICE_REGISTRY) {
    const profile = profileFor(device);
    if (device.capability_profile == null) {
      assert.equal(profile, null, `${device.id}: no profile declared, none resolved`);
      assert.ok(
        !DPS_CLASSES.includes(device.class),
        `${device.id}: class ${device.class} speaks dps and must name a capability_profile`,
      );
      continue;
    }
    assert.ok(profile, `${device.id}: declares ${device.capability_profile}, which does not exist`);
    if (profile.channels > 1) {
      assert.ok([1, 2].includes(device.channel), `${device.id}: multi-channel profile needs a channel`);
    }
  }
});

test('capability_profile and dps_map agree about which dps a device reads', () => {
  // The two encodings of the same fact must not drift. `DPS_MAPS` is the older, narrower one and
  // is still what the enrolment code generator emits, so a device whose profile says channel 2
  // while its dps_map says channel 1 would read the wrong branch circuit — silently, and on the
  // half of the fleet that bills.
  const DPS_MAP_POWER_DP = { type_a: 105, type_b: 19, type_c: 115 };

  for (const device of DEVICE_REGISTRY) {
    const profile = profileFor(device);
    if (!profile || !device.dps_map) continue;
    const expected = DPS_MAP_POWER_DP[device.dps_map];
    const codes = channelCodesFor(profile.id, device.channel ?? 1);
    const powerCode = codes.cur_power ?? 'cur_power';
    const actual = capabilityFor(profile.id, powerCode)?.dp;
    assert.equal(actual, expected, `${device.id}: dps_map ${device.dps_map} expects power on dp ${expected}, profile says ${actual}`);
  }
});

test('the profiles record whether the vendor offers a standard instruction set', () => {
  // Measured: /v1.0/devices/{id}/specifications answers for tdq and pc, and refuses for cz with
  // `code 2009: not support this device`. That refusal is WHY the meters are mapped by dp, and
  // it is the fact the dispatch path keys off when choosing how to address a device.
  assert.equal(CAPABILITY_PROFILES.tdq_switch.standard_instruction, true);
  assert.equal(CAPABILITY_PROFILES.pc_outlet.standard_instruction, true);
  assert.equal(CAPABILITY_PROFILES.cz_ct_single.standard_instruction, false);
  assert.equal(CAPABILITY_PROFILES.cz_ct_double.standard_instruction, false);
});

test('relay_status decodes to one value whichever vocabulary the wire uses', () => {
  // Measured: /specifications returns "0" for the light switch, the thing model and shadow
  // return "off", and the outlet's standard set says "power_off". The local protocol is a third
  // path nobody has read yet. All of them must land on the same value.
  for (const wire of ['0', 0, 'off', 'power_off']) {
    assert.equal(decodeDps('tdq_switch', { 38: wire }).relay_status, 'off', `tdq wire=${wire}`);
    assert.equal(decodeDps('pc_outlet', { 38: wire }).relay_status, 'off', `pc wire=${wire}`);
  }
  assert.equal(decodeDps('pc_outlet', { 38: 'last' }).relay_status, 'memory');
  assert.equal(decodeDps('tdq_switch', { 38: '2' }).relay_status, 'memory');
});

test('an unrecognised enum value passes through rather than becoming undefined', () => {
  // A firmware that adds a fourth power-on mode must show up as itself, not vanish.
  assert.equal(decodeDps('tdq_switch', { 38: 'brand_new_mode' }).relay_status, 'brand_new_mode');
});

test('both meter channels report idleness as the same word', () => {
  // Channel 1 spells it `close`, channel 2 spells it `idle`, on one physical device.
  assert.equal(decodeDps('cz_ct_double', { 103: 'close' }).device_state1, 'idle');
  assert.equal(decodeDps('cz_ct_double', { 113: 'idle' }).device_state2, 'idle');
  assert.equal(decodeDps('cz_ct_double', { 103: 'working' }).device_state1, 'working');
});
