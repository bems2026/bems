import { describe, it, expect } from 'vitest';
import { setpointOptions, seedSetpoint } from './setpointOptions';

/**
 * RM-027 — the selector must not offer a value the server will refuse.
 *
 * Two bounds, and keeping them distinct is the point. The IR library's range is a hardware
 * fact, identical at every site. The policy floor is the operator's rule and narrows it. A
 * dropdown offering 18 at a site whose floor is 25 produces a 400 and looks like a bug.
 */
describe('setpointOptions', () => {
  it('offers the full IR range when the site declares no floor', () => {
    expect(setpointOptions(null)).toEqual([16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  });

  it('starts at the policy floor when the site declares one', () => {
    expect(setpointOptions(25)).toEqual([25, 26, 27, 28, 29, 30]);
  });

  it('includes the floor itself — the bound is inclusive, matching validateCommand', () => {
    expect(setpointOptions(25)[0]).toBe(25);
  });

  it('never offers less than the IR library has codes for, whatever the policy says', () => {
    // A floor below the hardware minimum cannot widen the range: there is no code to send.
    expect(setpointOptions(10)[0]).toBe(16);
  });

  it('never returns an empty list, even for an absurd floor', () => {
    // An empty <select> is a dead control. Better to offer the single warmest legal value.
    expect(setpointOptions(99)).toEqual([30]);
  });
});

describe('seedSetpoint', () => {
  it('opens at the device reading when that reading is a legal option', () => {
    expect(seedSetpoint(27, 25)).toBe(27);
  });

  it('rounds a fractional reading to the nearest whole degree', () => {
    expect(seedSetpoint(26.4, 25)).toBe(26);
  });

  it('falls back to the floor when the last reading is below policy', () => {
    // The ACU genuinely can be sitting at 22 — set by remote, or before the policy existed.
    // Seeding the selector there would preselect a value the server refuses.
    expect(seedSetpoint(22, 25)).toBe(25);
  });

  it('falls back to the default when there is no reading at all', () => {
    expect(seedSetpoint(undefined, 25)).toBe(25);
    expect(seedSetpoint(null, null)).toBe(25);
  });

  it('keeps the pre-RM-027 default of 25 when no policy applies', () => {
    expect(seedSetpoint(undefined, null)).toBe(25);
  });
});
