import { describe, it, expect } from 'vitest';
import { costOf, carbonOf, provenanceLines, type Factor, type Rate } from './energyCost';

/**
 * What a period cost, and what it emitted.
 *
 * Every assertion here is about refusing to invent. A cost figure is the most quotable number a
 * report can carry — it is the one a reader repeats in a meeting without the caveats — so the
 * rules are stricter than for the kWh it derives from:
 *
 *   - no rate configured is `null`, never zero;
 *   - a day before the earliest rate is not priced at the earliest rate, it is unpriced;
 *   - a day with no energy reading contributes nothing and is counted as unpriced, because
 *     "we don't know what it cost" and "it cost nothing" are different claims.
 */

const rate = (effective_from: string, rate_per_kwh: number, source = 'INEC bill'): Rate => ({
  effective_from,
  rate_per_kwh,
  currency: 'PHP',
  source,
  set_at: '2026-09-01T00:00:00Z',
  set_by_label: 'alice@example.test',
});

const day = (d: string, kwh: number | null) => ({ day: d, kwh });

describe('costOf', () => {
  it('returns null when no rate is configured', () => {
    // Not zero. A zero cost is a claim that electricity was free, and it is the single most
    // damaging number this page could print.
    const r = costOf([day('2026-08-17', 14.68)], []);
    expect(r.total).toBeNull();
    expect(r.currency).toBeNull();
    expect(r.byRate).toHaveLength(0);
  });

  it('prices every day at the rate in force that day', () => {
    const r = costOf([day('2026-08-17', 10), day('2026-08-18', 10)], [rate('2026-01-01', 11.5)]);
    expect(r.total).toBeCloseTo(230, 6);
    expect(r.currency).toBe('PHP');
  });

  it('splits a period that spans a rate change, and names both rates', () => {
    // A single current rate would price the whole month at whichever rate happens to be latest.
    const r = costOf(
      [day('2026-08-17', 10), day('2026-08-18', 10), day('2026-08-19', 10)],
      [rate('2026-01-01', 10, 'old bill'), rate('2026-08-18', 12, 'new bill')]
    );
    expect(r.total).toBeCloseTo(10 * 10 + 10 * 12 + 10 * 12, 6);
    expect(r.byRate).toHaveLength(2);
    expect(r.byRate[0]).toMatchObject({ ratePerKwh: 10, kwh: 10, source: 'old bill' });
    expect(r.byRate[1]).toMatchObject({ ratePerKwh: 12, kwh: 20, source: 'new bill' });
  });

  it('does not price a day that predates the earliest rate', () => {
    // Back-applying the earliest known rate would be inventing history. The kWh is real; what it
    // cost is not known, and the report has to be able to say that.
    const r = costOf([day('2026-07-31', 10), day('2026-08-01', 10)], [rate('2026-08-01', 11)]);
    expect(r.total).toBeCloseTo(110, 6);
    expect(r.unpricedKwh).toBeCloseTo(10, 6);
  });

  it('counts a day with no reading as unpriced rather than as zero cost', () => {
    // 2026-08-18's shape: rows, no readings, no energy. Pricing it at zero would say the
    // building spent nothing that day, which is a claim about the building rather than the meters.
    const r = costOf([day('2026-08-17', 10), day('2026-08-18', null)], [rate('2026-01-01', 11)]);
    expect(r.total).toBeCloseTo(110, 6);
    expect(r.unobservedDays).toBe(1);
  });

  it('reports zero unpriced when every day is covered', () => {
    const r = costOf([day('2026-08-17', 10)], [rate('2026-01-01', 11)]);
    expect(r.unpricedKwh).toBe(0);
    expect(r.unobservedDays).toBe(0);
  });

  it('takes the latest rate at or before the day, whatever order the rates arrive in', () => {
    const r = costOf([day('2026-08-20', 10)], [rate('2026-08-18', 12), rate('2026-01-01', 10)]);
    expect(r.total).toBeCloseTo(120, 6);
  });

  it('refuses to mix currencies rather than adding them', () => {
    // Two rates in different currencies do not sum to anything. Better no total than a number
    // that is 400 of nothing.
    const r = costOf(
      [day('2026-08-17', 10), day('2026-08-19', 10)],
      [rate('2026-01-01', 10), { ...rate('2026-08-18', 12), currency: 'USD' }]
    );
    expect(r.total).toBeNull();
    expect(r.mixedCurrency).toBe(true);
  });

  it('carries the provenance of every rate it used', () => {
    // The point of the whole table. A funder reading a peso figure can trace it to a bill.
    const r = costOf([day('2026-08-17', 10)], [rate('2026-01-01', 11.4286, 'MMSU bill, Aug 2026')]);
    expect(r.byRate[0].source).toBe('MMSU bill, Aug 2026');
    expect(r.byRate[0].setByLabel).toBe('alice@example.test');
  });
});

