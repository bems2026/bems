/**
 * The read path for everything a device reports beyond volts, amps and watts — and the change of
 * source for today's energy that comes with it.
 *
 * WHY THE ENERGY RULE MATTERS. `<ctx>_energy` for a CT meter is INTEGRATED from power by the
 * legacy two-second engine. Integrating a frozen reading is exactly the corruption fixed in
 * Aug 2026, where a disconnected meter's last wattage compounded into the permanent kWh totals.
 * The meters have always reported `today_acc_energy` themselves and nothing read it: measured
 * 2026-09-02, `mtr_co_yellow` integrated to 8.0437 kWh while the meter said 8.057.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLatest } from '../shared/buildLatest.mjs';
import { DEVICE_REGISTRY, PHASE_MAP, STALE_AFTER_MS_BY_CLASS } from '../shared/registry.mjs';

const NOW = 1786000000000;
const meter = (over = {}) => ({ v: '225.4', c: '6.546', p: '717.3', e: '8.0437', h: true, ...over });

const snap = ({ energyOver = {}, outletOver = {}, energyAcc } = {}) => ({
  energy: {
    meters: {
      co_yel: meter(energyOver), lo_red: meter(), arec: meter(), lo_yel2: meter(),
    },
    totals: { today: '1', week: '2', month: '3' },
  },
  outlet: { meters: { co1: meter({ t: NOW, ...outletOver }) }, state: { status: {} } },
  switch: { state: {}, health: {} },
  aircon: { state: {} },
  arrivals: { co_yel: NOW, lo_red: NOW, arec: NOW, lo_yel2: NOW },
  ...(energyAcc ? { energyAcc } : {}),
});

const rowOf = (s, id) =>
  buildLatest(s, DEVICE_REGISTRY, PHASE_MAP, NOW, undefined, STALE_AFTER_MS_BY_CLASS)
    .find((r) => r.device_id === id);

test('a meter prefers its OWN daily total over the integrated one', () => {
  const r = rowOf(snap({ energyOver: { dp: { today_acc_energy1: 8.057, cur_power1: 717.3 } } }), 'mtr_co_yellow');
  assert.equal(r.energy_kwh_today, 8.057, 'the device said 8.057; integration said 8.0437');
});

test('the channel suffix decides which total a logical meter takes', () => {
  // One physical device, two logical meters. Taking channel 1's total for channel 2 would
  // attribute the outdoor ACU's consumption to the convenience outlets, plausibly and forever.
  const dp = { today_acc_energy1: 8.057, today_acc_energy2: 0.337 };
  const s = snap({ energyOver: { dp } });
  s.energy.meters.lo_yel2 = meter({ dp });

  assert.equal(rowOf(s, 'mtr_co_yellow').energy_kwh_today, 8.057, 'channel 1');
  assert.equal(rowOf(s, 'mtr_lo_yellow').energy_kwh_today, 0.337, 'channel 2');
});

test('a meter that has not reported its own total keeps the integrated value', () => {
  // An older flow, or a device that has not sent dp 109 yet. Nothing may regress.
  const r = rowOf(snap(), 'mtr_co_yellow');
  assert.equal(r.energy_kwh_today, 8.0437);
});

test('an outlet is unaffected — it has no daily-total dp at all', () => {
  // Outlets report `add_ele`, an increment their parser accumulates into <ctx>_energy. The
  // preference must not reach across and blank them.
  const r = rowOf(snap({ outletOver: { e: '1.234', dp: { add_ele: 0.008, cur_power: 74.8 } } }), 'co1');
  assert.equal(r.energy_kwh_today, 1.234);
});

test('the week and month bases accumulate the same figure that is reported', () => {
  // The accumulator banks whatever `energy_kwh_today` carried, so the two cannot disagree.
  const s = snap({
    energyOver: { dp: { today_acc_energy1: 8.057 } },
    energyAcc: { mtr_co_yellow: { weekBase: 10, monthBase: 100 } },
  });
  const r = rowOf(s, 'mtr_co_yellow');
  assert.equal(r.energy_kwh_week, 18.057);
  assert.equal(r.energy_kwh_month, 108.057);
});

test('capabilities ride on the reading, and are omitted when the parser has none', () => {
  const dp = { cur_power1: 717.3, warn_power1: 1500, net_state: 'cloud_net', total_energy1: 29482.573 };
  const withDp = rowOf(snap({ energyOver: { dp } }), 'mtr_co_yellow');
  assert.deepEqual(withDp.capabilities, dp);

  // An older flow that predates the generated parsers must still produce every other field.
  const without = rowOf(snap(), 'mtr_co_yellow');
  assert.equal(Object.hasOwn(without, 'capabilities'), false);
  assert.equal(without.power_w, 717.3, 'the rest of the reading is unchanged');
});

test('an empty decode object is not reported as a capability set', () => {
  const r = rowOf(snap({ energyOver: { dp: {} } }), 'mtr_co_yellow');
  assert.equal(Object.hasOwn(r, 'capabilities'), false);
});

test('a non-object dp key cannot corrupt the reading', () => {
  // Flow context survives restarts on disk; a half-written or hand-edited value must not throw
  // inside the one function node that builds every reading the system serves.
  for (const junk of ['broken', 42, null, []]) {
    const r = rowOf(snap({ energyOver: { dp: junk } }), 'mtr_co_yellow');
    assert.equal(r.device_id, 'mtr_co_yellow');
    assert.equal(r.energy_kwh_today, 8.0437, `dp=${JSON.stringify(junk)} falls back cleanly`);
  }
});

test('devices with no dps at all are untouched', () => {
  const rows = buildLatest(snap(), DEVICE_REGISTRY, PHASE_MAP, NOW, undefined, STALE_AFTER_MS_BY_CLASS);
  for (const id of ['acu_main', 'sens_outside_temp', 'l1']) {
    const r = rows.find((x) => x.device_id === id);
    assert.ok(r, `${id} still produces a reading`);
    assert.equal(Object.hasOwn(r, 'capabilities'), false);
  }
});

test('a light switch carries its settings too, from the lightStatus entry', () => {
  // Switches have no metering, so their capabilities travel on global.lightStatus beside the
  // connection state, not on a <ctx>_dp key.
  const s = snap();
  s.switch.health = {
    3: { conn: 'CONNECTED', on: true, dp: { switch_1: true, countdown_1: 0, relay_status: 'off', switch_type: 'flip' } },
    4: { conn: 'CONNECTED', on: false },
  };
  const l3 = rowOf(s, 'l3');
  assert.equal(l3.online, true);
  assert.equal(l3.capabilities.relay_status, 'off');
  assert.equal(l3.capabilities.switch_type, 'flip');

  // A switch whose collector predates the change keeps working, with no capabilities key.
  assert.equal(Object.hasOwn(rowOf(s, 'l4'), 'capabilities'), false);
  assert.equal(rowOf(s, 'l4').online, true);
});

test('a switch whose health entry is malformed still produces a reading', () => {
  const s = snap();
  s.switch.health = { 1: { conn: 'CONNECTED', dp: 'corrupt' } };
  const r = rowOf(s, 'l1');
  assert.equal(r.online, true);
  assert.equal(Object.hasOwn(r, 'capabilities'), false);
});
