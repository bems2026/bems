import { describe, it, expect } from 'vitest';
import { scheduleRowsToContext, dsmRowToContext, scheduleRowsFor, dsmRowFrom } from './supabaseConfig';

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

// ---------------------------------------------------------------------------
// Attribution.
//
// `schedules.updated_by` and `dsm_thresholds.updated_by` are how server/scheduler.mjs
// decides who a resulting command is attributed to. Without them every row a real user saves
// is skipped, because `commands.requested_by` is NOT NULL and inventing a user would put a
// fiction in the one table meant to be trustworthy. This file wrote neither until now.
// ---------------------------------------------------------------------------

describe('scheduleRowsFor', () => {
  const merged = {
    'global.schedule.l1.on': '08:00',
    'global.schedule.l1.off': '18:00',
    'global.schedule.l1.days': '1111100',
    'global.schedule.l1.armed': 'true',
  };

  it('stamps the signed-in user, so the schedule can actually fire later', () => {
    expect(scheduleRowsFor(new Set(['l1']), merged, 'user-42')[0].updated_by).toBe('user-42');
  });

  it('carries the rule and armed state through unchanged', () => {
    const row = scheduleRowsFor(new Set(['l1']), merged, 'user-42')[0];
    expect(row.device_id).toBe('l1');
    expect(row.enabled).toBe(true);
    expect(row.rule).toEqual({ on: '08:00', off: '18:00', days: '1111100' });
  });

  it('refreshes updated_at — the column only defaults on insert and these are upserts over existing rows', () => {
    expect(typeof scheduleRowsFor(new Set(['l1']), merged, 'user-42')[0].updated_at).toBe('string');
  });

  it('passes a null actor through rather than inventing one; the caller decides whether that is acceptable', () => {
    expect(scheduleRowsFor(new Set(['l1']), merged, null)[0].updated_by).toBeNull();
  });
});

describe('dsmRowFrom', () => {
  it('stamps the signed-in user and refreshes updated_at', () => {
    const row = dsmRowFrom({ 'global.dsm.max_total_kw': '5' }, 'user-42');
    expect(row.updated_by).toBe('user-42');
    expect(typeof row.updated_at).toBe('string');
  });

  it('keeps unset thresholds null rather than coercing them to 0 — "no limit" and "a limit of 0" are different facts', () => {
    const row = dsmRowFrom({}, 'user-42');
    expect(row.max_phase_current).toBeNull();
    expect(row.max_total_kw).toBeNull();
    expect(row.auto_shed).toBe(false);
  });
});
