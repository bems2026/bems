import { describe, it, expect } from 'vitest';
import { scheduleRowsToContext, dsmRowToContext } from './supabaseConfig';

describe('scheduleRowsToContext', () => {
  it('maps a full schedule row to the flat context keys the UI reads', () => {
    const ctx = scheduleRowsToContext([{ device_id: 'l3', rule: { on: '18:00', off: '06:00', days: '1111100' }, enabled: true }]);
    expect(ctx).toEqual({
      'global.schedule.l3.on': '18:00',
      'global.schedule.l3.off': '06:00',
      'global.schedule.l3.days': '1111100',
      'global.schedule.l3.armed': 'true',
    });
  });

  it('omits on/off/days keys the rule never set, rather than fabricating empty strings', () => {
    const ctx = scheduleRowsToContext([{ device_id: 'l3', rule: {}, enabled: false }]);
    expect(ctx).toEqual({ 'global.schedule.l3.armed': 'false' });
  });

  it('handles a null rule the same as an empty one', () => {
    const ctx = scheduleRowsToContext([{ device_id: 'co1', rule: null, enabled: false }]);
    expect(ctx).toEqual({ 'global.schedule.co1.armed': 'false' });
  });

  it('returns an empty map for no rows', () => {
    expect(scheduleRowsToContext([])).toEqual({});
  });
});

describe('dsmRowToContext', () => {
  it('maps a full threshold row, including the ACU trigger setpoint', () => {
    const ctx = dsmRowToContext({ max_phase_current: 30, max_total_kw: 5.5, auto_shed: true, care_acu_trigger_c: 28 });
    expect(ctx).toEqual({
      'global.dsm.max_phase_a': '30',
      'global.dsm.max_total_kw': '5.5',
      'global.dsm.auto_shed': 'true',
      'global.trigger.care_acu_on': '28',
    });
  });

  it('omits an unset (null) threshold rather than showing a fabricated 0 or empty string', () => {
    const ctx = dsmRowToContext({ max_phase_current: null, max_total_kw: null, auto_shed: false, care_acu_trigger_c: null });
    expect(ctx).toEqual({ 'global.dsm.auto_shed': 'false' });
  });

  it('returns an empty map when no row exists yet', () => {
    expect(dsmRowToContext(null)).toEqual({});
  });
});