describe('carbonOf', () => {
  const factor = (effective_from: string, kg: number) => ({
    effective_from,
    kg_co2e_per_kwh: kg,
    source: 'DOE NGEF',
    set_at: '2026-09-01T00:00:00Z',
    set_by_label: null,
  });

  it('returns null when no factor is configured', () => {
    expect(carbonOf([day('2026-08-17', 10)], []).total).toBeNull();
  });

  it('applies the factor in force on each day', () => {
    const r = carbonOf([day('2026-08-17', 10), day('2026-08-19', 10)], [factor('2026-01-01', 0.6), factor('2026-08-18', 0.5)]);
    expect(r.total).toBeCloseTo(10 * 0.6 + 10 * 0.5, 6);
  });

  it('leaves a day before the earliest factor unattributed', () => {
    const r = carbonOf([day('2026-07-31', 10), day('2026-08-01', 10)], [factor('2026-08-01', 0.6)]);
    expect(r.total).toBeCloseTo(6, 6);
    expect(r.unpricedKwh).toBeCloseTo(10, 6);
  });
});

describe('provenanceLines', () => {
  // The PDF's footnote. It has no elements to nest, so the page's provenance is flattened into
  // sentences here — and it must say what the page says, rate for rate.
  const pdfFactor = (effective_from: string, kg_co2e_per_kwh: number, set_by_label: string | null): Factor => ({
    effective_from,
    kg_co2e_per_kwh,
    source: 'DOE grid factor 2025',
    set_at: '2026-09-01T00:00:00Z',
    set_by_label,
  });

  it('says nothing when nothing was priced', () => {
    // An empty footnote, not "0 PHP/kWh". No source means no sentence claiming one.
    expect(provenanceLines(costOf([day('2026-08-17', 10)], []), carbonOf([day('2026-08-17', 10)], []))).toEqual([]);
  });

  it('names the rate, its date, the energy it priced, its source and who entered it', () => {
    const days = [day('2026-08-17', 10)];
    expect(provenanceLines(costOf(days, [rate('2026-01-01', 11.5)]), carbonOf(days, [pdfFactor('2026-01-01', 0.6, 'bob@example.test')]))).toEqual([
      '11.5 PHP/kWh from 2026-01-01, priced 10.00 kWh — INEC bill, entered by alice@example.test.',
      '0.6 kgCO₂e/kWh from 2026-01-01, applied to 10.00 kWh — DOE grid factor 2025, entered by bob@example.test.',
    ]);
  });

  it('omits the attribution rather than printing a null when the account is gone', () => {
    const days = [day('2026-08-17', 10)];
    const [line] = provenanceLines(costOf(days, []), carbonOf(days, [pdfFactor('2026-01-01', 0.6, null)]));
    expect(line).toBe('0.6 kgCO₂e/kWh from 2026-01-01, applied to 10.00 kWh — DOE grid factor 2025.');
  });
});
