import { describe, expect, it } from 'vitest';
import { estimatedTotal, estimateSentence, periodEndDay, withEstimatedDays, withEstimatedPeriod, type EnergyEstimate } from './energyEstimates';
import type { DeviceDayRow } from './circuitSeries';
import type { PeriodDeviceReport } from './supabaseReports';

/** RM-165 (E-260): CARE ACU's 32.495 kWh held from 14 to 28 October, as the edge spread it. */

const est = (day: string, kwh: number, device_id = 'mtr_arec_acu'): EnergyEstimate => ({ device_id, local_day: day, kwh, held_from: '2026-10-14T05:22:01Z', held_to: '2026-10-28T03:41:04Z' });
const day = (device_id: string, local_day: string, energy_kwh: number | null): DeviceDayRow => ({
  device_id, local_day, energy_kwh, counter_kwh: null, removed_kwh: null, clipped_hours: 0, peak_power_w: null, avg_power_w: null, online_minutes: 1440, expected_minutes: 1440, resolution: null,
});
const device = (device_id: string, energy_kwh: number | null): PeriodDeviceReport => ({
  period: 'month', period_start: '2026-10-01', device_id, energy_kwh, peak_power_w: null, avg_power_w: null, online_sample_count: 0, expected_sample_count: 0,
});

describe('periodEndDay', () => {
  it('is the first day after the period', () => {
    expect(periodEndDay('day', '2026-10-31')).toBe('2026-11-01');
    expect(periodEndDay('week', '2026-10-26')).toBe('2026-11-02');
    expect(periodEndDay('month', '2026-10-01')).toBe('2026-11-01');
  });
});

describe('withEstimatedDays and withEstimatedPeriod', () => {
  it("adds a day's estimate to that circuit's day, and keeps it apart", () => {
    const rows = withEstimatedDays([day('mtr_arec_acu', '2026-10-20', 0), day('mtr_lo_red', '2026-10-20', 0.3)], [est('2026-10-20', 3.494)]);
    expect(rows.find((r) => r.device_id === 'mtr_arec_acu')).toMatchObject({ energy_kwh: 3.494, estimated_kwh: 3.494 });
    expect(rows.find((r) => r.device_id === 'mtr_lo_red')?.estimated_kwh).toBeUndefined();
  });

  it('gives a held day with no row one of its own, rather than dropping its estimate', () => {
    const rows = withEstimatedDays([], [est('2026-10-20', 3.494)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ device_id: 'mtr_arec_acu', local_day: '2026-10-20', energy_kwh: 3.494, online_minutes: 0 });
  });

  it("adds a device's estimates to its period figure", () => {
    const rows = withEstimatedPeriod([device('mtr_arec_acu', 40.1), device('mtr_lo_red', 2)], [est('2026-10-20', 3.494), est('2026-10-21', 3.494)]);
    expect(rows[0]).toMatchObject({ energy_kwh: 47.088, estimated_kwh: 6.988 });
    expect(rows[1]).toEqual(device('mtr_lo_red', 2));
  });

  it('changes nothing when there are no estimates', () => {
    const rows = [device('mtr_arec_acu', 40.1)];
    expect(withEstimatedPeriod(rows, [])).toEqual(rows);
  });
});

describe('estimatedTotal and estimateSentence', () => {
  it('says how much is estimated, on which meters, and why', () => {
    const total = estimatedTotal([{ device_id: 'mtr_arec_acu', estimated_kwh: 32.495 }, { device_id: 'mtr_lo_red', estimated_kwh: 1.417 }, { device_id: 'co1' }]);
    expect(total).toEqual({ kwh: 33.912, deviceIds: ['mtr_arec_acu', 'mtr_lo_red'] });
    const names: Record<string, string> = { mtr_arec_acu: 'CARE ACU', mtr_lo_red: 'L.O Red' };
    const s = estimateSentence(total, (id) => names[id]);
    expect(s).toMatch(/^33\.91 kWh of this is estimated: CARE ACU and L\.O Red held their last reading while the site had no internet/);
    expect(estimateSentence({ kwh: 0, deviceIds: [] }, String)).toBeNull();
  });
});

describe('estimatesOrNone', () => {
  it('reads as none when the read fails, so the report stands without them', async () => {
    const { estimatesOrNone } = await import('./energyEstimates');
    await expect(estimatesOrNone('month', '2026-10-01')).resolves.toEqual([]);
  });
});
