import { describe, it, expect } from 'vitest';
import { baselineCsv, dailyCsv, deviceCsv, deviceDailyCsv } from './reportCsv';
import { SITE_BASELINE, compareWithBaseline, type ProjectedBaseline } from './baselineCompare';
import type { DeviceDayRow } from './circuitSeries';
import type { DailyRow } from './reportSeries';
import type { PeriodDeviceReport } from './supabaseReports';
import type { Factor, Rate } from './energyCost';

/**
 * RM-083 — the two CSVs a report exports.
 *
 * The SIMPLE CSV is one tidy table, one row per day: what somebody opening it in a spreadsheet
 * wants to sort, chart and sum. Tidy means no preamble, no totals row mixed in with the days (a
 * total inside the column is counted twice the moment anyone sums it), and units said once in the
 * header. Every rule the page keeps, the file keeps: a day with no real reading is an empty cell,
 * never 0, and a cost appears only when a rate exists to compute it from.
 */

const day = (o: Partial<DailyRow> = {}): DailyRow => ({
  local_day: '2026-08-17',
  energy_kwh: 14.68,
  peak_power_w: 1768,
  avg_power_w: 300,
  sample_count: 1440,
  usable_sample_count: 1440,
  expected_samples: 1440,
  first_seen_minute: 0,
  last_seen_minute: 1439,
  resolution: 'minute',
  ...o,
});

const rate: Rate = { effective_from: '2026-08-01', rate_per_kwh: 10, currency: 'PHP', source: 'bill', set_at: 'x', set_by_label: null };
const factor: Factor = { effective_from: '2026-08-01', kg_co2e_per_kwh: 0.7, source: 'grid', set_at: 'x', set_by_label: null };

const lines = (csv: string) => csv.split('\r\n');

describe('dailyCsv — the simple CSV', () => {
  it('has one row per day, and says each unit once, in the header', () => {
    const csv = dailyCsv({ daily: [day(), day({ local_day: '2026-08-18' })], tariffs: [], factors: [] });
    expect(lines(csv)[0]).toBe('Date,Energy (kWh),Peak demand (kW),Readings coverage (%),Day status');
    expect(lines(csv)).toHaveLength(3);
    expect(lines(csv)[1]).toBe('2026-08-17,14.68,1.768,100,complete');
  });

  it('leaves a day with no real reading empty — never 0 kWh — and says so', () => {
    // 2026-08-18, live: 1,414 rows and not one reading. Its energy is unknown, not zero, and a
    // zero in a spreadsheet is summed into the month like a real one.
    const csv = dailyCsv({
      daily: [day({ local_day: '2026-08-18', energy_kwh: 0, peak_power_w: null, sample_count: 1414, usable_sample_count: 0 })],
      tariffs: [],
      factors: [],
    });
    expect(lines(csv)[1]).toBe('2026-08-18,,,0,no data');
  });

  it('marks a partly observed day partial, with how much of it was seen', () => {
    // 2026-08-19, live: 0.89 kWh from 166 usable minutes of 1,440. A floor, and labelled as one.
    const csv = dailyCsv({ daily: [day({ local_day: '2026-08-19', energy_kwh: 0.89, usable_sample_count: 166 })], tariffs: [], factors: [] });
    expect(lines(csv)[1]).toBe('2026-08-19,0.89,1.768,12,partial');
  });

  it('adds a cost column in the rate’s own currency, only once a rate exists', () => {
    const csv = dailyCsv({ daily: [day({ local_day: '2026-07-31' }), day()], tariffs: [rate], factors: [] });
    expect(lines(csv)[0]).toBe('Date,Energy (kWh),Peak demand (kW),Readings coverage (%),Day status,Cost (PHP)');
    // Before the earliest rate the day is unpriced, not back-priced at a rate not yet in force.
    expect(lines(csv)[1]).toBe('2026-07-31,14.68,1.768,100,complete,');
    expect(lines(csv)[2]).toBe('2026-08-17,14.68,1.768,100,complete,146.8');
  });

  it('leaves the cost column out rather than adding amounts in two currencies', () => {
    const csv = dailyCsv({ daily: [day()], tariffs: [rate, { ...rate, effective_from: '2026-08-10', currency: 'USD' }], factors: [] });
    expect(lines(csv)[0]).not.toMatch(/Cost/);
  });

  it('adds an emissions column once an emission factor exists', () => {
    const csv = dailyCsv({ daily: [day()], tariffs: [], factors: [factor] });
    expect(lines(csv)[0]).toBe('Date,Energy (kWh),Peak demand (kW),Readings coverage (%),Day status,Emissions (kgCO2e)');
    expect(lines(csv)[1]).toBe('2026-08-17,14.68,1.768,100,complete,10.276');
  });
});

