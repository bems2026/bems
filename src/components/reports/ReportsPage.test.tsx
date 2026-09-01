import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ReportsPage } from './ReportsPage';
import * as reports from '@/lib/supabaseReports';

/**
 * The property this page exists to hold: a figure from a month that was barely observed is
 * never presented as the month's consumption. Everything else here is layout; this is the
 * claim, so it is what the tests assert.
 */

vi.mock('@/config/supabase', () => ({ supabase: {} }));

/** The filename is the assertion, not the contents — seven weeks of one month share a
 * `YYYY-MM` and would overwrite each other in a downloads folder. */
let downloaded = '';
vi.mock('@/lib/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/csv')>();
  return { ...actual, downloadCsv: (name: string) => { downloaded = name; } };
});
vi.mock('@/lib/supabaseReports', async (importOriginal) => {
  // Only the two I/O functions are faked. `coverageOf`/`isQuotable`/`formatPeriod` are the
  // pure logic under test here and must stay real, or this would be asserting on a mock.
  const actual = await importOriginal<typeof reports>();
  return { ...actual, getReportPeriods: vi.fn(), getDevicePeriodReports: vi.fn() };
});

const FULL_JULY = 31 * 24 * 60;

function buildingRow(overrides: Partial<reports.PeriodBuildingReport> = {}): reports.PeriodBuildingReport {
  return {
    period: 'month',
    period_start: '2026-07-01',
    energy_kwh: 1562.33,
    peak_total_power_w: 2140,
    avg_voltage: 219.8,
    phase_current_red_avg: 2.5,
    phase_current_yellow_avg: 2.0,
    phase_current_blue_avg: null,
    command_count: 4,
    command_count_manual: 3,
    command_count_schedule: 1,
    command_count_autoshed: 0,
    anomaly_count: 0,
    online_sample_count: FULL_JULY,
    expected_sample_count: FULL_JULY,
    generated_at: '2026-08-03T00:00:00Z',
    ...overrides,
  };
}

