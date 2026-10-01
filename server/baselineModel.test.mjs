/**
 * RM-153 — the projected baseline, built from recorded hours by stated rules.
 *
 * A synthetic fortnight in a UTC+8 building, so every rule has a day that only that rule explains:
 *
 *   Mon 3 – Sun 16 Aug 2026. Working days (Mon–Thu) draw 1000 W of aircon 08:00–17:00, 10 W
 *   otherwise; lighting is two 50 W meters; other is 200 W. Fridays run the aircon at 500 W — a
 *   lighter day the projected working day must NOT learn from, and the recorded view must show.
 *   Saturdays 10 / 100 W, Sundays 10 / 50 W.
 *
 *   Tue 4    hour 10 aircon 9000 W          — the trim's outlier
 *   Wed 5,   hour 8 aircon 0 W, both listed  — dropped hours; two of them, so the trim cannot
 *   Thu 6                                     hide a failure to drop
 *   Sat 8    hour 3 lighting 99,999 W        — above the ceiling; only two Saturdays, no trim
 *   Sun 9    hour 5 "other" row missing      — left out, never zeroed
 *   Mon 10   a holiday in the site calendar  — aircon 0 all day
 *   Wed 12   excluded by rule, with a reason — aircon 5000 all day
 *   Thu 13   an auto-shed command            — aircon 0 all day
 *   Sat 15   hour 12, one lighting meter missing — a category-hour needs every meter in it
 *
 * So the working profile is built from Mon 3, Tue 4, Wed 5, Thu 6 and Tue 11: five days, the trim on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBaseline, buildDonorDays, trimmedMean, quantile, STANDARD_MONTH_DAYS } from './baselineModel.mjs';

const OFFSET = 480;
const site = {
  id: 'test-lab',
  utc_offset_minutes: OFFSET,
  working_hours: { start: '08:00', end: '17:00' },
  working_week: [1, 2, 3, 4, 5],
  non_working_days: [{ date: '2026-08-10', name: 'A test holiday' }],
};
const meterLoads = [
  { load: 'lighting', meterIds: ['l1', 'l2'] },
  { load: 'aircon', meterIds: ['ac'] },
  { load: 'other', meterIds: ['o'] },
];

const dateList = (from, to) => {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
};
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The building's watts for one meter at one local hour, before the odd days are applied. */
function watts(meter, date, hour) {
  const dow = weekday(date);
  const open = hour >= 8 && hour < 17;
  if (meter === 'l1' || meter === 'l2') return 50;
  if (meter === 'o') return dow === 6 ? 100 : dow === 0 ? 50 : 200;
  // aircon
  if (date === '2026-08-10' || date === '2026-08-13') return 0;
  if (date === '2026-08-12') return 5000;
  if (dow === 0 || dow === 6) return 10;
  if (!open) return 10;
  if (dow === 5) return 500;
  if (date === '2026-08-04' && hour === 10) return 9000;
  if ((date === '2026-08-05' || date === '2026-08-06') && hour === 8) return 0;
  return 1000;
}

function fortnight() {
  const hourly = { l1: [], l2: [], ac: [], o: [] };
  for (const date of dateList('2026-08-01', '2026-08-16')) {
    for (let hour = 0; hour < 24; hour++) {
      const ts = new Date(Date.parse(`${date}T00:00:00Z`) - OFFSET * 60_000 + hour * 3_600_000).toISOString();
      for (const meter of Object.keys(hourly)) {
        if (date === '2026-08-09' && hour === 5 && meter === 'o') continue;
        if (date === '2026-08-15' && hour === 12 && meter === 'l2') continue;
        let w = watts(meter, date, hour);
        if (date === '2026-08-08' && hour === 3 && meter === 'l1') w = 99_999;
        // 1 and 2 Aug are outside the window: recorded, never used.
        hourly[meter].push({ ts, power_w: w, power_w_max: w * 1.5, voltage: 230, current: w / 230, online_count: 60, sample_count: 60 });
      }
    }
  }
  return hourly;
}

