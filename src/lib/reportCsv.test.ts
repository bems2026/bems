import { describe, it, expect } from 'vitest';
import { dailyCsv, deviceCsv } from './reportCsv';
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
      'Period,Period start,Device ID,Device,Branch,Energy (kWh),Share of building (%),Peak power (W),Average power (W),Coverage (%),Samples observed,Samples expected'
    );
    expect(lines(csv)[1]).toBe('week,2026-07-06,dev_a,Outlet A,Outlets,41.2,,812,230,100,44640,44640');
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
