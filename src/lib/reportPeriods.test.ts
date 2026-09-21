import { describe, it, expect } from 'vitest';
import { sameStartLastYear } from './reportPeriods';

describe('sameStartLastYear', () => {
  it('finds the same month a year earlier', () => {
    expect(sameStartLastYear('month', '2026-08-01')).toBe('2025-08-01');
    expect(sameStartLastYear('month', '2026-01-01')).toBe('2025-01-01');
  });

  it('finds the week 52 weeks earlier, which starts on a Monday too', () => {
    const back = sameStartLastYear('week', '2026-08-31');
    expect(back).toBe('2025-09-01');
    expect(new Date(`${back}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('keeps the weekday across a leap day', () => {
    // 2028 is a leap year; 364 days back from a Monday in March 2028 is still a Monday.
    const back = sameStartLastYear('week', '2028-03-06');
    expect(back).toBe('2027-03-08');
    expect(new Date(`${back}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('returns null for a date it cannot read, rather than a date it invented', () => {
    expect(sameStartLastYear('month', 'not a date')).toBeNull();
    expect(sameStartLastYear('week', '2026-13-01')).toBeNull();
  });
});

describe('sameStartLastYear for a day — RM-124', () => {
  it('is the same calendar date a year earlier', () => {
    expect(sameStartLastYear('day', '2026-09-19')).toBe('2025-09-19');
  });
  it('a leap day a year earlier does not exist, so it is the 28th', () => {
    expect(sameStartLastYear('day', '2028-02-29')).toBe('2027-02-28');
  });
});
