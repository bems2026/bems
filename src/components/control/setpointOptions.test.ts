import { describe, it, expect } from 'vitest';
import { setpointOptions, seedSetpoint, setpointWarning, DEFAULT_SETPOINT_C } from './setpointOptions';
import { ACU_MIN_C, ACU_MAX_C } from '@shared/commands.mjs';

/**
 * RM-068 removed a bound from this module rather than adding one.
 *
 * The site's comfort policy used to narrow the selector, because it was read as a limit on the
 * setpoint COMMANDED to the aircon and `validateCommand` refused anything below it. That number
 * now means the coldest ROOM TEMPERATURE an automatic rule may aim for, so it says nothing about
 * what a person may ask for by hand — and the selector offers the full hardware range with
 * `setpointWarning` supplying the sentence that used to be a 400.
 */

describe('setpointOptions', () => {
  it('offers every whole degree the IR library holds a code for, ascending', () => {
    const out = setpointOptions();
    expect(out[0]).toBe(ACU_MIN_C);
    expect(out[out.length - 1]).toBe(ACU_MAX_C);
    expect(out).toHaveLength(ACU_MAX_C - ACU_MIN_C + 1);
    expect([...out].sort((a, b) => a - b)).toEqual(out);
  });

  it('offers 16 °C — the degree the old policy floor used to hide', () => {
    // The regression that matters: a closed loop cannot hold a room at 24 on a hot afternoon if
    // the coldest thing it may ask for is 24.
    expect(setpointOptions()).toContain(16);
  });

  it('is every whole degree with no gaps', () => {
    const out = setpointOptions();
    expect(out.every((c, i) => i === 0 || c === out[i - 1] + 1)).toBe(true);
  });
});

describe('seedSetpoint', () => {
  it('opens on the unit last known setpoint, so the control shows where the room actually is', () => {
    expect(seedSetpoint(22)).toBe(22);
  });

  it('rounds a fractional reading to a degree the hardware can be told', () => {
    expect(seedSetpoint(23.4)).toBe(23);
  });

  it('opens on a value the OLD policy floor would have refused, because nothing refuses it now', () => {
    expect(seedSetpoint(18)).toBe(18);
  });

  it('falls back to the retired dashboard default when nothing is known', () => {
    expect(seedSetpoint(null)).toBe(DEFAULT_SETPOINT_C);
    expect(seedSetpoint(undefined)).toBe(DEFAULT_SETPOINT_C);
    expect(seedSetpoint(Number.NaN)).toBe(DEFAULT_SETPOINT_C);
  });

  it('falls back for a reading outside the hardware range — there is no code to send', () => {
    expect(seedSetpoint(5)).toBe(DEFAULT_SETPOINT_C);
    expect(seedSetpoint(40)).toBe(DEFAULT_SETPOINT_C);
  });
});

describe('setpointWarning', () => {
  it('says nothing when the choice is at or above the policy', () => {
    expect(setpointWarning(24, 24)).toBeNull();
    expect(setpointWarning(26, 24)).toBeNull();
  });

  it('says nothing when the site declares no policy at all', () => {
    expect(setpointWarning(16, null)).toBeNull();
    expect(setpointWarning(16, undefined)).toBeNull();
  });

  it('names the policy value and says the command is still allowed and recorded', () => {
    // The meaning of the number changed, so the sentence has to explain it — an operator who
    // remembers it as "the coldest you may set" would otherwise read this as a bug.
    const msg = setpointWarning(18, 24);
    expect(msg).toMatch(/24°C room-comfort policy/);
    expect(msg).toMatch(/allowed/);
    expect(msg).toMatch(/audit trail/);
  });
});
