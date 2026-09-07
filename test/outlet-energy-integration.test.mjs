/**
 * An outlet's daily energy, after RM-047.
 *
 * THE FAULT, measured on the running bridge 2026-09-07 over a three-minute watch with no flow
 * change and no device connection:
 *
 *     06:48:19  co5 p=0W add=0.028 e=31.4131 d=0.0280
 *     06:49:19  co5 p=0W add=0.028 e=31.4411 d=0.0280
 *     06:50:19  co5 p=0W add=0.028 e=31.4691 d=0.0280
 *
 * co5 drew zero watts throughout and accrued 0.028 kWh every sixty seconds — a fabricated
 * 1.68 kW on a socket that is switched off. co1 accrued 1.460 kWh across a day it drew 0 W
 * throughout (0.001 x 1,440 polls = 1.44, the whole of it). co5 reported 72.427 kWh for
 * 2026-09-06 against 2.268 kWh integrated from its own power, on a device whose highest reading
 * ever is 674 W — 16.2 kWh is its physical daily ceiling. Overstated 32-fold.
 *
 * WHY. The parser did `energy += fresh.add_ele`. That is correct for a device-pushed
 * `dp-refresh`, where `add_ele` genuinely means "energy since I last told you". It is wrong for
 * the 60 s poll, whose `data` event returns the device's entire retained dp table including the
 * last `add_ele` it ever sent. `node-red-contrib-tuya-smart-device` emits byte-identical message
 * shapes for both events — `src/tuya-smart-device.js` sends a bare
 * `{payload:{data,deviceId,deviceName}}` from each — so nothing downstream can tell a fresh
 * increment from its echo. The comment that stood above that line, *"`add_ele` is energy SINCE
 * THE LAST REPORT, so it accumulates"*, is true of the protocol and false of the transport.
 *
 * WHY NOT PREFER A COUNTER, AS THE METERS DO. `cz_ct_single`/`cz_ct_double` carry
 * `today_acc_energy` (`semantic: 'cumulative_daily'`), which is harmless to re-read. `pc_outlet`
 * has no cumulative energy dp at all — all 17 are switches, countdowns, coefficients,
 * diagnostics and this one increment — so there is nothing to difference against.
 *
 * WHY INTEGRATION IS TRUSTED. Measured, not assumed. For the four CT meters both numbers exist
 * for the same day, so integrating their stored `power_w` can be compared against their own
 * counters:
 *
 *     2026-08-30   0.2% / 0.2% / 1.1%          2026-09-01   0.2% / 0.3% / 0.3%
 *     2026-08-31   0.1% / 0.2% / 0.2% / 0.5%   2026-09-02   0.0% / 0.3% / 1.0% / 1.0%
 *     2026-09-03   3.1% / 3.5% / 3.7% — the fleet-outage day, where gaps are expected
 *
 * About 1% against a real counter, versus the +3,200% being replaced.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateParserSource, MAX_INTEGRATION_GAP_MS } from '../node-red-bridge/dpParserPlan.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { CAPABILITY_PROFILES } from '../shared/deviceCapabilities.mjs';

const device = (id) => DEVICE_REGISTRY.find((d) => d.id === id);
const profileOf = (d) => CAPABILITY_PROFILES[d.capability_profile];
const CO = device('co3');
const SRC = generateParserSource(CO, profileOf(CO));

function fakeFlow(initial = {}) {
  const store = new Map(Object.entries(initial));
  return { get: (k) => store.get(k), set: (k, v) => store.set(k, v), _dump: () => Object.fromEntries(store) };
}
const run = (src, msg, flow) => new Function('msg', 'flow', src)(msg, flow);

/**
 * One poll arriving `gapMs` after the previous one.
 *
 * The generated source calls `Date.now()` directly, so the interval is staged by winding the
 * stored `last_time` back rather than by faking the clock — which is what the existing parser
 * tests already do, and keeps the production source free of a seam that exists only for tests.
 */
function poll(flow, dps, gapMs = 60_000) {
  flow.set('co3_last_time', Date.now() - gapMs);
  return run(SRC, { payload: { dps } }, flow);
}

