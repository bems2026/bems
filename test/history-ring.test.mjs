/**
 * RM-079 — the history ring buffer, moved out of `build-flow.mjs` so it can be executed.
 *
 * The frontend had to RECONSTRUCT which tick each sample belonged to, because the ring stamped every
 * sample with the device's arrival time: `mtr_lo_red` had 298 intervals of 1-29 s and 347 of 90-129 s
 * in one day (RM-076). A device that stopped reporting carries one arrival stamp on every sample, so
 * nothing downstream could tell those samples apart at all. The ring now writes the tick beside it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAppendHistory } from '../node-red-bridge/historyRing.mjs';

const TICK = Date.parse('2026-09-14T00:54:00.000Z');
const rows = () => [
  { device_id: 'mtr_lo_red', ts: '2026-09-14T08:53:12+08:00', power_w: 19.1, voltage: 228.2, current: 0.576, online: true, measurement_frozen: true },
  { device_id: 'co1', ts: '2026-09-14T08:52:14+08:00', power_w: 106.8, online: false },
  { device_id: 'l1', ts: '2026-09-14T08:53:59+08:00', online: true, state: 'on' },
  { device_id: '_totals', ts: '2026-09-14T08:54:00+08:00', total_power_w: 500 },
];

test('stamps every sample from one tick with that tick, beside each reading’s own time', () => {
  const store = {};
  runAppendHistory(store, rows(), TICK, 1440);
  assert.equal(store.hist_mtr_lo_red[0].sample_ts, '2026-09-14T00:54:00.000Z');
  assert.equal(store.hist_co1[0].sample_ts, '2026-09-14T00:54:00.000Z');
  assert.equal(store.hist_mtr_lo_red[0].ts, '2026-09-14T08:53:12+08:00');
  assert.equal(store.hist_co1[0].ts, '2026-09-14T08:52:14+08:00');
});

test('marks a sample frozen only when the bridge flagged the reading', () => {
  const store = {};
  runAppendHistory(store, rows(), TICK, 1440);
  assert.equal(store.hist_mtr_lo_red[0].frozen, true);
  assert.equal('frozen' in store.hist_co1[0], false);
});

test('still copies online only when it is a real boolean, and omits what a reading did not carry', () => {
  const store = {};
  runAppendHistory(store, rows(), TICK, 1440);
  assert.equal(store.hist_co1[0].online, false);
  assert.equal('voltage' in store.hist_co1[0], false);
  assert.equal('current' in store.hist_co1[0], false);
  runAppendHistory(store, [{ device_id: 'co2', ts: 'x', power_w: 5 }], TICK, 1440);
  assert.equal('online' in store.hist_co2[0], false);
});

test('skips a row with no power and the building totals row', () => {
  const store = {};
  runAppendHistory(store, rows(), TICK, 1440);
  assert.equal(store.hist_l1, undefined);
  assert.equal(store.hist__totals, undefined);
});

test('keeps no more than the cap, dropping the oldest', () => {
  const store = {};
  for (let i = 0; i < 5; i++) runAppendHistory(store, [{ device_id: 'co1', ts: `t${i}`, power_w: i }], TICK + i * 60_000, 3);
  assert.deepEqual(store.hist_co1.map((p) => p.power_w), [2, 3, 4]);
});
