import { describe, it, expect } from 'vitest';
import { parseDays, formatDays, toggleDay, scheduleKey, nextUpSchedules, armedScheduleCount, scheduleProblems, SCHEDULE_PROBLEM_TEXT, brokenScheduleCount } from './automationMath';
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

/**
 * RM-060 — the footguns a schedule row can hold today without saying so.
 *
 * Each of these saves cleanly, reads as configured, and then does nothing at the hour somebody
 * expected it to act. That is worse than a visible error: the schedule looks armed.
 */
describe('scheduleProblems', () => {
  const rule = (over: Partial<Parameters<typeof scheduleProblems>[0]> = {}) => ({
    armed: false, on: undefined, off: undefined, days: undefined, ...over,
  });

  it('finds nothing to say about a row nobody has touched', () => {
    expect(scheduleProblems(rule())).toEqual([]);
  });

  it('flags a schedule armed with no day ticked — it can never fire', () => {
    expect(scheduleProblems(rule({ armed: true, on: '07:00', days: '0000000' })))
      .toContain('armed-without-days');
  });

  it('treats an absent days string the same as an empty one', () => {
    expect(scheduleProblems(rule({ armed: true, on: '07:00' }))).toContain('armed-without-days');
  });

  it('flags a schedule armed with no ON time', () => {
    expect(scheduleProblems(rule({ armed: true, off: '18:00', days: '1111100' })))
      .toContain('armed-without-on-time');
  });

  it('says nothing about an unarmed row that is merely incomplete — that is a draft, not a fault', () => {
    expect(scheduleProblems(rule({ on: '', days: '0000000' }))).toEqual([]);
  });

  it('flags an ON and OFF set to the same minute, which cannot mean anything', () => {
    expect(scheduleProblems(rule({ armed: true, on: '07:00', off: '07:00', days: '1111100' })))
      .toContain('same-on-and-off');
  });

  /**
   * THE CASE THAT MUST STAY SILENT. An OFF earlier in the day than its ON is an overnight
   * schedule — on at 18:00, off at 06:00 — which is exactly how a security light is configured.
   * Warning on it would train the operator to ignore the warnings that matter.
   */
  it('does NOT flag an overnight schedule, where OFF is earlier in the day than ON', () => {
    expect(scheduleProblems(rule({ armed: true, on: '18:00', off: '06:00', days: '1111111' }))).toEqual([]);
  });

  it('does NOT flag an ON with no OFF — switching on and leaving it is a real choice', () => {
    expect(scheduleProblems(rule({ armed: true, on: '07:00', days: '1111100' }))).toEqual([]);
  });

  it('gives every problem it can report a human sentence', () => {
    for (const code of ['armed-without-days', 'armed-without-on-time', 'same-on-and-off'] as const) {
      expect(SCHEDULE_PROBLEM_TEXT[code]).toMatch(/\S/);
    }
  });
});

describe('brokenScheduleCount', () => {
  const d = (id: string) => device(id, id.toUpperCase(), 'switch');

  it('counts nothing for a fleet whose schedules are all sound', () => {
    expect(brokenScheduleCount([d('l1')], {
      'global.schedule.l1.armed': 'true', 'global.schedule.l1.on': '07:00', 'global.schedule.l1.days': '1111100',
    })).toBe(0);
  });

  it('counts a row with two faults once, because it is one schedule to fix', () => {
    // Armed, no days, and ON equal to OFF: two problems, one broken row.
    expect(brokenScheduleCount([d('l1')], {
      'global.schedule.l1.armed': 'true', 'global.schedule.l1.on': '07:00',
      'global.schedule.l1.off': '07:00', 'global.schedule.l1.days': '0000000',
    })).toBe(1);
  });

  it('counts each broken device, which is what "Arm all" can create in one click', () => {
    const ctx: Record<string, string> = {};
    for (const id of ['l1', 'l2', 'l3']) { ctx[`global.schedule.${id}.armed`] = 'true'; }
    expect(brokenScheduleCount([d('l1'), d('l2'), d('l3')], ctx)).toBe(3);
  });
});