const rules = {
  window: { from: '2026-08-03', to: '2026-08-16' },
  record: { from: '2026-08-01', to: '2026-08-16' },
  excluded: { '2026-08-12': { reason: 'every device hand-tested', evidence: 'E-001' } },
  dropped_hours: {
    '2026-08-05': { hours: [8], reason: 'meters frozen while online' },
    '2026-08-06': { hours: [8], reason: 'meters frozen while online' },
  },
  day_types: {
    working: { label: 'Working day', recorded_weekdays: [1, 2, 3, 4] },
    saturday: { label: 'Saturday', recorded_weekdays: [6] },
    sunday: { label: 'Sunday', recorded_weekdays: [0] },
  },
  modelled_week: ['sunday', 'working', 'working', 'working', 'working', 'working', 'saturday'],
  weekday_notes: { 5: 'Friday is modelled as a full working day, on the Monday–Thursday profile.' },
  recorded_groups: [
    { key: 'mon_thu', label: 'Monday–Thursday', weekdays: [1, 2, 3, 4] },
    { key: 'friday', label: 'Friday', weekdays: [5] },
    { key: 'saturday', label: 'Saturday', weekdays: [6] },
    { key: 'sunday', label: 'Sunday', weekdays: [0] },
  ],
  automation_sources: ['dsm_autoshed', 'acu_loop'],
  trim_from_days: 5,
  min_hours_recorded: 20,
  ceiling_w: 25_000,
};
const commands = [
  { requested_at: '2026-08-13T03:00:00Z', source: 'dsm_autoshed', device_id: 'co1', action: 'off' },
  { requested_at: '2026-08-11T03:00:00Z', source: 'ibems-app', device_id: 'co1', action: 'off' },
];
const buildingPeaks = [
  ['2026-08-03', 1000], ['2026-08-04', 2000], ['2026-08-05', 3000], ['2026-08-06', 4000], ['2026-08-11', 5000],
  ['2026-08-12', 99_000], ['2026-08-07', 88_000],
].map(([local_day, max_w]) => ({ local_day, max_w }));

const build = (over = {}) =>
  buildBaseline({ site, meterLoads, hourly: fortnight(), commands, buildingPeaks, rules, generatedAt: '2026-09-30T00:00:00Z', ...over });

