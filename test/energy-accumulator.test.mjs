import test from 'node:test';
import assert from 'node:assert/strict';
import { runEnergyAccumulator } from '../node-red-bridge/energyAccumulator.mjs';

/**
 * The week/month accumulator, EXECUTED rather than pattern-matched — same discipline as
 * `energy-day-base.test.mjs`, and for the same reason: what ships is a source string injected
 * into a Node-RED function node, so a test that greps it proves nothing about what it does.
 *
 * Two faults are pinned here, both measured on the live bridge on 2026-09-08.
 */

const OFFSET = 480; // UTC+8, this site
const MAX_KW = 25;  // SITE.telemetry_bounds.power_w.max / 1000

/** Local wall-clock -> epoch ms, so the fixtures read as the times they actually were. */
const at = (localIso) => Date.parse(localIso + '+08:00');

const run = (store, rows, localIso) =>
  runEnergyAccumulator(store, rows, at(localIso), OFFSET, MAX_KW);

const one = (id, kwh) => [{ device_id: id, energy_kwh_today: kwh }];

/** Wall-clock derived figures are not exact; this is the tolerance used across the bridge. */
const KWH_EPSILON = 1e-4;
const near = (actual, expected, what) =>
  assert.ok(
    Math.abs(actual - expected) < KWH_EPSILON,
    `${what}: expected ~${expected}, got ${actual}`,
  );

test('accrues the day from bounded increments', () => {
  const s = {};
  run(s, one('m', 0.100), '2026-09-08T08:00:00');
  run(s, one('m', 0.150), '2026-09-08T09:00:00');
  near(s.enacc_m.banked, 0.150, 'banked');
  assert.equal(s.enacc_m.weekBase, 0);
  assert.equal(s.enacc_m.monthBase, 0);
});

test('first sight of a device adopts its current figure, so a mid-day deploy loses no morning', () => {
  const s = {};
  run(s, one('m', 0.750), '2026-09-08T14:00:00');
  near(s.enacc_m.banked, 0.750, 'banked');
});

test('a completed day folds into the week and month', () => {
  const s = {};
  run(s, one('m', 0.400), '2026-09-08T08:00:00');
  run(s, one('m', 1.900), '2026-09-08T20:00:00');
  run(s, one('m', 0.000), '2026-09-09T00:01:00');
  near(s.enacc_m.weekBase, 1.900, 'weekBase');
  near(s.enacc_m.monthBase, 1.900, 'monthBase');
  assert.equal(s.enacc_m.banked, 0);
});

// ---------------------------------------------------------------------------
// Fault 1 — the reported one. An offset the counter acquired mid-day was banked whole.
// ---------------------------------------------------------------------------

test('a counter that jumps faster than the branch can draw does not enter the week or month', () => {
  // Measured on mtr_lo_yellow, 2026-09-08: the channel-2 register was baselined correctly at
  // local midnight, climbed to 0.111 kWh, then read 67.391 at 02:36 local while the circuit
  // drew 49.1 W, and 77.317 ten minutes later. `energy_day_base` was repaired at 10:00, which
  // dropped the published figure back to 0.301 — and THAT drop is what the old accumulator
  // read as "counter went backwards, bank what it reached", folding 77.502 kWh into both
  // bases. The week then read 79.278 kWh against a real 1.5, an 80% share of a four-branch
  // split, and unlike a bad daily figure it never self-heals.
  const s = {};
  run(s, one('lo_yel', 0.111), '2026-09-08T02:00:00');
  run(s, one('lo_yel', 67.391), '2026-09-08T02:36:00');
  run(s, one('lo_yel', 77.317), '2026-09-08T02:46:00');

  assert.equal(s.enacc_lo_yel.weekBase, 0, 'a jump must not bank mid-day');
  near(s.enacc_lo_yel.banked, 0.111, 'banked must still be the morning it really drew');

  // The correction lands. It must neither bank the offset nor double-count the morning.
  run(s, one('lo_yel', 0.301), '2026-09-08T10:00:00');
  assert.equal(s.enacc_lo_yel.weekBase, 0, 'a correction is not consumption');
  near(s.enacc_lo_yel.banked, 0.301, 'the corrected figure is now the day');

  // The rest of the day accrues normally and folds at midnight — the whole day, and only it.
  run(s, one('lo_yel', 0.900), '2026-09-08T18:00:00');
  run(s, one('lo_yel', 0.002), '2026-09-09T00:01:00');
  near(s.enacc_lo_yel.weekBase, 0.900, 'the folded day is the real one');
  near(s.enacc_lo_yel.monthBase, 0.900, 'and the month agrees');
});

