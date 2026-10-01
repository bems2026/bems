import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { ReportsPage } from './ReportsPage';
import * as reports from '@/lib/supabaseReports';
import * as series from '@/lib/reportSeries';

/**
 * RM-154 — the baseline is chosen in the calendar and read through the same tabs as any report.
 *
 * The operator rejected RM-153's separate tab: the baseline belongs where the period is chosen, with the
 * Overview, Circuits and Usage patterns a recorded report has, and days that differ the way real days do.
 * These run against the site's own committed baseline and its recorded days.
 */

const { MONTH_DAYS, METERS } = vi.hoisted(() => ({
  MONTH_DAYS: Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`),
  METERS: ['mtr_lo_red', 'mtr_lo_yellow', 'mtr_arec_acu', 'mtr_co_yellow'],
}));

vi.mock('@/config/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/supabaseReports', async (importOriginal) => {
  const actual = await importOriginal<typeof reports>();
  return { ...actual, getReportPeriods: vi.fn(), getDevicePeriodReports: vi.fn() };
});
vi.mock('@/lib/reportSeries', async (importOriginal) => {
  const actual = await importOriginal<typeof series>();
  return {
    ...actual,
    getDailySeries: vi.fn().mockResolvedValue(
      MONTH_DAYS.map((local_day) => ({
        local_day,
        energy_kwh: 10,
        peak_power_w: 2000,
        avg_power_w: 400,
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
      rows: METERS.flatMap((device_id) =>
        MONTH_DAYS.map((local_day) => ({
          device_id,
          local_day,
          energy_kwh: 2.5,
          counter_kwh: 2.5,
          removed_kwh: null,
          clipped_hours: 0,
          peak_power_w: 1000,
          avg_power_w: 100,
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

const MONTH = 30 * 1440;
afterEach(cleanup);

async function openSeptember() {
  vi.mocked(reports.getReportPeriods).mockResolvedValue([
    {
      period: 'month',
      period_start: '2026-09-01',
      energy_kwh: 300,
      peak_total_power_w: 4500,
      avg_voltage: 221,
      phase_current_red_avg: 2,
      phase_current_yellow_avg: 2,
      phase_current_blue_avg: null,
      command_count: 0,
      command_count_manual: 0,
      command_count_schedule: 0,
      command_count_autoshed: 0,
      anomaly_count: 0,
      online_sample_count: MONTH,
      expected_sample_count: MONTH,
      generated_at: '2026-10-03T00:00:00Z',
    },
  ]);
  vi.mocked(reports.getDevicePeriodReports).mockResolvedValue(
    METERS.map((device_id) => ({
      period: 'month' as const,
      period_start: '2026-09-01',
      device_id,
      energy_kwh: 75,
      peak_power_w: 1000,
      avg_power_w: 100,
      online_sample_count: MONTH,
      expected_sample_count: MONTH,
    }))
  );
  render(<ReportsPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'September 2026' }));
  fireEvent.click(screen.getByRole('button', { name: 'Baseline' }));
  await screen.findByRole('button', { name: 'Baseline · September 2026' });
}

const tile = (root: HTMLElement, term: string) => within(root).getAllByRole('term').find((t) => t.textContent === term)?.nextElementSibling?.textContent ?? '';

describe('the baseline, chosen in the calendar — RM-154', () => {
  it('reads as a month of its own: projected, with what it was built from instead of what was recorded', async () => {
    await openSeptember();
    expect(await screen.findByRole('heading', { name: /September 2026 · Monthly baseline/ })).toBeInTheDocument();
    expect(screen.getByText('Projected')).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    await waitFor(() => expect(tile(panel, 'Energy')).toMatch(/^\d{3}\.\d{2} kWh/));
    expect(tile(panel, 'Built from')).toMatch(/^19 recorded days/);
    expect(within(panel).queryByRole('term', { name: 'Recorded' })).toBeNull();
    expect(within(panel).queryByText('Commands')).toBeNull();
    expect(screen.getByRole('region', { name: /how this baseline was made/i })).toBeInTheDocument();
  });

  it('draws a bar for every day of the month, and the days differ', async () => {
    await openSeptember();
    const chart = await screen.findByRole('img', { name: /Energy per day — September 2026/ });
    expect(chart).toBeInTheDocument();
    const { projectPeriod } = await import('@/lib/baselineProjection');
    const { SITE_BASELINE } = await import('@/lib/baselineCompare');
    const { loadBaselineDays } = await import('@shared/siteConfig.mjs');
    const { BASELINE_DAYS } = await loadBaselineDays();
    const p = projectPeriod(SITE_BASELINE as never, BASELINE_DAYS as never, 'month', '2026-09-01', {});
    // The tile is the projection's month, the sum of its thirty days.
    const panel = screen.getByRole('tabpanel');
    expect(tile(panel, 'Energy')).toMatch(new RegExp(`^${(p.building.energy_kwh as number).toFixed(2)} kWh`));
    expect(new Set(p.daily.map((d) => (d.energy_kwh as number).toFixed(1))).size).toBeGreaterThan(10);
  });

  it('fills the Circuits tab from the projected circuits, and says the devices inside them are not modelled', async () => {
    await openSeptember();
    fireEvent.click(screen.getByRole('tab', { name: /circuits/i }));
    const summary = await screen.findByRole('region', { name: /circuit summary/i });
    await waitFor(() => expect(tile(summary, 'Energy')).toMatch(/kWh/));
    expect(within(summary).getByText(/devices inside them are not modelled/)).toBeInTheDocument();
    expect(screen.queryByText(/^Devices on /)).toBeNull();
  });

  it('fills Usage patterns: a full month of hours, not "too little recorded"', async () => {
    await openSeptember();
    fireEvent.click(screen.getByRole('tab', { name: /usage patterns/i }));
    await screen.findByRole('img', { name: /typical day/i });
    expect(screen.queryByText(/Too little recorded/)).toBeNull();
  });

  it('opens Compare on the recorded month against its baseline', async () => {
    await openSeptember();
    fireEvent.click(screen.getByRole('tab', { name: /compare/i }));
    const against = await screen.findByRole('region', { name: /against the baseline, september 2026/i });
    // The recorded month is the sum of its circuits: 4 × 75 = 300 kWh.
    await waitFor(() => expect(tile(against, 'Recorded')).toMatch(/^300\.0 kWh/));
    expect(tile(against, 'Energy avoided')).toMatch(/kWh|None/);
  });

  it('goes back to the recorded report from the heading or the calendar', async () => {
    await openSeptember();
    fireEvent.click(await screen.findByRole('button', { name: 'Back to recorded' }));
    expect(await screen.findByRole('heading', { name: /September 2026 · Monthly report/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'September 2026' })).toBeInTheDocument();
  });
});
