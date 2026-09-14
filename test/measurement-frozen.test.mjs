/**
 * RM-079 — the bridge says when a measurement has frozen, rather than leaving every consumer to
 * notice from history.
 *
 * On 2026-09-12 L.O Red repeated one reading for fifteen hours while `online: true`, and the page
 * accused the bridge of losing 100 % of its energy, because the legacy integrator had multiplied the
 * held watts by the hours. The frontend now names such a freeze from its own 24h history (RM-077),
 * but only where that history is loaded. `buildLatest` now flags it on the reading itself, and
 * withholds the per-branch integrated figure while it holds, so no consumer can compare against it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLatest, iso8 } from '../shared/buildLatest.mjs';
import { DEVICE_REGISTRY, PHASE_MAP, DAILY_ENERGY_CODE_BY_DEVICE } from '../shared/registry.mjs';
import { FROZEN_AFTER_MS } from '../shared/measurementFreeze.mjs';

const NOW = 1789347000000;
const meter = (over = {}) => ({ v: '228.2', c: '0.576', p: '19.1', e: '0.3000', h: true, ...over });
// L.O Red's own daily register, so the reading comes from the register and the integration is
// published beside it as the second opinion — the case where withholding it means anything.
const loRedDp = { [DAILY_ENERGY_CODE_BY_DEVICE.mtr_lo_red]: 0.008 };

const snap = ({ valueSince, loRed = {}, outlet = {} } = {}) => ({
  energy: {
    meters: { co_yel: meter({ p: '350.0' }), lo_red: meter({ dp: loRedDp, ...loRed }), arec: meter(), lo_yel2: meter() },
    totals: { today: '1', week: '2', month: '3' },
  },
  outlet: { meters: { co1: meter(outlet) }, state: { status: {} } },
  switch: { state: {}, health: {} },
  aircon: { state: {} },
  ...(valueSince ? { valueSince } : {}),
});
const build = (s, threshold = FROZEN_AFTER_MS) => buildLatest(s, DEVICE_REGISTRY, PHASE_MAP, NOW, 480, {}, undefined, DAILY_ENERGY_CODE_BY_DEVICE, [], threshold);
const row = (rows, id) => rows.find((r) => r.device_id === id);
const LONG_AGO = NOW - FROZEN_AFTER_MS - 1_000;

test('the threshold is three hours — sized from the eleven devices, not the four meters (RM-077)', () => {
  assert.equal(FROZEN_AFTER_MS, 3 * 60 * 60 * 1000);
});

test('flags a meter whose values have not moved for three hours while it draws power', () => {
  const r = row(build(snap({ valueSince: { lo_red: LONG_AGO } })), 'mtr_lo_red');
  assert.equal(r.measurement_frozen, true);
  assert.equal(r.frozen_since, iso8(LONG_AGO, 480));
  // The meter's own register is still the reading; it is the second opinion that cannot be trusted.
  assert.equal(r.energy_kwh_today, 0.008);
  assert.equal('energy_kwh_today_integrated' in r, false);
});

test('says nothing, and keeps the second opinion, while the values have moved within three hours', () => {
  const r = row(build(snap({ valueSince: { lo_red: NOW - FROZEN_AFTER_MS + 60_000 } })), 'mtr_lo_red');
  assert.equal('measurement_frozen' in r, false);
  assert.equal(r.energy_kwh_today_integrated, 0.3);
});

test('does not call an idle circuit frozen — a channel at 0 W legitimately reports nothing new', () => {
  const r = row(build(snap({ valueSince: { lo_red: LONG_AGO }, loRed: { p: '0.0', c: '0.000' } })), 'mtr_lo_red');
  assert.equal('measurement_frozen' in r, false);
});

test('does not call a device frozen that is already offline — that is a different, louder fact', () => {
  const r = row(build(snap({ valueSince: { lo_red: LONG_AGO }, loRed: { h: false } })), 'mtr_lo_red');
  assert.equal(r.online, false);
  assert.equal('measurement_frozen' in r, false);
});

test('flags an outlet the same way', () => {
  const r = row(build(snap({ valueSince: { co1: LONG_AGO } })), 'co1');
  assert.equal(r.measurement_frozen, true);
});

test('says nothing for a device the tracker has no stamp for', () => {
  const rows = build(snap({ valueSince: { lo_red: LONG_AGO } }));
  assert.equal('measurement_frozen' in row(rows, 'mtr_arec_acu'), false);
});

test('a flow too old to pass a threshold behaves exactly as before', () => {
  // Nine arguments, as an older deployed flow calls it. Not `build(s, undefined)`: an explicit
  // undefined takes the helper's default, which is how this test first passed the threshold anyway.
  const rows = buildLatest(snap({ valueSince: { lo_red: LONG_AGO } }), DEVICE_REGISTRY, PHASE_MAP, NOW, 480, {}, undefined, DAILY_ENERGY_CODE_BY_DEVICE, []);
  const r = row(rows, 'mtr_lo_red');
  assert.equal('measurement_frozen' in r, false);
  assert.equal(r.energy_kwh_today_integrated, 0.3);
});