test('the jump is refused at the midnight fold too, and the real increments on top survive', () => {
  // Nobody repairs it; the day simply ends. Note what must NOT happen alongside: the register
  // kept incrementing correctly on top of its bogus offset, and those increments are real
  // electricity. Refusing the offset must not also refuse them.
  const s = {};
  run(s, one('lo_yel', 0.111), '2026-09-08T02:00:00');
  run(s, one('lo_yel', 67.391), '2026-09-08T02:36:00'); // offset — refused
  run(s, one('lo_yel', 77.317), '2026-09-08T02:46:00'); // offset — refused
  run(s, one('lo_yel', 77.502), '2026-09-08T02:56:00'); // 0.185 kWh in 10 min — real, kept
  run(s, one('lo_yel', 0.000), '2026-09-09T00:01:00');
  near(s.enacc_lo_yel.weekBase, 0.296, 'the morning plus the genuine increments, and nothing else');
});

test('a genuine mid-day counter reset still banks what the device really drew', () => {
  // The rule this replaces existed for a real case, and that case must keep working.
  const s = {};
  run(s, one('m', 1.000), '2026-09-08T08:00:00');
  run(s, one('m', 3.000), '2026-09-08T09:00:00');
  run(s, one('m', 0.020), '2026-09-08T09:30:00'); // device rebooted, register cleared
  near(s.enacc_m.weekBase, 2.980, 'the completed run is banked, not lost');
  near(s.enacc_m.monthBase, 2.980, 'month too');
  run(s, one('m', 0.520), '2026-09-08T10:30:00');
  // What the browser is served: weekBase + the published daily figure.
  near(s.enacc_m.weekBase + 0.520, 3.500, 'the published week spans the reset');
});

// ---------------------------------------------------------------------------
// Fault 2 — found while tracing fault 1. Two live meters were off by exactly one day.
// ---------------------------------------------------------------------------

test('the last day of a week is not banked into the next week', () => {
  // The old order reset the period keys BEFORE folding the completed day, so Sunday's energy
  // was zeroed out of its own week and then added to Monday's. Measured: mtr_co_yellow's
  // weekBase read 9.720 = Monday's 8.165 + Sunday's 1.555, exactly.
  const s = {};
  run(s, one('m', 0.100), '2026-09-06T12:00:00'); // Sunday
  run(s, one('m', 0.238), '2026-09-06T23:00:00');
  run(s, one('m', 0.000), '2026-09-07T00:01:00'); // Monday — a new ISO week
  assert.equal(s.enacc_m.weekKey, '2026-9-7');
  assert.equal(s.enacc_m.weekBase, 0, "Sunday belongs to the week that just ended");
  near(s.enacc_m.monthBase, 0.238, 'but it is still the same month, so the month keeps it');
});

test('the last day of a month is not banked into the next month', () => {
  const s = {};
  run(s, one('m', 2.000), '2026-08-31T22:00:00');
  run(s, one('m', 0.000), '2026-09-01T00:01:00');
  assert.equal(s.enacc_m.monthKey, '2026-9');
  assert.equal(s.enacc_m.monthBase, 0, 'August 31st is not September');
});

// ---------------------------------------------------------------------------
// Invariants and shapes
// ---------------------------------------------------------------------------

test('banked can never exceed what the branch could have drawn since local midnight', () => {
  // The backstop behind the rate check: every path that adopts an absolute passes through it.
  // First sight is the one path that adopts an absolute with no previous sample to rate-check
  // it against, so this is where the ceiling has to hold.
  const s = {};
  run(s, one('m', 900), '2026-09-08T01:00:00');
  near(s.enacc_m.banked, MAX_KW * 1, 'one hour of the branch maximum, not the 900 it claimed');
});

test('an accumulator stored by an older build keeps its bases and adopts its day', () => {
  const s = { enacc_m: { lastToday: 0.400, weekBase: 5.000, monthBase: 12.000, weekKey: '2026-9-7', monthKey: '2026-9', dayKey: '2026-9-8' } };
  run(s, one('m', 0.450), '2026-09-08T09:00:00');
  near(s.enacc_m.weekBase, 5.000, 'weekBase survives the upgrade');
  near(s.enacc_m.monthBase, 12.000, 'monthBase survives the upgrade');
  near(s.enacc_m.banked, 0.400, 'the day already counted is adopted, not restarted at zero');
});

test('ignores the building totals row and anything without a numeric daily figure', () => {
  const s = {};
  run(s, [
    { device_id: '_totals', energy_kwh_today: 40 },
    { device_id: 'a', energy_kwh_today: null },
    { device_id: 'b', energy_kwh_today: 'x' },
    { device_id: 'c', energy_kwh_today: NaN },
    { device_id: 'd', energy_kwh_today: -1 },
  ], '2026-09-08T09:00:00');
  assert.deepEqual(Object.keys(s), []);
});
