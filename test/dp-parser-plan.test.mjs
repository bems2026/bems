/**
 * These tests EXECUTE the generated parser source against a fake flow context, rather than
 * matching it against a string. A parser that produces the right text and the wrong numbers is
 * exactly the failure this work exists to fix, and only running it can tell the difference.
 *
 * The `docs/pi-session-brief.md` rule applies here more than anywhere: a green suite is not
 * proof. Each behavioural test below was confirmed to fail against the parser it replaces.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  generateParserSource, planDpParsers, applyDpParserPlan, findParserNodes, capsTableFor,
  validateDpParserPlan, generateSwitchCollectorSource,
  GENERATED_MARKER,
} from '../node-red-bridge/dpParserPlan.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { CAPABILITY_PROFILES } from '../shared/deviceCapabilities.mjs';

const LIVE = JSON.parse(readFileSync(new URL('../node-red-bridge/live-flow-baseline.json', import.meta.url)));
const device = (id) => DEVICE_REGISTRY.find((d) => d.id === id);
const profileOf = (d) => CAPABILITY_PROFILES[d.capability_profile];

/** A minimal stand-in for a Node-RED function node's `flow` context. */
function fakeFlow(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get: (k) => store.get(k),
    set: (k, v) => store.set(k, v),
    _dump: () => Object.fromEntries(store),
  };
}

/** Run a generated parser exactly as Node-RED would: `msg` and `flow` in scope, a return out. */
function run(source, msg, flow) {
  // eslint-disable-next-line no-new-func
  return new Function('msg', 'flow', source)(msg, flow);
}