describe('deviceCsv — the per-device CSV', () => {
  const row = (o: Partial<PeriodDeviceReport> = {}): PeriodDeviceReport => ({
    period: 'month',
    period_start: '2026-08-01',
    device_id: 'dev_a',
    energy_kwh: 41.2,
    peak_power_w: 812,
    avg_power_w: 230,
    online_sample_count: 44640,
    expected_sample_count: 44640,
    ...o,
  });

  const base = { period: 'month' as const, start: '2026-08-01', nameOf: (id: string) => id, branchOf: () => null, meterIds: [] as string[] };

  it('keeps the columns this export has always had, adds branch and share, and names the period in every row', () => {
    const csv = deviceCsv({ ...base, period: 'week', start: '2026-07-06', rows: [row({ period: 'week', period_start: '2026-07-06' })], nameOf: () => 'Outlet A', branchOf: () => 'Outlets' });
    expect(lines(csv)[0]).toBe(
      'Period,Period start,Device ID,Device,Branch,Energy (kWh),Share of building (%),Peak power (W),Average power (W),Coverage (%),Samples observed,Samples expected,Note'
    );
    expect(lines(csv)[1]).toBe('week,2026-07-06,dev_a,Outlet A,Outlets,41.2,,812,230,100,44640,44640,');
  });

  it('leaves an impossible figure empty with its reason, and out of every share — RM-090', () => {
    // The live week of 2026-09-07: 81.406 kWh at a 251.2 W peak, where 42.2 kWh is the most 168 hours
    // at that peak could deliver.
    const week = { period: 'week' as const, period_start: '2026-09-07', expected_sample_count: 10080, online_sample_count: 10050 };
    const csv = deviceCsv({
      ...base,
      period: 'week',
      start: '2026-09-07',
      meterIds: ['meter_a', 'meter_b'],
      rows: [row({ ...week, device_id: 'meter_a', energy_kwh: 81.406, peak_power_w: 251.2 }), row({ ...week, device_id: 'meter_b', energy_kwh: 24.188, peak_power_w: 673.6 })],
    });
    const [bad, good] = lines(csv).slice(1).map((l) => l.split(','));
    expect(bad[5]).toBe('');
    expect(bad[6]).toBe('');
    // The reason holds a comma, so the cell is quoted — and it is the last one on the line.
    expect(lines(csv)[1]).toMatch(/,"Not possible: [^"]+, so it is left out"$/);
    // A total missing a branch would overstate every share, so none is given.
    expect(good[6]).toBe('');
    expect(good[12]).toBe('');
  });

  it('keeps a corrected figure and says what was taken out of it', () => {
    const csv = deviceCsv({ ...base, rows: [row({ energy_kwh: 4.617, peak_power_w: 251.2, energy_removed_kwh: 76.789 })] });
    const cells = lines(csv)[1].split(',');
    expect(cells[5]).toBe('4.617');
    expect(cells[12]).toBe('Corrected: a 76.79 kWh jump in the meter’s counter is not counted');
  });

  it('gives each device its share of the building total, which is the sum of the branch meters', () => {
    const csv = deviceCsv({
      ...base,
      meterIds: ['meter_a', 'meter_b'],
      rows: [row({ device_id: 'meter_a', energy_kwh: 60 }), row({ device_id: 'meter_b', energy_kwh: 40 }), row({ device_id: 'dev_a', energy_kwh: 10 })],
    });
    const shares = lines(csv).slice(1).map((l) => l.split(',')[6]);
    expect(shares).toEqual(['60', '40', '10']);
  });

  it('keeps a narrowed export’s shares of the whole building, not of the rows it kept — RM-082c', () => {
    // Narrowed to one branch, a share of what is left would call that branch 100% of the building.
    const building = [row({ device_id: 'meter_a', energy_kwh: 60 }), row({ device_id: 'meter_b', energy_kwh: 40 }), row({ device_id: 'dev_a', energy_kwh: 10 })];
    const csv = deviceCsv({ ...base, meterIds: ['meter_a', 'meter_b'], rows: building.slice(1), buildingRows: building });
    expect(lines(csv).slice(1).map((l) => l.split(',')[6])).toEqual(['40', '10']);
  });

  it('leaves share empty when the building total is not known, never a percentage of nothing', () => {
    const csv = deviceCsv({ ...base, meterIds: ['meter_a'], rows: [row({ device_id: 'meter_a', energy_kwh: null }), row()] });
    expect(lines(csv).slice(1).map((l) => l.split(',')[6])).toEqual(['', '']);
  });

  it('neutralises a device name a spreadsheet would otherwise run as a formula', () => {
    const csv = deviceCsv({ ...base, rows: [row()], nameOf: () => '=HYPERLINK("http://x")' });
    expect(lines(csv)[1]).toContain('"\'=HYPERLINK(""http://x"")"');
  });
});

