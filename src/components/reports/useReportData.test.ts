import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { useReportData, ceilingWatts, type ReportDataOptions } from './useReportData';
import * as reports from '@/lib/supabaseReports';
import * as series from '@/lib/reportSeries';
import * as tariffs from '@/lib/supabaseTariffs';
import * as config from '@/lib/supabaseConfig';

/**
 * RM-081. The Reports page fetched everything in one `Promise.all` and kept one error string that
 * nothing ever cleared. So a failed tariff read hid five charts that had loaded, a hung heatmap
 * query left the page empty with nothing saying so, and one bad month followed the reader to every
 * other month until a reload. Each of those is a test here.
 *
 * ONLY THE I/O IS FAKED — the rule `ReportsPage.tabs.test.tsx` states, for the reason it states.
 */

vi.mock('@/config/supabase', () => ({ supabase: {} }));
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
vi.mock('@/lib/supabaseTariffs', () => ({ getTariffs: vi.fn(), getEmissionFactors: vi.fn() }));
vi.mock('@/lib/supabaseConfig', () => ({ fetchScheduleContext: vi.fn() }));

const month = (start: string): reports.PeriodBuildingReport => ({
  period: 'month',
  period_start: start,
  energy_kwh: 90.95,
  peak_total_power_w: 4551,
  avg_voltage: 228,
  phase_current_red_avg: 2,
  phase_current_yellow_avg: 2,
  phase_current_blue_avg: null,
  command_count: 0,
  command_count_manual: 0,
  command_count_schedule: 0,
  command_count_autoshed: 0,
  anomaly_count: 0,
  online_sample_count: 44640,
  expected_sample_count: 44640,
  generated_at: '2026-09-03T00:00:00Z',
});

const day: series.DailyRow = {
  local_day: '2026-08-17',
  energy_kwh: 14.68,
  peak_power_w: 1768,
  avg_power_w: 300,
  sample_count: 1440,
  usable_sample_count: 1440,
  expected_samples: 1440,
  first_seen_minute: 0,
  last_seen_minute: 1439,
  resolution: 'minute',
};

/** Retries without real waiting, so a transient failure costs a test nothing. */
const FAST: ReportDataOptions = { retry: { sleep: () => Promise.resolve() } };
const signalled = expect.objectContaining({ signal: expect.any(AbortSignal) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(reports.getReportPeriods).mockResolvedValue([month('2026-08-01'), month('2026-07-01')]);
  vi.mocked(reports.getDevicePeriodReports).mockResolvedValue([]);
  vi.mocked(series.getDailySeries).mockResolvedValue([day]);
  vi.mocked(series.getDemandSummary).mockResolvedValue(null);
  vi.mocked(series.getHourProfile).mockResolvedValue([]);
  vi.mocked(series.getHourMatrix).mockResolvedValue([]);
  vi.mocked(series.getDemandCurve).mockResolvedValue([]);
  vi.mocked(tariffs.getTariffs).mockResolvedValue([]);
  vi.mocked(tariffs.getEmissionFactors).mockResolvedValue([]);
  // A string, as the context map holds it — `dsmRowToContext` renders every value to text.
  vi.mocked(config.fetchScheduleContext).mockResolvedValue({ 'global.dsm.max_total_kw': '2.21' });
});

afterEach(cleanup);

const allReady = (r: ReturnType<typeof useReportData>) =>
  [r.periods, r.devices, r.core, r.detail, r.pricing, r.ceiling].every((s) => s.status === 'ready');

