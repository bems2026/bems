import { describe, it, expect } from 'vitest';
import { carbonOf, costOf, emissionsPerDay, pricePerDay, type DayEnergy, type Factor, type Rate } from './energyCost';

/**
 * RM-083. The simple CSV prices each day, so the per-day figures must obey every rule the period
 * total obeys — and must add up to it, or the spreadsheet and the report disagree about the same
 * month. The sum-equals-total assertions are what hold the two together.
 */

const rate = (o: Partial<Rate> = {}): Rate => ({
  effective_from: '2026-08-01',
  rate_per_kwh: 10,
  currency: 'PHP',
  source: 'bill',
  set_at: '2026-08-02T00:00:00Z',
  set_by_label: null,
  ...o,
});

const factor = (o: Partial<Factor> = {}): Factor => ({
  effective_from: '2026-08-01',
  kg_co2e_per_kwh: 0.7,
  source: 'grid factor',
  set_at: '2026-08-02T00:00:00Z',
  set_by_label: null,
  ...o,
});

const days: DayEnergy[] = [
  { day: '2026-07-31', kwh: 5 }, // before the earliest rate
  { day: '2026-08-01', kwh: 2 },
  { day: '2026-08-02', kwh: null }, // unobserved
  { day: '2026-08-03', kwh: 3 },
];

const sum = (values: readonly (number | null)[]) => values.reduce<number>((a, v) => a + (v ?? 0), 0);

describe('pricePerDay', () => {
  it('prices each day at the rate in force that day, and the days add up to the period’s cost', () => {
    const rates = [rate(), rate({ effective_from: '2026-08-03', rate_per_kwh: 12 })];
    const perDay = pricePerDay(days, rates);
    expect(perDay.map((d) => d.day)).toEqual(days.map((d) => d.day));
    expect(perDay[1].amount).toBeCloseTo(20, 9);
    expect(perDay[3].amount).toBeCloseTo(36, 9);
    expect(sum(perDay.map((d) => d.amount))).toBeCloseTo(costOf(days, rates).total as number, 9);
  });

  it('leaves an unobserved day and a day before the earliest rate unpriced — never zero', () => {
    const perDay = pricePerDay(days, [rate()]);
    expect(perDay[0].amount).toBeNull();
    expect(perDay[2].amount).toBeNull();
  });

  it('prices nothing when no rate has been entered', () => {
    expect(pricePerDay(days, []).every((d) => d.amount === null)).toBe(true);
  });

  it('prices nothing when the rates are in more than one currency, rather than adding them', () => {
    const mixed = [rate(), rate({ effective_from: '2026-08-02', currency: 'USD' })];
    expect(pricePerDay(days, mixed).every((d) => d.amount === null)).toBe(true);
  });
});

describe('emissionsPerDay', () => {
  it('applies the factor in force each day, and the days add up to the period’s emissions', () => {
    const factors = [factor()];
    const perDay = emissionsPerDay(days, factors);
    expect(perDay[1].kg).toBeCloseTo(1.4, 9);
    expect(perDay[3].kg).toBeCloseTo(2.1, 9);
    expect(perDay[0].kg).toBeNull();
    expect(perDay[2].kg).toBeNull();
    expect(sum(perDay.map((d) => d.kg))).toBeCloseTo(carbonOf(days, factors).total as number, 9);
  });

  it('applies nothing when no emission factor has been entered', () => {
    expect(emissionsPerDay(days, []).every((d) => d.kg === null)).toBe(true);
  });
});
