/**
 * An outlet socket's state is what the RELAY is doing, not what was last asked of it.
 *
 * WHY. This is FI-023 for the class it left out, and the two branches sit adjacent in
 * `buildLatest`: the switch branch prefers `lightStatus[n].on` over the commanded value, and the
 * outlet branch four lines below reads `bems_outlets_state` alone. That map is written by the
 * flow's `Outlet Logic Hub` from an incoming COMMAND before it is forwarded to the device, and
 * nothing ever writes back what the relay did — so it is a record of intent, exactly as
 * `bems_lights_state` was.
 *
 * REPORTED FROM THE BUILDING, 2026-09-07. Pressing a light switch at the wall updates the app;
 * pressing an outlet's own button does not. The operator tested both by hand and the asymmetry is
 * exactly the asymmetry in the code.
 *
 * The measured value was already arriving and being ignored. Every outlet reports real
 * `switch_1` / `switch_2` booleans on `reading.capabilities` on every poll — verified on the live
 * fleet the same day, all seven outlets — because `outletPollPlan` asks for them every 60 s and
 * the device pushes changes in between.
 *
 * Preferred, not required: an older flow whose parser has decoded no dps falls back to the
 * commanded value, which is what keeps this from being a regression for the mock. And the check
 * is `typeof === 'boolean'` rather than truthiness, because flow context survives restarts on
 * disk and a half-written entry must read as absent, not as ON — the same reasoning FI-023
 * records for switches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLatest } from '../shared/buildLatest.mjs';
import { DEVICE_REGISTRY, PHASE_MAP, STALE_AFTER_MS_BY_CLASS } from '../shared/registry.mjs';

const NOW = 1786000000000;

/** `commanded` is `bems_outlets_state.status`; `dp` is what the device itself last reported. */
const snap = ({ commanded = {}, dp = undefined } = {}) => ({
  energy: { meters: {}, totals: {} },
  outlet: {
    meters: { co1: { v: '223.3', c: '0.5', p: '110', e: '1.2', h: true, t: NOW, dp } },
    state: { status: commanded },
  },
  switch: { state: {}, health: {} },
  aircon: { state: {} },
});

const co1 = (s) =>
  buildLatest(s, DEVICE_REGISTRY, PHASE_MAP, NOW, 480, STALE_AFTER_MS_BY_CLASS)
    .find((r) => r.device_id === 'co1');

test('a socket switched at the outlet itself is reported, though nothing commanded it', () => {
  // The reported fault, as one assertion: the app was told OFF, the device says ON.
  const row = co1(snap({
    commanded: { CO1_1: false, CO1_2: false },
    dp: { switch_1: true, switch_2: true },
  }));
  assert.deepEqual(row.socket_states, { 1: 'on', 2: 'on' });
});

test('a socket switched OFF at the outlet is reported too', () => {
  const row = co1(snap({
    commanded: { CO1_1: true, CO1_2: true },
    dp: { switch_1: false, switch_2: false },
  }));
  assert.deepEqual(row.socket_states, { 1: 'off', 2: 'off' });
});

test('each socket is read independently — one pressed, one not', () => {
  // The whole reason this is per-socket: an outlet is two relays behind one label.
  const row = co1(snap({
    commanded: { CO1_1: false, CO1_2: false },
    dp: { switch_1: true, switch_2: false },
  }));
  assert.deepEqual(row.socket_states, { 1: 'on', 2: 'off' });
});

test('with no decoded dps at all it falls back to the commanded value', () => {
  // An older flow, or the mock. Preferring the measured value must not mean requiring it.
  const row = co1(snap({ commanded: { CO1_1: true, CO1_2: false }, dp: undefined }));
  assert.deepEqual(row.socket_states, { 1: 'on', 2: 'off' });
});

test('a dp object that carries no switch codes falls back rather than reading absent as OFF', () => {
  // A telemetry-only packet: volts and watts arrived, relay state did not. Absent is not OFF.
  const row = co1(snap({
    commanded: { CO1_1: true, CO1_2: true },
    dp: { cur_power: 110, cur_voltage: 223.3 },
  }));
  assert.deepEqual(row.socket_states, { 1: 'on', 2: 'on' });
});

test('a non-boolean switch value is treated as absent, not as ON', () => {
  // Flow context survives restarts on disk; a half-written entry must not read as switched on.
  const row = co1(snap({
    commanded: { CO1_1: false, CO1_2: false },
    dp: { switch_1: 'true', switch_2: 1 },
  }));
  assert.deepEqual(row.socket_states, { 1: 'off', 2: 'off' });
});

test('one socket measured and the other absent mixes the two sources per socket', () => {
  const row = co1(snap({
    commanded: { CO1_1: false, CO1_2: true },
    dp: { switch_1: true },
  }));
  assert.deepEqual(row.socket_states, { 1: 'on', 2: 'on' }, 'socket 1 measured, socket 2 commanded');
});

test('the derived whole-outlet state follows the measured sockets', () => {
  // `state` is `s1 || s2` and is what the Devices list and the 3D scene read.
  assert.equal(co1(snap({
    commanded: { CO1_1: true, CO1_2: true },
    dp: { switch_1: false, switch_2: false },
  })).state, 'off');
  assert.equal(co1(snap({
    commanded: { CO1_1: false, CO1_2: false },
    dp: { switch_1: false, switch_2: true },
  })).state, 'on');
});

test('capabilities still ride on the reading — this reads them, it does not consume them', () => {
  const row = co1(snap({ commanded: {}, dp: { switch_1: true, cur_power: 110 } }));
  assert.equal(row.capabilities.switch_1, true);
  assert.equal(row.capabilities.cur_power, 110);
});
