/**
 * The history correction for RM-047. This rewrites rows in a production table, so the rule gets
 * the same scrutiny the parser did.
 *
 *     node --test server/backfillOutletEnergy.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { recomputeDailyEnergy, localDayKey, outletIdsFrom } from './backfillOutletEnergy.mjs';
import { MAX_INTEGRATION_GAP_MS } from '../node-red-bridge/dpParserPlan.mjs';
import { DEVICE_REGISTRY, SITE } from '../shared/registry.mjs';

const OFFSET = SITE.utc_offset_minutes;
/** Minute-spaced rows starting at a local time, at a constant wattage. */
function series(startLocal, count, power_w, online = true, stepMs = 60_000) {
  const t0 = Date.parse(startLocal);
  return Array.from({ length: count }, (_, i) => ({
    ts: new Date(t0 + i * stepMs).toISOString(), power_w, online,
  }));
}
const last = (a) => a[a.length - 1].energy_kwh_today;

// ---------------------------------------------------------------------------
// The rule must be the parser's rule, or history and future are different quantities.
// ---------------------------------------------------------------------------

test('a steady load integrates to power times time', () => {
  // 60 samples a minute apart is 59 intervals, so 59 minutes at 600 W.
  const out = recomputeDailyEnergy(series('2026-09-05T08:00:00+08:00', 60, 600), OFFSET);
  assert.ok(Math.abs(last(out) - 0.59) < 1e-6, `got ${last(out)}`);
});

test('the interval is trapezoid over both endpoints', () => {
  const rows = [
    { ts: '2026-09-05T08:00:00+08:00', power_w: 0, online: true },
    { ts: '2026-09-05T08:01:00+08:00', power_w: 600, online: true },
  ];
  assert.ok(Math.abs(last(recomputeDailyEnergy(rows, OFFSET)) - 0.005) < 1e-9,
    'right-endpoint would give 0.01');
});

test('the first row of a series carries no interval', () => {
  const out = recomputeDailyEnergy(series('2026-09-05T08:00:00+08:00', 1, 600), OFFSET);
  assert.equal(out[0].energy_kwh_today, 0);
});

test('the value is cumulative across the day, not per row', () => {
  const out = recomputeDailyEnergy(series('2026-09-05T08:00:00+08:00', 4, 600), OFFSET);
  assert.deepEqual(out.map((r) => Math.round(r.energy_kwh_today * 1e6)), [0, 10000, 20000, 30000]);
});

test('a gap beyond the cap is skipped, exactly as the parser skips it', () => {
  const rows = [
    { ts: '2026-09-05T08:00:00+08:00', power_w: 600, online: true },
    { ts: new Date(Date.parse('2026-09-05T08:00:00+08:00') + MAX_INTEGRATION_GAP_MS + 1000).toISOString(), power_w: 600, online: true },
  ];
  assert.equal(last(recomputeDailyEnergy(rows, OFFSET)), 0);
});

// ---------------------------------------------------------------------------
// The online guard — the one thing history needs that the live path gets for free.
// ---------------------------------------------------------------------------

test("co5's frozen day integrates to nothing, not to 12.33 kWh", () => {
  // The measured case: 2026-08-28, 1,440 rows, `online: false` on every one, `power_w` frozen at
  // exactly 513.9 W. Naively integrated that is 12.33 kWh a day, and it held for eight
  // consecutive days — a fabrication larger than the fault being corrected.
  const out = recomputeDailyEnergy(series('2026-08-28T00:00:00+08:00', 1440, 513.9, false), OFFSET);
  assert.equal(last(out), 0);
});

test('an interval is refused if EITHER endpoint was offline', () => {
  // Not just the arriving one. A device that drops mid-interval has an unknown second half.
  const goingDown = [
    { ts: '2026-09-05T08:00:00+08:00', power_w: 600, online: true },
    { ts: '2026-09-05T08:01:00+08:00', power_w: 600, online: false },
  ];
  const comingBack = [
    { ts: '2026-09-05T08:00:00+08:00', power_w: 600, online: false },
    { ts: '2026-09-05T08:01:00+08:00', power_w: 600, online: true },
  ];
  assert.equal(last(recomputeDailyEnergy(goingDown, OFFSET)), 0);
  assert.equal(last(recomputeDailyEnergy(comingBack, OFFSET)), 0);
});