describe('deviceDailyCsv — devices, one row per day (RM-098)', () => {
  const day = (device_id: string, local_day: string, o: Partial<DeviceDayRow> = {}): DeviceDayRow => ({
    device_id,
    local_day,
    energy_kwh: 1.234,
    counter_kwh: 1.234,
    removed_kwh: null,
    clipped_hours: 0,
    peak_power_w: 612.4,
    avg_power_w: 51.4,
    online_minutes: 1440,
    expected_minutes: 1440,
    resolution: 'minute',
    ...o,
  });
  const base = { nameOf: (id: string) => `name ${id}`, circuitOf: () => 'Lights B', useOf: () => 'Lighting' };

  it('writes a row per device per day, day by day, with its units in the header', () => {
    const csv = deviceDailyCsv({ ...base, rows: [day('b', '2026-09-08'), day('a', '2026-09-07'), day('b', '2026-09-07')] });
    expect(lines(csv)[0]).toBe(
      'Date,Device ID,Device,Circuit,Use,Energy (kWh),Counter jump not counted (kWh),Highest power (W),Average power (W),Minutes recorded,Minutes in day,Recorded (%),Day status,Made from,Note'
    );
    expect(lines(csv).slice(1).map((l) => l.split(',').slice(0, 2).join(' '))).toEqual(['2026-09-07 a', '2026-09-07 b', '2026-09-08 b']);
    expect(lines(csv)[1]).toBe('2026-09-07,a,name a,Lights B,Lighting,1.234,,612,51,1440,1440,100,complete,minute readings,');
  });

  it('leaves a day with nothing recorded empty — never 0 kWh — and says so', () => {
    const csv = deviceDailyCsv({ ...base, rows: [day('a', '2026-09-09', { energy_kwh: null, counter_kwh: null, peak_power_w: null, avg_power_w: null, online_minutes: 0, resolution: null })] });
    expect(lines(csv)[1]).toBe('2026-09-09,a,name a,Lights B,Lighting,,,,,0,1440,0,no data,,');
  });

  it('says what a counter jump took out of a day', () => {
    const csv = deviceDailyCsv({ ...base, rows: [day('a', '2026-09-08', { energy_kwh: 0.713, counter_kwh: 77.502, removed_kwh: 76.789, clipped_hours: 1, online_minutes: 1434 })] });
    expect(lines(csv)[1]).toBe('2026-09-08,a,name a,Lights B,Lighting,0.713,76.789,612,51,1434,1440,100,complete,minute readings,counter jump removed');
  });

  it('calls a partly recorded day partial, and names where older figures came from', () => {
    const csv = deviceDailyCsv({ ...base, rows: [day('a', '2026-08-17', { online_minutes: 359, resolution: 'mixed' })] });
    expect(lines(csv)[1]).toMatch(/,25,partial,minute readings and hourly averages,$/);
  });
});

