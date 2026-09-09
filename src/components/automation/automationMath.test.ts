import { describe, it, expect } from 'vitest';
import { nextUpSchedules, armedScheduleCount } from './automationMath';
import type { Schedule } from '@/lib/supabaseSchedules';
import type { Device } from '@/lib/types';

const USER = '11111111-1111-1111-1111-111111111111';

const device = (id: string, display_name: string, deviceClass: Device['class']): Device => ({
  id,
  display_name,
  class: deviceClass,
  room: null,
  dps_map: null,
  status: 'active',
});

const DEVICES = [
  device('l1', 'Light Switch 1', 'switch'),
  device('l2', 'Light Switch 2', 'switch'),
  device('co1', 'Outlet 1', 'outlet_dual'),
];

let n = 0;
const rule = (over: Partial<Schedule> = {}): Schedule => ({
  id: `r${(n += 1)}`,
  deviceId: 'l1',
  socket: null,
  on: '08:00',
  off: '18:00',
  days: '1111111',
  enabled: true,
  label: null,
  updatedBy: USER,
  updatedAt: null,
  createdAt: null,
  ...over,
});

// 2026-08-24 is a Monday. 10:00 local, so the day's 08:00 has passed and 18:00 has not.
const MONDAY_10AM = new Date('2026-08-24T10:00:00');

describe('nextUpSchedules', () => {
  it('returns nothing when no schedule exists — no fabricated sample rows', () => {
    expect(nextUpSchedules(DEVICES, [], MONDAY_10AM)).toEqual([]);
  });

  it('excludes a disarmed rule', () => {
    expect(nextUpSchedules(DEVICES, [rule({ enabled: false })], MONDAY_10AM)).toEqual([]);
  });

  it('excludes a rule with no days — it matches no minute of the week', () => {
    expect(nextUpSchedules(DEVICES, [rule({ days: '0000000' })], MONDAY_10AM)).toEqual([]);
  });

  it('excludes a rule whose device is not in the catalogue', () => {
    expect(nextUpSchedules(DEVICES, [rule({ deviceId: 'ghost' })], MONDAY_10AM)).toEqual([]);
  });

  it('LOOKS FORWARD: an event that already happened today is next week, not overdue', () => {
    // The old version sorted on-times as plain strings, so a schedule that had already fired
    // sat at the top of the card all afternoon claiming to be next.
    const entries = nextUpSchedules(DEVICES, [rule({ on: '08:00', off: '18:00' })], MONDAY_10AM);
    expect(entries[0]).toMatchObject({ time: '18:00', action: 'off' });
    expect(entries[0].inMinutes).toBe(8 * 60);
  });

  it('reports both edges of a rule, soonest first', () => {
    const entries = nextUpSchedules(DEVICES, [rule({ on: '12:00', off: '11:00' })], MONDAY_10AM);
    expect(entries.map((e) => [e.time, e.action])).toEqual([
      ['11:00', 'off'],
      ['12:00', 'on'],
    ]);
  });

  it('sorts across devices by how soon each fires, not by registry order', () => {
    const entries = nextUpSchedules(
      DEVICES,
      [
        rule({ deviceId: 'l2', on: '16:00', off: null }),
        rule({ deviceId: 'l1', on: '11:00', off: null }),
        rule({ deviceId: 'co1', socket: 1, on: '13:00', off: null }),
      ],
      MONDAY_10AM,
    );
    expect(entries.map((e) => e.deviceId)).toEqual(['l1', 'co1', 'l2']);
  });

  it('wraps around the week — at 23:00 the next morning is next, not an empty list', () => {
    const lateMonday = new Date('2026-08-24T23:00:00');
    const entries = nextUpSchedules(DEVICES, [rule({ on: '07:00', off: null, days: '1111111' })], lateMonday);
    expect(entries[0].inMinutes).toBe(8 * 60);
  });

  it('finds a Sunday-only rule from a Monday, six days out', () => {
    const entries = nextUpSchedules(DEVICES, [rule({ on: '10:00', off: null, days: '0000001' })], MONDAY_10AM);
    expect(entries[0].inMinutes).toBe(6 * 24 * 60);
  });

  it('caps at the given limit', () => {
    const many = [rule({ on: '11:00' }), rule({ on: '12:00' }), rule({ on: '13:00' }), rule({ on: '14:00' })];
    expect(nextUpSchedules(DEVICES, many, MONDAY_10AM, 2)).toHaveLength(2);
  });

  it('lists a daily rule ONCE, not once per day of the week', () => {
    // Seven matches exist for a rule set every day; four of them stacked in the card would be
    // the same fact repeated, crowding out the other devices entirely.
    const entries = nextUpSchedules(DEVICES, [rule({ on: '11:00', off: null, days: '1111111' })], MONDAY_10AM);
    expect(entries).toHaveLength(1);
    expect(entries[0].inMinutes).toBe(60);
  });
});

describe('armedScheduleCount', () => {
  it('counts armed RULES, not armed devices — one device can hold five', () => {
    const stack = [rule({ deviceId: 'l1' }), rule({ deviceId: 'l1' }), rule({ deviceId: 'l1', enabled: false })];
    expect(armedScheduleCount(stack)).toBe(2);
  });

  it('zero when nothing is armed', () => {
    expect(armedScheduleCount([])).toBe(0);
  });
});
