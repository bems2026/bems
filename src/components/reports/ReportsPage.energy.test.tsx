import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ReportsPage } from './ReportsPage';
import * as reports from '@/lib/supabaseReports';

/**
 * RM-154 — the Overview and the Circuits tab print one energy figure.
 *
 * Live, the week of 21 Sep 2026 read 80.53 kWh on the Overview (the building's month counter) and 77.88
 * on Circuits (the sum of the branch circuits): the same four meters reduced two ways. The circuits' sum is
 * the figure now, on both tabs and in every comparison; the counter is said beside it, once, in words.
 */

vi.mock('@/config/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/supabaseReports', async (importOriginal) => {
  const actual = await importOriginal<typeof reports>();
  return { ...actual, getReportPeriods: vi.fn(), getDevicePeriodReports: vi.fn() };
});
const { DAYS, COUNTER_DAYS, CIRCUIT_DAYS } = vi.hoisted(() => {
  const DAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];
  /** The counter's days: 23 Sep reads 2.34 less than its circuits, as it did live. */
  const COUNTER_DAYS = [15.5, 15.49, 17.26, 15.3, 5.49, 5.26, 0.87];
  /** Per circuit per day: lighting red, lighting yellow, aircon, others — the circuits' days sum to 77.88. */
  const CIRCUIT_DAYS: Record<string, number[]> = {
    mtr_lo_red: [0.2, 0.2, 0.09, 0.2, 0.2, 0.0, 0.0],
    mtr_lo_yellow: [0.76, 0.5, 0.57, 0.5, 0.5, 0.34, 0.2],
    mtr_arec_acu: [5.27, 5.2, 7.72, 5.2, 0.4, 0.37, 0.27],
    mtr_co_yellow: [9.5, 9.59, 11.21, 9.4, 4.39, 4.7, 0.4],
  };
  return { DAYS, COUNTER_DAYS, CIRCUIT_DAYS };
});
vi.mock('@/lib/reportSeries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reportSeries')>();
  return {
    ...actual,
    getDailySeries: vi.fn().mockResolvedValue(
      DAYS.map((local_day, i) => ({
        local_day,
        energy_kwh: COUNTER_DAYS[i],
        peak_power_w: 2000,
        avg_power_w: 600,
        sample_count: 1440,
        usable_sample_count: 1440,
        expected_samples: 1440,
        first_seen_minute: 0,
        last_seen_minute: 1439,
        resolution: 'minute',
      }))
    ),
    getHourProfile: vi.fn().mockResolvedValue([]),
    getHourMatrix: vi.fn().mockResolvedValue([]),
    getDemandCurve: vi.fn().mockResolvedValue([]),
    getDemandSummary: vi.fn().mockResolvedValue(null),
  };
});
vi.mock('@/lib/circuitSeries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/circuitSeries')>();
  return {
    ...actual,
    getDeviceDailyEnergy: vi.fn().mockResolvedValue({
      available: true,
      rows: Object.entries(CIRCUIT_DAYS).flatMap(([device_id, values]) =>
        values.map((energy_kwh, i) => ({
          device_id,
          local_day: DAYS[i],
          energy_kwh,
          counter_kwh: energy_kwh,
          removed_kwh: null,
          clipped_hours: 0,
          peak_power_w: 3000,
          avg_power_w: 300,
          online_minutes: 1440,
          expected_minutes: 1440,
          resolution: 'minute',
        }))
      ),
    }),
    getCircuitTrend: vi.fn().mockResolvedValue(null),
  };
});
vi.mock('@/lib/supabaseConfig', () => ({ fetchScheduleContext: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabaseTariffs', () => ({ getTariffs: vi.fn().mockResolvedValue([]), getEmissionFactors: vi.fn().mockResolvedValue([]) }));

const WEEK = 7 * 1440;
const building = (period_start: string, energy_kwh: number): reports.PeriodBuildingReport => ({
  period: 'week',
  period_start,
  energy_kwh,
  peak_total_power_w: 4000,
  avg_voltage: 220,
  phase_current_red_avg: 2,
  phase_current_yellow_avg: 2,
  phase_current_blue_avg: null,
  command_count: 0,
  command_count_manual: 0,
  command_count_schedule: 0,
  command_count_autoshed: 0,
  anomaly_count: 0,
  online_sample_count: WEEK,
  expected_sample_count: WEEK,
  generated_at: '2026-09-29T00:00:00Z',
});
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const rowsFor = (period_start: string, factor = 1): reports.PeriodDeviceReport[] =>
  Object.entries(CIRCUIT_DAYS).map(([device_id, values]) => ({
    period: 'week',
    period_start,
    device_id,
    energy_kwh: sum(values) * factor,
    peak_power_w: 3000,
    avg_power_w: 300,
    online_sample_count: WEEK,
    expected_sample_count: WEEK,
  }));

afterEach(cleanup);

async function openWeek() {
  vi.mocked(reports.getReportPeriods).mockImplementation(async (period: reports.ReportPeriod) =>
    period === 'week' ? [building('2026-09-21', 80.53), building('2026-09-14', 71.5)] : []
  );
  vi.mocked(reports.getDevicePeriodReports).mockImplementation(async (_period, start: string) =>
    start === '2026-09-21' ? rowsFor('2026-09-21') : rowsFor('2026-09-14', 71.43 / 77.88)
  );
  render(<ReportsPage />);
  fireEvent.click(await screen.findByRole('button', { name: /^weekly$/i }));
}

const energyTile = (root: HTMLElement) => within(root).getAllByRole('term').find((t) => t.textContent === 'Energy')?.nextElementSibling?.textContent ?? '';

describe('one energy figure per period — RM-154', () => {
  it('prints the circuits\' sum as the period\'s energy on the Overview, not the counter', async () => {
    await openWeek();
    await waitFor(() => expect(energyTile(document.body)).toMatch(/^77\.88 kWh/));
    expect(document.body.textContent).not.toMatch(/80\.53 kWh(?!,)/);
  });

  it('says the counter once, in words, with the day the two part', async () => {
    await openWeek();
    expect(await screen.findByText(/^The building's own counter read 80\.53 kWh, 2\.65 more than its circuits\./)).toBeInTheDocument();
    // As live: 21 and 26 Sep part by a few tenths, 23 Sep by 2.33.
    expect(screen.getByText(/the two part on 21, 23 and 26 Sep\)\./)).toBeInTheDocument();
  });

  it('prints the same figure on the Circuits tab', async () => {
    await openWeek();
    await waitFor(() => expect(energyTile(document.body)).toMatch(/^77\.88 kWh/));
    fireEvent.click(screen.getByRole('tab', { name: /circuits/i }));
    const summary = await screen.findByRole('region', { name: /circuit summary/i });
    await waitFor(() => expect(energyTile(summary)).toMatch(/^77\.88 kWh/));
    expect(within(summary).getByText(/counter read 80\.53 kWh/)).toBeInTheDocument();
  });

  it('qualifies the figure the same way on both tabs — the same card, word for word', async () => {
    // Live, the week of 21 Sep: the building rows 99.4% recorded, the meters' own minutes 91.8%. The energy is
    // the meters' registers either way, which keep counting through a missed sample; one card, one qualifier.
    const rows = rowsFor('2026-09-21').map((r) => ({ ...r, online_sample_count: Math.round(WEEK * 0.918) }));
    vi.mocked(reports.getReportPeriods).mockResolvedValue([building('2026-09-21', 80.53)]);
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue(rows);
    render(<ReportsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /^weekly$/i }));
    await waitFor(() => expect(energyTile(document.body)).toMatch(/^77\.88 kWh/));
    const overview = energyTile(document.body);
    fireEvent.click(screen.getByRole('tab', { name: /circuits/i }));
    const summary = await screen.findByRole('region', { name: /circuit summary/i });
    await waitFor(() => expect(energyTile(summary)).toBe(overview));
  });

  it('compares with the previous week by its own circuits, not its counter', async () => {
    await openWeek();
    // 77.88 against the previous week's circuits, 71.43: 6.45 more. Against its counter (71.50) it would be 6.38.
    expect(await screen.findByText(/^\+6\.45 kWh$/)).toBeInTheDocument();
  });
});
