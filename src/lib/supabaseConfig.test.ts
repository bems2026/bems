import { describe, it, expect } from 'vitest';
import { dsmRowToContext, dsmRowFrom } from './supabaseConfig';

/**
 * The schedule half of this module went in RM-059. It mapped `schedules` rows to and from flat
 * `global.schedule.<id>.<field>` context keys, a shape that can hold exactly one rule per device
 * — which is the limitation RM-059 removed. Schedules are ordinary rows with ids now; their
 * coverage lives in `src/lib/scheduleStack.test.ts` and `src/stores/scheduleStore.ts`'s callers.
 *
 * What remains here is the DSM singleton, which is genuinely one row of settings and for which
 * the flat map is still the right shape.
 */

describe('dsmRowToContext', () => {
  it('maps a full threshold row to the flat context keys the card reads', () => {
    const ctx = dsmRowToContext({ max_phase_current: 30, max_total_kw: 5.5, auto_shed: true });
    expect(ctx).toEqual({
      'global.dsm.max_phase_a': '30',
      'global.dsm.max_total_kw': '5.5',
      'global.dsm.auto_shed': 'true',
    });
  });

  it('omits an unset (null) threshold rather than showing a fabricated 0 or empty string', () => {
    const ctx = dsmRowToContext({ max_phase_current: null, max_total_kw: null, auto_shed: false });
    expect(ctx).toEqual({ 'global.dsm.auto_shed': 'false' });
  });

  it('returns an empty map when no row exists yet', () => {
    expect(dsmRowToContext(null)).toEqual({});
  });

  it('no longer carries the ambient trigger — phase35 drops the column it came from', () => {
    // `care_acu_trigger_c` backed a slider that no server file ever read. RM-062's controller
    // replaces it; leaving the key mapped here would keep a dead value round-tripping.
    const ctx = dsmRowToContext({ max_phase_current: 30, max_total_kw: 5.5, auto_shed: true });
    expect(Object.keys(ctx).some((k) => k.startsWith('global.trigger.'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Attribution.
//
// `dsm_thresholds.updated_by` is how `server/shedPlan.mjs` decides who a shed command is
// attributed to; without it `planShed` returns an idle plan, because `commands.requested_by` is
// NOT NULL and inventing a user would put a fiction in the one table meant to be trustworthy.
// That is precisely why RM-006c needs a save from a signed-in session and not a flag flip.
// ---------------------------------------------------------------------------

describe('dsmRowFrom', () => {
  it('stamps the signed-in user and refreshes updated_at', () => {
    const row = dsmRowFrom({ 'global.dsm.max_total_kw': '5' }, 'user-42');
    expect(row.updated_by).toBe('user-42');
    // The column only defaults on INSERT and this is an update over a row that already exists.
    expect(typeof row.updated_at).toBe('string');
  });

  it('keeps unset thresholds null rather than coercing them to 0 — "no limit" and "a limit of 0" are different facts', () => {
    const row = dsmRowFrom({}, 'user-42');
    expect(row.max_phase_current).toBeNull();
    expect(row.max_total_kw).toBeNull();
    expect(row.auto_shed).toBe(false);
  });

  it('passes a null actor through rather than inventing one; the caller decides whether that is acceptable', () => {
    expect(dsmRowFrom({}, null).updated_by).toBeNull();
  });
});
