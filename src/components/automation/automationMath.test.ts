import { describe, it, expect } from 'vitest';
import { parseDays, formatDays, toggleDay, scheduleKey, nextUpSchedules, armedScheduleCount } from './automationMath';
import type { Device } from '@/lib/types';

const device = (id: string, display_name: string, deviceClass: Device['class']): Device => ({
  id,
  display_name,
  class: deviceClass,
  room: null,
  dps_map: null,
  status: 'active',
});

describe('parseDays', () => {
  it('an unset value parses to all-false, not a fabricated default schedule', () => {
    expect(parseDays(undefined)).toEqual([false, false, false, false, false, false, false]);
  });

  it('a malformed value (wrong length) also parses to all-false', () => {
    expect(parseDays('101')).toEqual(Array(7).fill(false));
  });

  it('parses a real 7-char string in Mon..Sun order', () => {
    expect(parseDays('1111100')).toEqual([true, true, true, true, true, false, false]);
  });
});

describe('formatDays', () => {
  it('round-trips through parseDays', () => {
    const days = [true, false, true, false, true, false, true];
    expect(parseDays(formatDays(days))).toEqual(days);
  });
});

describe('toggleDay', () => {
  it('flips exactly the requested day, starting from an unset value', () => {
    expect(toggleDay(undefined, 2)).toBe('0010000');
  });

  it('flips a day back off from an existing value', () => {
    expect(toggleDay('1111100', 0)).toBe('0111100');
  });
});

describe('scheduleKey', () => {
  it('builds the exact global.schedule.<device>.<field> shape shared/context.mjs validates', () => {
    expect(scheduleKey('l1', 'armed')).toBe('global.schedule.l1.armed');
  });
});

describe('nextUpSchedules', () => {
  const devices = [device('l1', 'Light Switch 1', 'switch'), device('l2', 'Light Switch 2', 'switch'), device('co1', 'Outlet 1', 'outlet_dual'), device('mtr_lo_red', 'L.O Red', 'meter')];

  it('returns nothing when no schedule has ever been saved — no fabricated sample rows', () => {
    expect(nextUpSchedules(devices, {})).toEqual([]);
  });

  it('excludes an armed device whose on-time was never saved', () => {
    const saved = { 'global.schedule.l1.armed': 'true' };
    expect(nextUpSchedules(devices, saved)).toEqual([]);
  });

  it('excludes a device with a saved on-time that was never armed', () => {
    const saved = { 'global.schedule.l1.on': '07:30' };
    expect(nextUpSchedules(devices, saved)).toEqual([]);
  });

  it('a meter is never eligible even if someone forced context keys for it', () => {
    const saved = { 'global.schedule.mtr_lo_red.armed': 'true', 'global.schedule.mtr_lo_red.on': '06:00' };
    expect(nextUpSchedules(devices, saved)).toEqual([]);
  });

  it('sorts armed, on-time schedules chronologically by on-time, not registry order', () => {
    const saved = {
      'global.schedule.l2.armed': 'true',
      'global.schedule.l2.on': '18:00',
      'global.schedule.l1.armed': 'true',
      'global.schedule.l1.on': '07:30',
      'global.schedule.co1.armed': 'true',
      'global.schedule.co1.on': '12:00',
    };
    const entries = nextUpSchedules(devices, saved);
    expect(entries.map((e) => e.deviceId)).toEqual(['l1', 'co1', 'l2']);
  });

  it('caps at the given limit', () => {
    const saved: Record<string, string> = {};
    for (const d of devices) {
      saved[`global.schedule.${d.id}.armed`] = 'true';
      saved[`global.schedule.${d.id}.on`] = '08:00';
    }
    expect(nextUpSchedules(devices, saved, 2).length).toBe(2);
  });
});

describe('armedScheduleCount', () => {
  const devices = [device('l1', 'Light Switch 1', 'switch'), device('l2', 'Light Switch 2', 'switch')];

  it('counts every armed schedulable device, not just the ones with a saved on-time', () => {
    expect(armedScheduleCount(devices, { 'global.schedule.l1.armed': 'true', 'global.schedule.l2.armed': 'true' })).toBe(2);
  });

  it('zero when nothing is armed', () => {
    expect(armedScheduleCount(devices, {})).toBe(0);
  });
});
