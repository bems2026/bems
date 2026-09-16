import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * RM-094 — per-circuit series for a settled week or month.
 *
 * Two reads: each device's energy per local day, from phase42's `report_device_daily_energy`, and each
 * branch meter's power hour by hour, from `readings_archive`. The first does not exist until the
 * operator applies phase42, and that must read as "not available on this database yet" — a state the
 * page explains — never as an error that is retried, and never as a period with no energy.
 */

const rpc = vi.fn();
vi.mock('@/config/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      const result = rpc(fn, args);
      const promise = Promise.resolve(result) as Promise<unknown> & { abortSignal: (s: AbortSignal) => unknown };
      promise.abortSignal = () => promise;
      return promise;
    },
  },
}));

const { densifyHours, getCircuitTrend, getDeviceDailyEnergy, isMissingFunction } = await import('./circuitSeries');

beforeEach(() => rpc.mockReset());

const dayRow = (o: Record<string, unknown> = {}) => ({
  device_id: 'dev_a',
  local_day: '2026-09-08',
  energy_kwh: 0.713,
  counter_kwh: 77.502,
  removed_kwh: 76.789,
  clipped_hours: 1,
  peak_power_w: 251.2,
  avg_power_w: 29.5,
  online_minutes: 1434,
  expected_minutes: 1440,
  resolution: 'minute',
  ...o,
});

describe('isMissingFunction', () => {
  it('recognises the API’s and the database’s ways of saying a function does not exist', () => {
    expect(isMissingFunction({ code: 'PGRST202' })).toBe(true);
    expect(isMissingFunction({ code: '42883' })).toBe(true);
  });

  it('does not mistake a refusal or a timeout for a missing function', () => {
    expect(isMissingFunction({ code: '42501' })).toBe(false);
    expect(isMissingFunction({ code: '57014' })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});

describe('getDeviceDailyEnergy', () => {
  it('asks for the period in the building’s zone, for the devices given, and returns the rows', async () => {
    rpc.mockReturnValue({ data: [dayRow()], error: null });
    const result = await getDeviceDailyEnergy('week', '2026-09-07', ['dev_a', 'dev_b']);
    expect(rpc).toHaveBeenCalledWith('report_device_daily_energy', {
      p_period: 'week',
      p_start: '2026-09-07',
      p_tz: expect.any(String),
      p_device_ids: ['dev_a', 'dev_b'],
    });
    expect(result).toEqual({ available: true, rows: [dayRow()] });
  });

  it('says the function is not there yet rather than throwing, before phase42 is applied', async () => {
    rpc.mockReturnValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(getDeviceDailyEnergy('week', '2026-09-07', ['dev_a'])).resolves.toEqual({ available: false });
  });

  it('throws any other failure, in words', async () => {
    rpc.mockReturnValue({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    await expect(getDeviceDailyEnergy('week', '2026-09-07', ['dev_a'])).rejects.toThrow(/statement timeout/);
  });

  it('refuses an answer at the API’s row cap, which would be a cut series drawn as a whole one', async () => {
    rpc.mockReturnValue({ data: Array.from({ length: 1000 }, () => dayRow()), error: null });
    await expect(getDeviceDailyEnergy('month', '2026-09-01', ['dev_a'])).rejects.toThrow(/cap/);
  });

  it('asks for nothing when there is nothing to ask about', async () => {
    await expect(getDeviceDailyEnergy('week', '2026-09-07', [])).resolves.toEqual({ available: true, rows: [] });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('densifyHours', () => {
  const start = '2026-09-06T16:00:00Z';

  it('gives every hour of the window a slot, and an hour nothing was recorded in is empty — never 0 W', () => {
    const slots = densifyHours(
      [
        { ts: '2026-09-06T16:00:00+00:00', power_w: 40, power_w_max: 49, voltage: 230, current: 0.2, energy_kwh_max: 0.04, sample_count: 60, online_count: 60 },
        { ts: '2026-09-06T18:00:00+00:00', power_w: 45, power_w_max: 50, voltage: 230, current: 0.2, energy_kwh_max: 0.12, sample_count: 60, online_count: 58 },
      ],
      start,
      '2026-09-06T20:00:00Z'
    );
    expect(slots.map((s) => s.avgW)).toEqual([40, null, 45, null]);
    expect(slots.map((s) => s.maxW)).toEqual([49, null, 50, null]);
    expect(slots[2]).toMatchObject({ online: 58, samples: 60 });
    expect(slots[1]).toMatchObject({ online: 0, samples: 0 });
    expect(slots.map((s) => s.startMs)).toEqual([0, 1, 2, 3].map((h) => Date.parse(start) + h * 3_600_000));
  });

  it('keeps an hour that had rows but no online reading empty', () => {
    const [slot] = densifyHours(
      [{ ts: '2026-09-06T16:00:00+00:00', power_w: null, power_w_max: null, voltage: null, current: null, energy_kwh_max: null, sample_count: 60, online_count: 0 }],
      start,
      '2026-09-06T17:00:00Z'
    );
    expect(slot).toMatchObject({ avgW: null, maxW: null, online: 0, samples: 60 });
  });

  it('ignores a row outside the window rather than folding it into an edge', () => {
    const slots = densifyHours(
      [{ ts: '2026-09-06T20:00:00+00:00', power_w: 99, power_w_max: 99, voltage: 230, current: 1, energy_kwh_max: 1, sample_count: 60, online_count: 60 }],
      start,
      '2026-09-06T20:00:00Z'
    );
    expect(slots.every((s) => s.avgW === null)).toBe(true);
  });
});

describe('getCircuitTrend', () => {
  it('reads the window from the database, then each meter’s hours inside it', async () => {
    rpc.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === 'report_window') {
        return { data: [{ local_start: '2026-09-07', win_start: '2026-09-06T16:00:00+00:00', win_end: '2026-09-13T16:00:00+00:00', expected_minutes: 10080 }], error: null };
      }
      return {
        data: [{ ts: '2026-09-06T16:00:00+00:00', power_w: args?.p_device_id === 'm1' ? 10 : 20, power_w_max: 30, voltage: 230, current: 0.1, energy_kwh_max: 0.01, sample_count: 60, online_count: 60 }],
        error: null,
      };
    });
    const trend = await getCircuitTrend('week', '2026-09-07', ['m1', 'm2']);
    expect(rpc).toHaveBeenCalledWith('readings_archive', {
      p_device_id: 'm1',
      p_since: '2026-09-06T16:00:00+00:00',
      p_until: '2026-09-13T16:00:00+00:00',
      p_bucket_seconds: 3600,
    });
    expect(trend.startMs).toBe(Date.parse('2026-09-06T16:00:00Z'));
    expect(trend.series.map((s) => s.meterId)).toEqual(['m1', 'm2']);
    expect(trend.series[0].slots).toHaveLength(168);
    expect(trend.series.map((s) => s.slots[0].avgW)).toEqual([10, 20]);
  });
});
