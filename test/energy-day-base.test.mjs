/**
 * Guards the per-meter day baseline — what makes a CT meter's `today_acc_energy` counter mean
 * "today" whether or not the DEVICE agrees that a day has ended.
 *
 * WHY THIS EXISTS, measured on the live meter 2026-09-03. One physical dual-channel meter backs
 * two logical devices. Its channel-1 register resets at midnight and read 3.477 kWh. Its
 * channel-2 register does NOT reset: it read 3625.021 kWh and was incrementing correctly on top
 * of that offset. `buildLatest` published the raw figure, so L.O Yellow — a ~120 W circuit that
 * averages 4% of the building — appeared as a 3,625 kWh burst, and `enacc_mtr_lo_yellow` had
 * already banked 3625.011 ready to fold into the week at the next local midnight.
 *
 * A daily counter is therefore not trustworthy as an ABSOLUTE. It is trustworthy as an
 * INCREMENT, and this tracker supplies the subtrahend.
 *
 * Executed rather than pattern-matched, for the same reason as `arrival-tracker.test.mjs`: what
 * ships is a source string injected into a Node-RED function node, so running it is the only
 * honest way to know what it does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runEnergyDayBase, energyDayBaseSrc } from '../node-red-bridge/energyDayBase.mjs';
import { buildLatest } from '../shared/buildLatest.mjs';
import { DEVICE_REGISTRY, PHASE_MAP, STALE_AFTER_MS_BY_CLASS } from '../shared/registry.mjs';

const OFFSET = 480;
/** 2026-09-03 11:26 local (+08:00). */
const NOON = Date.parse('2026-09-03T03:26:00Z');
const NEXT_DAY = Date.parse('2026-09-04T01:00:00Z');

/** A meter as the energy collector emits it: `e` integrated from watts, `dp` the decoded caps. */
const meter = (over = {}) => ({ n: 3, v: '223.5', c: '1.237', p: '119.6', e: '0.825', h: true, ...over });

const snapOf = (meters) => ({ energy: { meters } });

test('the first sight of a counter anchors so the published figure is continuous', () => {
  // Switching a device's energy source must not make today's consumption jump or vanish. The
  // baseline is seeded from the integrated value we were already serving, so the very first
  // reading after deploy equals what the previous reading said.
  const store = {};
  const base = runEnergyDayBase(store, snapOf({
    lo_yel2: meter({ e: '0.825', dp: { today_acc_energy2: 3625.021 } }),
  }), NOON, OFFSET);
  assert.equal(base.lo_yel2.today_acc_energy2, 3625.021 - 0.825);
});

test('a counter that never resets yields the increment since the day started, not its offset', () => {
  // The measured L.O Yellow case. 3625.021 -> 3625.081 over the sampling window is 0.06 kWh of
  // real consumption; the 3,625 is an offset the device never clears.
  const store = {};
  runEnergyDayBase(store, snapOf({
    lo_yel2: meter({ e: '0.825', dp: { today_acc_energy2: 3625.021 } }),
  }), NOON, OFFSET);
  const base = runEnergyDayBase(store, snapOf({
    lo_yel2: meter({ e: '0.885', dp: { today_acc_energy2: 3625.081 } }),
  }), NOON, OFFSET);
  // The anchor does not move on a rising counter.
  assert.equal(base.lo_yel2.today_acc_energy2, 3625.021 - 0.825);
  assert.ok(Math.abs((3625.081 - base.lo_yel2.today_acc_energy2) - 0.885) < 1e-9);
});

test('a counter that jumps backwards re-baselines rather than emitting a negative', () => {
  // A device-side daily reset, or a reboot. Whatever it does, today's figure may not go below
  // zero — a negative kWh is not a reading, it is a bug wearing one.
  const store = {};
  runEnergyDayBase(store, snapOf({
    co_yel: meter({ e: '3.346', dp: { today_acc_energy1: 3.477 } }),
  }), NOON, OFFSET);
  const base = runEnergyDayBase(store, snapOf({
    co_yel: meter({ e: '3.346', dp: { today_acc_energy1: 0.004 } }),
  }), NOON, OFFSET);
  assert.ok(0.004 - base.co_yel.today_acc_energy1 >= 0);
});

test('a new local day re-anchors, so yesterday is not carried into today', () => {
  const store = {};
  runEnergyDayBase(store, snapOf({
    lo_yel2: meter({ e: '0.825', dp: { today_acc_energy2: 3625.021 } }),
  }), NOON, OFFSET);
  const base = runEnergyDayBase(store, snapOf({
    lo_yel2: meter({ e: '0.010', dp: { today_acc_energy2: 3627.400 } }),
  }), NEXT_DAY, OFFSET);
  assert.ok(Math.abs((3627.4 - base.lo_yel2.today_acc_energy2) - 0.010) < 1e-9);
});

test('a meter the parser has not decoded yet is skipped, not crashed on', () => {
  const store = {};
  const base = runEnergyDayBase(store, snapOf({ arec: meter({ dp: undefined }) }), NOON, OFFSET);
  assert.deepEqual(base.arec, undefined);
});

test('the day boundary is the site offset, not UTC', () => {
  // 2026-09-03T16:30Z is 2026-09-04 00:30 at +08:00. A UTC boundary would still call it the 3rd
  // and fold four and a half hours of the new day into the old one.
  const store = {};
  runEnergyDayBase(store, snapOf({
    lo_yel2: meter({ e: '5.000', dp: { today_acc_energy2: 3630.0 } }),
  }), Date.parse('2026-09-03T15:00:00Z'), OFFSET);
  const before = store.energy_day_base.lo_yel2.dayKey;
  runEnergyDayBase(store, snapOf({
    lo_yel2: meter({ e: '0.010', dp: { today_acc_energy2: 3630.1 } }),
  }), Date.parse('2026-09-03T16:30:00Z'), OFFSET);
  assert.notEqual(store.energy_day_base.lo_yel2.dayKey, before);
});

