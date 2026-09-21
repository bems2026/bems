import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { ReportsPage } from './ReportsPage';
import * as reports from '@/lib/supabaseReports';
import * as series from '@/lib/reportSeries';

/**
 * The Daily period — RM-124. A third kind of period beside Weekly and Monthly, read through the
 * same four tabs: the Overview's chart becomes the day's twenty-four hourly bars, the picker
 * becomes a calendar of stored days, and everything else is the same page.
 *
 * Kept apart from the tabs test for the reason that file gives about its own sibling.
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
vi.mock('@/lib/reportSeries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reportSeries')>();
  return {
    ...actual,
    getDailySeries: vi.fn().mockResolvedValue([]),
    getHourProfile: vi.fn().mockResolvedValue([]),
    getHourMatrix: vi.fn().mockResolvedValue([]),
    getDemandCurve: vi.fn().mockResolvedValue([]),
    getDemandSummary: vi.fn().mockResolvedValue(null),
    getHourEnergy: vi.fn().mockResolvedValue([]),
  };
});
vi.mock('@/lib/supabaseConfig', () => ({ fetchScheduleContext: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabaseTariffs', () => ({
  getTariffs: vi.fn().mockResolvedValue([]),
  getEmissionFactors: vi.fn().mockResolvedValue([]),
}));

const DAY = 24 * 60;

const dayRow = (o: Partial<reports.PeriodBuildingReport> = {}): reports.PeriodBuildingReport => ({
  period: 'day',
  period_start: '2026-09-19',
  energy_kwh: 5.85,
  peak_total_power_w: 1420,
  avg_voltage: 229.1,
  phase_current_red_avg: 1.1,
  phase_current_yellow_avg: 2.0,
  phase_current_blue_avg: null,
  command_count: 0,
  command_count_manual: 0,
  command_count_schedule: 0,
  command_count_autoshed: 0,
  anomaly_count: 0,
  online_sample_count: DAY,
  expected_sample_count: DAY,
  generated_at: '2026-09-20T01:00:00Z',
  ...o,
});

const monthRow = (): reports.PeriodBuildingReport => dayRow({ period: 'month', period_start: '2026-08-01', energy_kwh: 100, online_sample_count: 31 * DAY, expected_sample_count: 31 * DAY });

const hourRow = (device_id: string, local_hour: number, energy_kwh: number | null): series.HourEnergyRow => ({
  device_id,
  local_day: '2026-09-19',
  local_hour,
  energy_kwh,
  clipped: false,
  avg_power_w: energy_kwh === null ? null : energy_kwh * 1000,
  max_power_w: energy_kwh === null ? null : energy_kwh * 1500,
  online_minutes: energy_kwh === null ? 0 : 60,
  resolution: energy_kwh === null ? null : 'minute',
});

beforeEach(() => {
  // The module-level fakes keep their call lists across tests; a test that asserts "not called"
  // must start from nothing.
  vi.clearAllMocks();
  vi.mocked(reports.getReportPeriods).mockImplementation(async (period) => {
    if (period === 'day') return [dayRow(), dayRow({ period_start: '2026-09-18', energy_kwh: 4.1 })];
    if (period === 'month') return [monthRow()];
    return [];
  });
  vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([
    { period: 'day', period_start: '2026-09-19', device_id: 'mtr_co_yellow', energy_kwh: 5.26, peak_power_w: 1286, avg_power_w: 219, online_sample_count: DAY, expected_sample_count: DAY },
    { period: 'day', period_start: '2026-09-19', device_id: 'mtr_lo_yellow', energy_kwh: 0.59, peak_power_w: 42, avg_power_w: 25, online_sample_count: DAY, expected_sample_count: DAY },
  ]);
  vi.mocked(series.getHourEnergy).mockResolvedValue([
    ...Array.from({ length: 24 }, (_, h) => hourRow('mtr_co_yellow', h, h >= 8 && h < 17 ? 0.5 : h < 6 ? null : 0.04)),
    ...Array.from({ length: 24 }, (_, h) => hourRow('mtr_lo_yellow', h, h < 6 ? null : 0.04)),
  ]);
});
afterEach(cleanup);

/** A chart's figure, found by the explore group that carries its title — the figure itself has no name. */
const figureOf = async (title: RegExp) => {
  const explore = await screen.findByRole('group', { name: (n) => /explore the values in/i.test(n) && title.test(n) });
  return explore.closest('figure') as HTMLElement;
};

