import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isTransient, ReportQueryError } from './reportLoader';

/**
 * Every Reports loader keeps the database's code when it fails — 2026-09-22.
 *
 * Each of them rethrew `new Error(\`${fn} failed: ${error.message}\`)`, which kept the words and
 * dropped the SQLSTATE, so `isTransient` could not tell a statement timeout (57014, gone on the next
 * attempt) from a refusal (42501, never gone). The Circuits tab showed "canceling statement due to
 * statement timeout" on the first attempt and Retry drew the chart. These assert, loader by loader,
 * that the code survives the wrap and that the message the page shows is unchanged.
 */

const answer = vi.fn();
const request = () => {
  // Resolves to whatever `answer` returns, and chains like a PostgREST builder: `.from().select()
  // .eq().order().limit().abortSignal()` or `.rpc().abortSignal()`.
  const promise = Promise.resolve().then(() => answer()) as Promise<unknown> & Record<string, () => unknown>;
  for (const step of ['select', 'eq', 'order', 'limit', 'abortSignal']) promise[step] = () => promise;
  return promise;
};
vi.mock('@/config/supabase', () => ({ supabase: { rpc: () => request(), from: () => request() } }));

const { getDailySeries } = await import('./reportSeries');
const { getCircuitTrend, getDeviceDailyEnergy, getReportWindow } = await import('./circuitSeries');
const { getReportPeriods, getDevicePeriodReports, getReportMonths, getDeviceReports } = await import('./supabaseReports');

const TIMEOUT = { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null };
beforeEach(() => answer.mockReset());

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('expected the loader to throw');
}

describe('a statement timeout keeps its code through every Reports loader', () => {
  it.each([
    ['getDailySeries', () => getDailySeries('week', '2026-09-14'), 'report_daily_series failed: canceling statement due to statement timeout'],
    ['getDeviceDailyEnergy', () => getDeviceDailyEnergy('week', '2026-09-14', ['mtr_arec_acu']), 'report_device_daily_energy failed: canceling statement due to statement timeout'],
    ['getReportWindow', () => getReportWindow('week', '2026-09-14'), 'report_window failed: canceling statement due to statement timeout'],
    ['getReportPeriods', () => getReportPeriods('week'), 'Could not list reports: canceling statement due to statement timeout'],
    ['getDevicePeriodReports', () => getDevicePeriodReports('week', '2026-09-14'), 'Could not load the week report starting 2026-09-14: canceling statement due to statement timeout'],
    ['getReportMonths', () => getReportMonths(), 'Could not list reports: canceling statement due to statement timeout'],
    ['getDeviceReports', () => getDeviceReports('2026-08-01'), 'Could not load the report for 2026-08-01: canceling statement due to statement timeout'],
  ])('%s', async (_name, run, message) => {
    answer.mockReturnValue({ data: null, error: TIMEOUT, status: 500 });
    const err = await failure(run);
    expect(err).toBeInstanceOf(ReportQueryError);
    expect((err as ReportQueryError).code).toBe('57014');
    expect((err as Error).message).toBe(message);
    expect(isTransient(err)).toBe(true);
  });

  it('getCircuitTrend, where the window answers and a meter times out', async () => {
    answer
      .mockReturnValueOnce({ data: [{ win_start: '2026-09-13T16:00:00+00:00', win_end: '2026-09-20T16:00:00+00:00' }], error: null, status: 200 })
      .mockReturnValue({ data: null, error: TIMEOUT, status: 500 });
    const err = await failure(() => getCircuitTrend('week', '2026-09-14', ['mtr_arec_acu']));
    expect(err).toBeInstanceOf(ReportQueryError);
    expect((err as Error).message).toBe('readings_archive failed for mtr_arec_acu: canceling statement due to statement timeout');
    expect(isTransient(err)).toBe(true);
  });

  it('and a refusal keeps ITS code, so it is still never retried', async () => {
    answer.mockReturnValue({ data: null, error: { code: '42501', message: 'permission denied for function report_daily_series' }, status: 403 });
    const err = await failure(() => getDailySeries('week', '2026-09-14'));
    expect((err as ReportQueryError).code).toBe('42501');
    expect(isTransient(err)).toBe(false);
  });
});
