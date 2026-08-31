/**
 * The mock bridge has to serve whatever site is configured — RM-033.
 *
 * WHY THIS EXISTS, and it is a scar found the same day it was written. Standing up a scaffolded
 * second site and starting `npm run mock` produced:
 *
 *     TypeError: Cannot read properties of undefined (reading 'toFixed')
 *     at mk (mock-bridge/server.mjs:188)
 *
 * because the mock named the CARE office's four branch-meter context keys as literals, and
 * looped `1..7` for outlets and lights. It could only ever serve one building.
 *
 * That matters more than a dev fixture usually would. The mock is how a second deployment is
 * developed and demonstrated BEFORE any hardware exists — which is exactly the position another
 * SUC is in, and exactly what Milestone 6 is for. A replication framework whose first `npm run`
 * crashes is not one.
 *
 * The plan is derived from the registry rather than declared, so a site describes its own
 * hardware and the fixture follows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixturePlan, branchEnergyTotal } from '../mock-bridge/fixturePlan.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

/** A registry sharing no id, ctx or state key with the CARE office. */
const OTHER_SITE = [
  { id: 'annex-sw1', class: 'switch', state_key: 'A1', ctx: null },
  { id: 'annex-sw2', class: 'switch', state_key: 'A2', ctx: null },
  { id: 'annex-co1', class: 'outlet_dual', ctx: 'annex_co1', sockets: ['A_CO1_1', 'A_CO1_2'] },
  { id: 'annex-mtr', class: 'meter', ctx: 'annex_main' },
  { id: 'annex-acu', class: 'acu_ir', ctx: null },
];

test('a site that shares nothing with the CARE office still gets a complete plan', () => {
  const plan = fixturePlan(OTHER_SITE);
  assert.deepEqual(plan.outlets.map((d) => d.id), ['annex-co1']);
  assert.deepEqual(plan.switches.map((d) => d.id), ['annex-sw1', 'annex-sw2']);
  assert.deepEqual(plan.branchCtx, ['annex_main']);
  // Every ctx the fixture will index an accumulator by, so the caller can seed all of them.
  assert.deepEqual(plan.meteredCtx, ['annex_co1', 'annex_main']);
});

test('a freshly scaffolded site — no devices at all — produces empty lists, not a crash', () => {
  // `npm run site:new` writes an empty device list on purpose. The very first thing anyone does
  // with a new site is start the mock, so this is the case that must not throw.
  const plan = fixturePlan([]);
  assert.deepEqual(plan, { outlets: [], switches: [], branchCtx: [], meteredCtx: [] });
});

test('an outlet without its socket keys is left out rather than half-simulated', () => {
  // A half-described outlet would index `sockets[1]` as undefined and emit a socket named
  // "undefined", which reads as a real socket in a real state.
  const plan = fixturePlan([{ id: 'x', class: 'outlet_dual', ctx: 'x', sockets: ['ONLY_ONE'] }]);
  assert.deepEqual(plan.outlets, []);
});

test('a switch without a state key is left out, because nothing could address it', () => {
  const plan = fixturePlan([{ id: 'x', class: 'switch', state_key: null }]);
  assert.deepEqual(plan.switches, []);
});

test('the live site still yields exactly what the fixture used to hardcode', () => {
  // The regression guard for the CARE office: this is what the four literals and the two 1..7
  // loops meant, and the derivation has to reproduce them exactly or the mock's output shifts.
  const plan = fixturePlan(DEVICE_REGISTRY);
  assert.deepEqual(plan.outlets.map((d) => d.ctx), ['co1', 'co2', 'co3', 'co4', 'co5', 'co6', 'co7']);
  assert.deepEqual(plan.switches.map((d) => d.state_key), ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
  assert.deepEqual(plan.branchCtx, ['co_yel', 'lo_red', 'arec', 'lo_yel2']);
});

test('every branch ctx is one the accumulator will actually hold', () => {
  // The exact shape of the crash: a branch key with no accumulator entry. Asserted as a
  // relationship rather than a list, so it stays true for a site nobody has written yet.
  for (const registry of [DEVICE_REGISTRY, OTHER_SITE, []]) {
    const plan = fixturePlan(registry);
    for (const ctx of plan.branchCtx) {
      assert.ok(plan.meteredCtx.includes(ctx), `${ctx} has no accumulator`);
    }
  }
});

/**
 * A BUILDING WITH NO METERS HAS NOT USED 0 kWh — it has used an unknown amount, and the two are
 * different claims. Found on a freshly scaffolded site: Live Demand and voltage both correctly
 * read "—", the Blue phase correctly read "not metered", and the energy tiles read
 * `0.00 kWh` / `0.0 kWh` / `0.0 kWh`. A new operator's first look at their own building would
 * have told them it consumed nothing.
 *
 * `buildLatest` already does the right thing — it renders an absent total as null and only a
 * present one as a number. The zero was manufactured one layer earlier, by a `reduce(..., 0)`
 * over an empty list. This is the same rule as RM-024 and EX-107, at the layer that seeds it.
 */
test('a site with no branch meters reports nothing, not zero', () => {
  assert.equal(branchEnergyTotal({}, []), undefined);
  // Even with accumulators present: if no circuit claims them as branch meters, nothing sums.
  assert.equal(branchEnergyTotal({ some_ctx: 4.2 }, []), undefined);
});

test('a site with branch meters sums exactly those', () => {
  assert.equal(branchEnergyTotal({ a: 1.5, b: 2.5, other: 99 }, ['a', 'b']), 4);
});

test('a branch meter that has accumulated nothing yet still counts as observed', () => {
  // Zero is a real answer once there IS a meter — it has been read and it read zero. The
  // distinction this whole test file exists for is "no meter" versus "a meter reading zero".
  assert.equal(branchEnergyTotal({ a: 0 }, ['a']), 0);
});

test('a branch meter with no accumulator entry does not poison the sum with NaN', () => {
  assert.equal(branchEnergyTotal({ a: 1 }, ['a', 'missing']), 1);
});

