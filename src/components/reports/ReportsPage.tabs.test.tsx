import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
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
    expect(tabs.map((t) => t.textContent)).toEqual(['Overview', 'Circuits', 'Usage patterns', 'Compare']);
  });

  it('starts on the overview', async () => {
    render(<ReportsPage />);
    expect(await screen.findByRole('tab', { name: /overview/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('uses no statistician’s words anywhere a reader looks — RM-097', async () => {
    const { container } = render(<ReportsPage />);
    await screen.findByText(/100\.00 kWh/);
    for (const name of [/overview/i, /circuits/i, /usage patterns/i, /compare/i]) {
      await openTab(name);
      await waitFor(() => expect(container.textContent).not.toMatch(/\bp(50|95|99)\b|median|baseline|DSM|load factor|load duration|percentile/i));
    }
  });

  it('keeps the control bar to the period, the scope and the export — the tabs are a strip of their own beneath it (RM-101)', async () => {
    // On the 800x480 kiosk one bar carrying the tabs as well wrapped to three lines and could not
    // stay in reach. The bar is what decides the report; the tabs decide the reading of it.
    render(<ReportsPage />);
    const bar = (await screen.findByRole('button', { name: /^circuit /i })).closest('.report-controls');
    expect(bar).not.toBeNull();
    expect(within(bar as HTMLElement).queryByRole('tablist')).not.toBeInTheDocument();
    expect(within(bar as HTMLElement).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(bar as HTMLElement).getByRole('button', { name: /^export$/i })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /report type/i })).toBeInTheDocument();
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
    expect(await screen.findByText(/choose an earlier month to compare/i)).toBeInTheDocument();
    // The figure specifically, not the word: "It is a difference, not a saving" is in the
    // caveats below and is supposed to be there whether or not a comparison was made.
    expect(screen.queryByRole('term', { name: 'Difference' })).toBeNull();
    expect(screen.queryByText(/kWh \(/)).toBeNull();
  });

  it('differences two fully observed periods', async () => {
    render(<ReportsPage />);
    await openTab(/compare/i);
    const select = await screen.findByRole('combobox', { name: /earlier period/i });
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
    const select = await screen.findByRole('combobox', { name: /earlier period/i });
    fireEvent.change(select, { target: { value: '2026-06-01' } });

    await waitFor(() => expect(screen.getByText(/Not comparable/i)).toBeInTheDocument());
    expect(screen.getByText(/earlier period was not fully recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/48%/)).toBeInTheDocument();
    expect(screen.queryByText(/Difference/)).toBeNull();
  });

  it('always says what it was not adjusted for, comparable or not', async () => {
    // Not collapsible and not behind a hint: a difference presented without this list reads as
    // a saving, and the reader has no way to know it is two months' weather.
    render(<ReportsPage />);
    await openTab(/compare/i);
    expect(await screen.findByText(/Not adjusted for weather\./)).toBeInTheDocument();
    expect(screen.getByText(/A difference, not a saving\./)).toBeInTheDocument();
  });
});

describe('usage patterns gate themselves', () => {
  it('says a thin window is too little to show a usual pattern', async () => {
    // The gate fires on the window's own thinness, not on anything the reader chose.
    render(<ReportsPage />);
    await openTab(/usage patterns/i);
    expect(await screen.findByText(/Too little recorded to show a usual pattern yet/i)).toBeInTheDocument();
  });

  it('carries the report’s limits, in the same claims the CLI report makes, said shorter', async () => {
    render(<ReportsPage />);
    await openTab(/usage patterns/i);
    expect(await screen.findByText(/Not per square metre or per person\./)).toBeInTheDocument();
    expect(screen.getByText(/Not a forecast\./)).toBeInTheDocument();
  });
});

describe('each tab names a panel that exists — FI-041', () => {
  // The strip set `aria-controls` on every tab, and the page never rendered the panel it named: a screen
  // reader asked to go to the tab's content found nothing there. The page renders the selected tab's body,
  // so that body is the panel, labelled by its tab.
  it.each([/overview/i, /circuits/i, /usage patterns/i, /compare/i])('%s', async (name) => {
    render(<ReportsPage />);
    const tab = await openTab(name);
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
    const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
  });
});