test('the injected source is what the tests run, and carries the site offset', () => {
  const src = energyDayBaseSrc(OFFSET);
  assert.match(src, /flow\.set\('energy_day_base'/);
  assert.match(src, /energyDayBase/);
  assert.ok(src.includes(`${OFFSET} * 60000`), 'the offset must be substituted, not read at run time');
});

// --- buildLatest, reading the baseline -------------------------------------------------------

const withMeters = (meters, dayBase) => ({
  energy: { meters, totals: {} },
  outlet: { meters: {}, state: {} },
  switch: { state: {} },
  aircon: { state: {} },
  arrivals: Object.fromEntries(Object.keys(meters).map((k) => [k, NOON])),
  energyDayBase: dayBase,
});

const rowOf = (snap, id, maxDaily) =>
  buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, NOON, OFFSET, STALE_AFTER_MS_BY_CLASS, maxDaily)
    .find((r) => r.device_id === id);

test('an unresetting counter is published as its daily increment, not its raw value', () => {
  const row = rowOf(withMeters(
    { lo_yel2: meter({ e: '0.825', dp: { today_acc_energy2: 3625.021 } }) },
    { lo_yel2: { today_acc_energy2: 3624.196 } },
  ), 'mtr_lo_yellow');
  assert.ok(row.energy_kwh_today < 1, `expected a sane daily figure, got ${row.energy_kwh_today}`);
  assert.ok(Math.abs(row.energy_kwh_today - 0.825) < 1e-6);
});

test('the channel suffix still selects the right register', () => {
  // One physical meter, two logical devices. Taking the wrong channel attributes one branch
  // circuit's consumption to another — the fault `shared/channelSwap.mjs` exists for.
  const dp = { today_acc_energy1: 3.477, today_acc_energy2: 3625.021 };
  const snap = withMeters(
    { co_yel: meter({ e: '3.346', dp }), lo_yel2: meter({ e: '0.825', dp }) },
    { co_yel: { today_acc_energy1: 0.131 }, lo_yel2: { today_acc_energy2: 3624.196 } },
  );
  assert.ok(Math.abs(rowOf(snap, 'mtr_co_yellow').energy_kwh_today - 3.346) < 1e-6);
  assert.ok(Math.abs(rowOf(snap, 'mtr_lo_yellow').energy_kwh_today - 0.825) < 1e-6);
});

test('a figure beyond the plausibility ceiling falls back to the integrated value', () => {
  // The guard is a backstop for a register this system cannot otherwise sanity-check. It exists
  // to catch 3,625 kWh on a 120 W circuit, not to second-guess a busy day.
  const row = rowOf(withMeters(
    { lo_yel2: meter({ e: '0.825', dp: { today_acc_energy2: 3625.021 } }) },
    { lo_yel2: { today_acc_energy2: 0 } }, // a baseline that fails to subtract the offset
  ), 'mtr_lo_yellow', 100);
  assert.ok(Math.abs(row.energy_kwh_today - 0.825) < 1e-6);
});

test('when both the device figure and the integrated one are implausible, the field is omitted', () => {
  // "No data" and "zero watts" are different facts and the UI renders them differently, so an
  // unbelievable reading is dropped rather than coerced to 0.
  const row = rowOf(withMeters(
    { lo_yel2: meter({ e: '9999', dp: { today_acc_energy2: 3625.021 } }) },
    { lo_yel2: { today_acc_energy2: 0 } },
  ), 'mtr_lo_yellow', 100);
  assert.equal('energy_kwh_today' in row, false);
});

test('with no ceiling configured nothing is rejected, so an older site config is unchanged', () => {
  const row = rowOf(withMeters(
    { lo_yel2: meter({ e: '0.825', dp: { today_acc_energy2: 3625.021 } }) },
    { lo_yel2: { today_acc_energy2: 0 } },
  ), 'mtr_lo_yellow');
  assert.equal(row.energy_kwh_today, 3625.021);
});

test('week and month are built from the corrected daily figure, never the raw counter', () => {
  // The accumulator banks whatever `energy_kwh_today` reported. If the two disagreed, the poison
  // would outlive the fix by a whole week.
  const snap = withMeters(
    { lo_yel2: meter({ e: '0.825', dp: { today_acc_energy2: 3625.021 } }) },
    { lo_yel2: { today_acc_energy2: 3624.196 } },
  );
  snap.energyAcc = { mtr_lo_yellow: { weekBase: 1.597, monthBase: 1.368 } };
  const row = rowOf(snap, 'mtr_lo_yellow');
  assert.ok(Math.abs(row.energy_kwh_week - (1.597 + 0.825)) < 1e-3);
  assert.ok(Math.abs(row.energy_kwh_month - (1.368 + 0.825)) < 1e-3);
});

test('an outlet is untouched — it has no today_acc_energy and keeps its own accumulation', () => {
  const snap = {
    energy: { meters: {}, totals: {} },
    outlet: { meters: { co1: { v: '223.3', c: '0', p: '0', e: '3.713', t: NOON, dp: { add_ele: 0.001 } } }, state: {} },
    switch: { state: {} },
    aircon: { state: {} },
    energyDayBase: {},
  };
  const row = buildLatest(snap, DEVICE_REGISTRY, PHASE_MAP, NOON, OFFSET, STALE_AFTER_MS_BY_CLASS, 100)
    .find((r) => r.device_id === 'co1');
  assert.ok(Math.abs(row.energy_kwh_today - 3.713) < 1e-6);
});
