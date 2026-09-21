import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ReportsPage } from './ReportsPage';
import * as reports from '@/lib/supabaseReports';

/**
 * The four readings of one period, and the one that refuses to give an answer.
 *
 * Kept separate from `ReportsPage.test.tsx` on purpose: that file is the regression guard for
 * the honesty properties the page shipped with, and it should keep passing untouched through
 * work like this. This one is about what RM-072n added.
 */

vi.mock('@/config/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/csv')>();
  return { ...actual, downloadCsv: () => {} };
});
vi.mock('@/lib/supabaseReports', async (importOriginal) => {
  const actual = await importOriginal<typeof reports>();
  return { ...actual, getReportPeriods: vi.fn(), getDevicePeriodReports: vi.fn() };
});
/**
 * ONLY THE I/O IS FAKED. `toDailyPoints` and the other mappers are pure and stay real — the
 * same rule the sibling test file states. Replacing the whole module leaves them undefined,
 * `ReportCharts` calls one, and the page throws on first render: every assertion in this file
 * then fails with "unable to find", which reads as four separate layout bugs and is one bad mock.
 */
vi.mock('@/lib/reportSeries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reportSeries')>();
  return {
    ...actual,
    getDailySeries: vi.fn().mockResolvedValue([]),
    getHourProfile: vi.fn().mockResolvedValue([]),
    getHourMatrix: vi.fn().mockResolvedValue([]),
    getDemandCurve: vi.fn().mockResolvedValue([]),
    getDemandSummary: vi.fn().mockResolvedValue(null),
  };
});
vi.mock('@/lib/supabaseConfig', () => ({ fetchScheduleContext: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/circuitSeries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/circuitSeries')>();
  const dayRow = (d: number, energy_kwh: number | null) => ({
    device_id: 'mtr_co_yellow', local_day: `2026-07-${String(d).padStart(2, '0')}`, energy_kwh, counter_kwh: energy_kwh, removed_kwh: null,
    clipped_hours: 0, peak_power_w: 800, avg_power_w: 300, online_minutes: energy_kwh === null ? 0 : 1440, expected_minutes: 1440, resolution: 'minute',
  });
  return {
    ...actual,
    getDeviceDailyEnergy: vi.fn().mockResolvedValue({ available: true, rows: [dayRow(1, 3), dayRow(2, null), dayRow(3, 6)] }),
    getCircuitTrend: vi.fn().mockResolvedValue(null),
  };
});
// Empty, which is the live state: no tariff entered. An unmocked one rejects, the whole
// Promise.all never resolves, and every tab that needs the series renders nothing — which reads
// as a broken panel and is a missing mock.
vi.mock('@/lib/supabaseTariffs', () => ({
  getTariffs: vi.fn().mockResolvedValue([]),
  getEmissionFactors: vi.fn().mockResolvedValue([]),
}));

const FULL = 31 * 24 * 60;

const buildingRow = (o: Partial<reports.PeriodBuildingReport> = {}): reports.PeriodBuildingReport => ({
  period: 'month',
  period_start: '2026-07-01',
  energy_kwh: 100,
  peak_total_power_w: 2140,
  avg_voltage: 219.8,
  phase_current_red_avg: 2.5,
  phase_current_yellow_avg: 2.0,
  phase_current_blue_avg: null,
  command_count: 0,
  command_count_manual: 0,
  command_count_schedule: 0,
  command_count_autoshed: 0,
  anomaly_count: 0,
  online_sample_count: FULL,
  expected_sample_count: FULL,
  generated_at: '2026-08-03T00:00:00Z',
  ...o,
});

const deviceRow = (o: Partial<reports.PeriodDeviceReport> = {}): reports.PeriodDeviceReport => ({
  period: 'month',
  period_start: '2026-07-01',
  device_id: 'mtr_co_yellow',
  energy_kwh: 41.2,
  peak_power_w: 812,
  avg_power_w: 230,
  online_sample_count: FULL,
  expected_sample_count: FULL,
  ...o,
});

beforeEach(() => {
  vi.mocked(reports.getReportPeriods).mockResolvedValue([buildingRow()]);
  vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([
    deviceRow(),
    deviceRow({ device_id: 'mtr_lo_yellow', energy_kwh: 4.6, peak_power_w: 42 }),
  ]);
});
afterEach(cleanup);

const openCircuits = async () => fireEvent.click(await screen.findByRole('tab', { name: /circuits/i }));

/**
 * RM-130 / FI-035 — the director's office aircon, on C.O Yellow with the CARE office's outlets, at
 * about two thirds of the branch by the operator's estimate. No meter sits on it; the section says so
 * in every line, and the measured charts are left alone.
 */
describe('the estimated loads section', () => {
  it('shows the director\'s aircon as about two thirds of C.O Yellow, marked as an estimate with its basis', async () => {
    render(<ReportsPage />);
    await openCircuits();
    const section = await screen.findByRole('region', { name: /estimated, not metered/i });
    expect(within(section).getAllByText(/director.s office aircon/i).length).toBeGreaterThanOrEqual(1);
    // Said on the figure's line and again in the chart's caption — both must carry it.
    expect(within(section).getAllByText(/about two thirds of C\.O Yellow/i).length).toBeGreaterThanOrEqual(2);
    expect(within(section).getAllByText(/operator.s estimate, 2026-09-22/i).length).toBeGreaterThanOrEqual(2);
    // 41.2 × 2/3 (in the figure and again in the note about Energy by use) and the rest, each
    // preceded by ≈ — never a bare figure.
    expect(within(section).getAllByText(/27\.47/).length).toBeGreaterThanOrEqual(1);
    expect(within(section).getByText(/13\.73/)).toBeInTheDocument();
    expect(within(section).getAllByText(/≈/).length).toBeGreaterThanOrEqual(2);
  });

  it('says what the estimate would do to Energy by use, rather than doing it', async () => {
    render(<ReportsPage />);
    await openCircuits();
    const section = await screen.findByRole('region', { name: /estimated, not metered/i });
    expect(within(section).getByText(/counts all of C\.O Yellow as Others/i)).toBeInTheDocument();
    expect(within(section).getByText(/would move/i)).toBeInTheDocument();
  });

  it('refuses the estimate when the branch\'s own figure is refused — RM-090', async () => {
    // 251 W for a whole month cannot reach 81 kWh; the branch reads "Not possible", so must its share.
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([deviceRow({ energy_kwh: 981.406, peak_power_w: 251.2 })]);
    render(<ReportsPage />);
    await openCircuits();
    const section = await screen.findByRole('region', { name: /estimated, not metered/i });
    expect(within(section).queryByText(/27\.47|654\.27/)).not.toBeInTheDocument();
    expect(within(section).getAllByText(/not possible/i).length).toBeGreaterThan(0);
  });

  it('is not on the Overview, which is the whole building measured', async () => {
    render(<ReportsPage />);
    await screen.findByText(/100\.00 kWh/);
    expect(screen.queryByRole('region', { name: /estimated, not metered/i })).not.toBeInTheDocument();
  });

  it('draws the estimate as its own bar chart, hatched, per day for a month, with ≈ in every value', async () => {
    render(<ReportsPage />);
    await openCircuits();
    const section = await screen.findByRole('region', { name: /estimated, not metered/i });
    const explore = await within(section).findByRole('group', { name: /explore the values in .*director.s office aircon, per day/i });
    const svg = explore.querySelector('svg') as SVGSVGElement;
    // Two observed days as hatched bars, one gap; every bar is a pattern fill, none solid.
    const bars = [...svg.querySelectorAll('rect')].filter((r) => (r.getAttribute('fill') ?? '').includes('-estimate)'));
    expect(bars).toHaveLength(2);
    expect([...svg.querySelectorAll('rect')].some((r) => (r.getAttribute('fill') ?? '').includes('-gap)'))).toBe(true);
    fireEvent.click(within(section).getByText(/show each day/i));
    expect(await within(section).findByText('≈ 2.00')).toBeInTheDocument();
    expect(within(section).getByText('≈ 4.00')).toBeInTheDocument();
  });
});