const chooseDaily = async () => {
  const group = await screen.findByRole('group', { name: /report period/i });
  fireEvent.click(within(group).getByRole('button', { name: /^daily$/i }));
};

describe('the Daily period', () => {
  it('is offered beside Weekly and Monthly, in that order', async () => {
    render(<ReportsPage />);
    const group = await screen.findByRole('group', { name: /report period/i });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Daily', 'Weekly', 'Monthly']);
  });

  it('lands on the newest stored day, named with its weekday, as a daily report', async () => {
    render(<ReportsPage />);
    await chooseDaily();
    // The parts, not their order — that is the reader's locale's.
    const h = await screen.findByRole('heading', { level: 2, name: /Daily report/ });
    expect(h.textContent).toMatch(/Sat/);
    expect(h.textContent).toMatch(/19/);
    expect(h.textContent).toMatch(/Sep/);
    expect(screen.getByRole('group', { name: /report day/i })).toBeInTheDocument();
  });

  it('draws the day hour by hour, twenty-four columns from 00 to 23, with the night as a gap', async () => {
    render(<ReportsPage />);
    await chooseDaily();
    const figure = await figureOf(/hour by hour/i);
    // Six hours before 06:00 carried nothing: one gap, said once. The rest are bars.
    await waitFor(() => expect(within(figure).getByText(/6 h, no data/)).toBeInTheDocument());
    expect(within(figure).getByText('00')).toBeInTheDocument();
    expect(within(figure).getByText('23')).toBeInTheDocument();
  });

  it('asks the database for the hourly credits only for a day, and never draws the per-day chart for one', async () => {
    render(<ReportsPage />);
    await screen.findByRole('group', { name: /report period/i });
    expect(series.getHourEnergy).not.toHaveBeenCalled();
    await chooseDaily();
    await waitFor(() => expect(series.getHourEnergy).toHaveBeenCalledWith('day', '2026-09-19', expect.any(Array), expect.anything()));
    expect(screen.queryByRole('group', { name: /explore the values in energy per day/i })).not.toBeInTheDocument();
  });

  it('sums the branch meters for the building\'s bars — the table shows the hour\'s kWh', async () => {
    render(<ReportsPage />);
    await chooseDaily();
    const figure = await figureOf(/hour by hour/i);
    fireEvent.click(within(figure).getByText(/show the hours/i));
    // 08:00 to 16:59 — outlets 0.50 + lighting 0.04, nine hours of it; the night is em-dashed.
    expect(await within(figure).findAllByText('0.54')).toHaveLength(9);
    expect(within(figure).getAllByText('0.08').length).toBeGreaterThan(0);
  });

  it('steps between stored days and opens a calendar of the month', async () => {
    render(<ReportsPage />);
    await chooseDaily();
    const stepper = await screen.findByRole('group', { name: /report day/i });
    fireEvent.click(within(stepper).getByRole('button', { name: /previous day/i }));
    expect(await screen.findByRole('heading', { level: 2, name: /Fri.*2026.*Daily report/ })).toBeInTheDocument();
    fireEvent.click(within(stepper).getByRole('button', { name: /Fri.*2026/ }));
    const dialog = await screen.findByRole('dialog', { name: /choose a report day/i });
    expect(within(dialog).getByText(/September 2026/)).toBeInTheDocument();
    // The 19th is stored and choosable; the 20th (a Sunday nobody generated) is not.
    const cell = (day: string) => within(dialog).getAllByRole('button').find((b) => b.textContent === day) as HTMLElement;
    expect(cell('19')).toBeEnabled();
    expect(cell('19')).toHaveAccessibleName(/Sat/);
    expect(cell('20')).toBeDisabled();
  });

  it('reads the Circuits tab hour by hour for a day, circuit by circuit, instead of one bar per circuit', async () => {
    render(<ReportsPage />);
    await chooseDaily();
    fireEvent.click(await screen.findByRole('tab', { name: /circuits/i }));
    const figure = await figureOf(/energy per hour, by circuit/i);
    expect(within(figure).getByText('00')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /explore the values in energy per day, by circuit/i })).not.toBeInTheDocument();
    fireEvent.click(within(figure).getByText(/show each hour/i));
    expect(within(figure).getAllByText('0.50').length).toBeGreaterThan(0);
  });
});
