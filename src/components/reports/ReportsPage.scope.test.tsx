import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { ReportsPage } from './ReportsPage';
import * as reports from '@/lib/supabaseReports';
import * as csv from '@/lib/csv';
import { BUILDING_METER_IDS, DEVICE_REGISTRY } from '@shared/registry.mjs';
import { CIRCUITS } from '@shared/siteConfig.mjs';

/**
 * RM-082c — one branch circuit at a time.
 *
 * The scope narrows what is stored per device: the device table, the Circuits tab and the per-device
 * CSV. It cannot narrow the headline figures, the findings or the charts, because per-device series
 * are not stored — so the page says so, rather than leaving a reader to believe a building-wide chart
 * is about the one branch they chose. And a branch's share stays a share of the WHOLE building: narrowed
 * to one branch, a share of what is left on screen would read 100%.
 *
 * Every device and branch here comes from the circuit tree, never from a literal id.
 */

vi.mock('@/config/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/csv')>();
  return { ...actual, downloadCsv: vi.fn() };
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
  };
});
vi.mock('@/lib/supabaseConfig', () => ({ fetchScheduleContext: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabaseTariffs', () => ({
  getTariffs: vi.fn().mockResolvedValue([]),
  getEmissionFactors: vi.fn().mockResolvedValue([]),
}));

type Circuit = { id: string; name: string; meter_device_id: string | null };
type Device = { id: string; branch_circuit?: string | null };

const circuits = CIRCUITS as readonly Circuit[];
const registry = DEVICE_REGISTRY as readonly Device[];
const meters = BUILDING_METER_IDS as readonly string[];
const circuitOf = (meterId: string) => circuits.find((c) => c.meter_device_id === meterId) as Circuit;
/** This building is one level deep, so a branch holds its meter and the devices naming it. */
const onBranch = (c: Circuit) => registry.filter((d) => d.id === c.meter_device_id || d.branch_circuit === c.name);

const FULL = 31 * 24 * 60;
/** The first branch measured 30 kWh and every other 10, so the building total is known exactly. */
const kwhOf = (id: string) => (id === meters[0] ? 30 : meters.includes(id) ? 10 : 1);
const TOTAL = meters.reduce((a, id) => a + kwhOf(id), 0);
const CHOSEN = circuitOf(meters[1]);
const SHARE = `${((10 / TOTAL) * 100).toFixed(1)}%`;

const buildingRow = (): reports.PeriodBuildingReport => ({
  period: 'month',
  period_start: '2026-07-01',
  energy_kwh: TOTAL,
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
});

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // A remembered export choice is a convenience; nothing here depends on clearing it.
  }
  vi.mocked(csv.downloadCsv).mockClear();
  vi.mocked(reports.getReportPeriods).mockResolvedValue([buildingRow()]);
  vi.mocked(reports.getDevicePeriodReports).mockResolvedValue(
    registry.map((d) => ({
      period: 'month',
      period_start: '2026-07-01',
      device_id: d.id,
      energy_kwh: kwhOf(d.id),
      peak_power_w: 800,
      avg_power_w: 200,
      online_sample_count: FULL,
      expected_sample_count: FULL,
    }))
  );
});
afterEach(cleanup);

const scopeSelect = () => screen.findByRole('combobox', { name: /^circuit$/i });
const deviceTable = () => screen.findByRole('table', { name: /per-device report/i });

describe('the circuit scope', () => {
  it('offers every branch of the building, named from the circuit tree, and starts on all of them', async () => {
    render(<ReportsPage />);
    const select = await scopeSelect();
    expect(select).toHaveValue('');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All circuits', ...meters.map((m) => circuitOf(m).name)]);
    // Nothing is narrowed, so there is nothing to explain.
    expect(screen.queryByText(/still describe the whole building/i)).toBeNull();
  });

  it('narrows the per-device table to one branch, and says what it cannot narrow', async () => {
    render(<ReportsPage />);
    const before = within(await deviceTable()).getAllByRole('row').length;

    fireEvent.change(await scopeSelect(), { target: { value: CHOSEN.id } });

    await waitFor(async () => {
      const after = within(await deviceTable()).getAllByRole('row').length;
      expect(before - after).toBe(registry.length - onBranch(CHOSEN).length);
    });
    expect(screen.getByText(new RegExp(`${onBranch(CHOSEN).length} of ${registry.length} devices`))).toBeInTheDocument();
    expect(screen.getByText(/still describe the whole building/i)).toBeInTheDocument();
  });

  it('keeps a branch share of the whole building when the Circuits tab is narrowed to it', async () => {
    render(<ReportsPage />);
    fireEvent.change(await scopeSelect(), { target: { value: CHOSEN.id } });
    fireEvent.click(await screen.findByRole('tab', { name: /circuits/i }));

    const branches = await screen.findByRole('table', { name: /branch circuits/i });
    expect(within(branches).getByText(SHARE)).toBeInTheDocument();
    expect(within(branches).queryByText('100.0%')).toBeNull();
    // Still the rule the tab exists for, in its narrowed form.
    expect(screen.getByText(/adding the two tables together would count the same energy twice/i)).toBeInTheDocument();
  });

  it('exports only that branch in the per-device CSV, named for it, with shares of the whole building', async () => {
    render(<ReportsPage />);
    fireEvent.change(await scopeSelect(), { target: { value: CHOSEN.id } });
    await deviceTable();

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /per-device csv/i }));
    expect(within(dialog).getByText(/each share is still of the whole building/i)).toBeInTheDocument();

    const download = within(dialog).getByRole('button', { name: /download csv/i });
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);
    await waitFor(() => expect(csv.downloadCsv).toHaveBeenCalledTimes(1));

    const [name, body] = vi.mocked(csv.downloadCsv).mock.calls[0];
    expect(name).toMatch(/^ibems-month-report-2026-07-[a-z0-9-]+\.csv$/);
    const lines = String(body).split('\r\n').filter(Boolean);
    expect(lines.length - 1).toBe(onBranch(CHOSEN).length);
    expect(String(body)).toContain(SHARE.replace('%', ''));
  });

  it('keeps the PDF about the whole building, and says so', async () => {
    render(<ReportsPage />);
    fireEvent.change(await scopeSelect(), { target: { value: CHOSEN.id } });
    await deviceTable();
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
    const dialog = await screen.findByRole('dialog');
    // The PDF waits for the charts' series; until then the drawer offers another format instead.
    const pdf = within(dialog).getByRole('radio', { name: /pdf document/i });
    await waitFor(() => expect(pdf).toBeEnabled());
    fireEvent.click(pdf);
    await waitFor(() => expect(pdf).toBeChecked());
    expect(within(dialog).getByText(/applies to the per-device CSV only/i)).toBeInTheDocument();
  });
});