describe('baselineCsv — RM-153', () => {
  // The site's own committed baseline: the file is its backup, so it must carry every figure the tab shows.
  const b = SITE_BASELINE as ProjectedBaseline;
  /** RFC 4180 cells: a note with a comma in it arrives quoted. */
  const cells = (line: string) => [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)].slice(0, -1).map((m) => m[1].replace(/^"|"$/g, '').replace(/""/g, '"'));
  const rowsOf = (csv: string) => csv.split('\r\n').slice(1).map(cells);
  const header = (csv: string) => csv.split('\r\n')[0];

  it('is one long table: what, which day, hour, use, value, unit, note — no preamble', () => {
    const csv = baselineCsv({ baseline: b, comparison: null, periodLabel: 'September 2026' });
    expect(header(csv)).toBe('Section,Day,Hour,Use,Value,Unit,Note');
  });

  it('carries every hour of every modelled day, for every use, and the figures read off them', () => {
    const rows = rowsOf(baselineCsv({ baseline: b, comparison: null, periodLabel: 'September 2026' }));
    const profile = rows.filter((r) => r[0] === 'Projected hour');
    expect(profile).toHaveLength(Object.keys(b.day_types).length * 24 * b.loads.length);
    const day = rows.find((r) => r[0] === 'Projected day' && r[1] === 'Working day' && r[3] === 'Total');
    expect(day?.[4]).toBe('13.83');
    expect(rows.find((r) => r[0] === 'Projected week' && r[3] === 'Total')?.[4]).toBe('75.4');
    expect(rows.find((r) => r[0] === 'Projected month' && r[3] === 'Total')?.[4]).toBe('328');
    expect(rows.find((r) => r[0] === 'Peak operating draw')?.[4]).toBe('2893');
  });

  it('keeps the recorded days as the backup, each saying what became of it', () => {
    const rows = rowsOf(baselineCsv({ baseline: b, comparison: null, periodLabel: 'September 2026' }));
    const recorded = rows.filter((r) => r[0] === 'Recorded day' && r[3] === 'Total');
    expect(recorded).toHaveLength(b.recorded.days.length);
    expect(recorded.find((r) => r[1] === '2026-08-25')?.[6]).toBe('Used: Working day');
    expect(recorded.find((r) => r[1] === '2026-09-01')?.[6]).toMatch(/^Left out: office evidently closed/);
  });

  it('adds the period against the baseline, with the direction in words and never a minus sign', () => {
    const comparison = compareWithBaseline({
      baseline: b,
      period: 'month',
      start: '2026-10-01',
      holidays: [],
      recordedKwh: 400,
      recordedByLoad: { lighting: 10, aircon: 150, other: 240 },
      coverage: { ratio: 1, band: 'complete' },
    });
    const csv = baselineCsv({ baseline: b, comparison, periodLabel: 'October 2026' });
    const rows = rowsOf(csv);
    const diff = rows.find((r) => r[0] === 'Against the baseline' && r[3] === 'Total' && r[6]?.startsWith('Difference'));
    expect(diff?.[6]).toBe('Difference: more than expected');
    expect(csv).not.toMatch(/,'?-\d/);
  });

  it('says why a period was not compared, in place of figures', () => {
    const comparison = compareWithBaseline({
      baseline: b, period: 'month', start: '2026-10-01', holidays: [], recordedKwh: 100, recordedByLoad: {}, coverage: { ratio: 0.48, band: 'partial' },
    });
    const rows = rowsOf(baselineCsv({ baseline: b, comparison, periodLabel: 'October 2026' }));
    const against = rows.filter((r) => r[0] === 'Against the baseline');
    expect(against).toHaveLength(1);
    expect(against[0].join(',')).toMatch(/48% recorded/);
  });
});
