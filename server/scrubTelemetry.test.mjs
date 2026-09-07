/**
 * The ingestion guard that did not exist.
 *
 * `shapeRows.mjs` was seven `?? null` assignments — no type check, no finiteness check, no
 * range check, no timestamp check. That is why 3,625 kWh on a circuit averaging 36 W reached
 * Supabase unchallenged on 2026-09-03 and had to be repaired by hand afterwards.
 *
 * WHAT THIS IS AND IS NOT. It is a backstop against the physically impossible. It is NOT an
 * accuracy check, and the difference is measurable on this fleet today: co5 reported 72.427 kWh
 * for a local day whose own power integrates to 2.268 kWh — 32x overstated, and comfortably
 * inside `max_branch_kwh_per_day: 100`. A bound wide enough to be safe cannot catch that, and a
 * bound narrow enough to catch it would discard real readings. Wrong values are caught upstream
 * by fixing what produced them; this file exists so that the *impossible* never lands.
 *
 *     node --test server/scrubTelemetry.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scrubReading,
  scrubTotals,
  readingBounds,
  totalsBounds,
  TS_MAX_FUTURE_MS,
  TS_MAX_PAST_MS,
} from './scrubTelemetry.mjs';
import { SITE } from '../shared/registry.mjs';

const NOW = Date.parse('2026-09-07T14:00:00+08:00');
const TS = '2026-09-07T13:59:00+08:00';
const BOUNDS = readingBounds(SITE);

/** A reading exactly as `splitLatestPayload` would have shaped it, all fields plausible. */
const clean = (over = {}) => ({
  device_id: 'co5', ts: TS,
  voltage: 231.4, current: 0.412, power_w: 94.6, energy_kwh_today: 2.268,
  online: true,
  ...over,
});

// ---------------------------------------------------------------------------
// The values that must survive. A scrub that discards real data is worse than none.
// ---------------------------------------------------------------------------

test('a plausible reading passes through completely unchanged', () => {
  const row = clean();
  const result = scrubReading(row, BOUNDS, NOW);
  assert.deepEqual(result.row, row);
  assert.deepEqual(result.rejections, []);
});

test('zero is kept — it is a reading, not a missing value', () => {
  // The whole point of "omit, never zero" cuts both ways: a real 0 W must not be treated as
  // suspect. Every outlet in this building reports 0 W for most of the night.
  const result = scrubReading(clean({ power_w: 0, current: 0, voltage: 0, energy_kwh_today: 0 }), BOUNDS, NOW);
  assert.equal(result.row.power_w, 0);
  assert.equal(result.row.current, 0);
  assert.equal(result.row.voltage, 0);
  assert.equal(result.row.energy_kwh_today, 0);
  assert.deepEqual(result.rejections, []);
});

test('null stays null and is not counted as a rejection', () => {
  // A light switch has no metering at all; its fields are absent, not wrong.
  const result = scrubReading(
    { device_id: 'l7', ts: TS, voltage: null, current: null, power_w: null, energy_kwh_today: null, online: true },
    BOUNDS, NOW,
  );
  assert.equal(result.row.power_w, null);
  assert.deepEqual(result.rejections, []);
});

test('the measured extremes of 22 days of live readings all pass', () => {
  // Sized against the real fleet, not against a guess. These are the actual max values in
  // `readings` on 2026-09-07 over 610,989 rows. If a future bound change rejects one of these
  // it is rejecting something this building has genuinely done.
  const result = scrubReading(
    clean({ voltage: 241.8, current: 15.974, power_w: 3091.3, energy_kwh_today: 74.006 }),
    BOUNDS, NOW,
  );
  assert.deepEqual(result.rejections, []);
});

// ---------------------------------------------------------------------------
// Omit, never zero.
// ---------------------------------------------------------------------------

test('the 2026-09-03 fault is omitted, not zeroed', () => {
  // The value that actually reached Supabase: L.O Yellow's channel-2 counter carrying an
  // offset nobody cleared. Zeroing it would have been the worse bug — a fabricated reading
  // that averages into every rollup, where null is visibly absent.
  const result = scrubReading(clean({ device_id: 'lo_yel2', energy_kwh_today: 3625.108 }), BOUNDS, NOW);
  assert.equal(result.row.energy_kwh_today, null);
  assert.notEqual(result.row.energy_kwh_today, 0);
  assert.equal(result.rejections.length, 1);
});