test('an outage in the middle of a day costs only the intervals it covers', () => {
  const rows = [
    ...series('2026-09-05T08:00:00+08:00', 11, 600, true),          // 10 minutes at 600 W
    ...series('2026-09-05T08:11:00+08:00', 10, 600, false),         // offline
    ...series('2026-09-05T08:21:00+08:00', 11, 600, true),          // back, 10 more minutes
  ];
  // The two online stretches contribute; the offline one and the two boundary intervals do not.
  assert.ok(Math.abs(last(recomputeDailyEnergy(rows, OFFSET)) - 0.2) < 0.002, `got ${last(recomputeDailyEnergy(rows, OFFSET))}`);
});

// ---------------------------------------------------------------------------
// The local-midnight rollover.
// ---------------------------------------------------------------------------

test('the counter resets at LOCAL midnight, not UTC midnight', () => {
  // +08:00. A UTC-midnight reset would put the office's evening into the next day.
  const rows = series('2026-09-05T23:58:00+08:00', 5, 600);
  const out = recomputeDailyEnergy(rows, OFFSET);
  assert.ok(out[1].energy_kwh_today > 0, 'still accruing before midnight');
  assert.equal(out[2].energy_kwh_today, 0, 'the 00:00 row opens the new day at zero');
  assert.ok(out[3].energy_kwh_today > 0, 'and accrues again after it');
});

test('localDayKey uses the site offset', () => {
  assert.equal(localDayKey('2026-09-05T16:30:00Z', 480), '2026-09-06');
  assert.equal(localDayKey('2026-09-05T15:30:00Z', 480), '2026-09-05');
});

// ---------------------------------------------------------------------------
// Safety.
// ---------------------------------------------------------------------------

test('running it twice changes nothing', () => {
  // It reads ts, power_w and online, and writes none of them — but asserting that is what makes
  // it safe to re-run against a table where it may already have been applied.
  const rows = series('2026-09-05T08:00:00+08:00', 30, 431.7);
  assert.deepEqual(recomputeDailyEnergy(rows, OFFSET), recomputeDailyEnergy(rows, OFFSET));
});

test('a non-finite wattage skips its interval rather than counting as zero', () => {
  const rows = [
    { ts: '2026-09-05T08:00:00+08:00', power_w: 600, online: true },
    { ts: '2026-09-05T08:01:00+08:00', power_w: null, online: true },
    { ts: '2026-09-05T08:02:00+08:00', power_w: 600, online: true },
  ];
  assert.equal(last(recomputeDailyEnergy(rows, OFFSET)), 0, 'neither interval is computable');
});

test('it can never reach a meter', () => {
  // A CT meter's energy comes from its OWN today_acc_energy counter. Recomputing that from power
  // would replace a measurement with an estimate, which is the opposite of the point.
  const ids = outletIdsFrom(DEVICE_REGISTRY);
  assert.deepEqual(ids.sort(), ['co1', 'co2', 'co3', 'co4', 'co5', 'co6', 'co7']);
  for (const id of ['mtr_co_yellow', 'mtr_lo_red', 'mtr_arec_acu', 'mtr_lo_yellow', 'l7']) {
    assert.equal(ids.includes(id), false, `${id} must not be touched`);
  }
});

test('the outlet list is derived from the registry, not hard-coded', () => {
  // A site with a different number of outlets gets the right answer with no edit here.
  const fake = [{ id: 'x1', class: 'outlet_dual' }, { id: 'm1', class: 'meter' }, { id: 's1', class: 'switch' }];
  assert.deepEqual(outletIdsFrom(fake), ['x1']);
});

test('a numeric string wattage is accepted — PostgREST may send numeric either way', () => {
  const rows = [
    { ts: '2026-09-05T08:00:00+08:00', power_w: '600', online: true },
    { ts: '2026-09-05T08:01:00+08:00', power_w: '600', online: true },
  ];
  assert.ok(Math.abs(last(recomputeDailyEnergy(rows, OFFSET)) - 0.01) < 1e-9);
});

test('an undefined wattage is refused like a null one', () => {
  const rows = [
    { ts: '2026-09-05T08:00:00+08:00', power_w: 600, online: true },
    { ts: '2026-09-05T08:01:00+08:00', online: true },
  ];
  assert.equal(last(recomputeDailyEnergy(rows, OFFSET)), 0);
});
