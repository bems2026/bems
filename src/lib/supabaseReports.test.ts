import { describe, it, expect } from 'vitest';
import { coverageOf, isQuotable, formatMonth } from './supabaseReports';

const FULL_JULY = 31 * 24 * 60; // one sample per minute

describe('coverageOf', () => {
  it('reports a fully observed month as complete', () => {
    expect(coverageOf(FULL_JULY, FULL_JULY)).toEqual({ ratio: 1, band: 'complete' });
  });

  it('tolerates a few missed minutes — a daemon restart is not a gap worth flagging', () => {
    const c = coverageOf(FULL_JULY - 60, FULL_JULY);
    expect(c?.band).toBe('complete');
  });

  it('calls half a month partial, not complete', () => {
    expect(coverageOf(FULL_JULY / 2, FULL_JULY)?.band).toBe('partial');
  });

  it('calls the current outage what it is — sparse, not a small real number', () => {
    // RM-001: the field devices dropped on 2026-08-20. A month with four days of data
    // produces a real kWh figure that means almost nothing on its own.
    const c = coverageOf(4 * 24 * 60, FULL_JULY);
    expect(c?.band).toBe('sparse');
    expect(c?.ratio).toBeCloseTo(0.129, 2);
  });

  it('distinguishes "we saw nothing" from "we cannot say"', () => {
    // Zero observed samples out of a known expectation IS a measurement: the month happened
    // and nothing was recorded. A missing expectation is not — there is nothing to divide by.
    expect(coverageOf(0, FULL_JULY)).toEqual({ ratio: 0, band: 'none' });
    expect(coverageOf(0, 0)).toBeNull();
    expect(coverageOf(10, 0)).toBeNull();
  });

  it('returns null rather than a number for nonsense inputs', () => {
    expect(coverageOf(Number.NaN, FULL_JULY)).toBeNull();
    expect(coverageOf(-5, FULL_JULY)).toBeNull();
    expect(coverageOf(10, Number.NaN)).toBeNull();
  });

  it('clamps at 1 — an extra sample from a clock skew is not 101% of a month', () => {
    expect(coverageOf(FULL_JULY + 500, FULL_JULY)?.ratio).toBe(1);
  });
});

describe('isQuotable', () => {
  it('permits only a complete month to stand without a caveat', () => {
    expect(isQuotable(coverageOf(FULL_JULY, FULL_JULY))).toBe(true);
    expect(isQuotable(coverageOf(FULL_JULY * 0.8, FULL_JULY))).toBe(false);
    expect(isQuotable(coverageOf(0, FULL_JULY))).toBe(false);
    expect(isQuotable(null)).toBe(false);
  });
});

describe('formatMonth', () => {
  it('renders a month key as a readable month and year', () => {
    expect(formatMonth('2026-07-01')).toBe('July 2026');
  });

  it('accepts a full timestamp, which is how PostgREST may render a date column', () => {
    expect(formatMonth('2026-07-01T00:00:00+00:00')).toBe('July 2026');
  });

  it('does not shift the month across a timezone boundary', () => {
    // Parsing '2026-01-01' in a UTC+8 locale and formatting it locally would print December.
    expect(formatMonth('2026-01-01')).toBe('January 2026');
    expect(formatMonth('2026-12-01')).toBe('December 2026');
  });

  it('returns the input unchanged rather than inventing a date it cannot parse', () => {
    expect(formatMonth('not-a-month')).toBe('not-a-month');
  });
});
