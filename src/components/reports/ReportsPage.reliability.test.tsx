import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ReportsPage } from './ReportsPage';
import { sceneWidthFor } from './chartWidth';
import * as reports from '@/lib/supabaseReports';
import * as series from '@/lib/reportSeries';
import * as tariffs from '@/lib/supabaseTariffs';
import * as config from '@/lib/supabaseConfig';

/**
 * RM-081 — what the page does when the network, the database or one bad row does not cooperate.
 *
 * Kept apart from `ReportsPage.test.tsx` and `ReportsPage.tabs.test.tsx` on purpose: those are the
 * regression guard for the honesty properties the page shipped with and must keep passing
 * untouched through this work. ONLY THE I/O IS FAKED, for the reason the tabs file gives.
 */

vi.mock('@/config/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/csv')>();
  return { ...actual, downloadCsv: () => {} };
});
vi.mock('@/lib/supabaseReports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabaseReports')>();
  return { ...actual, getReportPeriods: vi.fn(), getDevicePeriodReports: vi.fn() };
});
vi.mock('@/lib/reportSeries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reportSeries')>();
  return {
    ...actual,
    getDailySeries: vi.fn(),
    getHourProfile: vi.fn(),
    getHourMatrix: vi.fn(),
    getDemandCurve: vi.fn(),
    getDemandSummary: vi.fn(),
  };
});
// Set in `beforeEach`, not here: `vi.resetAllMocks()` wipes a factory's implementation, and an
// unset ceiling read then fails and raises a second alert this file never meant to test.
vi.mock('@/lib/supabaseConfig', () => ({ fetchScheduleContext: vi.fn() }));
vi.mock('@/lib/supabaseTariffs', () => ({ getTariffs: vi.fn(), getEmissionFactors: vi.fn() }));
/** The one generator made to throw, as a malformed row would make it. Every other chart is real. */
const heatmapThrows = { current: false };
vi.mock('./charts/demandHeatmapChart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./charts/demandHeatmapChart')>();
  return {
    ...actual,
    demandHeatmapChart: (...args: Parameters<typeof actual.demandHeatmapChart>) => {
      if (heatmapThrows.current) throw new Error('a cell with no day');
      return actual.demandHeatmapChart(...args);
    },
  };
});

const FULL_MONTH = 31 * 24 * 60;

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
  online_sample_count: FULL_MONTH,
  expected_sample_count: FULL_MONTH,
  generated_at: '2026-08-03T00:00:00Z',
  ...o,
});

const deviceRow: reports.PeriodDeviceReport = {
  period: 'month',
  period_start: '2026-07-01',
  device_id: 'mtr_co_yellow',
  energy_kwh: 41.2,
  peak_power_w: 812,
  avg_power_w: 230,
  online_sample_count: FULL_MONTH,
  expected_sample_count: FULL_MONTH,
};

const summary = (o: Partial<series.DemandSummary> = {}): series.DemandSummary => ({
  n: FULL_MONTH,
  p50_w: 800,
  p95_w: 1900,
  p99_w: 2100,
  max_w: 2140,
  min_w: 90,
  observed_minutes: FULL_MONTH,
  usable_minutes: FULL_MONTH,
  expected_minutes: FULL_MONTH,
  longest_gap_minutes: 0,
  resolution: 'minute',
  ...o,
});

beforeEach(() => {
  vi.resetAllMocks();
  heatmapThrows.current = false;
  vi.mocked(reports.getReportPeriods).mockResolvedValue([buildingRow()]);
  vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([deviceRow]);
  vi.mocked(series.getDailySeries).mockResolvedValue([]);
  vi.mocked(series.getHourProfile).mockResolvedValue([]);
  vi.mocked(series.getHourMatrix).mockResolvedValue([]);
  vi.mocked(series.getDemandCurve).mockResolvedValue([]);
  vi.mocked(series.getDemandSummary).mockResolvedValue(summary());
  vi.mocked(tariffs.getTariffs).mockResolvedValue([]);
  vi.mocked(tariffs.getEmissionFactors).mockResolvedValue([]);
  vi.mocked(config.fetchScheduleContext).mockResolvedValue({});
});

afterEach(cleanup);

describe('ReportsPage — when something fails', () => {
  it('contains a chart that cannot be drawn to its own card, and keeps the rest of the report', async () => {
    // One malformed row used to throw to the page boundary and replace the whole Reports page.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    heatmapThrows.current = true;
    render(<ReportsPage />);
    expect(await screen.findByText(/100\.00 kWh/)).toBeInTheDocument();

    // RM-096: the busy hours chart lives on Usage patterns.
    fireEvent.click(await screen.findByRole('tab', { name: /usage patterns/i }));
    expect(await screen.findByText(/could not be drawn/)).toBeInTheDocument();
    // The rest of the tab is still there: its demand tiles, and the two charts that did not throw.
    expect(screen.getByText('Usual demand')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2));
  });

  it('keeps the charts when the tariffs cannot be read, and never claims no rate was entered', async () => {
    // "No rate has been entered" is a statement about the database. A read that failed has not
    // established it, and printing it would be the page lying about why it has no figure.
    vi.mocked(tariffs.getTariffs).mockRejectedValue(new Error('permission denied for table energy_tariffs'));
    render(<ReportsPage />);

    expect(await screen.findByText(/rates could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no rate has been entered/)).not.toBeInTheDocument();
    // The Overview's two charts — energy per day, and energy by use.
    await waitFor(() => expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2));
  });

  it('offers Retry on a section that failed, and draws it once it answers', async () => {
    vi.mocked(series.getHourMatrix)
      .mockRejectedValueOnce(new Error('report_hour_matrix failed: canceling statement due to statement timeout'))
      .mockResolvedValue([]);
    render(<ReportsPage />);
    // The figures that did load are not hostage to the ones that did not.
    expect(await screen.findByText(/100\.00 kWh/)).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('tab', { name: /usage patterns/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/busy hours chart could not be loaded/i);
    expect(alert).toHaveTextContent(/statement timeout/);
    // RM-081b: nor are the charts whose own series arrived.
    await waitFor(() => expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText(/^Busy hours/)).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getAllByRole('img').length).toBeGreaterThanOrEqual(3));
    expect(screen.queryByText(/busy hours chart could not be loaded/i)).not.toBeInTheDocument();
  });

  it('says it is loading, rather than showing an empty page', async () => {
    vi.mocked(series.getDailySeries).mockReturnValue(new Promise(() => {}));
    render(<ReportsPage />);

    const statuses = await screen.findAllByRole('status');
    expect(statuses.some((s) => /loading/i.test(s.textContent ?? ''))).toBe(true);
  });
});

