import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { BaselineReport } from './BaselineReport';
import type { PeriodBuildingReport, PeriodDeviceReport, ReportPeriod } from '@/lib/supabaseReports';
import type { PricingData, Section } from './useReportData';

/**
 * RM-153 — the Baseline tab, at each resolution and in both views, against the site's committed
 * baseline: the figures the operator was given (E-232) are the figures on screen.
 */

afterEach(cleanup);

const minutes = (days: number) => days * 24 * 60;
const building = (o: Partial<PeriodBuildingReport> = {}): PeriodBuildingReport => ({
  period: 'month',
  period_start: '2026-10-01',
  energy_kwh: 300,
  peak_total_power_w: 2800,
  avg_voltage: 220,
  phase_current_red_avg: 2,
  phase_current_yellow_avg: 2,
  phase_current_blue_avg: null,
  command_count: 0,
  command_count_manual: 0,
  command_count_schedule: 0,
  command_count_autoshed: 0,
  anomaly_count: 0,
  online_sample_count: minutes(31),
  expected_sample_count: minutes(31),
  generated_at: '2026-11-02T00:00:00Z',
  ...o,
});
const meter = (device_id: string, energy_kwh: number): PeriodDeviceReport => ({
  period: 'month',
  period_start: '2026-10-01',
  device_id,
  energy_kwh,
  peak_power_w: 1000,
  avg_power_w: 100,
  online_sample_count: minutes(31),
  expected_sample_count: minutes(31),
});
const ROWS = [meter('mtr_lo_red', 10), meter('mtr_lo_yellow', 10), meter('mtr_arec_acu', 120), meter('mtr_co_yellow', 160)];
const pricing: Section<PricingData> = { status: 'ready', data: { tariffs: [], factors: [] }, error: null, retry: () => {} };

const show = (period: ReportPeriod, start: string, o: Partial<Parameters<typeof BaselineReport>[0]> = {}) =>
  render(<BaselineReport period={period} start={start} building={building({ period, period_start: start })} rows={ROWS} pricing={pricing} {...o} />);
const tile = (term: string) => screen.getAllByRole('term').find((t) => t.textContent === term)?.nextElementSibling?.textContent ?? '';

describe('Monthly', () => {
  it('shows the expected month, demand, standby and peak operating draw', () => {
    show('month', '2026-09-01');
    expect(tile('Expected energy')).toMatch(/^328 kWh/);
    expect(tile('Expected energy')).toMatch(/September 2026 as a full working month: 329 kWh/);
    expect(tile('Peak operating draw')).toMatch(/^2\.89 kW/);
    expect(tile('Base standby load')).toMatch(/^96 W/);
    expect(screen.getByRole('table', { name: /the baseline by use/i })).toBeInTheDocument();
    // No rate entered: said as such, never a zero.
    expect(screen.getByText(/no rate has been entered/i)).toBeInTheDocument();
  });

  it('switches to the recorded days, and says what the baseline did with each', () => {
    show('month', '2026-09-01');
    fireEvent.click(screen.getByRole('button', { name: /^recorded aug–sep$/i }));
    expect(screen.getByText(/19 of 46 recorded days went into the baseline/)).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /recorded days behind the baseline/i });
    expect(within(table).getByText(/Left out: National Heroes Day/)).toBeInTheDocument();
    expect(within(table).getAllByText(/Used: Working day/)).toHaveLength(11);
  });
});

