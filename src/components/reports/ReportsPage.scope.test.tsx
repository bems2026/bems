import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { ReportsPage } from './ReportsPage';
import * as reports from '@/lib/supabaseReports';
import * as csv from '@/lib/csv';
import { BUILDING_METER_IDS, DEVICE_REGISTRY } from '@shared/registry.mjs';
import { CIRCUITS } from '@shared/siteConfig.mjs';
import { LOADS, LOAD_LABELS, loadOf } from '@shared/circuits.mjs';

/**
 * RM-082c — one branch circuit at a time; RM-093 — or one category of load.
 *
 * The scope narrows the Circuits tab — its figures, its charts and its tables — and the per-device CSV.
 * The Overview and Usage patterns are the whole building's series (RM-096), and they say so in one line
 * with the way to the Circuits tab, rather than leaving a reader to believe a building-wide chart is
 * about the part they chose. And a branch's share stays a share of the WHOLE building: narrowed
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

type Circuit = { id: string; name: string; meter_device_id: string | null; parent_id: string | null; load?: string };
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
/** RM-093: the categories the building meters' branches carry, as the tree declares them. */
const loadOfMeter = (meterId: string) => loadOf(circuits as never, circuitOf(meterId).id) as string | null;
const CARRIED = (LOADS as readonly string[]).filter((l) => meters.some((m) => loadOfMeter(m) === l));

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

/** RM-102: the control bar's Circuit button, whose name carries what the report is narrowed to. */
const scopeButton = () => screen.findByRole('button', { name: /^circuit /i });
/** Open the Circuit button and choose one entry — a use pill or a circuit item — by its label. */
const chooseScope = async (label: string) => {
  fireEvent.click(await scopeButton());
  const dialog = await screen.findByRole('dialog', { name: /narrow the report/i });
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
};
const branchTable = () => screen.findByRole('table', { name: /branch circuits/i });
const deviceTable = () => screen.findByRole('table', { name: /devices on these circuits/i });
/** Data rows of a table: every row but its header. */
const dataRows = (table: HTMLElement) => within(table).getAllByRole('row').length - 1;
const openCircuits = async () => fireEvent.click(await screen.findByRole('tab', { name: /^circuits$/i }));
const devicesLoaded = () => waitFor(() => expect(reports.getDevicePeriodReports).toHaveBeenCalled());

describe('the circuit scope', () => {
  it('offers every branch of the building, named from the circuit tree, and starts on all of them', async () => {
    render(<ReportsPage />);
    expect(await scopeButton()).toHaveAccessibleName('Circuit All circuits');
    fireEvent.click(await scopeButton());
    const dialog = await screen.findByRole('dialog', { name: /narrow the report/i });
    expect(within(within(dialog).getByRole('group', { name: /by use/i })).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'All',
      ...CARRIED.map((l) => LOAD_LABELS[l as keyof typeof LOAD_LABELS]),
    ]);
    expect(within(within(dialog).getByRole('group', { name: /one circuit/i })).getAllByRole('button').map((b) => b.textContent)).toEqual(
      meters.map((m) => circuitOf(m).name)
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    // Nothing is narrowed, so there is nothing to explain.
    expect(screen.queryByText(/this tab shows the whole building/i)).toBeNull();
  });

  it('narrows the Circuits tab to one branch, and the Overview says it is still the whole building', async () => {
    render(<ReportsPage />);
    await chooseScope(CHOSEN.name);
    // RM-096: the Overview is the building's series, and says so in one line with the way to the branch.
    expect(await screen.findByText(/this tab shows the whole building/i)).toBeInTheDocument();

    await openCircuits();
    await waitFor(async () => expect(dataRows(await branchTable())).toBe(1));
    // The devices on it, without its own meter — which is in the table above.
    expect(dataRows(await deviceTable())).toBe(onBranch(CHOSEN).length - 1);
    expect(screen.getByRole('heading', { name: CHOSEN.name })).toBeInTheDocument();
  });

  it('narrows to a category of load — every branch that carries it, with the devices on them — RM-093', async () => {
    render(<ReportsPage />);
    await openCircuits();
    await branchTable();
    for (const load of CARRIED) {
      const branches = meters.filter((m) => loadOfMeter(m) === load).map(circuitOf);
      const devicesOn = branches.flatMap(onBranch).length - branches.length;
      const label = LOAD_LABELS[load as keyof typeof LOAD_LABELS];
      // RM-102: the use pills are inside the control bar's Circuit button — the one control for this state.
      await chooseScope(label);
      await waitFor(async () => expect(dataRows(await branchTable())).toBe(branches.length));
      if (devicesOn > 0) expect(dataRows(await deviceTable())).toBe(devicesOn);
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
      expect(await scopeButton()).toHaveAccessibleName(`Circuit ${label}`);
    }
  });

  it('keeps a branch share of the whole building when the Circuits tab is narrowed to it', async () => {
    render(<ReportsPage />);
    await chooseScope(CHOSEN.name);
    await openCircuits();

    const branches = await branchTable();
    expect(within(branches).getByText(SHARE)).toBeInTheDocument();
    expect(within(branches).queryByText('100.0%')).toBeNull();
    // Still the rule the tab exists for, in its narrowed form.
    expect(screen.getByText(/adding the two tables together would count the same energy twice/i)).toBeInTheDocument();
  });

  it('exports only that branch in the per-device CSV, named for it, with shares of the whole building', async () => {
    render(<ReportsPage />);
    await chooseScope(CHOSEN.name);
    await devicesLoaded();

    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /devices, whole period/i }));
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

  it('narrows the PDF’s circuit sections, and says the building’s own charts stay the whole building', async () => {
    render(<ReportsPage />);
    await chooseScope(CHOSEN.name);
    await devicesLoaded();
    fireEvent.click(screen.getByRole('button', { name: /^export$/i }));
    const dialog = await screen.findByRole('dialog');
    // The PDF waits for the charts' series; until then the drawer offers another format instead.
    const pdf = within(dialog).getByRole('radio', { name: /pdf document/i });
    await waitFor(() => expect(pdf).toBeEnabled());
    fireEvent.click(pdf);
    await waitFor(() => expect(pdf).toBeChecked());
    expect(within(dialog).getByText(/circuit sections follow/i)).toBeInTheDocument();
  });
});
