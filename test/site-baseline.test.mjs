/**
 * RM-153 — the committed baseline is internally consistent, belongs to this site, and is the one its
 * rules produce.
 *
 * `baseline.mjs` is generated and committed, so nothing rebuilds it on a change. These are the
 * properties a reader of the Baseline tab relies on without being able to check them: the daily
 * energy is the profile's, the week is the days', the month is the week's, every day of the window
 * is either used or said why not, and none of it came from a holiday or a day automation acted on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SITE, CIRCUITS, BASELINE, loadBaselineDays } from '../shared/siteConfig.mjs';
import { buildingMetersByLoad } from '../shared/circuits.mjs';
import { checkSite } from '../scripts/site-check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { BASELINE_RULES: RULES } = await import(pathToFileURL(join(ROOT, 'shared', 'sites', SITE.id, 'baseline-rules.mjs')).href);

const sum = (xs) => xs.reduce((a, x) => a + x, 0);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const dates = (from, to) => {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

test('the baseline is this site\'s, and the site check agrees', () => {
  assert.ok(BASELINE, 'this site has a baseline');
  assert.equal(BASELINE.site_id, SITE.id);
  const r = checkSite({ slug: SITE.id, site: SITE, devices: [], circuits: [], baseline: BASELINE });
  assert.equal(r.errors.some((e) => e.code === 'baseline_other_site'), false);
});

test('its categories and meters are the circuit tree\'s, so a rewired branch forces a rebuild', () => {
  const groups = buildingMetersByLoad(CIRCUITS);
  assert.deepEqual([...BASELINE.loads], groups.map((g) => g.load));
  for (const g of groups) assert.deepEqual([...BASELINE.meters[g.load]], g.meterIds);
});

test('every profile is 24 non-negative hours, and each day\'s energy is its profile\'s', () => {
  const profiles = [...Object.values(BASELINE.day_types), ...BASELINE.recorded.profiles];
  for (const p of profiles) {
    for (const load of BASELINE.loads) {
      const hours = p.profile_w[load];
      assert.equal(hours.length, 24, `${p.label} ${load}`);
      assert.ok(hours.every((w) => Number.isFinite(w) && w >= 0), `${p.label} ${load}`);
      near(p.kwh[load], sum(hours) / 1000, 0.001, `${p.label} ${load} kWh`);
    }
    near(p.kwh.total, sum(BASELINE.loads.map((l) => p.kwh[l])), 0.002, `${p.label} total`);
  }
});

test('the week is its seven modelled days, and the standard month is the week scaled', () => {
  for (const load of [...BASELINE.loads, 'total']) {
    near(BASELINE.week.kwh[load], sum(BASELINE.week.days.map((t) => BASELINE.day_types[t].kwh[load])), 0.005, `week ${load}`);
    near(BASELINE.standard_month.kwh[load], (BASELINE.week.kwh[load] * BASELINE.standard_month.days) / 7, 0.01, `month ${load}`);
  }
});

test('every day of the window is used by exactly one day type or excluded with a reason', () => {
  const used = Object.values(BASELINE.day_types).flatMap((t) => t.days);
  assert.equal(new Set(used).size, used.length, 'a day feeds two types');
  const excluded = new Map(BASELINE.excluded.map((e) => [e.date, e.reason]));
  for (const date of dates(BASELINE.window.from, BASELINE.window.to)) {
    const isUsed = used.includes(date);
    assert.ok(isUsed !== excluded.has(date), `${date} is ${isUsed ? 'both used and excluded' : 'neither used nor excluded'}`);
    if (!isUsed) assert.ok(excluded.get(date).trim().length > 0, `${date} has no reason`);
  }
});

test('no holiday of the site calendar is in any profile', () => {
  const used = new Set(Object.values(BASELINE.day_types).flatMap((t) => t.days));
  for (const h of SITE.non_working_days) assert.equal(used.has(h.date), false, `${h.date} ${h.name}`);
});

test('the window meets the manual\'s rule: four weeks, 99% of minutes on every meter, no warnings', () => {
  assert.ok(BASELINE.window.days >= 28);
  for (const [meter, share] of Object.entries(BASELINE.coverage)) assert.ok(share >= 0.99, `${meter} ${share}`);
  assert.deepEqual([...BASELINE.warnings], []);
});

test('the committed file is the one the rules describe — a rule changed without a rebuild fails here', () => {
  assert.equal(BASELINE.window.from, RULES.window.from);
  assert.equal(BASELINE.window.to, RULES.window.to);
  assert.deepEqual([...BASELINE.week.days], [...RULES.modelled_week]);
  assert.equal(BASELINE.method.trim_from_days, RULES.trim_from_days);
  assert.equal(BASELINE.method.min_hours_recorded, RULES.min_hours_recorded);
  const excluded = new Map(BASELINE.excluded.map((e) => [e.date, e.reason]));
  for (const [date, rule] of Object.entries(RULES.excluded)) {
    if (date < RULES.window.from || date > RULES.window.to) continue;
    assert.equal(excluded.get(date), rule.reason, date);
  }
  assert.deepEqual(
    BASELINE.dropped_hours.map((d) => [d.date, [...d.hours]]),
    Object.entries(RULES.dropped_hours).map(([date, d]) => [date, [...d.hours]]),
  );
  for (const [type, def] of Object.entries(RULES.day_types)) {
    assert.deepEqual([...BASELINE.day_types[type].recorded_weekdays], [...def.recorded_weekdays], type);
  }
});

test('the recorded backup covers its whole span, and agrees with the profiles about each day', () => {
  assert.deepEqual(BASELINE.recorded.days.map((d) => d.date), dates(RULES.record.from, RULES.record.to));
  for (const d of BASELINE.recorded.days) {
    const type = Object.entries(BASELINE.day_types).find(([, t]) => t.days.includes(d.date))?.[0] ?? null;
    assert.equal(d.used_as, type, d.date);
    if (!type) assert.ok(typeof d.reason === 'string' && d.reason.length > 0, `${d.date} unused without a reason`);
  }
});

test('the peak operating draw comes from the working days, and is no lower than their typical hour', () => {
  const p = BASELINE.peak_operating_draw;
  assert.equal(p.days, BASELINE.day_types.working.days.length);
  assert.ok(p.w >= BASELINE.day_types.working.highest_hourly_w, 'a highest minute below the highest hourly average is not one');
});

// ---------------------------------------------------------------------------
// RM-154 — the recorded days behind the baseline
// ---------------------------------------------------------------------------

const { BASELINE_DAYS: DAYS } = await loadBaselineDays();
const dayKwh = (d) => Object.values(d.meters).reduce((a, m) => a + m.w.reduce((x, w) => x + w, 0), 0) / 1000;

test('the days module is this baseline\'s: the same site, meters and days per type', () => {
  assert.ok(DAYS, 'this site has its recorded days');
  assert.equal(DAYS.site_id, BASELINE.site_id);
  assert.deepEqual([...DAYS.meters].sort(), BASELINE.loads.flatMap((l) => BASELINE.meters[l]).sort());
  for (const [type, t] of Object.entries(BASELINE.day_types)) {
    assert.deepEqual(DAYS.types[type].days.map((d) => d.date), [...t.days], type);
  }
});

test('each type\'s days average the baseline\'s projected day, so a projected month keeps its total', () => {
  for (const [type, t] of Object.entries(DAYS.types)) {
    const mean = t.days.reduce((a, d) => a + dayKwh(d), 0) / t.days.length;
    near(mean, BASELINE.day_types[type].kwh.total, 0.02, `${type} mean`);
  }
});

test('the days really differ: working days span more than a quarter of their mean', () => {
  const totals = DAYS.types.working.days.map(dayKwh);
  const mean = sum(totals) / totals.length;
  assert.ok((Math.max(...totals) - Math.min(...totals)) / mean > 0.25, totals.join(', '));
});

test('every hour of every day holds a number, and every filled hour is listed', () => {
  for (const t of Object.values(DAYS.types)) {
    for (const d of t.days) {
      for (const [meter, m] of Object.entries(d.meters)) {
        for (const f of ['w', 'max', 'a']) assert.ok(m[f].length === 24 && m[f].every((x) => Number.isFinite(x) && x >= 0), `${d.date} ${meter} ${f}`);
      }
      assert.ok(d.v.every((x) => x > 0) && d.max_w.every((x) => Number.isFinite(x)), d.date);
    }
  }
  const dropped = DAYS.types.working.days.find((d) => d.date === '2026-08-26');
  for (const f of dropped.filled) assert.deepEqual([...f.hours], [8, 9, 10], f.meter);
});
