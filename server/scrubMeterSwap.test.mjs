/**
 * The scrub for the shared dual-channel meter's stored rows (RM-123): the same classifier the live
 * demux runs, applied to what was already written, with each affected day's energy re-integrated.
 *
 * The fixture is the shape of 2026-09-19 in miniature: direct, then the device puts channel 1 in
 * `monitor` and reports the outlets under channel 2, then back. A second day is clean and must
 * come out of the plan untouched — the scrub's most important property is what it does not do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_PROFILES } from '../shared/deviceCapabilities.mjs';
import { planScrub, reintegrateDay, localDayOf } from './scrubMeterSwap.mjs';

const P = CAPABILITY_PROFILES.cz_ct_double;
const RULES = { ceiling_w: 150 };
const OFFSET = 480;
const AT = '2026-09-22T00:00:00.000Z';

/** One minute per row, from a local-time start. */
const ts = (day, hhmm, i) => new Date(Date.parse(`${day}T${hhmm}:00+08:00`) + i * 60000).toISOString();
const row = (device_id, t, over = {}) => ({
  device_id, ts: t, voltage: 229, current: 0.23, power_w: 40, energy_kwh_today: 0, online: true,
  total_energy_kwh: 100, warn_power_w: 2000, power_type: 'normal', net_state: 'cloud_net', fault: null,
  capabilities: { add_ele1: 0.01, device_state1: 'working', all_energy: 1 }, ...over,
});

const CO = 'mtr_co_yellow', LO = 'mtr_lo_yellow';

/**
 * 30 minutes on 09-19, each transition evidenced the way the real day's were: 10 direct (lights
 * off, so channel 2 idle), 10 swapped (channel 1 idle, the outlets at 600 W on channel 2), 10 direct
 * (the outlets at 600 W back on channel 1, the lights on).
 */
function saturday() {
  const co = [], lo = [];
  for (let i = 0; i < 30; i++) {
    const t = ts('2026-09-19', '06:00', i);
    if (i < 10) {
      co.push(row(CO, t, { power_w: 40, current: 0.23, total_energy_kwh: 100 }));
      lo.push(row(LO, t, { power_w: 0, current: 0, total_energy_kwh: 50, capabilities: { device_state2: 'monitor', all_energy: 1 } }));
    } else if (i < 20) {
      co.push(row(CO, t, { power_w: 0, current: 0, voltage: 223.5, total_energy_kwh: 100, capabilities: { device_state1: 'monitor', add_ele1: 0.01, all_energy: 1 } }));
      lo.push(row(LO, t, { power_w: 600, current: 5.1, voltage: 229.1, total_energy_kwh: 50, capabilities: { device_state2: 'working', add_ele2: 0.02, all_energy: 1 } }));
    } else {
      co.push(row(CO, t, { power_w: 600, current: 5.1, total_energy_kwh: 100 }));
      lo.push(row(LO, t, { power_w: 41, current: 0.43, total_energy_kwh: 50, capabilities: { add_ele2: 0.01, device_state2: 'working', all_energy: 1 } }));
    }
  }
  // One offline minute inside the window: ingest kept the last values with online=false.
  co[15].online = false; lo[15].online = false;
  return { co, lo };
}

/** A clean Sunday, half an hour, nothing to say. */
function sunday() {
  const co = [], lo = [];
  for (let i = 0; i < 30; i++) {
    const t = ts('2026-09-20', '10:00', i);
    co.push(row(CO, t, { power_w: 500 + i, current: 4 }));
    lo.push(row(LO, t, { power_w: 0, current: 0, capabilities: { device_state2: 'monitor', all_energy: 1 } }));
  }
  return { co, lo };
}

test('localDayOf buckets by the site\'s own day, not UTC', () => {
  assert.equal(localDayOf('2026-09-18T16:30:00.000Z', OFFSET), '2026-09-19'); // 00:30 local
  assert.equal(localDayOf('2026-09-18T15:59:00.000Z', OFFSET), '2026-09-18');
});

test('the plan finds the swapped window, dated after the two-sample debounce, and names its rule', () => {
  const { co, lo } = saturday();
  const plan = planScrub({ co, lo, profile: P, rules: RULES, offsetMinutes: OFFSET, at: AT });
  assert.equal(plan.windows.length, 1);
  const w = plan.windows[0];
  assert.equal(w.from, ts('2026-09-19', '06:00', 11), 'the second agreeing sample confirms the flip');
  assert.equal(w.to, ts('2026-09-19', '06:00', 21), 'and the second agreeing sample confirms the flip back');
  assert.equal(w.rule, 'ceiling');
  assert.equal(w.samples, 10);
  assert.deepEqual(plan.affectedDays, ['2026-09-19']);
});

test('inside the window each row takes the other channel\'s measurements, codes renamed to its own channel', () => {
  const { co, lo } = saturday();
  const plan = planScrub({ co, lo, profile: P, rules: RULES, offsetMinutes: OFFSET, at: AT });
  const t = ts('2026-09-19', '06:00', 14);
  const coU = plan.updates.find((u) => u.device_id === CO && u.ts === t);
  const loU = plan.updates.find((u) => u.device_id === LO && u.ts === t);
  assert.equal(coU.power_w, 600); assert.equal(coU.current, 5.1); assert.equal(coU.voltage, 229.1);
  assert.equal(loU.power_w, 0); assert.equal(loU.current, 0); assert.equal(loU.voltage, 223.5);
  assert.equal(coU.total_energy_kwh, 50, 'the per-channel register travels with the clamp');
  assert.equal(loU.total_energy_kwh, 100);
  assert.equal(coU.capabilities.device_state1, 'working');
  assert.equal(coU.capabilities.add_ele1, 0.02);
  assert.equal(loU.capabilities.device_state2, 'monitor');
  assert.equal(coU.capabilities.all_energy, 1, 'device-wide codes stay');
  assert.deepEqual(coU.capabilities.scrub, { swapped: true, rule: 'ceiling', energy: 'reintegrated', at: AT });
  // `online` is the row's own fact, carried unchanged — it must travel, because a bulk upsert
  // evaluates the INSERT tuple's NOT NULL constraints before the conflict path (measured
  // 2026-09-22: 23502 on the first batch without it, nothing written).
  assert.equal(coU.online, true);
  const off = plan.updates.find((u) => u.device_id === CO && u.ts === ts('2026-09-19', '06:00', 15));
  assert.equal(off.online, false, 'an offline row stays offline');
});

