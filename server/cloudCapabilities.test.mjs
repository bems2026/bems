/**
 * Tests for server/cloudCapabilities.mjs — what of a reading's `capabilities` the cloud keeps
 * (RM-148, Stage 3). The archive on the edge keeps all of it; this decides the cloud's copy.
 *
 * Measured 2026-09-29 (E-218): the jsonb was 271 of an average 320 bytes a row, almost all of it
 * settings repeated every minute. The rule comes from the capability catalogue's own `semantic`,
 * so a new product is classified by the same facts its parser is generated from.
 *
 *     node --test server/cloudCapabilities.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cloudCapabilities, readingsForCloud, KEPT_FOR_READERS } from './cloudCapabilities.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { capabilityForDevice } from '../shared/deviceCapabilities.mjs';

const byId = (id) => DEVICE_REGISTRY.find((d) => d.id === id);

test('a light keeps its switch state and nothing it only configures', () => {
  const caps = { switch_1: false, cycle_time: '', countdown_1: 0, random_time: '', switch_type: 'flip', relay_status: 'off', switch_inching: 'AAAC' };
  assert.deepEqual(cloudCapabilities(byId('l1'), caps), { switch_1: false });
});

test('an outlet keeps its sockets and what it measures, not its calibration or settings', () => {
  const caps = {
    add_ele: 0.001, switch_1: true, switch_2: true, test_bit: 2, cur_power: 0, power_coe: 0, child_lock: false,
    cycle_time: '', countdown_1: 0, countdown_2: 0, cur_current: 0, cur_voltage: 226.6, voltage_coe: 0,
    electric_coe: 0, relay_status: 'memory', electricity_coe: 0,
  };
  assert.deepEqual(cloudCapabilities(byId('co1'), caps), { add_ele: 0.001, switch_1: true, switch_2: true, cur_power: 0, cur_current: 0, cur_voltage: 226.6 });
});

test('a dual meter keeps its other channel\'s readings and state, and the system\'s own flags', () => {
  const channelMap = { rule: 'idle', flips: 32, since: '2026-09-29T03:03:05+08:00', assignment: 'direct' };
  const caps = {
    add_ele2: 0.01, all_energy: 286348.554, cur_power2: 0, channel_map: channelMap, cur_current2: 0, cur_voltage2: 226,
    sync_request: 'request', device_state2: 'monitor', sync_response: 'idle', today_acc_energy2: 197.003,
    today_energy_add2: 0.01, power_type2: 'normal', warn_power2: 4000, measurement_frozen: true,
    frozen_since: '2026-09-29T07:00:00+08:00', scrub: { energy: 'reintegrated' },
  };
  assert.deepEqual(cloudCapabilities(byId('mtr_lo_yellow'), caps), {
    add_ele2: 0.01, all_energy: 286348.554, cur_power2: 0, channel_map: channelMap, cur_current2: 0, cur_voltage2: 226,
    device_state2: 'monitor', today_acc_energy2: 197.003, today_energy_add2: 0.01, measurement_frozen: true,
    frozen_since: '2026-09-29T07:00:00+08:00', scrub: { energy: 'reintegrated' },
  });
});

test('the IR hub keeps the room it measures and drops the codes it sends', () => {
  const caps = { temp_current: 27.5, humidity_value: 61, ir_send: 'x'.repeat(200), ir_study_code: 'y'.repeat(200) };
  assert.deepEqual(cloudCapabilities(byId('acu_main'), caps), { temp_current: 27.5, humidity_value: 61 });
});

test('nothing left is null, not an empty object, as readingCapabilities.mjs rules', () => {
  assert.equal(cloudCapabilities(byId('l1'), { cycle_time: '', relay_status: 'off' }), null);
  assert.equal(cloudCapabilities(byId('l1'), null), null);
});

test('a code the catalogue does not know, or a device it does not know, is kept rather than guessed at', () => {
  assert.deepEqual(cloudCapabilities(byId('l1'), { brand_new_dp: 7, cycle_time: '' }), { brand_new_dp: 7 });
  assert.deepEqual(cloudCapabilities({ id: 'unknown' }, { anything: 1 }), { anything: 1 });
  assert.deepEqual(cloudCapabilities(byId('sens_outside_temp'), { anything: 1 }), { anything: 1 });
});

test('every code a scrub tool or the database reads is kept, on every meter', () => {
  // scrubHeldReading reads cur_power/cur_current/cur_voltage/device_state/today_acc_energy by base;
  // scrubMeterSwap reads device_state, add_ele and the channel's live values; all_energy is the
  // meter-wide register. If a later catalogue change reclassified one of these, the scrubs would
  // quietly lose their input in the cloud — so the list is pinned here.
  assert.deepEqual([...KEPT_FOR_READERS].sort(), ['add_ele', 'all_energy', 'cur_current', 'cur_power', 'cur_voltage', 'device_state', 'today_acc_energy']);
  for (const device of DEVICE_REGISTRY.filter((d) => d.class === 'meter')) {
    for (const base of KEPT_FOR_READERS) {
      for (const channel of [1, 2]) {
        const cap = capabilityForDevice({ ...device, channel }, base);
        if (!cap) continue;
        assert.ok(cloudCapabilities(device, { [cap.code]: 1 }), `${device.id} would drop ${cap.code}`);
      }
    }
  }
});

test('the daemon slims readings on the way to the cloud, in the one function both write paths share', async () => {
  // Read from source, like server/testStatePaths.test.mjs: ingest.mjs exits on missing configuration,
  // so it cannot be imported by a test, and a wiring slip here would show only as a full cloud.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./ingest.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('async function sendToCloud('), src.indexOf('async function writeOrBuffer('));
  assert.ok(body.length > 0, 'sendToCloud has moved; the slimming needs a new home');
  assert.match(body, /readingsForCloud\(/, 'sendToCloud must slim readings before they leave');
  assert.match(src, /import \{ readingsForCloud \} from '\.\/cloudCapabilities\.mjs';/);
  assert.doesNotMatch(src.slice(src.indexOf('archive: (batch)'), src.indexOf('archive: (batch)') + 200), /readingsForCloud/,
    'the archive must get the full row, not the slimmed one');
});

test('readingsForCloud slims capabilities only, and leaves the archive\'s rows untouched', () => {
  const row = { device_id: 'l1', ts: '2026-09-29T08:40:00+00:00', online: true, power_w: null, capabilities: { switch_1: true, cycle_time: '' } };
  const [cloud] = readingsForCloud([row]);
  assert.deepEqual(cloud, { ...row, capabilities: { switch_1: true } });
  assert.deepEqual(row.capabilities, { switch_1: true, cycle_time: '' }, 'the input is not mutated');
});