const today = () => new Date().getDate();
const energyOf = (flow) => flow._dump().co3_energy;

// ---------------------------------------------------------------------------
// The fault itself.
// ---------------------------------------------------------------------------

test('a repeated poll of the same add_ele adds nothing — RM-047', () => {
  // co5's exact live shape: zero watts, add_ele stuck at its last reported value, polled every
  // sixty seconds. Before this each poll banked another 0.028 kWh.
  const flow = fakeFlow({ co3_last_day: today(), co3_energy: 0 });
  for (let i = 0; i < 5; i += 1) poll(flow, { 17: 28, 19: 0 });
  assert.equal(energyOf(flow), 0, 'zero watts for five minutes is zero energy');
});

test('a full day of polls at zero watts stays at zero', () => {
  // co1's day: 1,440 polls, 0 W throughout, and 1.460 kWh recorded. This is that day.
  const flow = fakeFlow({ co3_last_day: today(), co3_energy: 0 });
  for (let i = 0; i < 1440; i += 1) poll(flow, { 17: 1, 19: 0 });
  assert.equal(energyOf(flow), 0);
});

test("co5's measured day lands near its integrated truth, not 32x above it", () => {
  // 1,440 polls at a steady 94.5 W is 2.268 kWh — the figure co5's own power integrates to for
  // 2026-09-06, against the 72.427 kWh it reported. add_ele is present and stuck throughout,
  // exactly as it was on the day.
  const flow = fakeFlow({ co3_last_day: today(), co3_energy: 0 });
  for (let i = 0; i < 1440; i += 1) poll(flow, { 17: 28, 19: 945 });
  assert.ok(Math.abs(energyOf(flow) - 2.268) < 0.005, `got ${energyOf(flow)}`);
});

// ---------------------------------------------------------------------------
// Integration, and how it measures.
// ---------------------------------------------------------------------------

test('energy comes from power over elapsed time', () => {
  const flow = fakeFlow({ co3_last_day: today(), co3_energy: 0, co3_last_p: 600 });
  poll(flow, { 19: 6000 }, 60_000); // 600.0 W for one minute
  assert.ok(Math.abs(energyOf(flow) - 0.01) < 1e-9, `got ${energyOf(flow)}`);
});

test('the interval is trapezoid, not the arriving wattage applied backwards', () => {
  // A socket switched on between two polls used the full new wattage for the whole preceding
  // minute. Averaging the endpoints halves that error, and costs nothing.
  const flow = fakeFlow({ co3_last_day: today(), co3_energy: 0, co3_last_p: 0 });
  poll(flow, { 19: 6000 }, 60_000); // 0 W -> 600 W across the minute
  assert.ok(Math.abs(energyOf(flow) - 0.005) < 1e-9, `got ${energyOf(flow)} — right-endpoint would be 0.01`);
});

test('a steady load integrates the same whichever way the endpoints are read', () => {
  const flow = fakeFlow({ co3_last_day: today(), co3_energy: 0, co3_last_p: 600 });
  poll(flow, { 19: 6000 }, 60_000);
  assert.ok(Math.abs(energyOf(flow) - 0.01) < 1e-9);
});

// ---------------------------------------------------------------------------
// The staleness guard — integration's one documented weakness.
// ---------------------------------------------------------------------------

test('a gap longer than the cap is skipped, never interpolated', () => {
  // The fault integration is known for: "a disconnected meter's last wattage compounds into the
  // total for as long as it stays down". We do not know what the socket did while it was gone,
  // and inventing an hour of it is the same class of harm as inventing a reading.
  const flow = fakeFlow({ co3_last_day: today(), co3_energy: 1.5, co3_last_p: 600 });
  poll(flow, { 19: 6000 }, 3600_000);
  assert.equal(energyOf(flow), 1.5, 'an hour offline added nothing');
});