describe('ReportsPage — saying what a figure is', () => {
  it('calls a period with no real reading "not observed", never 0 kWh', async () => {
    // Live, 2026-09-15: the week of 2026-08-10 is stored as 0 kWh from 10 of 10,080 samples, and
    // the page printed "0.00 kWh". Ten rows the meters wrote while observing nothing are not a
    // week that used no electricity.
    vi.mocked(reports.getReportPeriods).mockResolvedValue([
      buildingRow({ energy_kwh: 0, online_sample_count: 10, peak_total_power_w: 0 }),
    ]);
    vi.mocked(series.getDemandSummary).mockResolvedValue(summary({ usable_minutes: 0, observed_minutes: 10, max_w: null }));
    render(<ReportsPage />);

    expect(await screen.findAllByText(/not observed/)).not.toHaveLength(0);
    expect(screen.queryByText(/^0\.00 kWh/)).not.toBeInTheDocument();
  });

  it('calls a thin weekly figure a partial week, not a partial month', async () => {
    const week = (o: Partial<reports.PeriodBuildingReport> = {}) =>
      buildingRow({ period: 'week', period_start: '2026-07-06', online_sample_count: 4 * 24 * 60, expected_sample_count: 7 * 24 * 60, ...o });
    vi.mocked(reports.getReportPeriods).mockImplementation(async (period) => (period === 'week' ? [week()] : [buildingRow()]));
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([
      { ...deviceRow, period: 'week', period_start: '2026-07-06', online_sample_count: 4 * 24 * 60, expected_sample_count: 7 * 24 * 60 },
    ]);
    render(<ReportsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weekly' }));

    expect(await screen.findAllByText(/partial week/)).not.toHaveLength(0);
    expect(screen.queryByText(/partial month/)).not.toBeInTheDocument();
  });

  it('talks about weeks when no week has completed', async () => {
    vi.mocked(reports.getReportPeriods).mockImplementation(async (period) => (period === 'week' ? [] : [buildingRow()]));
    render(<ReportsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weekly' }));

    expect(await screen.findByText(/No week has completed/)).toBeInTheDocument();
  });
});

describe('the next report, said on the page — RM-138', () => {
  // The operator read the newest weekly report on the evening of 22 Sept and could not tell whether the
  // week of 14 Sept was late or broken. The calendar's cell says it; a `title` never shows on the kiosk,
  // so the page says it too — only while the newest report is the one being read.
  const weekRow = (start: string) =>
    buildingRow({ period: 'week', period_start: start, online_sample_count: 7 * 24 * 60, expected_sample_count: 7 * 24 * 60 });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the next weekly report and when, while the newest is being read — and not on an older one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-22T12:30:00Z'));
    vi.mocked(reports.getReportPeriods).mockImplementation(async (period) =>
      period === 'week' ? [weekRow('2026-09-07'), weekRow('2026-08-31')] : [buildingRow()]
    );
    render(<ReportsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weekly' }));

    const note = await screen.findByText(/^Next weekly report:/);
    expect(note).toHaveTextContent(reports.formatPeriod('week', '2026-09-14'));
    expect(note).toHaveTextContent(/ready after 08:00/);

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await waitFor(() => expect(screen.queryByText(/^Next weekly report:/)).not.toBeInTheDocument());
  });
});

describe('the controls stay put while a new kind of period loads — RM-140', () => {
  it('keeps the period picker in the bar while the weeks are read', async () => {
    let answer!: (rows: reports.PeriodBuildingReport[]) => void;
    vi.mocked(reports.getReportPeriods).mockImplementation((period) =>
      period === 'week' ? new Promise((resolve) => (answer = resolve)) : Promise.resolve([buildingRow()])
    );
    render(<ReportsPage />);
    await screen.findByRole('group', { name: 'Report month' });
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    const picker = await screen.findByRole('group', { name: 'Report week' });
    expect(picker).toHaveAttribute('aria-busy', 'true');
    answer([buildingRow({ period: 'week', period_start: '2026-07-06' })]);
    await waitFor(() => expect(screen.getByRole('group', { name: 'Report week' })).not.toHaveAttribute('aria-busy', 'true'));
  });
});

describe('charts drawn at the width the page has — RM-142', () => {
  // At 1920 px every chart was a 640-unit drawing stretched 2.36×: 21 px labels beside 11 px captions.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('draws each chart at the measured panel’s width, so its text is one size on any screen', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly report: ResizeObserverCallback;
        constructor(report: ResizeObserverCallback) {
          this.report = report;
        }
        observe() {
          this.report([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
        }
        disconnect() {}
        unobserve() {}
      }
    );
    render(<ReportsPage />);
    const chart = await screen.findByRole('img', { name: /Energy per day/ });
    expect(chart.getAttribute('viewBox')?.split(' ')[2]).toBe(String(sceneWidthFor(1200)));
  });
});
