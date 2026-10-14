import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frozenStretches, STILL_AFTER_MS } from './frozenStretches.mjs';

/**
 * RM-163 (2026-10-14). The four CT meters answered the flow's poll for days with identical figures while
 * the site was offline; two sat at 0 W, which the live freeze rule exempts, so their stuck minutes were
 * stored as real. This finds such stretches after the fact: a meter's online readings repeating EVERY
 * measured value (voltage too, which a live circuit never holds) for longer than any healthy stillness.
 */

const T0 = Date.parse('2026-10-08T12:00:00+08:00');
const MIN = 60_000;
const r = (i, over = {}) => ({ ts: new Date(T0 + i * MIN).toISOString(), online: true, voltage: 228 + (i % 7) / 10,
  current: 0.4, power_w: 40, energy_kwh_today: 0.1 + i / 1000, total_energy_kwh: 50 + i / 1000, ...over });
const held = (i) => r(i, { voltage: 227.8, current: 0, power_w: 0, energy_kwh_today: 0.001, total_energy_kwh: 51.2 });

test('the threshold sits above the longest healthy stillness measured (535 min on L.O Red)', () => {
  assert.ok(STILL_AFTER_MS > 535 * MIN);
  assert.equal(STILL_AFTER_MS, 12 * 60 * MIN);
});

test('a reading repeated for 13 hours is one stretch, from the minute after the last real value', () => {
  const rows = [r(0), r(1), ...Array.from({ length: 13 * 60 + 1 }, (_, k) => held(2 + k)), r(2 + 13 * 60 + 1)];
  const [s, ...rest] = frozenStretches(rows);
  assert.equal(rest.length, 0);
  assert.equal(s.frozenSince, rows[2].ts, 'the first held reading was itself a real measurement');
  assert.equal(s.fromTs, rows[3].ts, 'flagging starts at the first repeat');
  assert.equal(s.toTs, rows[2 + 13 * 60].ts);
  assert.equal(s.rows, 13 * 60);
});

test('eight hours of stillness is not a freeze — healthy meters have held that long', () => {
  const rows = [r(0), ...Array.from({ length: 8 * 60 }, (_, k) => held(1 + k)), r(8 * 60 + 1)];
  assert.deepEqual(frozenStretches(rows), []);
});

test('a single changed value ends the stretch', () => {
  const rows = [...Array.from({ length: 7 * 60 }, (_, k) => held(k)), r(7 * 60, { voltage: 228.1, current: 0, power_w: 0, energy_kwh_today: 0.001, total_energy_kwh: 51.2 }),
    ...Array.from({ length: 7 * 60 }, (_, k) => held(7 * 60 + 1 + k))];
  assert.deepEqual(frozenStretches(rows), []);
});

test('offline minutes neither break nor extend a stretch; a missing value breaks it', () => {
  const offlineGap = [...Array.from({ length: 7 * 60 }, (_, k) => held(k)), r(7 * 60, { online: false, voltage: null }),
    ...Array.from({ length: 6 * 60 }, (_, k) => held(7 * 60 + 1 + k))];
  assert.equal(frozenStretches(offlineGap).length, 1);
  const nullGap = [...Array.from({ length: 7 * 60 }, (_, k) => held(k)), r(7 * 60, { voltage: null }),
    ...Array.from({ length: 6 * 60 }, (_, k) => held(7 * 60 + 1 + k))];
  assert.deepEqual(frozenStretches(nullGap), []);
});

test('the threshold is a parameter, so step 6 can tighten it once the meters report live', () => {
  const rows = Array.from({ length: 3 * 60 + 1 }, (_, k) => held(k));
  assert.deepEqual(frozenStretches(rows), []);
  assert.equal(frozenStretches(rows, { stillAfterMs: 2 * 60 * MIN }).length, 1);
});