test('rejecting one field leaves every other field on the row', () => {
  // Never drop the whole row: `online` carries the truth about the device, and dropping rows
  // would put holes in a series that currently has none (0% missing over 359 minutes).
  const result = scrubReading(clean({ energy_kwh_today: 3625.108 }), BOUNDS, NOW);
  assert.equal(result.row.voltage, 231.4);
  assert.equal(result.row.current, 0.412);
  assert.equal(result.row.power_w, 94.6);
  assert.equal(result.row.online, true);
  assert.equal(result.row.device_id, 'co5');
  assert.equal(result.row.ts, TS);
});

test('a rejection says enough to diagnose it without the payload', () => {
  const [r] = scrubReading(clean({ energy_kwh_today: 3625.108 }), BOUNDS, NOW).rejections;
  assert.equal(r.device_id, 'co5');
  assert.equal(r.field, 'energy_kwh_today');
  assert.equal(r.value, 3625.108);
  assert.match(r.reason, /100/);
  assert.match(String(r), /co5/);
  assert.match(String(r), /energy_kwh_today/);
});

// ---------------------------------------------------------------------------
// Finiteness and type.
// ---------------------------------------------------------------------------

for (const bad of [NaN, Infinity, -Infinity]) {
  test(`${bad} is rejected rather than stored`, () => {
    const result = scrubReading(clean({ power_w: bad }), BOUNDS, NOW);
    assert.equal(result.row.power_w, null);
    assert.equal(result.rejections.length, 1);
    assert.match(result.rejections[0].reason, /finite/);
  });
}

test('a non-number is rejected even when it looks like one', () => {
  // `docs/bridge-contract.md` says these are numbers and `buildLatest`'s `num()` guarantees it.
  // A string here is a broken contract upstream; coercing it would store the value and hide the
  // break, which is the failure shape this whole file exists to stop.
  const result = scrubReading(clean({ voltage: '231.4' }), BOUNDS, NOW);
  assert.equal(result.row.voltage, null);
  assert.equal(result.rejections.length, 1);
});

test('a boolean in a numeric field does not become 1', () => {
  const result = scrubReading(clean({ current: true }), BOUNDS, NOW);
  assert.equal(result.row.current, null);
});

test('online is a flag, not telemetry, and is never scrubbed', () => {
  const result = scrubReading(clean({ online: false }), BOUNDS, NOW);
  assert.equal(result.row.online, false);
  assert.deepEqual(result.rejections, []);
});

// ---------------------------------------------------------------------------
// Physical bounds.
// ---------------------------------------------------------------------------

test('a negative magnitude is rejected', () => {
  // Volts, amps and watts are unsigned magnitudes from these CT clamps. This is the bound to
  // revisit when RM-026's inverter lands, because export is real negative power.
  const result = scrubReading(clean({ power_w: -5 }), BOUNDS, NOW);
  assert.equal(result.row.power_w, null);
});

test('a voltage no 230 V installation can produce is rejected', () => {
  const result = scrubReading(clean({ voltage: 61234 }), BOUNDS, NOW);
  assert.equal(result.row.voltage, null);
  assert.equal(result.rejections[0].field, 'voltage');
});

test('the energy bound is the site\'s declared one, not a second copy', () => {
  // `max_branch_kwh_per_day` is already the backstop `buildLatest` applies at the bridge. This
  // is the same fact enforced a second time at ingestion, where an older deployed flow cannot
  // reach — not a new number that could drift from it.
  assert.equal(BOUNDS.energy_kwh_today.max, SITE.max_branch_kwh_per_day);
});

test('a site that declares no bounds rejects nothing', () => {
  // A deployment predating this file must behave exactly as it did, or upgrading the code
  // becomes a data-loss event.
  const result = scrubReading(clean({ voltage: 61234, power_w: -5 }), readingBounds({}), NOW);
  assert.equal(result.row.voltage, 61234);
  assert.equal(result.row.power_w, -5);
  assert.deepEqual(result.rejections, []);
});

// ---------------------------------------------------------------------------
// Timestamps. The one field that cannot be nulled — it is half the upsert key.
// ---------------------------------------------------------------------------

