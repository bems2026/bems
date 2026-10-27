import { describe, it, expect } from 'vitest';
import { unusualDays } from './unusualDays';

/** RM-164: the days worth a note — well above or below the period's usual day of the same kind. */

const day = (local_day: string, energy_kwh: number | null, usable_sample_count = 1440) => ({ local_day, energy_kwh, usable_sample_count });

describe('unusualDays', () => {
  // September 2026: the 1st is a Tuesday.
  const weekdays = ['01', '02', '03', '04', '07', '08', '09', '10', '11'].map((d) => day(`2026-09-${d}`, 12));

  it('flags a weekday well above or below the usual weekday', () => {
    const out = unusualDays([...weekdays, day('2026-09-14', 25), day('2026-09-15', 3)]);
    expect(out['2026-09-14']).toBe('high');
    expect(out['2026-09-15']).toBe('low');
    expect(out['2026-09-02']).toBeUndefined();
  });

  it('judges a weekend against weekends, so a quiet Saturday is not "low"', () => {
    const out = unusualDays([...weekdays, day('2026-09-05', 2), day('2026-09-06', 2), day('2026-09-12', 2), day('2026-09-13', 2.1)]);
    expect(out['2026-09-05']).toBeUndefined();
    expect(out['2026-09-13']).toBeUndefined();
  });

  it('says nothing about a day that recorded nothing, or a group too small to have a usual', () => {
    const out = unusualDays([day('2026-09-01', null, 0), day('2026-09-02', 10), day('2026-09-03', 30)]);
    expect(out).toEqual({});
  });
});
