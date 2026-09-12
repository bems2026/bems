import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
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
  vi.mocked(reports.getReportPeriods).mockResolvedValue([
    buildingRow(),
    buildingRow({ period_start: '2026-06-01', energy_kwh: 120 }),
  ]);
  vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([deviceRow()]);
});
afterEach(cleanup);

const openTab = async (name: RegExp) => {
  const tab = await screen.findByRole('tab', { name });
  fireEvent.click(tab);
  return tab;
};

describe('the report-type tabs', () => {
  it('offers four readings of the same period', async () => {
    render(<ReportsPage />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Summary', 'Baseline', 'Circuits', 'Compare']);
  });

  it('starts on the summary', async () => {
    render(<ReportsPage />);
    expect(await screen.findByRole('tab', { name: /summary/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the period picker across tabs, because the period is the page subject', async () => {
    // A tab that reset the period would be a different page pretending to be a tab.
    render(<ReportsPage />);
    await screen.findByRole('group', { name: /report month/i });
    await openTab(/circuits/i);
    expect(screen.getByRole('group', { name: /report month/i })).toBeInTheDocument();
  });

  it('separates branch circuits from the devices inside them', async () => {
    // A flat table puts a branch meter and an outlet within it on adjacent rows, reading as
    // peers. Adding those together double-counts.
    render(<ReportsPage />);
    await openTab(/circuits/i);
    expect(await screen.findByText(/adding the two tables together would count the same energy twice/i)).toBeInTheDocument();
  });
});

describe('the comparison refuses rather than guessing', () => {
  it('shows no figure until a baseline is chosen', async () => {
    // Defaulting to "the period before" would put a number on screen nobody asked for, on the
    // one report whose job is to be careful about what a number means.
    render(<ReportsPage />);
    await openTab(/compare/i);
    expect(await screen.findByText(/choose a baseline period/i)).toBeInTheDocument();
    // The figure specifically, not the word: "It is a difference, not a saving" is in the
    // caveats below and is supposed to be there whether or not a comparison was made.
    expect(screen.queryByRole('term', { name: 'Difference' })).toBeNull();
    expect(screen.queryByText(/kWh \(/)).toBeNull();
  });

  it('differences two fully observed periods', async () => {
    render(<ReportsPage />);
    await openTab(/compare/i);
    const select = await screen.findByRole('combobox', { name: /baseline period/i });
    fireEvent.change(select, { target: { value: '2026-06-01' } });
    await waitFor(() => expect(screen.getByText(/Difference/)).toBeInTheDocument());
    // 100 against a 120 baseline: 20 kWh less, said in words as well as in the sign.
    expect(screen.getByText(/20\.00 kWh \(16\.7%\) less/)).toBeInTheDocument();
  });

  it('refuses when the baseline was not fully observed, and says which', async () => {
    // THE ASSERTION THIS REPORT EXISTS FOR. Live, that is a 100%-covered week beside a
    // 48%-covered month; ungated it prints a large percentage that is entirely an artefact of
    // the meters being off.
    vi.mocked(reports.getReportPeriods).mockResolvedValue([
      buildingRow(),
      buildingRow({ period_start: '2026-06-01', energy_kwh: 120, online_sample_count: Math.round(FULL * 0.48) }),
    ]);
    render(<ReportsPage />);
    await openTab(/compare/i);
    const select = await screen.findByRole('combobox', { name: /baseline period/i });
    fireEvent.change(select, { target: { value: '2026-06-01' } });

    await waitFor(() => expect(screen.getByText(/Not comparable/i)).toBeInTheDocument());
    expect(screen.getByText(/baseline period was not fully observed/i)).toBeInTheDocument();
    expect(screen.getByText(/48%/)).toBeInTheDocument();
    expect(screen.queryByText(/Difference/)).toBeNull();
  });

  it('always says what it was not adjusted for, comparable or not', async () => {
    // Not collapsible and not behind a hint: a difference presented without this list reads as
    // a saving, and the reader has no way to know it is two months' weather.
    render(<ReportsPage />);
    await openTab(/compare/i);
    expect(await screen.findByText(/It is not weather-adjusted\./)).toBeInTheDocument();
    expect(screen.getByText(/It is a difference, not a saving\./)).toBeInTheDocument();
  });
});

describe('the baseline report gates itself', () => {
  it('says a thin window is not a baseline yet', async () => {
    // The gate fires on the window's own thinness, not on anything the reader chose.
    render(<ReportsPage />);
    await openTab(/baseline/i);
    expect(await screen.findByText(/This is not a baseline yet/i)).toBeInTheDocument();
  });

  it('carries the caveats the CLI report carries, from the same source', async () => {
    render(<ReportsPage />);
    await openTab(/baseline/i);
    expect(await screen.findByText(/It is not normalised by floor area or occupancy\./)).toBeInTheDocument();
    expect(screen.getByText(/It is not a forecast\./)).toBeInTheDocument();
  });
});
