import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyProfile, estimateRows, heldStep, spreadHeldEnergy } from './heldEnergy.mjs';

/**
 * RM-165 (E-260). On 2026-10-28 the four circuit meters resumed when the site's internet returned, and their
 * lifetime registers had kept counting through a two-week hold: CARE ACU 152.972 -> 185.945 kWh in one reading.
 * The figures below are those readings, from the edge's archive.
 */

const OFFSET = 480;
const local = (s) => Date.parse(`${s}+08:00`);
const sum = (parts) => Math.round(parts.reduce((a, p) => a + p.kwh, 0) * 1000) / 1000;

test('the spread sums exactly to what was held, by local day, part days by the share held', () => {
  const parts = spreadHeldEnergy({ kwh: 32.495, fromMs: local('2026-10-14T13:22:01'), toMs: local('2026-10-28T00:00:00'), profile: { weekday: 4.6, weekend: 0.3 }, offsetMinutes: OFFSET });
  assert.equal(sum(parts), 32.495);
  assert.equal(parts[0].day, '2026-10-14');
  assert.equal(parts.at(-1).day, '2026-10-27');
  const by = Object.fromEntries(parts.map((p) => [p.day, p.kwh]));
  assert.ok(by['2026-10-14'] < by['2026-10-15'], 'the 14th was held from 13:22 only');
  assert.ok(by['2026-10-18'] < by['2026-10-19'] / 5, 'a Sunday takes a Sunday share, not a Monday one');
});

test('a profile that says nothing is used falls back to time held, rather than dropping the energy', () => {
  const parts = spreadHeldEnergy({ kwh: 1.2, fromMs: local('2026-10-17T00:00:00'), toMs: local('2026-10-19T00:00:00'), profile: { weekday: 3, weekend: 0 }, offsetMinutes: OFFSET });
  assert.deepEqual(parts, [{ day: '2026-10-17', kwh: 0.6 }, { day: '2026-10-18', kwh: 0.6 }]);
});

const row = (ts, total, today, power = 529.6) => ({ ts: new Date(local(ts)).toISOString(), power_w: power, total_energy_kwh: total, energy_kwh_today: today, online: true });

test('CARE ACU, 28 Oct: the step less the recovery day\'s own count, spread up to that day', () => {
  const rows = [row('2026-10-14T13:22:01', 152.972, 1.1), row('2026-10-20T08:00:00', 152.972, 0), row('2026-10-28T11:39:31', 152.972, 0), row('2026-10-28T11:41:04', 185.945, 0.478, 527.3)];
  const step = heldStep(rows, { fromMs: local('2026-10-14T13:22:01'), offsetMinutes: OFFSET });
  assert.deepEqual(step, { ok: true, kwh: 32.495, fromMs: local('2026-10-14T13:22:01'), toMs: local('2026-10-28T00:00:00'), stepKwh: 185.945 - 152.972, recoveredAt: rows[3].ts });
});

test('the yellow meter\'s lifetime register is refused: it rises faster than any branch can draw', () => {
  const rows = [row('2026-10-14T13:21:00', 275592.189, 0), row('2026-10-28T11:41:04', 286696.706, 0)];
  assert.equal(heldStep(rows, { fromMs: local('2026-10-14T13:21:00'), offsetMinutes: OFFSET }).reason, 'implausible');
  assert.equal(heldStep([row('2026-10-14T13:21:00', 9, 0), row('2026-10-28T11:41:04', 8, 0)], { fromMs: local('2026-10-14T13:21:00'), offsetMinutes: OFFSET }).reason, 'implausible', 'a fall is not a count');
});

test('a hold that has not recovered, or recovered the same day with its register counting it, leaves nothing to spread', () => {
  assert.equal(heldStep([row('2026-10-14T13:22:01', 152.972, 1.1)], { fromMs: local('2026-10-14T13:22:01'), offsetMinutes: OFFSET }).reason, 'no-recovery');
  const sameDay = [row('2026-10-14T09:00:00', 10, 1), row('2026-10-14T13:00:00', 12, 3)];
  assert.equal(heldStep(sameDay, { fromMs: local('2026-10-14T09:00:00'), offsetMinutes: OFFSET }).reason, 'nothing-to-spread');
});

test('the profile reads only days read live, weekdays and weekends apart', () => {
  const day = (d, max, live) => Array.from({ length: 30 }, (_, i) => ({ ts: new Date(local(`${d}T08:00:00`) + i * 60_000).toISOString(), power_w: live ? 400 + i : 15.5, energy_kwh_today: (max * (i + 1)) / 30, online: true }));
  const rows = [...day('2026-10-05', 4, true), ...day('2026-10-06', 5, true), ...day('2026-10-07', 0, false), ...day('2026-10-04', 0.2, true)];
  assert.deepEqual(dailyProfile(rows, OFFSET), { weekday: 4.5, weekend: 0.2 });
});

test('each row says it is an estimate, and from what', () => {
  const step = { ok: true, kwh: 1.452, fromMs: local('2026-10-26T13:00:00'), toMs: local('2026-10-28T00:00:00'), stepKwh: 1.452, recoveredAt: '2026-10-28T03:41:04.505Z' };
  const rows = estimateRows({ siteId: 'site', deviceId: 'mtr_lo_red', frozenSince: '2026-10-26T13:00:00+08:00', step, profile: { weekday: 1, weekend: 1 }, offsetMinutes: OFFSET });
  assert.equal(sum(rows), 1.452);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['basis', 'device_id', 'held_from', 'held_to', 'kwh', 'local_day', 'site_id']);
  assert.match(rows[0].basis, /meter held from .* lifetime register rose 1\.452 kWh/);
});

