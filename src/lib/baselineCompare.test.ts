import { describe, it, expect } from 'vitest';
import {
  SITE_BASELINE,
  baselineAssumptionItems,
  compareWithBaseline,
  describeAgainstBaseline,
  expectedFor,
  loadSeries,
  periodDates,
  profilePoints,
  recordedDayPoints,
  weekPoints,
  type ProjectedBaseline,
} from './baselineCompare';

/**
 * RM-153 — the projected baseline against a real period.
 *
 * A period is held to the baseline over ITS OWN calendar: the weekdays it has, and its holidays as
 * closed days. A month is not "a standard month", and August 2026 with two holidays is not charged
 * two working days it never had — that is the routine adjustment IPMVP asks for, and the only one
 * this site records.
 */

const flat = (w: number) => Array.from({ length: 24 }, () => w);
const profile = (label: string, weekdays: number[], perLoad: [number, number, number]) => {
  const [lighting, aircon, other] = perLoad;
  const kwh = { lighting: (lighting * 24) / 1000, aircon: (aircon * 24) / 1000, other: (other * 24) / 1000 };
  return {
    label,
    recorded_weekdays: weekdays,
    days: [],
    profile_w: { lighting: flat(lighting), aircon: flat(aircon), other: flat(other) },
    kwh: { ...kwh, total: kwh.lighting + kwh.aircon + kwh.other },
    standby_w: 0,
    working_hours_avg_w: 0,
    highest_hourly_w: 0,
    working_hours_share: 0,
  };
};
// Per day: working 10 kWh (1 + 5 + 4), Saturday 4.8, Sunday 2.4.
const working = profile('Working day', [1, 2, 3, 4], [1000 / 24, 5000 / 24, 4000 / 24]);
const saturday = profile('Saturday', [6], [0, 0, 200]);
const sunday = profile('Sunday', [0], [0, 0, 100]);
const FAKE = {
  version: 1,
  site_id: 'test-lab',
  generated_at: '2026-09-30T00:00:00Z',
  window: { from: '2026-08-25', to: '2026-09-22', days: 29 },
  working_hours: { start: '08:00', end: '17:00' },
  loads: ['lighting', 'aircon', 'other'],
  meters: { lighting: ['l'], aircon: ['a'], other: ['o'] },
  method: { trim_from_days: 5, min_hours_recorded: 20, ceiling_w: 25000, automation_sources: [], standard_month_days: 30.4375 },
  day_types: { working, saturday, sunday },
  week: { days: ['sunday', 'working', 'working', 'working', 'working', 'working', 'saturday'], kwh: { lighting: 5, aircon: 25, other: 27.2, total: 57.2 } },
  standard_month: { days: 30.4375, working_days: 21.741, day_counts: {}, kwh: { total: 248.7 } },
  peak_operating_draw: { w: 2893, days: 11, quantile: 0.9 },
  excluded: [{ date: '2026-09-01', reason: 'office closed', evidence: null }],
  dropped_hours: [],
  coverage: {},
  recorded: {
    from: '2026-08-31',
    to: '2026-09-02',
    days: [
      { date: '2026-08-31', weekday: 1, kwh: { lighting: 0.2, aircon: 0, other: 1, total: 1.2 }, hours_recorded: 24, highest_w: 600, used_as: null, reason: 'holiday' },
      { date: '2026-09-01', weekday: 2, kwh: { lighting: 0.2, aircon: 0, other: 1, total: 1.2 }, hours_recorded: 12, highest_w: null, used_as: null, reason: 'office closed' },
      { date: '2026-09-02', weekday: 3, kwh: { lighting: 1, aircon: 5, other: 4, total: 10 }, hours_recorded: 24, highest_w: 2893, used_as: 'working', reason: null },
    ],
    profiles: [{ ...profile('Friday', [5], [0, 3000 / 24, 3000 / 24]), key: 'friday', weekdays: [5] }],
  },
  warnings: [],
} as unknown as ProjectedBaseline;

const HOLIDAYS = [
  { date: '2026-08-21', name: 'Ninoy Aquino Day' },
  { date: '2026-08-31', name: 'National Heroes Day' },
];

