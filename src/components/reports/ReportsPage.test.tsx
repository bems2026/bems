import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ReportsPage } from './ReportsPage';
import * as reports from '@/lib/supabaseReports';

/**
 * The property this page exists to hold: a figure from a month that was barely observed is
 * never presented as the month's consumption. Everything else here is layout; this is the
 * claim, so it is what the tests assert.
 */

vi.mock('@/config/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/supabaseReports', async (importOriginal) => {
  // Only the two I/O functions are faked. `coverageOf`/`isQuotable`/`formatMonth` are the
  // pure logic under test here and must stay real, or this would be asserting on a mock.
  const actual = await importOriginal<typeof reports>();
  return { ...actual, getReportMonths: vi.fn(), getDeviceReports: vi.fn() };
});

const FULL_JULY = 31 * 24 * 60;

function buildingRow(overrides: Partial<reports.MonthlyBuildingReport> = {}): reports.MonthlyBuildingReport {
  return {
    month: '2026-07-01',
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

function deviceRow(overrides: Partial<reports.MonthlyDeviceReport> = {}): reports.MonthlyDeviceReport {
  return {
    month: '2026-07-01',
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
  vi.mocked(reports.getReportMonths).mockResolvedValue([buildingRow()]);
  vi.mocked(reports.getDeviceReports).mockResolvedValue([deviceRow()]);
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
    vi.mocked(reports.getReportMonths).mockResolvedValue([
      buildingRow({ online_sample_count: sparse }),
    ]);
    vi.mocked(reports.getDeviceReports).mockResolvedValue([
      deviceRow({ online_sample_count: sparse }),
    ]);

    render(<ReportsPage />);

    expect(await screen.findAllByText(/Sparse · 13%/)).not.toHaveLength(0);
    const caveats = await screen.findAllByText(/partial month/);
    expect(caveats.length).toBeGreaterThan(0);
  });

  it('renders a missing figure as an em dash, never as zero', async () => {
    // A device with no energy figure at all must not read as "0 kWh consumed".
    vi.mocked(reports.getDeviceReports).mockResolvedValue([deviceRow({ energy_kwh: null })]);
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
    vi.mocked(reports.getReportMonths).mockResolvedValue([]);
    render(<ReportsPage />);
    expect(await screen.findByText(/No month has completed/)).toBeInTheDocument();
  });

  it('surfaces a fetch failure instead of rendering an empty report as a real one', async () => {
    vi.mocked(reports.getReportMonths).mockRejectedValue(new Error('RLS said no'));
    render(<ReportsPage />);
    expect(await screen.findByText(/RLS said no/)).toBeInTheDocument();
  });

  it('disables the CSV export while there is nothing to export', async () => {
    vi.mocked(reports.getDeviceReports).mockResolvedValue([]);
    render(<ReportsPage />);
    const button = await screen.findByRole('button', { name: /Export CSV/ });
    expect(button).toBeDisabled();
  });
});