const keysWritten = (src) => new Set([...src.matchAll(/flow\.set\("([^"]+)"/g)].map((m) => m[1]));

test('the generated parser writes every context key the live one wrote', () => {
  // Nothing else in this repository declares these keys — the legacy /ui dashboard, the
  // two-second totals engine and the bridge collectors all read them and none are in here. A key
  // that quietly stopped being written would break a dashboard nobody would think to check.
  for (const id of ['co1', 'co3', 'co7', 'mtr_co_yellow', 'mtr_lo_red', 'mtr_lo_yellow', 'mtr_arec_acu']) {
    const d = device(id);
    const live = findParserNodes(LIVE, d).find((n) => /Unified Parser/i.test(n.name ?? ''));
    assert.ok(live, `${id}: found its live parser`);
    const generated = keysWritten(generateParserSource(d, profileOf(d)));
    for (const key of keysWritten(live.func)) {
      assert.ok(generated.has(key), `${id}: generated parser stopped writing ${key}`);
    }
  }
});

test('an outlet packet decodes to the values the vendor cloud reports', () => {
  // Real dps read off co3 on 2026-09-02, beside the cloud's own view of the same device.
  const flow = fakeFlow();
  const d = device('co3');
  run(generateParserSource(d, profileOf(d)),
    { payload: { dps: { 1: true, 2: true, 17: 8, 18: 526, 19: 748, 20: 2270, 41: false, 26: 0 } } }, flow);

  const s = flow._dump();
  assert.equal(s.co3_last_v, 227);
  assert.equal(s.co3_last_c, 0.526);
  assert.equal(s.co3_last_p, 74.8);
  assert.equal(s.co3_health, true);
  assert.equal(s.co3_dp.switch_1, true);
  assert.equal(s.co3_dp.child_lock, false);
  assert.equal(s.co3_dp.cur_power, 74.8);
  assert.equal(s.co3_dp.add_ele, 0.008, 'scale 3, not the scale 2 the live parser used');
});

test('add_ele ACCUMULATES — the live parser assigned it, and that is the fault', () => {
  // Neuter check: replacing `energy +=` with `energy =` in the generated source makes this fail,
  // which is what the live node does and why co3 reported 0.08 kWh while drawing 74.8 W.
  const flow = fakeFlow({ co3_last_day: new Date().getDate() });
  const d = device('co3');
  const src = generateParserSource(d, profileOf(d));

  for (let i = 0; i < 5; i += 1) run(src, { payload: { dps: { 17: 8, 19: 748 } } }, flow);
  assert.equal(Math.round(flow._dump().co3_energy * 1000) / 1000, 0.04, 'five 0.008 kWh increments');
});

test('an outlet resets its daily energy at the local date rollover', () => {
  // `Zero Out Energy Memory` clears the four CT meters and no outlet, so this counter used to run
  // for the life of the flow while `buildLatest` served it as `energy_kwh_today`.
  const d = device('co3');
  const src = generateParserSource(d, profileOf(d));
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).getDate();
  const flow = fakeFlow({ co3_energy: 4.2, co3_last_day: yesterday });

  run(src, { payload: { dps: { 17: 8, 19: 748 } } }, flow);
  assert.equal(flow._dump().co3_energy, 0.008, "yesterday's 4.2 kWh did not carry into today");
  assert.equal(flow._dump().co3_last_day, new Date().getDate());
});

test('integration is the fallback, used only when no energy dp arrived', () => {
  const d = device('co3');
  const src = generateParserSource(d, profileOf(d));
  const flow = fakeFlow({
    co3_last_day: new Date().getDate(),
    co3_last_time: Date.now() - 3600_000, // one hour ago
    co3_energy: 0,
  });
  run(src, { payload: { dps: { 19: 1000 } } }, flow); // 100.0 W, no add_ele
  assert.ok(Math.abs(flow._dump().co3_energy - 0.1) < 0.002, 'one hour at 100 W is 0.1 kWh');
});

test('the two channels of one physical meter read their own dps', () => {
  // mtr_co_yellow and mtr_lo_yellow are one device. Reading the wrong half would swap two branch
  // circuits' load — plausibly, and permanently, in the billing record.
  const ch1 = device('mtr_co_yellow');
  const ch2 = device('mtr_lo_yellow');
  const packet = { payload: { dps: { 105: 9984, 106: 8767, 107: 2254, 115: 0, 116: 0, 117: 2256 } } };

  const f1 = fakeFlow(); run(generateParserSource(ch1, profileOf(ch1)), packet, f1);
  const f2 = fakeFlow(); run(generateParserSource(ch2, profileOf(ch2)), packet, f2);

  assert.equal(f1._dump().co_yel_last_p, 998.4);
  assert.equal(f1._dump().co_yel_last_v, 225.4);
  assert.equal(f2._dump().lo_yel2_last_p, 0);
  assert.equal(f2._dump().lo_yel2_last_v, 225.6);
});

test("a channel's decode table excludes the other channel's dps entirely", () => {
  const table = capsTableFor(CAPABILITY_PROFILES.cz_ct_double, 2);
  assert.ok(table[115], 'channel 2 power is present');
  assert.equal(table[105], undefined, "channel 1's power is not in channel 2's table");
  assert.ok(table[123], 'device-wide all_energy is present on both channels');
  assert.ok(table[101], 'device-wide sync_request is present on both channels');
});

test('a meter carries the device-reported daily and lifetime energy through to the bridge', () => {
  // The whole reason this key exists: `<ctx>_energy` stays the legacy engine's integrated value,
  // while the meter's OWN figure travels beside it for `buildLatest` to prefer.
  const d = device('mtr_co_yellow');
  const flow = fakeFlow();
  run(generateParserSource(d, profileOf(d)),
    { payload: { dps: { 108: 29482573, 109: 8057, 111: 1500, 123: 40421923, 124: 'cloud_net' } } }, flow);

  const dp = flow._dump().co_yel_dp;
  assert.equal(dp.total_energy1, 29482.573);
  assert.equal(dp.today_acc_energy1, 8.057);
  assert.equal(dp.warn_power1, 1500);
  assert.equal(dp.all_energy, 40421.923);
  assert.equal(dp.net_state, 'cloud_net');
});

test('a meter parser does not overwrite the legacy energy accumulator', () => {
  const d = device('mtr_lo_red');
  const flow = fakeFlow({ lo_red_energy: 3.5 });
  run(generateParserSource(d, profileOf(d)), { payload: { dps: { 109: 251, 105: 275 } } }, flow);
  assert.equal(flow._dump().lo_red_energy, 3.5, 'the two-second engine still owns this key');
});

test('decoded capabilities persist across packets that do not repeat them', () => {
  // Settings are reported when they change. Without this, a card would show child lock on one
  // frame and blank on the next.
  const d = device('co3');
  const src = generateParserSource(d, profileOf(d));
  const flow = fakeFlow({ co3_last_day: new Date().getDate() });

  run(src, { payload: { dps: { 41: true } } }, flow);
  run(src, { payload: { dps: { 19: 748 } } }, flow);
  assert.equal(flow._dump().co3_dp.child_lock, true, 'still known after a telemetry-only packet');
  assert.equal(flow._dump().co3_dp.cur_power, 74.8);
});

test('health follows the status output and any dps arriving at all', () => {
  const d = device('co3');
  const src = generateParserSource(d, profileOf(d));
  const flow = fakeFlow({ co3_last_day: new Date().getDate() });

  run(src, { payload: 'DISCONNECTED' }, flow);
  assert.equal(flow._dump().co3_health, false);
  run(src, { payload: { state: 'CONNECTED' } }, flow);
  assert.equal(flow._dump().co3_health, true);
  run(src, { payload: 'ERROR' }, flow);
  assert.equal(flow._dump().co3_health, false);
  run(src, { payload: { dps: { 19: 10 } } }, flow);
  assert.equal(flow._dump().co3_health, true, 'data proves the session is alive');
});

test('an unknown dp is dropped rather than injected under its number', () => {
  const d = device('co3');
  const flow = fakeFlow({ co3_last_day: new Date().getDate() });
  run(generateParserSource(d, profileOf(d)), { payload: { dps: { 19: 748, 250: 'surprise' } } }, flow);
  assert.deepEqual(Object.keys(flow._dump().co3_dp), ['cur_power']);
});

test('the plan rewrites every dp-decoding node on the live flow, and only those', () => {
  const plan = planDpParsers(LIVE, { registry: DEVICE_REGISTRY });
  assert.equal(plan.changes.length, 12, '7 outlets + 4 meters + the shared lights collector');
  assert.deepEqual(
    plan.changes.map((c) => c.device).sort(),
    ['(lights)', 'co1', 'co2', 'co3', 'co4', 'co5', 'co6', 'co7',
     'mtr_arec_acu', 'mtr_co_yellow', 'mtr_lo_red', 'mtr_lo_yellow'],
  );
  for (const c of plan.changes) assert.ok(c.after.includes(GENERATED_MARKER));
});

test('the Aircon tab\'s second writer of arec_health is reported, never rewritten', () => {
  // `AREC ACU Daily Parser` also writes `arec_health` and belongs to a different tab with a
  // different job. Silently rewriting it would be the same undeclared-state problem in reverse.
  const plan = planDpParsers(LIVE, { registry: DEVICE_REGISTRY });
  const flagged = plan.warnings.find((w) => w.name === 'AREC ACU Daily Parser');
  assert.ok(flagged, 'the second writer is surfaced as a warning');
  assert.equal(flagged.device, 'mtr_arec_acu');
  assert.equal(plan.changes.some((c) => c.name === 'AREC ACU Daily Parser'), false);
});

test('applying the plan is idempotent and touches no other node', () => {
  const plan = planDpParsers(LIVE, { registry: DEVICE_REGISTRY });
  const applied = applyDpParserPlan(LIVE, plan);
  assert.equal(applied.length, LIVE.length, 'no node added or removed');

  const changedIds = new Set(plan.changes.map((c) => c.node));
  for (let i = 0; i < LIVE.length; i += 1) {
    if (!changedIds.has(LIVE[i].id)) assert.equal(applied[i], LIVE[i], 'untouched nodes keep identity');
  }
  assert.deepEqual(planDpParsers(applied, { registry: DEVICE_REGISTRY }).changes, [], 're-running changes nothing');
});

test('a device whose profile is missing is warned about, not silently skipped', () => {
  const broken = DEVICE_REGISTRY.map((d) => (d.id === 'co1' ? { ...d, capability_profile: 'nope' } : d));
  const plan = planDpParsers(LIVE, { registry: broken });
  assert.ok(plan.warnings.some((w) => w.device === 'co1' && /no capability profile/.test(w.reason)));
  assert.equal(plan.changes.some((c) => c.device === 'co1'), false);
});

test('the validator refuses a plan that would drop a context key', () => {
  // The keys these parsers write are read by the legacy /ui dashboard, the two-second totals
  // engine and the bridge collectors — none of which are in this repository. Losing one would
  // break something whose diff looked clean.
  const plan = planDpParsers(LIVE, { registry: DEVICE_REGISTRY });
  const target = plan.changes[0];
  const sabotaged = { ...plan, changes: [{ ...target, after: 'flow.set("nothing_useful", 1);' }] };
  const next = applyDpParserPlan(LIVE, sabotaged);

  const problems = validateDpParserPlan(LIVE, next, sabotaged);
  assert.ok(problems.length > 0);
  assert.match(problems.join('\n'), /would stop writing/);
});

test('the validator refuses a change to anything other than a parser\'s code', () => {
  const plan = planDpParsers(LIVE, { registry: DEVICE_REGISTRY });
  const next = applyDpParserPlan(LIVE, plan).map((n) =>
    n.id === plan.changes[0].node ? { ...n, wires: [] } : n);
  assert.match(validateDpParserPlan(LIVE, next, plan).join('\n'), /changed something other than its code/);
});

test('the validator refuses a change to a node nobody planned', () => {
  const plan = planDpParsers(LIVE, { registry: DEVICE_REGISTRY });
  const victim = LIVE.find((n) => n.type === 'function' && !plan.changes.some((c) => c.node === n.id));
  const next = applyDpParserPlan(LIVE, plan).map((n) =>
    n.id === victim.id ? { ...n, func: '// tampered' } : n);
  assert.match(validateDpParserPlan(LIVE, next, plan).join('\n'), /unplanned change/);
});

test('a clean plan passes its own validator', () => {
  const plan = planDpParsers(LIVE, { registry: DEVICE_REGISTRY });
  assert.deepEqual(validateDpParserPlan(LIVE, applyDpParserPlan(LIVE, plan), plan), []);
});

test('the generated lights collector keeps conn/on/lastSeen and adds the settings', () => {
  // `buildLatest` derives every switch's `online` from `conn`. If this drifted, the whole
  // lighting circuit would read offline while the relays worked perfectly.
  const src = generateSwitchCollectorSource(CAPABILITY_PROFILES.tdq_switch);
  const store = new Map();
  const global = { get: (k) => store.get(k), set: (k, v) => store.set(k, v) };
  // eslint-disable-next-line no-new-func
  const runSwitch = (msg) => new Function('msg', 'global', src)(msg, global);

  runSwitch({ lightId: '3', payload: { state: 'connected' } });
  assert.equal(store.get('lightStatus')['3'].conn, 'CONNECTED', 'still upper-cased');

  runSwitch({ lightId: '3', payload: { dps: { 1: true, 9: 0, 38: '2', 47: 'flip' } } });
  const cur = store.get('lightStatus')['3'];
  assert.equal(cur.on, true, 'relay state preserved');
  assert.equal(cur.conn, 'CONNECTED');
  assert.ok(cur.lastSeen, 'lastSeen still stamped');
  assert.equal(cur.dp.relay_status, 'memory', 'dp 38 "2" decodes through the alias table');
  assert.equal(cur.dp.switch_type, 'flip');
  assert.equal(cur.dp.countdown_1, 0);

  // Each light keeps its own entry — one node serves all seven.
  runSwitch({ lightId: '5', payload: { dps: { 1: false } } });
  assert.equal(store.get('lightStatus')['5'].on, false);
  assert.equal(store.get('lightStatus')['3'].on, true, "light 3 untouched by light 5's packet");
});

test('the lights collector is located by the global key it writes, not by its name', () => {
  const renamed = LIVE.map((n) =>
    typeof n.func === 'string' && n.func.includes("global.set('lightStatus'")
      ? { ...n, name: 'something else entirely' } : n);
  const plan = planDpParsers(renamed, { registry: DEVICE_REGISTRY });
  assert.equal(plan.changes.some((c) => c.device === '(lights)'), true);
});