test('a hold read from the archive: the step from its readings, the profile from the days before', async () => {
  const { estimateHold } = await import('./heldEnergy.mjs');
  const asked = [];
  const before = Array.from({ length: 20 }, (_, i) => ({ ts: new Date(local('2026-10-13T08:00:00') + i * 60_000).toISOString(), power_w: 500 + i, energy_kwh_today: i / 4, total_energy_kwh: 150, online: true }));
  const across = [row('2026-10-14T13:22:01', 152.972, 1.1), row('2026-10-28T11:41:04', 185.945, 0.478, 527.3)];
  const archive = {
    *rowsBetween(stream, q) {
      asked.push({ stream, ...q });
      yield* (q.sinceMs >= local('2026-10-14T13:22:01') ? across : before);
    },
  };
  const { rows, step } = estimateHold(archive, { siteId: 's', deviceId: 'mtr_arec_acu', frozenSince: '2026-10-14T13:22:01+08:00', endedAtMs: local('2026-10-28T11:33:00'), offsetMinutes: OFFSET });
  assert.equal(step.ok, true);
  assert.equal(sum(rows), 32.495);
  assert.equal(asked[0].untilMs, local('2026-10-28T12:03:00'), 'the recovery is looked for up to half an hour after the hold ended');
  assert.equal(asked.at(-1).untilMs, local('2026-10-14T00:00:00'), 'the profile reads only days before the hold');
});

test('the backfill finds each ended hold once, even when its held figure stepped, and skips one made before', async () => {
  const { findHoldEstimates } = await import('./heldEnergy.mjs');
  const { frozenStretches } = await import('./frozenStretches.mjs');
  const r = (ts, power, total, today = 0, voltage = 223.4) => ({ ts: new Date(local(ts)).toISOString(), power_w: power, voltage, current: 0.07, total_energy_kwh: total, energy_kwh_today: today, online: true });
  const hours = (from, n, make) => Array.from({ length: n }, (_, i) => make(new Date(local(from) + i * 3_600_000).toISOString().replace('Z', '').slice(0, 19), i));
  const rows = [
    ...hours('2026-10-13T00:00:00', 24, (_, i) => ({ ...r('2026-10-13T00:00:00', 400 + i, 140 + i / 10, i / 10, 220 + i / 10), ts: new Date(local('2026-10-13T00:00:00') + i * 3_600_000).toISOString() })),
    ...Array.from({ length: 100 }, (_, i) => ({ ...r('2026-10-14T13:22:01', 15.5, 152.972), ts: new Date(local('2026-10-14T13:22:01') + i * 3_600_000).toISOString() })),
    ...Array.from({ length: 236 }, (_, i) => ({ ...r('2026-10-18T16:23:01', 15.8, 152.972, 0, 227.7), ts: new Date(local('2026-10-18T16:23:01') + i * 3_600_000).toISOString() })),
    r('2026-10-28T11:41:04', 527.3, 185.945, 0.478, 219),
  ];
  const archive = { *rowsBetween(_s, q) { yield* rows.filter((x) => Date.parse(x.ts) >= q.sinceMs && Date.parse(x.ts) < q.untilMs); } };
  const opts = { meters: ['mtr_arec_acu'], sinceMs: local('2026-10-01T00:00:00'), untilMs: local('2026-10-29T00:00:00'), siteId: 's', offsetMinutes: OFFSET, stillAfterMs: 12 * 3_600_000, frozenStretches };
  const holds = findHoldEstimates(archive, opts);
  assert.equal(holds.length, 1, 'the step to 15.8 W is the same hold');
  assert.equal(sum(holds[0].rows), 32.495);
  const again = findHoldEstimates(archive, { ...opts, already: new Set([`mtr_arec_acu|${holds[0].frozenSince}`]) });
  assert.equal(again[0].skipped, 'estimated before');
});

test('only a meter with a lifetime register of its own is estimated: the dual-channel meter\'s is both clamps\' sum', async () => {
  const { hasOwnLifetimeRegister } = await import('./heldEnergy.mjs');
  assert.equal(hasOwnLifetimeRegister({ id: 'mtr_arec_acu', class: 'meter', channel: 1, capability_profile: 'cz_ct_single' }), true);
  assert.equal(hasOwnLifetimeRegister({ id: 'mtr_co_yellow', class: 'meter', channel: 1, capability_profile: 'cz_ct_double' }), false);
  assert.equal(hasOwnLifetimeRegister({ id: 'co1', class: 'outlet_dual' }), false);
});

test('a hold begins where the lifetime register stopped, not where the daily counter last reset', async () => {
  // 14 Oct: CARE ACU's register stopped at 13:22; its daily counter still reset at midnight, so the still stretch
  // (every value equal) began at 23:59. The afternoon of the 14th was held too.
  const { estimateHold } = await import('./heldEnergy.mjs');
  const before = [row('2026-10-14T13:00:00', 152.9, 1.0, 500), row('2026-10-14T13:22:01', 152.972, 1.1), row('2026-10-14T20:00:00', 152.972, 1.1)];
  const across = [row('2026-10-14T23:59:00', 152.972, 0), row('2026-10-28T11:41:04', 185.945, 0.478, 527.3)];
  const archive = {
    *rowsBetween(_s, q) {
      yield* [...before, ...across].filter((x) => Date.parse(x.ts) >= q.sinceMs && Date.parse(x.ts) < q.untilMs);
    },
  };
  const { step } = estimateHold(archive, { siteId: 's', deviceId: 'mtr_arec_acu', frozenSince: new Date(local('2026-10-14T23:59:00')).toISOString(), endedAtMs: local('2026-10-28T11:33:00'), offsetMinutes: OFFSET });
  assert.equal(step.fromMs, local('2026-10-14T13:22:01'));
});
