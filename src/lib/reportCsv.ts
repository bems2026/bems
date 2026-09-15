import { toCsv, type CsvColumn } from './csv';
import { coverageOf, type PeriodDeviceReport, type ReportPeriod } from './supabaseReports';
import type { DailyRow } from './reportSeries';
import { emissionsPerDay, pricePerDay, type Factor, type Rate } from './energyCost';

/**
 * The report's two CSVs — RM-083. Pure: rows in, text out; `downloadCsv` does the DOM part.
 *
 * THE SIMPLE CSV IS ONE TIDY TABLE, ONE ROW PER DAY — what somebody opening it in a spreadsheet
 * wants to sort, chart and sum. Tidy means no preamble, no totals row mixed in with the days (a total
 * inside a column is counted twice the moment anyone sums it), and each unit said once, in its
 * header. Every rule the page keeps, the file keeps: a day with no real reading has an empty energy
 * cell, never 0 — a zero in a spreadsheet is summed into the month like a real one — and a cost or
 * emissions column exists only when a rate or factor exists to compute it from.
 *
 * THE PER-DEVICE CSV keeps the columns it has always had and adds two: the branch a device sits on,
 * and its share of the building total. The total is the sum of the branch meters (RM-057), and a
 * share is given only when every one of them reported — a share of a total that is missing a branch
 * is larger than it should be, which is worse than no share.
 *
 * Both go through `toCsv`, which neutralises a device name a spreadsheet would run as a formula.
 */

const round = (v: number | null | undefined, digits: number) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(digits));

export function dailyCsv({
  daily,
  tariffs,
  factors,
}: {
  daily: readonly DailyRow[];
  tariffs: readonly Rate[];
  factors: readonly Factor[];
}): string {
  // Energy only from days whose rows held a real reading — the rule `toDailyPoints` and the page's
  // pricing already apply, so the file cannot price or sum a day the page calls unobserved.
  const days = daily.map((d) => ({ day: d.local_day.slice(0, 10), kwh: d.usable_sample_count > 0 ? d.energy_kwh : null }));
  const currencies = new Set(tariffs.map((t) => t.currency));
  const priced = tariffs.length > 0 && currencies.size === 1 ? pricePerDay(days, tariffs) : null;
  const emitted = factors.length > 0 ? emissionsPerDay(days, factors) : null;

  const rows = daily.map((d, i) => {
    const observed = d.usable_sample_count > 0;
    const coverage = coverageOf(d.usable_sample_count, d.expected_samples);
    return {
      date: days[i].day,
      energy: observed ? round(d.energy_kwh, 3) : null,
      peak: observed && d.peak_power_w !== null ? round(d.peak_power_w / 1000, 3) : null,
      coverage: coverage ? Math.round(coverage.ratio * 100) : null,
      status: !observed ? 'no data' : coverage?.band === 'complete' ? 'complete' : 'partial',
      cost: priced ? round(priced[i].amount, 2) : null,
      emissions: emitted ? round(emitted[i].kg, 3) : null,
    };
  });

  type Row = (typeof rows)[number];
  const columns: CsvColumn<Row>[] = [
    { key: 'date', header: 'Date' },
    { key: 'energy', header: 'Energy (kWh)' },
    { key: 'peak', header: 'Peak demand (kW)' },
    { key: 'coverage', header: 'Readings coverage (%)' },
    { key: 'status', header: 'Day status' },
    ...(priced ? [{ key: 'cost' as const, header: `Cost (${[...currencies][0]})` }] : []),
    ...(emitted ? [{ key: 'emissions' as const, header: 'Emissions (kgCO2e)' }] : []),
  ];
  return toCsv(rows, columns);
}

export function deviceCsv({
  period,
  start,
  rows,
  nameOf,
  branchOf,
  meterIds,
}: {
  period: ReportPeriod;
  start: string;
  rows: readonly PeriodDeviceReport[];
  nameOf: (id: string) => string;
  branchOf: (id: string) => string | null;
  /** The branch meters whose sum is the building total — `BUILDING_METER_IDS` on the page. */
  meterIds: readonly string[];
}): string {
  const meters = new Set(meterIds);
  const meterRows = rows.filter((r) => meters.has(r.device_id));
  const total =
    meterRows.length > 0 && meterRows.every((r) => r.energy_kwh !== null && Number.isFinite(r.energy_kwh))
      ? meterRows.reduce((a, r) => a + (r.energy_kwh as number), 0)
      : null;

  const flat = rows.map((r) => {
    const c = coverageOf(r.online_sample_count, r.expected_sample_count);
    return {
      period,
      start: start.slice(0, 10),
      device_id: r.device_id,
      device_name: nameOf(r.device_id),
      branch: branchOf(r.device_id),
      energy_kwh: r.energy_kwh,
      share_pct: total !== null && total > 0 && r.energy_kwh !== null ? round((r.energy_kwh / total) * 100, 1) : null,
      peak_power_w: r.peak_power_w,
      avg_power_w: r.avg_power_w,
      // A number a spreadsheet can sort and filter on, not "Partial · 13%".
      coverage_pct: c ? Math.round(c.ratio * 100) : null,
      online_sample_count: r.online_sample_count,
      expected_sample_count: r.expected_sample_count,
    };
  });

  const columns: CsvColumn<(typeof flat)[number]>[] = [
    { key: 'period', header: 'Period' },
    { key: 'start', header: 'Period start' },
    { key: 'device_id', header: 'Device ID' },
    { key: 'device_name', header: 'Device' },
    { key: 'branch', header: 'Branch' },
    { key: 'energy_kwh', header: 'Energy (kWh)' },
    { key: 'share_pct', header: 'Share of building (%)' },
    { key: 'peak_power_w', header: 'Peak power (W)' },
    { key: 'avg_power_w', header: 'Average power (W)' },
    { key: 'coverage_pct', header: 'Coverage (%)' },
    { key: 'online_sample_count', header: 'Samples observed' },
    { key: 'expected_sample_count', header: 'Samples expected' },
  ];
  return toCsv(flat, columns);
}
