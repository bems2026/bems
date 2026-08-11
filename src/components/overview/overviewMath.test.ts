import { describe, it, expect } from 'vitest';
import { countOnline, todayVsWeeklyAveragePace, topByPower, meteredVsUntracked } from './overviewMath';
import type { Device, Reading } from '@/lib/types';

const device = (id: string, display_name = id): Device => ({
  id,
  display_name,
  class: 'outlet_dual',
  room: null,
  dps_map: 'type_b',
  status: 'active',
});

const reading = (overrides: Partial<Reading>): Reading => ({
  device_id: 'x',
  ts: new Date().toISOString(),
  online: true,
  state: 'on',
  ...overrides,
});

describe('countOnline', () => {
  it('counts only devices with a reading reporting online: true', () => {
    const devices = [device('a'), device('b'), device('c')];
    const readings = {
      a: reading({ device_id: 'a', online: true }),
      b: reading({ device_id: 'b', online: false }),
      // c has no reading at all
    };
    expect(countOnline(devices, readings)).toEqual({ online: 1, total: 3 });
  });

  it('is {0, 0} with an empty catalogue', () => {
    expect(countOnline([], {})).toEqual({ online: 0, total: 0 });
  });
});

describe('todayVsWeeklyAveragePace', () => {
  it('is null when today is missing', () => {
    expect(todayVsWeeklyAveragePace(null, 70)).toBe(null);
  });

  it('is null when week is missing', () => {
    expect(todayVsWeeklyAveragePace(10, null)).toBe(null);
  });

  it('is null rather than Infinity when the weekly average is zero', () => {
    expect(todayVsWeeklyAveragePace(10, 0)).toBe(null);
  });

  it('is 1 when today exactly matches the weekly daily average', () => {
    expect(todayVsWeeklyAveragePace(10, 70)).toBe(1);
  });

  it('is >1 when today is running ahead of the weekly pace', () => {
    expect(todayVsWeeklyAveragePace(14, 70)).toBe(1.4);
  });
});

describe('topByPower', () => {
  it('omits devices with no power reading rather than showing them as 0 W', () => {
    const devices = [device('a'), device('b')];
    const readings = { a: reading({ device_id: 'a', power_w: 100 }) };
    expect(topByPower(devices, readings, 5)).toEqual([{ id: 'a', label: 'a', power_w: 100 }]);
  });

  it('sorts descending by power', () => {
    const devices = [device('a'), device('b'), device('c')];
    const readings = {
      a: reading({ device_id: 'a', power_w: 50 }),
      b: reading({ device_id: 'b', power_w: 200 }),
      c: reading({ device_id: 'c', power_w: 100 }),
    };
    expect(topByPower(devices, readings, 5).map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });

  it('caps to the given limit', () => {
    const devices = [device('a'), device('b'), device('c')];
    const readings = {
      a: reading({ device_id: 'a', power_w: 50 }),
      b: reading({ device_id: 'b', power_w: 200 }),
      c: reading({ device_id: 'c', power_w: 100 }),
    };
    expect(topByPower(devices, readings, 2)).toHaveLength(2);
  });
});

describe('meteredVsUntracked', () => {
  const outlet = (id: string): Device => ({ id, display_name: id, class: 'outlet_dual', room: null, dps_map: 'type_b', status: 'active' });
  const meter = (id: string): Device => ({ id, display_name: id, class: 'meter', room: null, dps_map: 'type_a', status: 'active' });

  it('is all-null when the panel total has no reading yet', () => {
    const devices = [outlet('co1')];
    const readings = { co1: reading({ device_id: 'co1', power_w: 100 }) };
    expect(meteredVsUntracked(devices, readings, null)).toEqual({ meteredW: 100, totalW: null, untrackedW: null, meteredPct: null });
  });

  it('sums only outlet_dual devices — a branch meter with power_w does not count as "metered"', () => {
    const devices = [outlet('co1'), meter('mtr_lo_red')];
    const readings = {
      co1: reading({ device_id: 'co1', power_w: 100 }),
      mtr_lo_red: reading({ device_id: 'mtr_lo_red', power_w: 500 }),
    };
    expect(meteredVsUntracked(devices, readings, 900).meteredW).toBe(100);
  });

  it('treats a missing outlet reading as 0 toward the metered sum, not as excluded', () => {
    const devices = [outlet('co1'), outlet('co2')];
    const readings = { co1: reading({ device_id: 'co1', power_w: 100 }) }; // co2 has no reading
    expect(meteredVsUntracked(devices, readings, 500).meteredW).toBe(100);
  });

  it('computes untracked as total minus metered, clamped at 0', () => {
    const devices = [outlet('co1')];
    const readings = { co1: reading({ device_id: 'co1', power_w: 300 }) };
    expect(meteredVsUntracked(devices, readings, 1000).untrackedW).toBe(700);
  });

  it('clamps untracked to 0 rather than going negative if metered somehow exceeds total', () => {
    const devices = [outlet('co1')];
    const readings = { co1: reading({ device_id: 'co1', power_w: 1200 }) };
    expect(meteredVsUntracked(devices, readings, 1000).untrackedW).toBe(0);
  });

  it('computes meteredPct as a 0-100 percentage', () => {
    const devices = [outlet('co1')];
    const readings = { co1: reading({ device_id: 'co1', power_w: 250 }) };
    expect(meteredVsUntracked(devices, readings, 1000).meteredPct).toBe(25);
  });

  it('meteredPct is 0, not NaN, when total is 0', () => {
    const devices: Device[] = [];
    expect(meteredVsUntracked(devices, {}, 0).meteredPct).toBe(0);
  });
});