describe('periodDates', () => {
  it('lists a day, a week from its Monday, and a whole month, leap years included', () => {
    expect(periodDates('day', '2026-09-02')).toEqual(['2026-09-02']);
    expect(periodDates('week', '2026-09-28')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(periodDates('month', '2026-08-01')).toHaveLength(31);
    expect(periodDates('month', '2028-02-01')).toHaveLength(29);
  });
});

describe('expectedFor', () => {
  it('holds a month to its own weekdays, not to a standard month', () => {
    // August 2026 starts on a Saturday: 21 weekdays, five Saturdays, five Sundays.
    const e = expectedFor(FAKE, periodDates('month', '2026-08-01'), []);
    expect(e.counts).toEqual({ working: 21, saturday: 5, sunday: 5 });
    expect(e.kwh.total).toBeCloseTo(21 * 10 + 5 * 4.8 + 5 * 2.4, 6);
    expect(e.holidays).toEqual([]);
  });

  it('counts a holiday as a closed day, expected to use what the quietest day does', () => {
    const e = expectedFor(FAKE, periodDates('month', '2026-08-01'), HOLIDAYS);
    expect(e.counts).toEqual({ working: 19, saturday: 5, sunday: 7 });
    expect(e.kwh.total).toBeCloseTo(19 * 10 + 5 * 4.8 + 7 * 2.4, 6);
    expect(e.kwh.aircon).toBeCloseTo(19 * 5, 6);
    expect(e.holidays.map((h) => h.name)).toEqual(['Ninoy Aquino Day', 'National Heroes Day']);
  });

  it('ignores a holiday that falls on a day already closed', () => {
    const e = expectedFor(FAKE, periodDates('day', '2026-08-30'), [{ date: '2026-08-30', name: 'A Sunday holiday' }]);
    expect(e.counts).toEqual({ sunday: 1 });
  });
});

describe('compareWithBaseline', () => {
  const complete = { ratio: 1, band: 'complete' as const };

  it('refuses a period under 95% recorded, and says how much was', () => {
    const c = compareWithBaseline({
      baseline: FAKE,
      period: 'month',
      start: '2026-08-01',
      holidays: HOLIDAYS,
      recordedKwh: 150,
      recordedByLoad: {},
      coverage: { ratio: 0.48, band: 'partial' },
    });
    expect(c.comparable).toBe(false);
    if (!c.comparable) expect(c.reason).toMatch(/48% recorded/);
  });

  it('refuses when the site has no baseline, or the period no energy', () => {
    const none = compareWithBaseline({ baseline: null, period: 'month', start: '2026-08-01', holidays: [], recordedKwh: 1, recordedByLoad: {}, coverage: complete });
    expect(none.comparable).toBe(false);
    if (!none.comparable) expect(none.reason).toMatch(/no baseline/i);
    const empty = compareWithBaseline({ baseline: FAKE, period: 'month', start: '2026-08-01', holidays: [], recordedKwh: null, recordedByLoad: {}, coverage: complete });
    expect(empty.comparable).toBe(false);
  });

  it('sets a fully recorded period against its own calendar, overall and by use', () => {
    const c = compareWithBaseline({
      baseline: FAKE,
      period: 'month',
      start: '2026-08-01',
      holidays: HOLIDAYS,
      recordedKwh: 200,
      recordedByLoad: { lighting: 20, aircon: 90, other: 90 },
      coverage: complete,
    });
    expect(c.comparable).toBe(true);
    if (!c.comparable) return;
    const expected = 19 * 10 + 5 * 4.8 + 7 * 2.4;
    expect(c.expectedKwh).toBeCloseTo(expected, 6);
    expect(c.avoidedKwh).toBeCloseTo(expected - 200, 6);
    expect(c.differencePct).toBeCloseTo(((200 - expected) / expected) * 100, 6);
    expect(c.byLoad.find((l) => l.load === 'aircon')).toMatchObject({ label: 'Aircon', recordedKwh: 90 });
    expect(c.byLoad.find((l) => l.load === 'aircon')?.expectedKwh).toBeCloseTo(95, 6);
    // August 25–31 is inside the window the baseline was built from.
    expect(c.ownWindowDays).toBe(7);
    expect(describeAgainstBaseline(c, 'month')).toMatch(/^This month used 30\.8 kWh \(13\.3%\) less than the baseline expects\.$/);
  });

  it('says more in words, never with a bare minus sign', () => {
    const c = compareWithBaseline({ baseline: FAKE, period: 'day', start: '2026-10-07', holidays: [], recordedKwh: 12, recordedByLoad: {}, coverage: complete });
    expect(c.comparable && describeAgainstBaseline(c, 'day')).toBe('This day used 2.0 kWh (20.0%) more than the baseline expects.');
    expect(c.comparable && c.ownWindowDays).toBe(0);
  });
});

describe('chart points', () => {
  it('draws a day type as twenty-four hours of energy, by use', () => {
    const points = profilePoints(FAKE.day_types.working, FAKE.loads);
    expect(points).toHaveLength(24);
    expect(points[0]).toMatchObject({ label: '0', observed: true, complete: true });
    expect(points[9].values[1]).toBeCloseTo(5000 / 24 / 1000, 9);
  });

  it('draws the modelled week Monday first', () => {
    const points = weekPoints(FAKE);
    expect(points.map((p) => p.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(points[4].values.reduce<number>((a, v) => a + (v ?? 0), 0)).toBeCloseTo(10, 6);
    expect(points[6].notes?.[0]).toMatch(/Sunday/);
  });

  it('draws each recorded day, and says what the baseline did with it', () => {
    const points = recordedDayPoints(FAKE);
    expect(points.map((p) => p.day)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02']);
    expect(points[1].complete).toBe(false);
    expect(points[1].notes).toContain('not used: office closed');
    expect(points[2].notes).toContain('used for the Working day');
  });

  it('keeps each use in its own colour, as the rest of the page does', () => {
    expect(loadSeries(FAKE)).toEqual([
      { id: 'lighting', label: 'Lighting', colourIndex: 0 },
      { id: 'aircon', label: 'Aircon', colourIndex: 1 },
      { id: 'other', label: 'Others', colourIndex: 2 },
    ]);
  });
});

describe('this site’s baseline', () => {
  // The figures the operator was given on 2026-09-30 (E-232). A rebuild that moves them has to move
  // the evidence as well, which is why they are pinned here.
  it('reproduces the typical week and the standard month', () => {
    expect(SITE_BASELINE).not.toBeNull();
    const b = SITE_BASELINE as ProjectedBaseline;
    expect(b.week.kwh.total).toBeCloseTo(75.4, 1);
    expect(Math.round(b.standard_month.kwh.total)).toBe(328);
    expect(Math.round(expectedFor(b, periodDates('month', '2026-08-01'), []).kwh.total)).toBe(322);
    expect(Math.round(expectedFor(b, periodDates('month', '2026-09-01'), []).kwh.total)).toBe(329);
  });

  it('states its assumptions from its own data: Friday modelled, the unmetered aircon named', () => {
    const items = baselineAssumptionItems(SITE_BASELINE as ProjectedBaseline);
    const leads = items.map((i) => i.lead);
    expect(leads).toContain('Friday is modelled as a working day.');
    expect(items.find((i) => i.lead === 'Friday is modelled as a working day.')?.body).toMatch(/recorded Fridays averaged \d+\.\d kWh/);
    expect(leads).toContain("Others includes the Director's office aircon.");
    expect(leads.some((l) => /^Built from 29 days/.test(l))).toBe(true);
    // A weekday keeps its capital; a kind of day does not.
    expect(items.find((i) => /^Built from/.test(i.lead))?.body).toMatch(/^11 working days, 4 Saturdays, 4 Sundays;/);
  });
});

describe('compareWithProjection — RM-154', () => {
  const complete = { ratio: 1, band: 'complete' as const };
  it('sets a period against its projection on the same dates, overall, by use and day by day', async () => {
    const { compareWithProjection } = await import('./baselineCompare');
    const { projectPeriod } = await import('./baselineProjection');
    const { loadBaselineDays } = await import('@shared/siteConfig.mjs');
    const b = SITE_BASELINE as ProjectedBaseline;
    const { BASELINE_DAYS } = await loadBaselineDays();
    const projected = projectPeriod(b, BASELINE_DAYS as never, 'month', '2026-08-01', { holidays: HOLIDAYS });
    const recordedDaily = projected.daily.map((d) => ({ date: d.local_day, kwh: (d.energy_kwh as number) * 0.9 }));
    const c = compareWithProjection({
      baseline: b,
      projected,
      period: 'month',
      recordedKwh: (projected.building.energy_kwh as number) * 0.9,
      recordedByLoad: {},
      recordedDaily,
      coverage: complete,
    });
    expect(c.comparable).toBe(true);
    if (!c.comparable) return;
    expect(c.expectedKwh).toBeCloseTo(projected.building.energy_kwh as number, 6);
    expect(c.avoidedKwh).toBeCloseTo((projected.building.energy_kwh as number) * 0.1, 6);
    expect(c.holidays.map((h) => h.name)).toEqual(['Ninoy Aquino Day', 'National Heroes Day']);
    expect(c.days).toHaveLength(31);
    expect(c.days?.[0].recordedKwh).toBeCloseTo((c.days?.[0].expectedKwh as number) * 0.9, 6);
    const aircon = c.byLoad.find((l) => l.load === 'aircon');
    expect(aircon?.expectedKwh).toBeGreaterThan(0);
  });

  it('refuses under 95% recorded, and without a projection', async () => {
    const { compareWithProjection } = await import('./baselineCompare');
    const none = compareWithProjection({ baseline: FAKE, projected: null, period: 'month', recordedKwh: 1, recordedByLoad: {}, coverage: complete });
    expect(none.comparable).toBe(false);
    const thin = compareWithProjection({ baseline: FAKE, projected: null, period: 'month', recordedKwh: 1, recordedByLoad: {}, coverage: { ratio: 0.48, band: 'partial' } });
    expect(thin.comparable === false && thin.reason).toMatch(/48% recorded/);
  });
});