test('a row whose timestamp is unusable is dropped, because it was never storable', () => {
  // `iso8(NaN)` yields the literal string "NaN-NaN-NaNTNaN:NaN:NaN+08:00". Postgres rejects it
  // with a 400, `writeOrBuffer` appends the whole batch to the outage buffer, and `flushBuffer`
  // replays it at the head of the queue on every subsequent cycle — for ever. One malformed
  // timestamp wedges ingestion permanently. This is the only case where dropping a row is
  // right: a row with no usable key was never a row.
  const result = scrubReading(clean({ ts: 'NaN-NaN-NaNTNaN:NaN:NaN+08:00' }), BOUNDS, NOW);
  assert.equal(result.row, null);
  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0].field, 'ts');
});

test('a timestamp from the future is dropped', () => {
  const ts = new Date(NOW + TS_MAX_FUTURE_MS + 60000).toISOString();
  assert.equal(scrubReading(clean({ ts }), BOUNDS, NOW).row, null);
});

test('a timestamp older than the past window is dropped', () => {
  const ts = new Date(NOW - TS_MAX_PAST_MS - 60000).toISOString();
  assert.equal(scrubReading(clean({ ts }), BOUNDS, NOW).row, null);
});

test('a little clock skew is tolerated — the Pi stamps these itself', () => {
  const ts = new Date(NOW + 30000).toISOString();
  assert.notEqual(scrubReading(clean({ ts }), BOUNDS, NOW).row, null);
});

test('a missing timestamp is dropped rather than defaulted to now', () => {
  // Substituting the receipt time would fabricate WHEN, which is the same class of harm as
  // fabricating a value and considerably harder to notice afterwards.
  assert.equal(scrubReading(clean({ ts: undefined }), BOUNDS, NOW).row, null);
});

// ---------------------------------------------------------------------------
// Building totals — a different row shape, the same rules.
// ---------------------------------------------------------------------------

const TOTALS = totalsBounds(SITE);
const cleanTotals = (over = {}) => ({
  ts: TS, site_id: SITE.id,
  energy_kwh_today: 11.44, energy_kwh_week: 66.74, energy_kwh_month: 90.95,
  total_power_w: 1561.1, avg_voltage: 231.2,
  phase_current_red: 2.1, phase_current_yellow: 4.6, phase_current_blue: null,
  ...over,
});

test('the measured extremes of 22 days of building totals all pass', () => {
  const result = scrubTotals(
    cleanTotals({
      total_power_w: 4551.3, avg_voltage: 233.7,
      phase_current_red: 8.945, phase_current_yellow: 15.974,
      energy_kwh_today: 21.83, energy_kwh_week: 66.74, energy_kwh_month: 90.95,
    }),
    TOTALS, NOW,
  );
  assert.deepEqual(result.rejections, []);
});

test('phase_current_blue stays null without being called a rejection', () => {
  // There is no Blue-phase meter installed. Null is the correct, permanent answer here, and
  // counting it as a rejection every minute would bury a real one.
  const result = scrubTotals(cleanTotals(), TOTALS, NOW);
  assert.equal(result.row.phase_current_blue, null);
  assert.deepEqual(result.rejections, []);
});

test('site_id is never scrubbed', () => {
  const result = scrubTotals(cleanTotals(), TOTALS, NOW);
  assert.equal(result.row.site_id, SITE.id);
});

test('the week and month bounds scale from the building daily bound', () => {
  // Derived rather than declared, so a site that raises its daily ceiling cannot leave a
  // stale weekly one behind that quietly rejects its real data.
  assert.equal(TOTALS.energy_kwh_week.max, TOTALS.energy_kwh_today.max * 7);
  assert.equal(TOTALS.energy_kwh_month.max, TOTALS.energy_kwh_today.max * 31);
});

test('an impossible building total is omitted, not zeroed', () => {
  const result = scrubTotals(cleanTotals({ total_power_w: 999999 }), TOTALS, NOW);
  assert.equal(result.row.total_power_w, null);
  assert.equal(result.rejections.length, 1);
});

test('a totals row with a bad timestamp is dropped like any other', () => {
  assert.equal(scrubTotals(cleanTotals({ ts: 'not a date' }), TOTALS, NOW).row, null);
});
