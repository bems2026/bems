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
import { runValueFreezeTracker } from '../node-red-bridge/valueFreezeTracker.mjs';

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
