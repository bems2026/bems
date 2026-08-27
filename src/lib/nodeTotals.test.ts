import { describe, it, expect } from 'vitest';
import { rowToNodeTotals, coverageOf } from './nodeTotals';

/**
 * The mappers only. The RPC itself is exercised by `supabase/rehearse.sh` against a real
 * PostgreSQL, which is where its honesty rules are actually settled — the same split every
 * other Supabase module here draws.
 */
describe('rowToNodeTotals', () => {
  it('passes an observed row through', () => {
    expect(
      rowToNodeTotals({ device_count: 3, reporting_count: 2, sample_count: 40, online_sample_count: 30, avg_power_w: 200.5, peak_power_w: 900 }),
    ).toEqual({ deviceCount: 3, reportingCount: 2, sampleCount: 40, onlineSampleCount: 30, avgPowerW: 200.5, peakPowerW: 900 });
  });

  it('keeps NULL power as null and never turns it into 0', () => {
    // The whole point of the RPC's honesty rule, preserved across the wire. A 0 here would be a
    // reading nobody observed, which is the failure this project keeps paying for.
    const t = rowToNodeTotals({ device_count: 1, reporting_count: 0, sample_count: 0, online_sample_count: 0, avg_power_w: null, peak_power_w: null });
    expect(t.avgPowerW).toBeNull();
    expect(t.peakPowerW).toBeNull();
  });

  it('coerces the counts to numbers, because PostgREST returns bigint as a string', () => {
    // count(*) is bigint; supabase-js hands it back as "40", and arithmetic on that silently
    // concatenates rather than adding.
    const t = rowToNodeTotals({ device_count: 1, reporting_count: 1, sample_count: '40', online_sample_count: '30', avg_power_w: '12.5', peak_power_w: '99' });
    expect(t.sampleCount).toBe(40);
    expect(t.onlineSampleCount).toBe(30);
    expect(t.avgPowerW).toBe(12.5);
  });
});

describe('coverageOf', () => {
  it('is the observed fraction of the samples considered', () => {
    expect(coverageOf({ sampleCount: 100, onlineSampleCount: 75 })).toBe(0.75);
  });

  it('is null when nothing was considered, not 1 and not 0', () => {
    // "Everything we looked at was fine" and "we looked at nothing" must not render the same.
    // Both 1 and 0 would be a claim; null is the absence of one.
    expect(coverageOf({ sampleCount: 0, onlineSampleCount: 0 })).toBeNull();
  });

  it('is 0 when samples existed and none were observed', () => {
    // Distinct from the case above: here we DID look, and saw nothing reporting.
    expect(coverageOf({ sampleCount: 20, onlineSampleCount: 0 })).toBe(0);
  });
});