const close = (actual, expected, tol = 1e-6) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} ≉ ${expected}`);

test('the working profile comes from the Monday–Thursday days no rule removed', () => {
  const b = build();
  assert.deepEqual(b.day_types.working.days, ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-11']);
  assert.deepEqual(b.day_types.saturday.days, ['2026-08-08', '2026-08-15']);
  assert.deepEqual(b.day_types.sunday.days, ['2026-08-09', '2026-08-16']);
});

test('the trim drops the highest and lowest day, so one testing day cannot move an hour', () => {
  const b = build();
  close(b.day_types.working.profile_w.aircon[10], 1000);
  // Neutered: without the trim the 9000 W hour averages in to 2600 W.
  const untrimmed = build({ rules: { ...rules, trim_from_days: 99 } });
  close(untrimmed.day_types.working.profile_w.aircon[10], 2600);
});

test('dropped hours are left out, not counted as the zero the frozen meter reported', () => {
  close(build().day_types.working.profile_w.aircon[8], 1000);
  const kept = build({ rules: { ...rules, dropped_hours: {} } });
  // [0, 0, 1000, 1000, 1000] trimmed to [0, 1000, 1000].
  close(kept.day_types.working.profile_w.aircon[8], 2000 / 3, 0.05);
  assert.deepEqual(build().dropped_hours, [
    { date: '2026-08-05', hours: [8], reason: 'meters frozen while online' },
    { date: '2026-08-06', hours: [8], reason: 'meters frozen while online' },
  ]);
});

test('an hourly value above the ceiling is dropped as impossible', () => {
  close(build().day_types.saturday.profile_w.lighting[3], 100);
  const unbounded = build({ rules: { ...rules, ceiling_w: Infinity } });
  close(unbounded.day_types.saturday.profile_w.lighting[3], (100_049 + 100) / 2);
});

test('a missing hour is left out of the average, never zeroed', () => {
  close(build().day_types.sunday.profile_w.other[5], 50);
});

test('a category-hour needs every meter in the category, or it is not the category', () => {
  // One of two lighting meters missing would read 50 W as "the lighting" — half of it.
  close(build().day_types.saturday.profile_w.lighting[12], 100);
});

test('every day not used says why: the rule, a holiday, automation, or the modelled weekday', () => {
  const b = build();
  const why = Object.fromEntries(b.excluded.map((e) => [e.date, e.reason]));
  assert.equal(why['2026-08-12'], 'every device hand-tested');
  assert.match(why['2026-08-10'], /holiday: A test holiday/i);
  // In words the operator reads, not the audit trail's source codes.
  assert.equal(why['2026-08-13'], 'automation acted: 1 auto-shed command');
  assert.match(why['2026-08-07'], /Friday is modelled as a full working day/);
  assert.match(why['2026-08-14'], /Friday is modelled as a full working day/);
  assert.equal(b.excluded.find((e) => e.date === '2026-08-12').evidence, 'E-001');
  // A manual command is not automation: 11 Aug is used.
  assert.equal(why['2026-08-11'], undefined);
  for (const e of b.excluded) assert.ok(e.reason.trim().length > 0, `${e.date} has no reason`);
});

test('neutered: without the automation rule, the shed day feeds the profile and changes it', () => {
  const b = build({ commands: [] });
  assert.ok(b.day_types.working.days.includes('2026-08-13'));
});

test('per-day energy, share of working hours, standby and demand are read off the profile', () => {
  const w = build().day_types.working;
  close(w.kwh.aircon, 9.15);
  close(w.kwh.lighting, 2.4);
  close(w.kwh.other, 4.8);
  close(w.kwh.total, 16.35);
  close(w.standby_w, 310);
  close(w.working_hours_avg_w, 1300);
  close(w.highest_hourly_w, 1300);
  close(w.working_hours_share, 11_700 / 16_350, 0.001);
});

test('the week follows the modelled week, and the month is the week scaled to 30.44 days', () => {
  const b = build();
  close(b.week.kwh.aircon, 5 * 9.15 + 0.24 + 0.24);
  close(b.week.kwh.lighting, 5 * 2.4 + 2.4 + 2.4);
  close(b.week.kwh.other, 5 * 4.8 + 2.4 + 1.2);
  close(b.week.kwh.total, 90.63);
  assert.deepEqual(b.week.days, rules.modelled_week);
  close(STANDARD_MONTH_DAYS, 30.4375);
  close(b.standard_month.kwh.total, (90.63 * 30.4375) / 7, 0.001);
  close(b.standard_month.working_days, (30.4375 * 5) / 7, 0.001);
});

test('peak operating draw is the 90th percentile of the used working days\' highest minute', () => {
  const b = build();
  close(b.peak_operating_draw.w, 4600);
  assert.equal(b.peak_operating_draw.days, 5, 'the excluded 12th and the Friday are not working days of the profile');
});

test('the recorded backup keeps every day of the span, and what became of it', () => {
  const b = build();
  const days = b.recorded.days;
  assert.equal(days.length, 16);
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  assert.equal(byDate['2026-08-01'].used_as, null);
  assert.match(byDate['2026-08-01'].reason, /outside the baseline window/);
  assert.equal(byDate['2026-08-03'].used_as, 'working');
  assert.equal(byDate['2026-08-07'].used_as, null);
  close(byDate['2026-08-07'].kwh.aircon, (9 * 500 + 15 * 10) / 1000);
  close(byDate['2026-08-12'].kwh.aircon, 5 * 24);
  assert.equal(byDate['2026-08-12'].highest_w, 99_000);
  assert.equal(byDate['2026-08-09'].hours_recorded, 23, 'the Sunday with an hour missing says so');
});

test('the recorded profiles are plain averages by actual weekday, so the lighter Friday shows', () => {
  const g = Object.fromEntries(build().recorded.profiles.map((p) => [p.key, p]));
  close(g.friday.profile_w.aircon[10], 500);
  assert.deepEqual(g.friday.days, ['2026-08-07', '2026-08-14']);
  // Holidays, rule exclusions and automation days are not "recorded Mondays": the view is of
  // ordinary days as they were, not of every day.
  assert.ok(!g.mon_thu.days.includes('2026-08-10'));
  assert.ok(!g.mon_thu.days.includes('2026-08-12'));
});

test('coverage is each meter\'s share of the window\'s minutes', () => {
  const b = build();
  close(b.coverage.o, (14 * 24 - 1) / (14 * 24));
  close(b.coverage.ac, 1);
});

test('it refuses a day type with no days, rather than projecting a zero', () => {
  const noSundays = fortnight();
  for (const m of Object.keys(noSundays)) {
    noSundays[m] = noSundays[m].filter((r) => weekday(new Date(Date.parse(r.ts) + OFFSET * 60_000).toISOString().slice(0, 10)) !== 0);
  }
  assert.throws(() => build({ hourly: noSundays }), /sunday.*no days/i);
});

test('a day recorded for fewer hours than the rule is not an ordinary day', () => {
  const short = fortnight();
  for (const m of Object.keys(short)) short[m] = short[m].filter((r) => !(r.ts >= '2026-08-10T16:00:00Z' && r.ts < '2026-08-11T04:00:00Z'));
  const b = build({ hourly: short });
  assert.equal(b.excluded.find((x) => x.date === '2026-08-11').reason, 'only 12 of 24 hours recorded on every meter; the rule is 20');
  assert.ok(!b.day_types.working.days.includes('2026-08-11'));
});

test('a window shorter than four weeks builds, and carries a warning saying so', () => {
  assert.ok(build().warnings.some((w) => /28 days/.test(w)));
});

test('the helpers: a trimmed mean and a linear quantile', () => {
  assert.equal(trimmedMean([1, 2, 3, 4, 100], 5), 3);
  assert.equal(trimmedMean([1, 100], 5), 50.5);
  assert.equal(trimmedMean([null, 4], 5), 4);
  assert.equal(trimmedMean([], 5), null);
  assert.equal(quantile([1000, 2000, 3000, 4000, 5000], 0.9), 4600);
  assert.equal(quantile([], 0.9), null);
});

test('the rendered module is data only, frozen at every level, and holds exactly the baseline', async () => {
  const { renderBaselineModule } = await import('./baselineModel.mjs');
  // An apostrophe and a backslash, because "New Year's Day" is a real holiday name.
  const b = build({ rules: { ...rules, excluded: { '2026-08-12': { reason: "the office's \\ hand test", evidence: 'E-001' } } } });
  const text = renderBaselineModule(b);
  assert.doesNotMatch(text, /^import /m, 'a site module imports nothing');
  const mod = await import(`data:text/javascript,${encodeURIComponent(text)}`);
  assert.deepEqual(JSON.parse(JSON.stringify(mod.BASELINE)), JSON.parse(JSON.stringify(b)));
  const unfrozen = [];
  const walk = (v, path) => {
    if (v === null || typeof v !== 'object') return;
    if (!Object.isFrozen(v)) unfrozen.push(path);
    for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(mod.BASELINE, 'BASELINE');
  assert.deepEqual(unfrozen, []);
});

// ---------------------------------------------------------------------------
// RM-154 — the recorded days behind the baseline, hour by hour and circuit by circuit
// ---------------------------------------------------------------------------

/** The building's highest minute in each hour: here, every meter's highest at once. */
const buildingHours = dateList('2026-08-01', '2026-08-16').flatMap((date) =>
  Array.from({ length: 24 }, (_, hour) => ({
    local_day: date,
    local_hour: hour,
    max_w: ['l1', 'l2', 'ac', 'o'].reduce((a, m) => a + watts(m, date, hour) * 1.5, 0),
  })),
);
const donors = (over = {}) => {
  const baseline = build(over);
  return { baseline, d: buildDonorDays({ site, baseline, hourly: fortnight(), buildingHours, rules, ...over }) };
};
const dayKwh = (day) => Object.values(day.meters).reduce((a, m) => a + m.w.reduce((x, w) => x + w, 0), 0) / 1000;

test('the donor days are exactly the days each projected type was built from', () => {
  const { baseline, d } = donors();
  for (const [type, t] of Object.entries(baseline.day_types)) {
    assert.deepEqual(d.types[type].days.map((x) => x.date), t.days, type);
  }
  assert.deepEqual(Object.keys(d.types.working.days[0].meters).sort(), ['ac', 'l1', 'l2', 'o']);
});

test('each type is scaled once so its days average the baseline\'s day, keeping their spread', () => {
  const { baseline, d } = donors();
  for (const [type, t] of Object.entries(d.types)) {
    const mean = t.days.reduce((a, x) => a + dayKwh(x), 0) / t.days.length;
    close(mean, baseline.day_types[type].kwh.total, 0.01);
  }
  // Tue 4 carried the 9000 W testing hour; it stays the biggest working day after scaling.
  const totals = d.types.working.days.map((x) => [x.date, dayKwh(x)]);
  assert.equal(totals.sort((a, b) => b[1] - a[1])[0][0], '2026-08-04');
  assert.ok(d.types.working.scale < 1, 'the testing hour pulls the plain mean above the trimmed one');
});

test('a dropped or missing hour is filled from the same meter-hour of the other days, and listed', () => {
  const { d } = donors();
  const wed = d.types.working.days.find((x) => x.date === '2026-08-05');
  // Hour 8 was dropped on the 5th and the 6th; the 3rd, 4th and 11th read 1000 W.
  close(wed.meters.ac.w[8], 1000 * d.types.working.scale, 0.1);
  assert.deepEqual(wed.filled, [{ meter: 'ac', hours: [8] }, { meter: 'l1', hours: [8] }, { meter: 'l2', hours: [8] }, { meter: 'o', hours: [8] }]);
  const sun = d.types.sunday.days.find((x) => x.date === '2026-08-09');
  close(sun.meters.o.w[5], 50 * d.types.sunday.scale, 0.1);
  assert.deepEqual(sun.filled, [{ meter: 'o', hours: [5] }]);
  for (const t of Object.values(d.types)) {
    for (const x of t.days) for (const m of Object.values(x.meters)) assert.ok(m.w.every((w) => Number.isFinite(w)), x.date);
  }
});

test('neutered: without the fill, the dropped hour reads as the frozen zero it was', () => {
  const { d } = donors({ rules: { ...rules, dropped_hours: {} } });
  const wed = d.types.working.days.find((x) => x.date === '2026-08-05');
  close(wed.meters.ac.w[8], 0);
});

test('each day carries its highest power, current, voltage and the building\'s highest minute, per hour', () => {
  const { d } = donors();
  const mon = d.types.working.days.find((x) => x.date === '2026-08-03');
  const k = d.types.working.scale;
  close(mon.meters.ac.max[10], 1500 * k, 0.1);
  close(mon.meters.ac.a[10], (1000 / 230) * k, 0.001);
  close(mon.v[10], 230, 0.1);
  close(mon.max_w[10], (1000 + 50 + 50 + 200) * 1.5 * k, 0.1);
});

test('the days module renders data only, frozen, and holds exactly the donor days', async () => {
  const { renderBaselineDaysModule } = await import('./baselineModel.mjs');
  const { d } = donors();
  const text = renderBaselineDaysModule(d);
  assert.doesNotMatch(text, /^import /m);
  const mod = await import(`data:text/javascript,${encodeURIComponent(text)}`);
  assert.deepEqual(JSON.parse(JSON.stringify(mod.BASELINE_DAYS)), JSON.parse(JSON.stringify(d)));
  assert.ok(Object.isFrozen(mod.BASELINE_DAYS.types.working.days[0].meters.ac.w));
});
