/**
 * RM-079 — when each metered device's measurement last MOVED, as opposed to when it last arrived.
 *
 * L.O Red repeated 19.1 W / 228.2 V / 0.576 A for fifteen hours on 2026-09-12 while reporting online,
 * because it kept sending messages. `arrivalTracker.mjs` could not see that — its signature includes
 * the sample-buffer depth, which moves on every message — so this is a second, narrower signature:
 * the three measured values alone. What ships is the string, so these tests execute it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runValueFreezeTracker, runValueFreezeTrackerFull } from '../node-red-bridge/valueFreezeTracker.mjs';

const reading = (p, over = {}) => ({ v: '228.2', c: '0.576', p, e: '0.3000', n: 1, h: true, ...over });
const snapshot = (energy = {}, outlet = {}) => ({ energy: { meters: energy }, outlet: { meters: outlet } });

test('stamps when a meter last changed, not when the tracker last ran', () => {
  const store = {};
  runValueFreezeTracker(store, snapshot({ lo_red: reading('19.1') }), 1_000);
  assert.equal(runValueFreezeTracker(store, snapshot({ lo_red: reading('19.1') }), 61_000).lo_red, 1_000);
  assert.equal(runValueFreezeTracker(store, snapshot({ lo_red: reading('13.3') }), 121_000).lo_red, 121_000);
});

test('does not move the stamp however often it is read — RM-056 was a clock that followed the reader', () => {
  const store = {};
  let since;
  for (let i = 0; i < 100; i++) since = runValueFreezeTracker(store, snapshot({ lo_red: reading('19.1') }), 1_000 + i * 2_000).lo_red;
  assert.equal(since, 1_000);
});

test('ignores the sample-buffer depth and the energy accumulator, which both move while a reading is frozen', () => {
  const store = {};
  runValueFreezeTracker(store, snapshot({ lo_red: reading('19.1', { n: 1, e: '0.3000' }) }), 1_000);
  const later = runValueFreezeTracker(store, snapshot({ lo_red: reading('19.1', { n: 7, e: '0.3100' }) }), 600_000);
  assert.equal(later.lo_red, 1_000);
});

test('a change in voltage or current alone counts as the measurement moving', () => {
  const store = {};
  runValueFreezeTracker(store, snapshot({ lo_red: reading('19.1') }), 1_000);
  assert.equal(runValueFreezeTracker(store, snapshot({ lo_red: reading('19.1', { v: '228.3' }) }), 2_000).lo_red, 2_000);
  assert.equal(runValueFreezeTracker(store, snapshot({ lo_red: reading('19.1', { v: '228.3', c: '0.577' }) }), 3_000).lo_red, 3_000);
});

test('tracks the outlets as well as the energy meters, each by its own key', () => {
  const store = {};
  runValueFreezeTracker(store, snapshot({ lo_red: reading('19.1') }, { co1: reading('106.8') }), 1_000);
  const later = runValueFreezeTracker(store, snapshot({ lo_red: reading('19.2') }, { co1: reading('106.8') }), 5_000);
  assert.deepEqual(later, { lo_red: 5_000, co1: 1_000 });
});

test('starts counting afresh when its context was wiped, rather than inventing a freeze', () => {
  // A Node-RED restart without file-backed context loses the store. The honest reading of "no
  // evidence yet" is that the values have been still for zero time, not for as long as they look.
  assert.equal(runValueFreezeTracker({}, snapshot({ lo_red: reading('19.1') }), 9_000).lo_red, 9_000);
});

/**
 * RM-133 — the register clock. On 2026-09-22 the yellow meter's channel 2 froze at 07:47:44 (39.8 W /
 * 0.446 A and its own `today_acc_energy2` held for hours while the lights on that circuit were off),
 * and from 10:58 its voltage dp began following channel 1's — the voltage is one measurement shared
 * by both channels — which reset the v/c/p clock every minute. A shared voltage is not evidence
 * that a clamp is measuring. The register is: a channel drawing power must move its own counter.
 */
const dp2 = (acc, total = 80791.183) => ({ today_acc_energy2: acc, total_energy2: total, all_energy: 144984.57 });

test('stamps when a meter\'s own energy registers last moved, separately from its values', () => {
  const store = {};
  runValueFreezeTrackerFull(store, snapshot({ lo_yel2: reading('39.8', { dp: dp2(25523.556) }) }), 1_000);
  const held = runValueFreezeTrackerFull(store, snapshot({ lo_yel2: reading('39.8', { v: '214.5', dp: dp2(25523.556) }) }), 61_000);
  assert.equal(held.valueSince.lo_yel2, 61_000, 'the voltage moved, so the value clock restarts');
  assert.equal(held.registerSince.lo_yel2, 1_000, 'but the register did not, so its clock stands');
  const moved = runValueFreezeTrackerFull(store, snapshot({ lo_yel2: reading('39.8', { v: '214.5', dp: dp2(25523.557) }) }), 121_000);
  assert.equal(moved.registerSince.lo_yel2, 121_000);
});

/**
 * RM-136, 2026-09-22 15:38. L.O Yellow sat at 0 W from 14:21 with its register rightly still; the lights
 * came on at 15:38 at 41.9 W and the FIRST loaded sample was flagged frozen, because the register clock had
 * been running since the register last moved hours earlier, and "41.9 W for two hours owes 0.08 kWh".
 * A channel drawing nothing owes its register nothing, so the clock starts when the load does.
 */
test('the register clock does not run while the channel draws nothing — it starts when the load does', () => {
  const store = {};
  runValueFreezeTrackerFull(store, snapshot({ lo_yel2: reading('0', { c: '0', dp: dp2(25523.558) }) }), 1_000);
  const idle = runValueFreezeTrackerFull(store, snapshot({ lo_yel2: reading('0', { c: '0', v: '214.2', dp: dp2(25523.558) }) }), 4_600_000);
  assert.equal(idle.registerSince.lo_yel2, 4_600_000, 'at 0 W the register is not expected to move, so the clock keeps restarting');
  const on = runValueFreezeTrackerFull(store, snapshot({ lo_yel2: reading('41.9', { c: '0.427', v: '228.7', dp: dp2(25523.558) }) }), 4_660_000);
  assert.equal(on.registerSince.lo_yel2, 4_600_000, 'the lights came on after the last idle sample; they owe nothing yet');
  const held = runValueFreezeTrackerFull(store, snapshot({ lo_yel2: reading('41.9', { c: '0.427', v: '228.7', dp: dp2(25523.558) }) }), 6_460_000);
  assert.equal(held.registerSince.lo_yel2, 4_600_000, 'and while loaded the clock stands until the register moves');
});

test('the shared all_energy register does not count — it moves with the other channel', () => {
  const store = {};
  runValueFreezeTrackerFull(store, snapshot({ lo_yel2: reading('39.8', { dp: dp2(25523.556) }) }), 1_000);
  const r = runValueFreezeTrackerFull(store, snapshot({ lo_yel2: reading('39.8', { dp: { ...dp2(25523.556), all_energy: 144990.0 } }) }), 61_000);
  assert.equal(r.registerSince.lo_yel2, 1_000);
});

test('a device with no register dps gets no register clock, so nothing can call it stalled', () => {
  const store = {};
  const r = runValueFreezeTrackerFull(store, snapshot({}, { co1: reading('35.8', { dp: { cur_power: 35.8, add_ele: 0.01 } }) }), 1_000);
  assert.equal('co1' in r.registerSince, false);
  assert.equal(r.valueSince.co1, 1_000);
});
