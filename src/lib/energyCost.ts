/**
 * What a period cost, and what it emitted.
 *
 * Pure, and held to a stricter standard than the kilowatt-hours it derives from. A cost figure
 * is the most quotable number a report can carry — it is the one a reader repeats in a meeting
 * without the caveats attached — so every way of not knowing produces `null` or an explicit
 * unpriced remainder rather than a zero:
 *
 *   - no rate configured at all yields `null`, never 0;
 *   - a day earlier than the earliest known rate is NOT back-priced at it. The kilowatt-hours
 *     are real; what they cost is not known, and the report has to be able to say so;
 *   - a day with no energy reading is unobserved, not free;
 *   - two rates in different currencies do not sum. Better no total than a number that is four
 *     hundred of nothing.
 *
 * PER DAY, AT THE RATE IN FORCE THAT DAY. A single "current rate" would price August 2026 at
 * whatever the rate is on the afternoon somebody opens the report, and that error is invisible
 * and grows. `report_daily_series` gives a figure per day precisely so this can be done properly.
 */

export interface DayEnergy {
  /** `YYYY-MM-DD`, the building's own day — already resolved by the SQL. */
  day: string;
  kwh: number | null;
}

interface Dated {
  effective_from: string;
  source: string;
  set_at: string;
  /** Whoever entered it, for the footnote. `null` when the account is no longer resolvable. */
  set_by_label: string | null;
}

export interface Rate extends Dated {
  rate_per_kwh: number;
  currency: string;
}

export interface Factor extends Dated {
  kg_co2e_per_kwh: number;
}

export interface AppliedRate {
  ratePerKwh: number;
  effectiveFrom: string;
  source: string;
  setByLabel: string | null;
  /** Energy this rate priced, so a reader can check the arithmetic themselves. */
  kwh: number;
  amount: number;
}

export interface Costed {
  total: number | null;
  currency: string | null;
  byRate: AppliedRate[];
  /** Energy no rate covered — before the earliest one, or during a currency clash. */
  unpricedKwh: number;
  /** Days that carried no reading. Distinct from unpriced: nothing to price, not no price. */
  unobservedDays: number;
  mixedCurrency: boolean;
}

/** The latest entry whose `effective_from` is on or before `day`, or undefined. */
function inForce<T extends Dated>(entries: readonly T[], day: string): T | undefined {
  let best: T | undefined;
  for (const e of entries) {
    if (e.effective_from <= day && (best === undefined || e.effective_from > best.effective_from)) {
      best = e;
    }
  }
  return best;
}

export function costOf(days: readonly DayEnergy[], rates: readonly Rate[]): Costed {
  const empty: Costed = { total: null, currency: null, byRate: [], unpricedKwh: 0, unobservedDays: 0, mixedCurrency: false };
  if (rates.length === 0) return { ...empty, unobservedDays: days.filter((d) => d.kwh === null).length };

  const currencies = new Set(rates.map((r) => r.currency));
  const applied = new Map<string, AppliedRate>();
  let unpricedKwh = 0;
  let unobservedDays = 0;

  for (const d of days) {
    if (d.kwh === null || !Number.isFinite(d.kwh)) {
      unobservedDays += 1;
      continue;
    }
    const r = inForce(rates, d.day);
    if (!r) {
      // Before the earliest rate. Back-applying it would be inventing history.
      unpricedKwh += d.kwh;
      continue;
    }
    const key = r.effective_from;
    const prev = applied.get(key);
    applied.set(key, {
      ratePerKwh: r.rate_per_kwh,
      effectiveFrom: r.effective_from,
      source: r.source,
      setByLabel: r.set_by_label,
      kwh: (prev?.kwh ?? 0) + d.kwh,
      amount: (prev?.amount ?? 0) + d.kwh * r.rate_per_kwh,
    });
  }

  const byRate = [...applied.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  if (currencies.size > 1) {
    // The amounts are individually right and their sum means nothing. Everything priced becomes
    // unpriced rather than silently added together.
    return {
      total: null,
      currency: null,
      byRate,
      unpricedKwh: unpricedKwh + byRate.reduce((a, r) => a + r.kwh, 0),
      unobservedDays,
      mixedCurrency: true,
    };
  }

  return {
    total: byRate.length === 0 ? null : byRate.reduce((a, r) => a + r.amount, 0),
    currency: [...currencies][0] ?? null,
    byRate,
    unpricedKwh,
    unobservedDays,
    mixedCurrency: false,
  };
}

export interface AppliedFactor {
  kgPerKwh: number;
  effectiveFrom: string;
  source: string;
  setByLabel: string | null;
  kwh: number;
  kgCo2e: number;
}

export interface Carboned {
  total: number | null;
  byFactor: AppliedFactor[];
  unpricedKwh: number;
  unobservedDays: number;
}

export function carbonOf(days: readonly DayEnergy[], factors: readonly Factor[]): Carboned {
  if (factors.length === 0) {
    return { total: null, byFactor: [], unpricedKwh: 0, unobservedDays: days.filter((d) => d.kwh === null).length };
  }

  const applied = new Map<string, AppliedFactor>();
  let unpricedKwh = 0;
  let unobservedDays = 0;

  for (const d of days) {
    if (d.kwh === null || !Number.isFinite(d.kwh)) {
      unobservedDays += 1;
      continue;
    }
    const f = inForce(factors, d.day);
    if (!f) {
      unpricedKwh += d.kwh;
      continue;
    }
    const prev = applied.get(f.effective_from);
    applied.set(f.effective_from, {
      kgPerKwh: f.kg_co2e_per_kwh,
      effectiveFrom: f.effective_from,
      source: f.source,
      setByLabel: f.set_by_label,
      kwh: (prev?.kwh ?? 0) + d.kwh,
      kgCo2e: (prev?.kgCo2e ?? 0) + d.kwh * f.kg_co2e_per_kwh,
    });
  }

  const byFactor = [...applied.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return {
    total: byFactor.length === 0 ? null : byFactor.reduce((a, f) => a + f.kgCo2e, 0),
    byFactor,
    unpricedKwh,
    unobservedDays,
  };
}

/**
 * The same provenance `CostCarbonLine` renders, as plain sentences for the PDF — which has no
 * elements to nest. Lives here rather than beside the component so that file exports components
 * only, and so the page and the document read their footnote from one place.
 */
export function provenanceLines(cost: Costed, carbon: Carboned): string[] {
  return [
    ...cost.byRate.map(
      (r) =>
        `${r.ratePerKwh} ${cost.currency}/kWh from ${r.effectiveFrom}, priced ${r.kwh.toFixed(2)} kWh — ${r.source}${r.setByLabel ? `, entered by ${r.setByLabel}` : ''}.`
    ),
    ...carbon.byFactor.map(
      (f) =>
        `${f.kgPerKwh} kgCO₂e/kWh from ${f.effectiveFrom}, applied to ${f.kwh.toFixed(2)} kWh — ${f.source}${f.setByLabel ? `, entered by ${f.setByLabel}` : ''}.`
    ),
  ];
}
