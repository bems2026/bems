/**
 * Demand statistics for choosing DSM thresholds.
 *
 * Pure — the fetching lives in `demand-profile.mjs`, so the maths can be tested without a
 * database. Choosing where to cut power to a working building is not a place for a number
 * nobody can reproduce.
 */

/** Nearest-rank percentile over a sorted array. Returns null for an empty series. */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export function summarize(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  return {
    n: clean.length,
    p50: percentile(clean, 0.5),
    p95: percentile(clean, 0.95),
    p99: percentile(clean, 0.99),
    max: clean[clean.length - 1],
  };
}

/**
 * A threshold suggestion, and the reasoning, from an observed series.
 *
 * Set above the observed peak, not at a percentile of it. A DSM limit is a *ceiling the
 * building should not cross*, not a description of what it usually does — anchoring it at p95
 * would put the limit inside normal operation and shed load on an ordinary busy afternoon.
 * The headroom is what turns "this is what we draw" into "this is more than we should draw".
 *
 * Returns null rather than a number when the sample is too small to support one. A threshold
 * derived from a handful of readings is a guess wearing a decimal point, and this system can
 * act on it by switching off lights.
 */
export function suggestThreshold(stats, { headroom = 1.25, minSamples = 500 } = {}) {
  if (!stats) return { value: null, reason: 'no readings' };
  if (stats.n < minSamples) {
    return { value: null, reason: `only ${stats.n} readings — too few to set a limit that switches off load` };
  }
  return {
    value: Number((stats.max * headroom).toPrecision(3)),
    reason: `${Math.round((headroom - 1) * 100)}% above the observed peak of ${stats.max.toFixed(2)} across ${stats.n} readings`,
  };
}
