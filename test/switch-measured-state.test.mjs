/**
 * A switch's `state` is what the RELAY is doing, not what was last asked of it.
 *
 * WHY (FI-023, found 2026-09-03). `bems_lights_state` is written by the flow's `Lighting Logic
 * Hub`, which sets `state[msg.topic] = Boolean(val)` from an incoming COMMAND and then forwards
 * it to the device. Nothing ever writes back what the relay actually did. So the field the whole
 * app reads as a light's state is the last thing this system ASKED FOR.
 *
 * It went wrong exactly as that implies. On the morning of 2026-09-03 the dashboard showed all
 * seven office lights off while the devices reported all seven on — confirmed independently by
 * the vendor cloud, which reaches them over the internet rather than the local subnet. The
 * primary display of a building energy management system was reporting seven circuits as off
 * while they were on, and had no mechanism that could ever have noticed.
 *
 * The measured state was already there. `Collect status` has always maintained
 * `global.lightStatus[<n>].on` from `dps['1']`; `buildLatest` read only `.conn` from that same
 * entry. This makes it read `.on` too, and keeps the commanded value as the fallback for a flow
 * or a mock that has no lightStatus at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLatest } from '../shared/buildLatest.mjs';
import { DEVICE_REGISTRY, PHASE_MAP, STALE_AFTER_MS_BY_CLASS } from '../shared/registry.mjs';

const NOW = 1786000000000;

const snap = ({ commanded = {}, health = {} } = {}) => ({
  energy: { meters: {}, totals: {} },
  outlet: { meters: {}, state: { status: {} } },
  switch: { state: commanded, health },
  aircon: { state: {} },
});

const rowOf = (s, id) =>
  buildLatest(s, DEVICE_REGISTRY, PHASE_MAP, NOW, undefined, STALE_AFTER_MS_BY_CLASS)
    .find((r) => r.device_id === id);

test('the device wins when it disagrees with what was commanded', () => {
  // The exact shape of the 2026-09-03 fault: commanded off, relay on.
  const r = rowOf(snap({
    commanded: { L1: false },
    health: { 1: { conn: 'CONNECTED', on: true } },
  }), 'l1');
  assert.equal(r.state, 'on');
});

test('and in the other direction — commanded on, relay off', () => {
  // A command that never landed must not keep reading as success.
  const r = rowOf(snap({
    commanded: { L1: true },
    health: { 1: { conn: 'CONNECTED', on: false } },
  }), 'l1');
  assert.equal(r.state, 'off');
});

test('when they agree, nothing changes', () => {
  for (const value of [true, false]) {
    const r = rowOf(snap({
      commanded: { L1: value },
      health: { 1: { conn: 'CONNECTED', on: value } },
    }), 'l1');
    assert.equal(r.state, value ? 'on' : 'off');
  }
});

test('the commanded value is still the fallback when nothing measured exists', () => {
  // An older flow, a mock that does not simulate lightStatus, or a switch that has never
  // reported. Falling back is what keeps this from being a regression for them.
  assert.equal(rowOf(snap({ commanded: { L1: true } }), 'l1').state, 'on');
  assert.equal(rowOf(snap({ commanded: { L1: true }, health: { 1: { conn: 'CONNECTED' } } }), 'l1').state, 'on');
  assert.equal(rowOf(snap({ commanded: { L1: false }, health: { 1: { conn: 'CONNECTED' } } }), 'l1').state, 'off');
});

test('a non-boolean `on` is treated as absent, not as truthy', () => {
  // Flow context survives restarts on disk. A half-written or hand-edited entry must fall back
  // to the commanded value rather than coerce a string into a relay position.
  for (const junk of ['on', 1, null, {}]) {
    const r = rowOf(snap({ commanded: { L1: false }, health: { 1: { conn: 'CONNECTED', on: junk } } }), 'l1');
    assert.equal(r.state, 'off', `on=${JSON.stringify(junk)} must not read as measured`);
  }
});

test('an offline switch reports the last thing the DEVICE said, not the last thing we asked', () => {
  // The measured value is stale here, and stale-but-real beats fresh-but-imagined: it is what
  // the relay was doing when we could last see it. `online: false` is what tells the UI how much
  // to trust it, and that is carried separately.
  const r = rowOf(snap({
    commanded: { L1: false },
    health: { 1: { conn: 'DISCONNECTED', on: true } },
  }), 'l1');
  assert.equal(r.online, false);
  assert.equal(r.state, 'on');
});

test('every other class is untouched', () => {
  const rows = buildLatest(
    { ...snap(), outlet: { meters: {}, state: { status: { CO1_1: true, CO1_2: false } } }, aircon: { state: { power: true } } },
    DEVICE_REGISTRY, PHASE_MAP, NOW, undefined, STALE_AFTER_MS_BY_CLASS,
  );
  const co1 = rows.find((r) => r.device_id === 'co1');
  assert.deepEqual(co1.socket_states, { 1: 'on', 2: 'off' });
  assert.equal(co1.state, 'on');
  assert.equal(rows.find((r) => r.device_id === 'acu_main').state, 'on');
  assert.equal(rows.find((r) => r.device_id === 'mtr_lo_red').state, null);
});