describe('useReportData', () => {
  it('reads the newest period, and every section of it, handing each request a signal it can be cancelled with', async () => {
    const { result } = renderHook(() => useReportData('month', FAST));
    await waitFor(() => expect(allReady(result.current)).toBe(true));

    expect(result.current.selected).toBe('2026-08-01');
    expect(result.current.core.data?.daily).toEqual([day]);
    expect(result.current.ceiling.data).toBeCloseTo(2210, 6);
    expect(reports.getDevicePeriodReports).toHaveBeenCalledWith('month', '2026-08-01', signalled);
    expect(series.getDailySeries).toHaveBeenCalledWith('month', '2026-08-01', signalled);
    expect(series.getHourMatrix).toHaveBeenCalledWith('month', '2026-08-01', signalled);
    expect(tariffs.getTariffs).toHaveBeenCalledWith(signalled);
  });

  it('confines a tariff failure to the cost, and leaves the charts that loaded', async () => {
    // The defect this exists for: an all-or-nothing load hid five charts behind one failed read
    // of a table that only prices them.
    vi.mocked(tariffs.getTariffs).mockRejectedValue(new Error('permission denied for table energy_tariffs'));
    const { result } = renderHook(() => useReportData('month', FAST));

    await waitFor(() => expect(result.current.pricing.status).toBe('error'));
    expect(result.current.pricing.error).toMatch(/permission denied/);
    await waitFor(() => expect(result.current.detail.status).toBe('ready'));
    expect(result.current.core.status).toBe('ready');
  });

  it('confines a heatmap failure to the detail charts, and keeps the headline figures', async () => {
    vi.mocked(series.getHourMatrix).mockRejectedValue(new Error('report_hour_matrix failed: statement timeout'));
    const { result } = renderHook(() => useReportData('month', FAST));

    await waitFor(() => expect(result.current.detail.status).toBe('error'));
    expect(result.current.core.status).toBe('ready');
    expect(result.current.devices.status).toBe('ready');
  });

  it('asks again when Retry is pressed, and recovers', async () => {
    vi.mocked(series.getHourMatrix).mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
    const { result } = renderHook(() => useReportData('month', FAST));
    await waitFor(() => expect(result.current.detail.status).toBe('error'));

    act(() => result.current.detail.retry());
    // Loading at once, not the old error sitting there until the answer arrives.
    expect(result.current.detail.status).toBe('loading');
    await waitFor(() => expect(result.current.detail.status).toBe('ready'));
    expect(series.getHourMatrix).toHaveBeenCalledTimes(2);
  });

  it('turns a request that never answers into a timeout, rather than a page that loads forever', async () => {
    vi.mocked(series.getHourMatrix).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useReportData('month', { timeouts: { detail: 30 }, retry: { retries: 0 } }));

    await waitFor(() => expect(result.current.detail.status).toBe('error'));
    expect(result.current.detail.error).toMatch(/did not answer/);
    expect(result.current.core.status).toBe('ready');
  });

  it('retries a network failure by itself, without anybody pressing anything', async () => {
    // The kiosk is on a wall with nobody at it. A dropped packet should not need a person.
    vi.mocked(series.getDailySeries).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue([day]);
    const { result } = renderHook(() => useReportData('month', FAST));

    await waitFor(() => expect(result.current.core.status).toBe('ready'));
    expect(series.getDailySeries).toHaveBeenCalledTimes(2);
  });

  it('does not carry one period’s failure to the next period the reader opens', async () => {
    vi.mocked(series.getDailySeries).mockImplementation(async (_period, start) => {
      if (start === '2026-08-01') throw new Error('August could not be read');
      return [];
    });
    const { result } = renderHook(() => useReportData('month', FAST));
    await waitFor(() => expect(result.current.core.status).toBe('error'));

    act(() => result.current.select('2026-07-01'));
    await waitFor(() => expect(result.current.core.status).toBe('ready'));
    expect(result.current.core.error).toBeNull();
  });

  it('never exposes a month’s figures while the list of weeks is still loading', async () => {
    // RM-041's trap, at the data layer: the page now says "weekly" and the only rows in hand are
    // a month's, which share a first day with a week.
    const { result, rerender } = renderHook(({ period }) => useReportData(period, FAST), {
      initialProps: { period: 'month' as reports.ReportPeriod },
    });
    await waitFor(() => expect(result.current.devices.status).toBe('ready'));

    vi.mocked(reports.getReportPeriods).mockReturnValue(new Promise(() => {}));
    rerender({ period: 'week' });

    expect(result.current.periods.status).toBe('loading');
    expect(result.current.selected).toBeNull();
    expect(result.current.devices.data).toBeNull();
    expect(result.current.core.data).toBeNull();
  });

  it('answers a period it has already read from memory, instead of asking again', async () => {
    const { result } = renderHook(() => useReportData('month', FAST));
    await waitFor(() => expect(result.current.core.status).toBe('ready'));

    act(() => result.current.select('2026-07-01'));
    await waitFor(() => expect(result.current.core.status).toBe('ready'));
    act(() => result.current.select('2026-08-01'));

    // Ready in the same render, with no loading state in between.
    expect(result.current.core.status).toBe('ready');
    expect(vi.mocked(series.getDailySeries).mock.calls.filter(([, start]) => start === '2026-08-01')).toHaveLength(1);
  });

  it('has nothing to load when no period has completed, and says idle rather than loading', async () => {
    vi.mocked(reports.getReportPeriods).mockResolvedValue([]);
    const { result } = renderHook(() => useReportData('month', FAST));

    await waitFor(() => expect(result.current.periods.status).toBe('ready'));
    expect(result.current.selected).toBeNull();
    expect(result.current.devices.status).toBe('idle');
    expect(result.current.core.status).toBe('idle');
  });

  it('falls back to the newest period when the one asked for is not a report that exists', async () => {
    const { result } = renderHook(() => useReportData('month', FAST));
    await waitFor(() => expect(result.current.periods.status).toBe('ready'));

    act(() => result.current.select('1999-01-01'));
    expect(result.current.selected).toBe('2026-08-01');
  });
});

describe('ceilingWatts', () => {
  it('reads the demand ceiling the Automation page writes, in watts', () => {
    expect(ceilingWatts({ 'global.dsm.max_total_kw': 2.5 })).toBe(2500);
    expect(ceilingWatts({ 'global.dsm.max_total_kw': '2.5' })).toBe(2500);
  });

  it.each([[undefined], [null], [0], [-1], ['not a number']])('treats %s as no ceiling set, never as a ceiling of zero', (kw) => {
    expect(ceilingWatts({ 'global.dsm.max_total_kw': kw })).toBeNull();
  });
});
