import { toCsv, type CsvColumn } from './csv';
import { coverageOf, type PeriodDeviceReport, type ReportPeriod } from './supabaseReports';
import type { DailyRow } from './reportSeries';
import type { DeviceDayRow } from './circuitSeries';
import { emissionsPerDay, pricePerDay, type Factor, type Rate } from './energyCost';
import { energyFlagOf, energyFlagText, usableEnergy } from './boundedEnergy';
import type { BaselineComparison, ProjectedBaseline } from './baselineCompare';
import { LOAD_LABELS } from '@shared/circuits.mjs';

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
  projected = false,
}: {
  daily: readonly DailyRow[];
  tariffs: readonly Rate[];
  factors: readonly Factor[];
  /** RM-154: the days of a projected baseline — no coverage to state, and each is said to be projected. */
  projected?: boolean;
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
      coverage: projected ? null : coverage ? Math.round(coverage.ratio * 100) : null,
      status: projected ? 'projected' : !observed ? 'no data' : coverage?.band === 'complete' ? 'complete' : 'partial',
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
  buildingRows = rows,
  nameOf,
  branchOf,
  meterIds,
}: {
  period: ReportPeriod;
  start: string;
  /** The rows to write — one branch's, when the export is narrowed to one (RM-082c). */
  rows: readonly PeriodDeviceReport[];
  /**
   * Every row of the period, which the building total is taken from. A narrowed export passes the
   * whole period here, so a share is still of the building rather than of the branch it kept —
   * narrowed to one branch, a share of what is left would call that branch 100% of the building.
   */
  buildingRows?: readonly PeriodDeviceReport[];
  nameOf: (id: string) => string;
  branchOf: (id: string) => string | null;
  /** The branch meters whose sum is the building total — `BUILDING_METER_IDS` on the page. */
  meterIds: readonly string[];
}): string {
  const meters = new Set(meterIds);
  const meterRows = buildingRows.filter((r) => meters.has(r.device_id));
  const total =
    meterRows.length > 0 && meterRows.every((r) => usableEnergy(r) !== null && Number.isFinite(usableEnergy(r)))
      ? meterRows.reduce((a, r) => a + (usableEnergy(r) as number), 0)
      : null;

  const flat = rows.map((r) => {
    const c = coverageOf(r.online_sample_count, r.expected_sample_count);
    // RM-090: an impossible stored figure is an empty cell with its reason, never a number to sum.
    const energy = usableEnergy(r);
    const flag = energyFlagOf(r);
    return {
      period,
      start: start.slice(0, 10),
      device_id: r.device_id,
      device_name: nameOf(r.device_id),
      branch: branchOf(r.device_id),
      energy_kwh: energy,
      share_pct: total !== null && total > 0 && energy !== null ? round((energy / total) * 100, 1) : null,
      peak_power_w: r.peak_power_w,
      avg_power_w: r.avg_power_w,
      // A number a spreadsheet can sort and filter on, not "Partial · 13%".
      coverage_pct: c ? Math.round(c.ratio * 100) : null,
      online_sample_count: r.online_sample_count,
      expected_sample_count: r.expected_sample_count,
      note: flag ? energyFlagText(flag) : null,
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
    { key: 'note', header: 'Note' },
  ];
  return toCsv(flat, columns);
}

const MADE_FROM: Record<string, string> = {
  minute: 'minute readings',
  hour: 'hourly averages',
  mixed: 'minute readings and hourly averages',
};

/**
 * Devices, one row per day — RM-098. Each device's bounded energy per local day from phase42's
 * `report_device_daily_energy`, so the days sum to the report's own per-device figure, and a counter jump
 * is as absent here as there — with what it took out said in its own column.
 *
 * The rules the page keeps, kept: a day nothing was recorded on is empty, never 0 kWh; a partly recorded
 * day says so; and where an older day's figures came from (minute readings or hourly averages) is named,
 * because an hourly average cannot show a short peak.
 */
export function deviceDailyCsv({
  rows,
  nameOf,
  circuitOf,
  useOf,
}: {
  rows: readonly DeviceDayRow[];
  nameOf: (id: string) => string;
  circuitOf: (id: string) => string | null;
  useOf: (id: string) => string | null;
}): string {
  // Day by day, and within a day by device id, so the same period exports the same file every time.
  const sorted = [...rows].sort((a, b) => a.local_day.localeCompare(b.local_day) || a.device_id.localeCompare(b.device_id));

  const flat = sorted.map((r) => {
    const recorded = r.online_minutes > 0 && r.energy_kwh !== null;
    const c = coverageOf(r.online_minutes, r.expected_minutes);
    return {
      date: r.local_day.slice(0, 10),
      device_id: r.device_id,
      device: nameOf(r.device_id),
      circuit: circuitOf(r.device_id),
      use: useOf(r.device_id),
      energy: recorded ? round(Number(r.energy_kwh), 3) : null,
      removed: r.removed_kwh !== null && Number(r.removed_kwh) > 0.001 ? round(Number(r.removed_kwh), 3) : null,
      peak: recorded ? round(r.peak_power_w, 0) : null,
      average: recorded ? round(r.avg_power_w, 0) : null,
      minutes: r.online_minutes,
      expected: r.expected_minutes,
      recorded_pct: c ? Math.round(c.ratio * 100) : null,
      status: !recorded ? 'no data' : c?.band === 'complete' ? 'complete' : 'partial',
      made_from: r.resolution ? (MADE_FROM[r.resolution] ?? r.resolution) : null,
      note: r.removed_kwh !== null && Number(r.removed_kwh) > 0.001 ? 'counter jump removed' : null,
    };
  });

  const columns: CsvColumn<(typeof flat)[number]>[] = [
    { key: 'date', header: 'Date' },
    { key: 'device_id', header: 'Device ID' },
    { key: 'device', header: 'Device' },
    { key: 'circuit', header: 'Circuit' },
    { key: 'use', header: 'Use' },
    { key: 'energy', header: 'Energy (kWh)' },
    { key: 'removed', header: 'Counter jump not counted (kWh)' },
    { key: 'peak', header: 'Highest power (W)' },
    { key: 'average', header: 'Average power (W)' },
    { key: 'minutes', header: 'Minutes recorded' },
    { key: 'expected', header: 'Minutes in day' },
    { key: 'recorded_pct', header: 'Recorded (%)' },
    { key: 'status', header: 'Day status' },
    { key: 'made_from', header: 'Made from' },
    { key: 'note', header: 'Note' },
  ];
  return toCsv(flat, columns);
}

/**
 * The projected baseline as one long table — RM-153.
 *
 * The baseline's backup, and the figures behind every number the Baseline tab shows: each modelled day
 * hour by hour and use by use, the day, week and month read off them, the recorded days it was built from
 * with what became of each, and the chosen period against it. LONG rather than wide, because the rows are
 * of several kinds: a spreadsheet filters on Section and pivots on Day, Hour and Use, and no row is a total
 * of rows beside it in the same column.
 *
 * NO MINUS SIGN. `toCsv` neutralises a cell starting with "-" (a spreadsheet would read it as a formula),
 * and the direction of a difference is said in the Note instead — which is how the page says it too.
 */
export function baselineCsv({
  baseline: b,
  comparison,
  periodLabel,
}: {
  baseline: ProjectedBaseline;
  comparison: BaselineComparison | null;
  periodLabel: string;
}): string {
  interface Row {
    section: string;
    day: string | null;
    hour: string | null;
    use: string;
    value: number | string | null;
    unit: string | null;
    note: string | null;
  }
  const label = (load: string) => (LOAD_LABELS as Record<string, string>)[load] ?? (load === 'total' ? 'Total' : load);
  const uses = [...b.loads, 'total'];
  const rows: Row[] = [];
  const push = (section: string, day: string | null, hour: string | null, use: string, value: number | string | null, unit: string | null, note: string | null = null) =>
    rows.push({ section, day, hour, use, value, unit, note });

  for (const t of Object.values(b.day_types)) {
    for (let h = 0; h < 24; h++) {
      for (const l of b.loads) push('Projected hour', t.label, `${String(h).padStart(2, '0')}:00`, label(l), round(t.profile_w[l][h], 1), 'W', 'average draw in the hour');
    }
  }
  for (const t of Object.values(b.day_types)) {
    for (const u of uses) push('Projected day', t.label, null, label(u), round(t.kwh[u], 2), 'kWh', `from ${t.days.length} recorded days`);
    push('Base standby load', t.label, null, 'Total', round(t.standby_w, 0), 'W', 'overnight, 00:00–05:00');
    push('Expected demand', t.label, null, 'Total', round(t.working_hours_avg_w, 0), 'W', `average draw, ${b.working_hours.start}–${b.working_hours.end}`);
  }
  for (const u of uses) push('Projected week', null, null, label(u), round(b.week.kwh[u], 1), 'kWh', 'five working days, a Saturday and a Sunday');
  for (const u of uses) push('Projected month', null, null, label(u), round(b.standard_month.kwh[u], 0), 'kWh', `a standard month of ${b.standard_month.days} days`);
  push('Peak operating draw', null, null, 'Total', round(b.peak_operating_draw.w, 0), 'W', `highest minute of a busy working day; ${Math.round(b.peak_operating_draw.quantile * 10)} in 10 of ${b.peak_operating_draw.days} working days stayed below it`);

  for (const d of b.recorded.days) {
    const fate = d.used_as ? `Used: ${b.day_types[d.used_as]?.label ?? d.used_as}` : `Left out: ${d.reason ?? 'no reason recorded'}`;
    for (const u of uses) push('Recorded day', d.date, null, label(u), d.hours_recorded > 0 ? round(d.kwh[u], 3) : null, 'kWh', u === 'total' ? fate : null);
    push('Recorded day', d.date, null, 'Hours recorded', d.hours_recorded, 'hours', null);
  }
  for (const p of b.recorded.profiles) {
    for (let h = 0; h < 24; h++) {
      for (const l of b.loads) push('Recorded average hour', p.label, `${String(h).padStart(2, '0')}:00`, label(l), round(p.profile_w[l][h], 1), 'W', `average of ${p.days.length} recorded days`);
    }
  }

  if (comparison && !comparison.comparable) {
    push('Against the baseline', periodLabel, null, 'Total', null, null, `Not compared: ${comparison.reason}`);
  } else if (comparison) {
    const byUse = [...comparison.byLoad.map((l) => ({ use: l.label, expected: l.expectedKwh, recorded: l.recordedKwh })), { use: 'Total', expected: comparison.expectedKwh, recorded: comparison.recordedKwh as number | null }];
    for (const r of byUse) {
      push('Against the baseline', periodLabel, null, r.use, round(r.expected, 2), 'kWh', 'Expected');
      push('Against the baseline', periodLabel, null, r.use, round(r.recorded, 2), 'kWh', 'Recorded');
      if (r.recorded !== null) {
        const d = r.recorded - r.expected;
        push('Against the baseline', periodLabel, null, r.use, round(Math.abs(d), 2), 'kWh', `Difference: ${d <= 0 ? 'less' : 'more'} than expected`);
      }
    }
    for (const h of comparison.holidays) push('Against the baseline', h.date, null, 'Total', null, null, `Counted as a closed day: ${h.name}`);
  }

  return toCsv(rows, [
    { key: 'section', header: 'Section' },
    { key: 'day', header: 'Day' },
    { key: 'hour', header: 'Hour' },
    { key: 'use', header: 'Use' },
    { key: 'value', header: 'Value' },
    { key: 'unit', header: 'Unit' },
    { key: 'note', header: 'Note' },
  ]);
}