test('outside the window on an affected day, measurements are untouched and only energy is restated', () => {
  const { co, lo } = saturday();
  const plan = planScrub({ co, lo, profile: P, rules: RULES, offsetMinutes: OFFSET, at: AT });
  const t = ts('2026-09-19', '06:00', 3);
  const coU = plan.updates.find((u) => u.device_id === CO && u.ts === t);
  assert.equal(coU.power_w, 40);
  assert.equal(coU.capabilities.device_state1, 'working');
  assert.deepEqual(coU.capabilities.scrub, { energy: 'reintegrated', at: AT });
});

test('energy is re-integrated from the corrected power, so the outlets\' ten minutes at 600 W land on C.O', () => {
  const { co, lo } = saturday();
  const plan = planScrub({ co, lo, profile: P, rules: RULES, offsetMinutes: OFFSET, at: AT });
  const last = (dev) => plan.updates.filter((u) => u.device_id === dev).sort((a, b) => a.ts.localeCompare(b.ts)).at(-1);
  // Left-Riemann over 29 one-minute intervals, WITH the debounce: the first contradicting minute
  // on each side (i10, i20) stays under the previous assignment, so it carries the other row's
  // value — 0 W at i10 (channel 1 already idle), 41 W at i20 (the lights already back). That is
  // one minute of at most the outlet load per flip, the same cost the live node pays.
  // C.O: 40 W x10, 0 W x1, 600 W x9 (one minute offline, bridged from the last online power),
  // 41 W x1, 600 W x8. L.O, mirror image: nothing x10, 600 W x1, nothing x9, 600 W x1, 41 W x8.
  assert.ok(Math.abs(last(CO).energy_kwh_today - (40 * 10 + 600 * 9 + 41 + 600 * 8) / 60000) < 0.0005, `C.O ${last(CO).energy_kwh_today}`);
  assert.ok(Math.abs(last(LO).energy_kwh_today - (600 + 600 + 41 * 8) / 60000) < 0.0005, `L.O ${last(LO).energy_kwh_today}`);
  const coSeries = plan.updates.filter((u) => u.device_id === CO).sort((a, b) => a.ts.localeCompare(b.ts)).map((u) => u.energy_kwh_today);
  for (let i = 1; i < coSeries.length; i++) assert.ok(coSeries[i] >= coSeries[i - 1], 'never decreases within a day');
});

test('a day with no swapped minute yields no updates at all', () => {
  const sat = saturday(), sun = sunday();
  const plan = planScrub({ co: [...sat.co, ...sun.co], lo: [...sat.lo, ...sun.lo], profile: P, rules: RULES, offsetMinutes: OFFSET, at: AT });
  assert.deepEqual(plan.affectedDays, ['2026-09-19']);
  assert.equal(plan.updates.some((u) => u.ts.startsWith('2026-09-20')), false);
  assert.equal(plan.updates.length, 60, 'both devices, every minute of the affected day');
});

test('every update carries the same column set, which is what a bulk upsert requires', () => {
  const { co, lo } = saturday();
  const plan = planScrub({ co, lo, profile: P, rules: RULES, offsetMinutes: OFFSET, at: AT });
  const keys = new Set(plan.updates.map((u) => Object.keys(u).sort().join(',')));
  assert.equal(keys.size, 1);
  assert.equal([...keys][0], 'capabilities,current,device_id,energy_kwh_today,online,power_type,power_w,total_energy_kwh,ts,voltage,warn_power_w');
});

test('reintegrateDay holds the running total across an offline gap and does not integrate through a long one', () => {
  const t0 = Date.parse('2026-09-19T00:00:00+08:00');
  const rows = [
    { ts: new Date(t0).toISOString(), power_w: 600, online: true },
    { ts: new Date(t0 + 60000).toISOString(), power_w: 600, online: true },
    { ts: new Date(t0 + 120000).toISOString(), power_w: 600, online: false },
    { ts: new Date(t0 + 180000).toISOString(), power_w: 600, online: true },
    { ts: new Date(t0 + 30 * 60000).toISOString(), power_w: 600, online: true }, // 27 min later
  ];
  const e = reintegrateDay(rows, { maxGapMs: 5 * 60000 }).map((r) => r.energy_kwh_today);
  assert.equal(e[0], 0);
  assert.ok(Math.abs(e[1] - 0.01) < 1e-9);
  assert.equal(e[2], e[1], 'an offline row restates the total, adds nothing');
  assert.ok(Math.abs(e[3] - 0.03) < 1e-9, 'the gap through the offline row is bridged from the last online power');
  assert.equal(e[4], e[3], 'a 27-minute gap is not integrated');
});

test('with nothing swapped the plan is empty and says so', () => {
  const { co, lo } = sunday();
  const plan = planScrub({ co, lo, profile: P, rules: RULES, offsetMinutes: OFFSET, at: AT });
  assert.deepEqual(plan.windows, []);
  assert.deepEqual(plan.updates, []);
});