function deviceRow(overrides: Partial<reports.PeriodDeviceReport> = {}): reports.PeriodDeviceReport {
  return {
    period: 'month',
    period_start: '2026-07-01',
    device_id: 'mtr_co_yellow',
    energy_kwh: 41.2,
    peak_power_w: 812,
    avg_power_w: 230,
    online_sample_count: FULL_JULY,
    expected_sample_count: FULL_JULY,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(reports.getReportPeriods).mockResolvedValue([buildingRow()]);
  vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([deviceRow()]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ReportsPage', () => {
  it('lists a generated month and its building summary', async () => {
    render(<ReportsPage />);
    expect(await screen.findByRole('button', { name: 'July 2026' })).toBeInTheDocument();
    expect(await screen.findByText(/1562\.33 kWh/)).toBeInTheDocument();
  });

  it('marks a fully observed month complete, and lets its figures stand unqualified', async () => {
    render(<ReportsPage />);
    expect(await screen.findByText(/Complete · 100%/)).toBeInTheDocument();
    expect(screen.queryByText(/partial month/)).not.toBeInTheDocument();
  });

  it('never lets a barely-observed month quote a bare total', async () => {
    // This is the whole point. Four days of a 31-day month yields a real 41.2 kWh that is
    // not the month's consumption — the same shape of error as the truncated chart Phase 9
    // fixed, and RM-001 means this is the CURRENT state of the data, not a hypothetical.
    const sparse = 4 * 24 * 60;
    vi.mocked(reports.getReportPeriods).mockResolvedValue([
      buildingRow({ online_sample_count: sparse }),
    ]);
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([
      deviceRow({ online_sample_count: sparse }),
    ]);

    render(<ReportsPage />);

    expect(await screen.findAllByText(/Sparse · 13%/)).not.toHaveLength(0);
    const caveats = await screen.findAllByText(/partial month/);
    expect(caveats.length).toBeGreaterThan(0);
  });

  it('renders a missing figure as an em dash, never as zero', async () => {
    // A device with no energy figure at all must not read as "0 kWh consumed".
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([deviceRow({ energy_kwh: null })]);
    render(<ReportsPage />);
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
    expect(screen.queryByText(/^0\.00 kWh/)).not.toBeInTheDocument();
  });

  it('shows the unmetered Blue phase as missing rather than as 0 A', async () => {
    // No Blue-phase meter is installed. Reporting 0 A would claim a measurement.
    render(<ReportsPage />);
    await screen.findByText(/1562\.33 kWh/);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('says so plainly when no month has completed yet', async () => {
    vi.mocked(reports.getReportPeriods).mockResolvedValue([]);
    render(<ReportsPage />);
    expect(await screen.findByText(/No month has completed/)).toBeInTheDocument();
  });

  it('surfaces a fetch failure instead of rendering an empty report as a real one', async () => {
    vi.mocked(reports.getReportPeriods).mockRejectedValue(new Error('RLS said no'));
    render(<ReportsPage />);
    expect(await screen.findByText(/RLS said no/)).toBeInTheDocument();
  });

  it('disables the CSV export while there is nothing to export', async () => {
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([]);
    render(<ReportsPage />);
    const button = await screen.findByRole('button', { name: /Export CSV/ });
    expect(button).toBeDisabled();
  });
});

/**
 * Weekly reports — RM-041. A month is what gets reported upward; a week is how somebody notices
 * that something changed. The property most of these defend: **a week and a month are different
 * reports that happen to share a first day**, and nothing may render one under the other's
 * heading.
 */
describe('ReportsPage — weekly', () => {
  const weekRow = (over: Partial<reports.PeriodBuildingReport> = {}) =>
    buildingRow({ period: 'week', period_start: '2026-07-06', online_sample_count: 7 * 24 * 60, expected_sample_count: 7 * 24 * 60, ...over });

  it('opens on months, because that is what gets reported upward', async () => {
    render(<ReportsPage />);
    await screen.findByRole('group', { name: 'Report month' });
    expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('asks for weeks when weekly is chosen', async () => {
    render(<ReportsPage />);
    await screen.findByRole('group', { name: 'Report month' });
    vi.mocked(reports.getReportPeriods).mockResolvedValue([weekRow()]);
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([deviceRow({ period: 'week', period_start: '2026-07-06' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    await waitFor(() => expect(reports.getReportPeriods).toHaveBeenCalledWith('week'));
    expect(await screen.findByRole('group', { name: 'Report week' })).toBeInTheDocument();
  });

  it('labels a week by the day it starts, not by its month', async () => {
    // A list of weeks all reading "July 2026" would be a list of identical buttons.
    vi.mocked(reports.getReportPeriods).mockResolvedValue([weekRow()]);
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([deviceRow({ period: 'week', period_start: '2026-07-06' })]);
    render(<ReportsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weekly' }));
    // Not an exact string: `toLocaleDateString` orders the parts by the RUNNER's locale, so
    // pinning "6 Jul 2026" would pass in en-GB and fail in en-US. What matters is that a week is
    // labelled as a week and never as the month it falls in.
    // Plural: the label appears on the week's own button AND in the summary heading, which is
    // the point — both name the same period.
    const labels = await screen.findAllByText(/^Week of /);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels[0].textContent).toMatch(/2026/);
    expect(screen.queryByText('July 2026')).not.toBeInTheDocument();
  });

  it('selects the newest week rather than keeping the month that was selected', async () => {
    // THE TRAP. Carrying the previous selection over means a month's date is asked for as a
    // week, matches nothing, and the page renders an empty report that looks like a week with
    // no consumption.
    render(<ReportsPage />);
    await screen.findByRole('group', { name: 'Report month' });
    vi.mocked(reports.getReportPeriods).mockResolvedValue([weekRow(), weekRow({ period_start: '2026-06-29' })]);
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([deviceRow({ period: 'week', period_start: '2026-07-06' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    await waitFor(() => expect(reports.getDevicePeriodReports).toHaveBeenCalledWith('week', '2026-07-06'));
  });

  it('never renders a month’s device rows under a week that shares its first day', async () => {
    // 2026-06-01 is both a month start and a Monday. The fetch is tagged with its PERIOD as well
    // as its date precisely so these two cannot be mistaken for each other.
    vi.mocked(reports.getReportPeriods).mockResolvedValue([buildingRow({ period_start: '2026-06-01', energy_kwh: 99.9 })]);
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([deviceRow({ period_start: '2026-06-01' })]);
    render(<ReportsPage />);
    // The building figure renders with its unit, the same way the other tests match it.
    expect(await screen.findByText(/99\.90 kWh/)).toBeInTheDocument();

    // Switch to weeks and let the WEEK LIST hang. This is the window the bug lives in: the page
    // now says "Weekly", and the only data it has is the month's. A first version of this test
    // let the list resolve immediately, so there was no window at all — and deleting the guard
    // in the component broke nothing, which is how the test was found to be asserting nothing.
    vi.mocked(reports.getReportPeriods).mockReturnValue(new Promise(() => {}));
    vi.mocked(reports.getDevicePeriodReports).mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));

    // The month's summary must be gone rather than sitting under a weekly selection.
    await waitFor(() => expect(screen.queryByText(/99\.90 kWh/)).not.toBeInTheDocument());
  });

  it('names the period in the exported file, so seven weeks do not overwrite each other', async () => {
    vi.mocked(reports.getReportPeriods).mockResolvedValue([weekRow()]);
    vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([deviceRow({ period: 'week', period_start: '2026-07-06' })]);
    render(<ReportsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Weekly' }));
    await screen.findAllByText(/^Week of /);
    fireEvent.click(screen.getByRole('button', { name: /Export|CSV/i }));
    expect(downloaded).toMatch(/ibems-week-report-2026-07-06\.csv/);
  });
});
