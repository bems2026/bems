/**
 * `semantic` does some work — the surviving half of the plan's Phase 6.
 *
 * THE ORIGINAL TARGET IS GONE. Phase 6 was written against `dpParserPlan`, which hard-coded
 * increment behaviour by matching the literal name `add_ele`. RM-047 deleted that accumulation
 * outright, so nothing there matches on a name any more. The concern survived one file over.
 *
 * `shared/buildLatest.mjs` decides whether to trust a meter's OWN daily counter or fall back to
 * the bridge's integrator, and it identified that counter as
 * `dp['today_acc_energy' + (d.channel || 1)]` — a literal, assembled by hand. The catalogue
 * already declares which capability that is: `semantic: 'cumulative_daily'`. The two agree today
 * by coincidence of naming, and `shared/deviceCapabilities.mjs`'s own header calls this exact
 * class of mistake out — *"assigning an increment to a cumulative"* — while `semantic` was, until
 * this change, read by no production code at all.
 *
 * WHAT WOULD GO WRONG. A meter product whose daily counter is coded anything else — and the
 * replication framework and RM-026's inverter both make a new product a real prospect — would
 * have `ownRaw` come back undefined, silently fall through to the integrated value, and lose
 * the accuracy EX-158 was built to gain. Nothing would report a fault; the number would just be
 * the worse one. That is the same silent-degradation shape the plan objected to.
 *
 * LATENT, NOT ACTIVE, and worth stating plainly: both meter profiles in this building code it
 * `today_acc_energy{n}`, so the literal and the catalogue currently name the same dp.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLatest } from '../shared/buildLatest.mjs';
import { dailyEnergyCodeFor, CAPABILITY_PROFILES } from '../shared/deviceCapabilities.mjs';
import { DEVICE_REGISTRY, PHASE_MAP } from '../shared/registry.mjs';

const NOW = Date.parse('2026-09-07T12:00:00+08:00');
const device = (id) => DEVICE_REGISTRY.find((d) => d.id === id);

// ---------------------------------------------------------------------------
// The catalogue lookup.
// ---------------------------------------------------------------------------

test('the daily counter is found by semantic, on the right channel', () => {
  assert.equal(dailyEnergyCodeFor(device('mtr_co_yellow')), 'today_acc_energy1');
  // Channel 2 of the dual meter is a DIFFERENT branch circuit. Taking channel 1's code here
  // would attribute one circuit's consumption to another — the failure `capabilityForDevice`'s
  // own header describes.
  assert.equal(dailyEnergyCodeFor(device('mtr_lo_yellow')), 'today_acc_energy2');
});

test('a device with no daily counter says so rather than guessing', () => {
  // `pc_outlet` has no cumulative energy dp at all — that is the whole reason RM-047 had to
  // integrate. Returning a plausible-looking name here would be the fault, not the fix.
  assert.equal(dailyEnergyCodeFor(device('co5')), null);
  assert.equal(dailyEnergyCodeFor(device('l7')), null);
  assert.equal(dailyEnergyCodeFor(undefined), null);
  assert.equal(dailyEnergyCodeFor({ id: 'x', capability_profile: 'nope' }), null);
});

test('every profile that declares a cumulative_daily is reachable through it', () => {
  for (const [id, p] of Object.entries(CAPABILITY_PROFILES)) {
    for (const cap of p.capabilities.filter((c) => c.semantic === 'cumulative_daily')) {
      const found = dailyEnergyCodeFor({ capability_profile: id, channel: cap.channel ?? 1 });
      assert.equal(found, cap.code, `${id} channel ${cap.channel ?? 1}`);
    }
  }
});

// ---------------------------------------------------------------------------
// buildLatest actually using it.
// ---------------------------------------------------------------------------

/** One metered device's snapshot, with whatever dps the test wants it to report. */
function snapFor(ctx, dp, p = 36) {
  return { energy: { meters: { [ctx]: { v: 230, c: 0.16, p, e: 1.5, h: 'CONNECTED', n: 5, dp } }, totals: {} } };
}
const rowFor = (payload, id) => payload.find((r) => r.device_id === id);

test('a meter still prefers its own daily counter — unchanged behaviour', () => {
  const d = device('mtr_co_yellow');
  const out = buildLatest(snapFor(d.ctx, { today_acc_energy1: 8.057 }), [d], PHASE_MAP, NOW, 480, {}, 100,
    { [d.id]: dailyEnergyCodeFor(d) });
  assert.equal(rowFor(out, d.id).energy_kwh_today, 8.057);
});

test('an older flow that passes no map behaves exactly as before', () => {
  // `build-flow.mjs` threads this in the same way it threads the site offset and the branch
  // bound. A deployed flow predating the change passes nothing, and must not change behaviour —
  // otherwise upgrading the repo silently changes what the bridge reports.
  const d = device('mtr_co_yellow');
  const out = buildLatest(snapFor(d.ctx, { today_acc_energy1: 8.057 }), [d], PHASE_MAP, NOW, 480, {}, 100);
  assert.equal(rowFor(out, d.id).energy_kwh_today, 8.057);
});

test('a differently-named daily counter is honoured — the point of the change', () => {
  // A hypothetical future meter product. Under the old literal this dp was invisible and the
  // device silently fell back to the integrated value; now the catalogue names it.
  const fake = {
    id: 'mtr_future', ctx: 'future', class: 'meter', display_name: 'Future Meter',
    capability_profile: 'cz_ct_single', channel: 1, branch_circuit: null,
  };
  const snap = snapFor('future', { daily_kwh_total: 4.25 });
  const withMap = buildLatest(snap, [fake], PHASE_MAP, NOW, 480, {}, 100, { mtr_future: 'daily_kwh_total' });
  assert.equal(rowFor(withMap, 'mtr_future').energy_kwh_today, 4.25, 'the named dp is preferred');

  const withoutMap = buildLatest(snap, [fake], PHASE_MAP, NOW, 480, {}, 100);
  assert.equal(rowFor(withoutMap, 'mtr_future').energy_kwh_today, 1.5,
    'and without it the device silently falls back to the integrator — the fault being fixed');
});

test('the day-base subtraction uses the same code, not a second literal', () => {
  // EX-158: the published figure is relative to where the counter stood at local midnight. If
  // the baseline looked up a different dp from the reading, the subtraction would be nonsense.
  const fake = {
    id: 'mtr_future', ctx: 'future', class: 'meter', display_name: 'Future Meter',
    capability_profile: 'cz_ct_single', channel: 1, branch_circuit: null,
  };
  const snap = snapFor('future', { daily_kwh_total: 10 });
  snap.energyDayBase = { future: { daily_kwh_total: 4 } };
  const out = buildLatest(snap, [fake], PHASE_MAP, NOW, 480, {}, 100, { mtr_future: 'daily_kwh_total' });
  assert.equal(rowFor(out, 'mtr_future').energy_kwh_today, 6, '10 minus the 4 banked at midnight');
});

test('an outlet is unaffected — it has no counter and must keep integrating', () => {
  const d = device('co5');
  const snap = {
    outlet: { meters: { co5: { v: 230, c: 0.4, p: 94, e: 2.268, h: 'CONNECTED', dp: {}, t: NOW } }, state: {} },
  };
  const out = buildLatest(snap, [d], PHASE_MAP, NOW, 480, {}, 100, {});
  assert.equal(rowFor(out, 'co5').energy_kwh_today, 2.268);
});