describe('Daily', () => {
  it('draws a working day hour by hour with the working hours shaded, and switches day', () => {
    show('day', '2026-10-07');
    expect(tile('Expected energy')).toMatch(/^13\.83 kWh/);
    expect(screen.getByRole('img', { name: /working day, hour by hour/i })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Working hours 08:00–17:00 are shaded/);
    fireEvent.click(screen.getByRole('button', { name: /^saturday$/i }));
    expect(tile('Expected energy')).toMatch(/^4\.65 kWh/);
    // A weekday keeps its capital; a kind of day does not.
    expect(tile('Expected energy')).toMatch(/A Saturday,/);
    expect(screen.getByText(/11 working days, 4 Saturdays, 4 Sundays\./)).toBeInTheDocument();
  });

  it('shows each recorded weekday as it was, so the lighter Friday is visible', () => {
    show('day', '2026-10-07');
    fireEvent.click(screen.getByRole('button', { name: /^recorded aug–sep$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^friday$/i }));
    expect(tile('Recorded energy')).toMatch(/^7\.14 kWh/);
    expect(tile('Recorded energy')).toMatch(/recorded days \(Friday\)/);
    // A recorded average is not an expectation, and the tiles say which they are.
    expect(screen.queryByRole('term', { name: /^Expected/ })).toBeNull();
    expect(tile('Working-hours demand')).toMatch(/kW/);
  });
});

describe('Weekly', () => {
  it('shows the typical week and its seven days', () => {
    show('week', '2026-10-05');
    expect(tile('Expected energy')).toMatch(/^75\.4 kWh/);
    expect(screen.getByRole('img', { name: /a typical week, day by day/i })).toBeInTheDocument();
  });
});

describe('against the baseline', () => {
  it('refuses a period under 95% recorded, and says how much it was', () => {
    show('month', '2026-10-01', { building: building({ online_sample_count: Math.round(minutes(31) * 0.48) }) });
    expect(screen.getByText('Not compared')).toBeInTheDocument();
    expect(screen.getByText(/This month was 48% recorded/)).toBeInTheDocument();
    expect(screen.queryByRole('term', { name: 'Energy avoided' })).toBeNull();
  });

  it('sets a fully recorded month against its own calendar, with its holidays as closed days', () => {
    show('month', '2026-08-01', { building: building({ period_start: '2026-08-01', energy_kwh: 250 }) });
    expect(tile('Energy avoided')).toMatch(/kWh/);
    expect(tile('Energy avoided')).toMatch(/This month used [\d.]+ kWh \([\d.]+%\) less than the baseline expects\./);
    expect(screen.getByText(/Counted as closed days: 21 Aug, Ninoy Aquino Day; 31 Aug, National Heroes Day\./)).toBeInTheDocument();
    // August 25–31 is the baseline's own window, and the page says what that means.
    expect(screen.getByText(/a small difference here is expected/)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /by use, against the baseline/i })).toBeInTheDocument();
  });

  it('says so in words when a period used more', () => {
    show('month', '2026-10-01', { building: building({ energy_kwh: 400 }) });
    expect(tile('Energy avoided')).toMatch(/^None/);
    expect(tile('Energy avoided')).toMatch(/more than the baseline expects/);
  });
});

describe('what it rests on', () => {
  it('fetches nothing: the baseline is a committed file and the period rows are the page’s', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    show('month', '2026-09-01');
    fireEvent.click(screen.getByRole('button', { name: /^recorded aug–sep$/i }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('states its assumptions every time, not behind a hint', () => {
    show('week', '2026-10-05');
    const caveats = screen.getByRole('region', { name: /what this baseline assumes/i });
    expect(within(caveats).getByText('Friday is modelled as a working day.')).toBeInTheDocument();
    expect(within(caveats).getByText('Not adjusted for weather.')).toBeInTheDocument();
    expect(within(caveats).getByText("Others includes the Director's office aircon.")).toBeInTheDocument();
  });

  it('says there is no baseline yet, rather than drawing an empty one', () => {
    show('month', '2026-09-01', { baseline: null });
    expect(screen.getByText('No baseline yet')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('the charts describe what they draw', () => {
  it('calls a modelled day a day of hours by use, never recorded days of circuits', () => {
    show('day', '2026-10-07');
    const chart = screen.getByRole('img', { name: /working day, hour by hour/i });
    expect(document.body.textContent).toMatch(/A working day as the baseline expects it: each hour's energy, stacked by use\./);
    expect(chart.textContent ?? '').not.toMatch(/days were recorded|circuits/);
  });
});