test('a gap just inside the cap is still counted', () => {
  // Erring tight would lose real energy on a merely slow tick. Measured sample spacing on this
  // fleet is 30/60/90 s, so the cap sits well clear of normal operation.
  const flow = fakeFlow({ co3_last_day: today(), co3_energy: 0, co3_last_p: 600 });
  poll(flow, { 19: 6000 }, MAX_INTEGRATION_GAP_MS - 1000);
  assert.ok(energyOf(flow) > 0);
});

test('the cap is clear of the real cadence but far under a real outage', () => {
  assert.ok(MAX_INTEGRATION_GAP_MS >= 3 * 90_000, 'at least 3x the slowest measured 90 s gap');
  assert.ok(MAX_INTEGRATION_GAP_MS <= 10 * 60_000, 'well under an outage worth noticing');
});

test('the very first packet a flow ever sees adds nothing', () => {
  // `last_time` defaults to now, so the interval is zero. A negative or zero span must never
  // reach the accumulator.
  const flow = fakeFlow({ co3_last_day: today() });
  run(SRC, { payload: { dps: { 17: 28, 19: 6000 } } }, flow);
  assert.equal(energyOf(flow), 0);
});

test('a clock that steps backwards cannot subtract energy', () => {
  const flow = fakeFlow({ co3_last_day: today(), co3_energy: 0.4, co3_last_p: 600 });
  flow.set('co3_last_time', Date.now() + 60_000);
  run(SRC, { payload: { dps: { 19: 6000 } } }, flow);
  assert.equal(energyOf(flow), 0.4);
});

// ---------------------------------------------------------------------------
// What must not change.
// ---------------------------------------------------------------------------

test('add_ele is still decoded and published — it is cross-check data, not an accumulator', () => {
  // Dropping it from `capabilities` would remove the only device-side energy figure an outlet
  // reports, which is what any future comparison would need.
  const flow = fakeFlow({ co3_last_day: today() });
  poll(flow, { 17: 8, 19: 748 });
  assert.equal(flow._dump().co3_dp.add_ele, 0.008, 'scale 3, still decoded');
});

test('an outlet still resets its daily energy at the local date rollover', () => {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).getDate();
  const flow = fakeFlow({ co3_energy: 4.2, co3_last_day: yesterday, co3_last_p: 600 });
  poll(flow, { 19: 6000 }, 60_000);
  assert.ok(energyOf(flow) < 0.02, `yesterday's 4.2 kWh did not carry into today (got ${energyOf(flow)})`);
  assert.equal(flow._dump().co3_last_day, today());
});

test('voltage, current and power still reach the UI payload unchanged', () => {
  const flow = fakeFlow({ co3_last_day: today() });
  const out = poll(flow, { 18: 1820, 19: 4021, 20: 2214 });
  assert.equal(out[0].payload.voltage, '221.4');
  assert.equal(out[0].payload.current, '1.820');
  assert.equal(out[0].payload.power, '402.1');
  assert.equal(out[1].payload, 402.1, 'the second output still carries watts for the totals engine');
});

test('every context key the parser wrote before is still written', () => {
  // The legacy /ui dashboard and the two-second totals engine read these and neither is in this
  // repository, so a key that quietly stopped being written would break something unwatched.
  const flow = fakeFlow({ co3_last_day: today() });
  poll(flow, { 17: 8, 18: 1820, 19: 4021, 20: 2214 });
  for (const key of ['co3_last_v', 'co3_last_c', 'co3_last_p', 'co3_energy', 'co3_last_time', 'co3_last_day', 'co3_dp']) {
    assert.ok(key in flow._dump(), `still writes ${key}`);
  }
});

test('a meter is untouched by this — it has a counter and keeps preferring it', () => {
  // `today_acc_energy` is cumulative_daily; re-reading it is harmless, which is exactly why the
  // meters never had this fault and must not acquire it now.
  const m = device('mtr_co_yellow');
  const src = generateParserSource(m, profileOf(m));
  const flow = fakeFlow();
  run(src, { payload: { dps: { 109: 6289 } } }, flow);
  assert.equal(flow._dump().co_yel_dp.today_acc_energy1, 6.289, "the meter's own daily counter");
  assert.equal('co_yel_energy' in flow._dump(), false, 'and the legacy accumulator is left alone');
});
