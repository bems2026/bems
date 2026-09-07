/**
 * A reading nobody has taken must not be persisted as zero — the project's own rule, violated
 * in the one place that manufactures the values.
 *
 * THE PATH. Both generated tails open with `parseFloat(flow.get("<ctx>_last_p")) || 0` and close
 * with an unconditional `flow.set("<ctx>_last_p", lastP)`. So a packet carrying no telemetry dps
 * — a connect-time status frame, a settings-only report — writes a real `0` into flow context
 * for a device that has never reported anything. That is not a display artefact: the bridge
 * collectors read those exact keys (`node-red-bridge/build-flow.mjs` builds the snapshot from
 * `flow.get(k + '_last_v')`), so `buildLatest` publishes `voltage: 0, current: 0, power_w: 0` as
 * measured values, and the outlet tab's own arrival timestamp says they are fresh.
 *
 * NOT CURRENTLY ACTIVE, and worth saying so rather than overstating it. Every one of the eleven
 * metered devices reports, so the live context holds real values — checked 2026-09-07, all seven
 * outlets carry a genuine `_last_v` around 228 V with `_last_p` at 0 because the sockets are
 * actually off. This is a latent fault that a newly enrolled device, or any device whose first
 * packet is a status frame, walks straight into.
 *
 * WHAT IS DELIBERATELY LEFT ALONE. The legacy `/ui` dashboard payload and the second output that
 * feeds the two-second totals engine both still receive a number, because neither lives in this
 * repository and neither can be tested from here. The fabrication is confined to the display it
 * was always confined to; what changes is that it is never written down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { generateParserSource } from '../node-red-bridge/dpParserPlan.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { CAPABILITY_PROFILES } from '../shared/deviceCapabilities.mjs';

const device = (id) => DEVICE_REGISTRY.find((d) => d.id === id);
const profileOf = (d) => CAPABILITY_PROFILES[d.capability_profile];
const run = (src, msg, flow) => new Function('msg', 'flow', src)(msg, flow);

function fakeFlow(initial = {}) {
  const store = new Map(Object.entries(initial));
  return { get: (k) => store.get(k), set: (k, v) => store.set(k, v), _dump: () => Object.fromEntries(store) };
}

/** An outlet and a meter, because the two tails are separate code with the same defect. */
const CASES = [
  { id: 'co3', ctx: 'co3', telemetry: { 18: 1820, 19: 4021, 20: 2214 }, quiet: { 38: 'memory' } },
  // dpBase is 103 for channel 1, so power/current/voltage are 105/106/107 — 108 is
  // total_energy1 and 109 today_acc_energy1. Getting that wrong is how a test passes for the
  // wrong reason, so the values below are the ones the decode table actually names.
  { id: 'mtr_co_yellow', ctx: 'co_yel', telemetry: { 105: 4620, 106: 275, 107: 2307 }, quiet: { 124: 'cloud_net' } },
];

for (const { id, ctx, telemetry, quiet } of CASES) {
  const src = () => generateParserSource(device(id), profileOf(device(id)));

  test(`${id}: a packet with no telemetry does not invent a reading`, () => {
    const flow = fakeFlow();
    run(src(), { payload: { dps: quiet } }, flow);
    const dump = flow._dump();
    for (const key of [`${ctx}_last_v`, `${ctx}_last_c`, `${ctx}_last_p`]) {
      assert.notEqual(dump[key], 0, `${key} was persisted as a fabricated zero`);
      assert.equal(dump[key] === undefined || dump[key] === null, true, `${key} should be absent, got ${dump[key]}`);
    }
  });

  test(`${id}: the bridge therefore omits the field rather than publishing 0`, () => {
    // The collector reads these keys straight out of context — see build-flow.mjs. `undefined`
    // is what makes `buildLatest`'s `num()` omit the field; `0` is what makes it a measurement.
    const flow = fakeFlow();
    run(src(), { payload: { dps: quiet } }, flow);
    assert.equal(flow.get(`${ctx}_last_p`), undefined);
  });

  test(`${id}: a real reading is persisted exactly as before`, () => {
    const flow = fakeFlow();
    run(src(), { payload: { dps: telemetry } }, flow);
    const dump = flow._dump();
    assert.equal(typeof dump[`${ctx}_last_v`], 'number');
    assert.equal(typeof dump[`${ctx}_last_c`], 'number');
    assert.equal(typeof dump[`${ctx}_last_p`], 'number');
    assert.ok(dump[`${ctx}_last_v`] > 200, `got ${dump[`${ctx}_last_v`]}`);
  });

  test(`${id}: a genuine zero watts IS persisted — it is a reading`, () => {
    // The distinction the whole change rests on. Every outlet reports 0 W most of the night and
    // that must survive; only the never-measured case is withheld.
    const flow = fakeFlow();
    const zeroPower = { ...telemetry };
    zeroPower[id === 'co3' ? 19 : 105] = 0;
    run(src(), { payload: { dps: zeroPower } }, flow);
    assert.equal(flow.get(`${ctx}_last_p`), 0);
  });

  test(`${id}: a quiet packet after a real one keeps the last real value`, () => {
    const flow = fakeFlow();
    run(src(), { payload: { dps: telemetry } }, flow);
    const persisted = flow.get(`${ctx}_last_v`);
    run(src(), { payload: { dps: quiet } }, flow);
    assert.equal(flow.get(`${ctx}_last_v`), persisted, 'the last measured value is retained');
  });

  test(`${id}: the legacy UI payload still gets numbers, never undefined`, () => {
    // The `/ui` dashboard and the two-second totals engine are outside this repository and
    // cannot be tested from here, so their inputs must not change shape.
    const flow = fakeFlow();
    const out = run(src(), { payload: { dps: quiet } }, flow);
    assert.match(out[0].payload.voltage, /^[0-9.]+$/);
    assert.match(out[0].payload.current, /^[0-9.]+$/);
    assert.match(out[0].payload.power, /^[0-9.]+$/);
    assert.equal(typeof out[1].payload, 'number', 'output 2 still carries watts');
  });
}

test('the outlet arrival timestamp is still stamped on every packet', () => {
  // `<ctx>_last_time` is the outlet tab's ONLY arrival signal and `buildLatest` derives both
  // `ts` and the staleness backstop from it. Withholding it on a quiet packet would make a
  // reporting device look dead — the opposite failure, and a worse one.
  const flow = fakeFlow();
  run(generateParserSource(device('co3'), profileOf(device('co3'))), { payload: { dps: { 38: 'memory' } } }, flow);
  assert.equal(typeof flow.get('co3_last_time'), 'number');
});

test('the meter sample buffers still grow on every packet', () => {
  // The energy tab writes no timestamp at all, so buffer DEPTH is how the bridge knows a meter
  // is still reporting. It must keep growing whether or not this packet carried telemetry.
  const d = device('mtr_co_yellow');
  const flow = fakeFlow();
  run(generateParserSource(d, profileOf(d)), { payload: { dps: { 124: 'cloud_net' } } }, flow);
  assert.equal(flow.get('co_yel_arr_v').length, 1);
});
