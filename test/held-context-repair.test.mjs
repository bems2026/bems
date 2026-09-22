/**
 * The bridge's own copy of a held reading, corrected — the sibling of `scrub:held` (RM-136).
 *
 * `scrub:held` corrected the STORED rows of L.O Yellow's 2026-09-22 hold. Node-RED keeps two more copies
 * of it in flow context, and the page reads both: the 24 h history ring (so the hold was still named as a
 * freeze) and the legacy two-second integrator, which multiplied the held 39.8 W by six and a half hours
 * (so without the ring's hold to subtract, the page would say "47 % missing" again). Both are corrected
 * together or neither: correcting one alone moves the page from one false notice to the other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planHeldContextRepair } from '../node-red-bridge/heldContextRepair.mjs';

const T0 = Date.parse('2026-09-22T07:40:00+08:00');
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const sample = (min, p, c, over = {}) => ({ ts: at(min), power_w: p, voltage: 226.7, current: c, online: true, sample_ts: at(min), ...over });

/** 07:40–07:43 measured lights, 07:44–08:43 held 39.8 W (one offline blip, the last ten flagged), then 0 W. */
function ring() {
  const out = [];
  for (let m = 0; m < 4; m++) out.push(sample(m, 40.1, 0.455));
  for (let m = 4; m < 64; m++) out.push(sample(m, 39.8, 0.446, { ...(m === 20 ? { online: false } : {}), ...(m >= 54 ? { frozen: true } : {}) }));
  for (let m = 64; m < 70; m++) out.push(sample(m, 0, 0));
  return out;
}
const energy = () => ({ lo_yel2_energy: 0.3, bems_energy_today: 5.0, bems_energy_week: 20.0, bems_energy_month: 100.0, co_yel_energy: 4.0 });
const args = (over = {}) => ({
  ring: ring(),
  energy: energy(),
  ctx: 'lo_yel2',
  fromMs: T0 + 4 * 60_000,
  toMs: T0 + 63 * 60_000,
  ...over,
});

test('the held samples in the window become 0 W / 0 A, lose the flag, and nothing else in the ring moves', () => {
  const plan = planHeldContextRepair(args());
  assert.equal(plan.refused, null);
  assert.equal(plan.changed, 60);
  const before = ring();
  plan.ring.forEach((s, i) => {
    if (i >= 4 && i < 64) {
      assert.equal(s.power_w, 0);
      assert.equal(s.current, 0);
      assert.equal('frozen' in s, false);
      assert.equal(s.voltage, before[i].voltage, 'the voltage is left as the bridge showed it');
      assert.equal(s.online, before[i].online, 'online is the sample\'s own fact');
    } else {
      assert.deepEqual(s, before[i]);
    }
  });
});

test('the phantom is the held power over the time the integrator ran — online samples only', () => {
  // 60 held samples a minute apart; the offline one's minute is not integrated (the integrator skips an
  // unhealthy branch), and the last sample's own minute is not counted either: 58 minutes.
  const plan = planHeldContextRepair(args());
  assert.ok(Math.abs(plan.phantomKwh - (39.8 * 58) / 60 / 1000) < 1e-9, `phantom ${plan.phantomKwh}`);
});

test('every legacy integrator that counted it is reduced by it, and no other key moves', () => {
  const plan = planHeldContextRepair(args());
  const p = plan.phantomKwh;
  assert.deepEqual(Object.keys(plan.energy).sort(), Object.keys(energy()).sort());
  for (const k of ['lo_yel2_energy', 'bems_energy_today', 'bems_energy_week', 'bems_energy_month']) {
    assert.ok(Math.abs(plan.energy[k] - (energy()[k] - p)) < 1e-12, k);
  }
  assert.equal(plan.energy.co_yel_energy, 4.0, 'another branch\'s integrator is not touched');
});

test('refuses when the window holds no single held reading to correct', () => {
  assert.match(planHeldContextRepair(args({ fromMs: T0 + 64 * 60_000, toMs: T0 + 69 * 60_000 })).refused, /no held/);
  const mixed = ring();
  mixed[30] = { ...mixed[30], power_w: 12.5 };
  assert.match(planHeldContextRepair(args({ ring: mixed })).refused, /not one held reading/);
});

test('refuses rather than drive an integrator below zero — it would not have counted what is being removed', () => {
  assert.match(planHeldContextRepair(args({ energy: { ...energy(), lo_yel2_energy: 0.01 } })).refused, /lo_yel2_energy/);
});

test('is idempotent — a repaired ring has nothing held left to find', () => {
  const once = planHeldContextRepair(args());
  const twice = planHeldContextRepair(args({ ring: once.ring, energy: once.energy }));
  assert.match(twice.refused, /no held/);
});
