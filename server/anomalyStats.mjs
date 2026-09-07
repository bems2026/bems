/**
 * Pure rolling-window anomaly math for server/ingest.mjs's tick(). No I/O, no daemon
 * state — the Map<deviceId, number[]> that actually holds each device's rolling window
 * lives in ingest.mjs itself (module-level, same pattern as its existing `lastError`),
 * exactly like shapeRows.mjs stays pure while ingest.mjs owns the mutable state around it.
 *
 * Simple, explainable rolling statistics — no ML, no training data. Two complementary checks,
 * which must AGREE before anything is recorded:
 *   - z-score against the window's mean/stddev — the usual "how many standard deviations
 *     off" signal.
 *   - Tukey's-fence IQR bounds — robust to the mean/stddev being dragged around by a
 *     single earlier outlier already sitting in the window.
 *
 * EITHER-FLAGS WAS THE ORIGINAL RULE, AND MEASUREMENT OVERTURNED IT — RM-004, which asked for
 * exactly this re-check once a week of continuous telemetry existed. Over the four days to
 * 2026-09-07 this recorded **2,833 anomalies**: 2,152 from the IQR check alone, 667 from both,
 * 14 from z alone. The median |z| across every flagged row was **2.37**, against a threshold of
 * 3.5 — the median thing being called an anomaly was not anomalous by the other check at all.
 *
 * The mechanism, narrowed down by running the numbers rather than reasoning about them. A
 * switched outlet sits at exactly 0 W for most of a 20-sample window, so `q1 = q3 = 0`, the
 * window's own IQR is 0, ANOMALY_MIN_IQR_W substitutes 1 W and the fence becomes +-3 W. That
 * alone is not enough — on an ALL-zero window the stddev floor makes z large too, so both fire
 * and the sample is recorded either way. The false positive lives in a band one sample wide:
 *
 *     ten zeros, then 74 W          z = 74.00   fence [-3, 3]        both   <- kept
 *     nine zeros + a 74, then 74    z =  3.00   fence [-3, 3]        iqr    <- the 2,152
 *     seven zeros + three 74s       z =  1.53   fence [-166, 222]    none
 *
 * One prior "on" sample lifts the stddev enough to pull z under threshold while two zeros still
 * sit at both quartiles. So the second sample of every switch-on was an alarm.
 *
 * ANOMALY_MIN_STDDEV_W / ANOMALY_MIN_IQR_W are NOT a "skip detection on a flat window"
 * gate — they're a noise floor substituted into the spread whenever the window's own
 * stddev/iqr is smaller. A hard gate would mean a device that's been rock-steady for 20
 * minutes could never be flagged no matter how large a subsequent jump is, which is
 * exactly the "stuck relay" / "ACU suddenly drawing way more" case this exists to catch.
 * Requiring agreement does NOT reintroduce that blind spot, which is what makes it the right
 * fix rather than merely a quieter one: a real jump on a flat window trips both checks at once
 * and is still recorded (see anomalyAgreement.test.mjs).
 *
 * `method` is still computed and returned when only one check fires, and is still written to
 * the `anomalies` table. That column is what makes this decision auditable afterwards — every
 * row recorded from now on reads `both`, and a run of `iqr` rows would mean this was reverted.
 */

export const ANOMALY_WINDOW_SIZE = 20; // ~20 min of history at the default 60s poll
export const ANOMALY_MIN_SAMPLES = 10; // ~10 min warm-up before a window is trusted
export const ANOMALY_Z_THRESHOLD = 3.5; // conservative — first pass, not a tuned model
export const ANOMALY_IQR_MULTIPLIER = 3.0; // Tukey's "far out" fence, not the usual 1.5
export const ANOMALY_MIN_STDDEV_W = 1; // noise floor substituted for stddev when it's smaller
export const ANOMALY_MIN_IQR_W = 1; // noise floor substituted for iqr when it's smaller

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values, m) {
  const variance = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Linear-interpolation quantile — Postgres's default `percentile_cont` method, so a
 * future SQL-side recompute (backfill/audit) agrees with this exactly. */
function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Computes baseline stats from `window` (must NOT include the sample being tested — see
 * detectAnomaly). Returns null when there aren't enough samples yet to trust the baseline
 * (ANOMALY_MIN_SAMPLES), so a freshly restarted daemon warms up silently instead of
 * flagging its own empty history as anomalous.
 */
export function computeBaseline(window) {
  if (window.length < ANOMALY_MIN_SAMPLES) return null;
  const m = mean(window);
  const sd = stddev(window, m);
  const sorted = [...window].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return { mean: m, stddev: sd, q1, q3, iqr: q3 - q1, sampleCount: window.length };
}

/**
 * Tests `value` against `window`'s baseline (window excludes `value` itself — a sample
 * must never be judged against a baseline that already includes it). Returns null when the
 * window isn't trusted yet; otherwise `{ isAnomaly, method, zScore, baselineMean,
 * baselineStddev, iqrLower, iqrUpper, sampleCount }`. `baselineStddev` is the RAW
 * (unfloored) stddev, kept for transparency even though the flagging decision below uses
 * the floored version. `method` is 'zscore' | 'iqr' | 'both' | 'none' — kept even when
 * `isAnomaly` is false so callers/tests can see why not.
 */
export function detectAnomaly(window, value) {
  const baseline = computeBaseline(window);
  if (!baseline) return null;

  const effectiveStddev = Math.max(baseline.stddev, ANOMALY_MIN_STDDEV_W);
  const zScore = (value - baseline.mean) / effectiveStddev;
  const zFlagged = Math.abs(zScore) >= ANOMALY_Z_THRESHOLD;

  const effectiveIqr = Math.max(baseline.iqr, ANOMALY_MIN_IQR_W);
  const iqrLower = baseline.q1 - ANOMALY_IQR_MULTIPLIER * effectiveIqr;
  const iqrUpper = baseline.q3 + ANOMALY_IQR_MULTIPLIER * effectiveIqr;
  const iqrFlagged = value < iqrLower || value > iqrUpper;

  const method = zFlagged && iqrFlagged ? 'both' : zFlagged ? 'zscore' : iqrFlagged ? 'iqr' : 'none';

  return {
    // BOTH, not either — see this file's header for the measurement that changed it. The two
    // checks are complementary rather than redundant, so agreement is a meaningfully stronger
    // claim than either alone: z asks "is this far from typical", IQR asks "is this outside the
    // bulk", and a real fault answers yes to both.
    isAnomaly: zFlagged && iqrFlagged,
    method,
    zScore,
    baselineMean: baseline.mean,
    baselineStddev: baseline.stddev,
    iqrLower,
    iqrUpper,
    sampleCount: baseline.sampleCount,
  };
}

/** Pushes `value` into `window`, capping at ANOMALY_WINDOW_SIZE (oldest drops off first) —
 * a plain array push/slice, not a real ring buffer: at 20 elements max this is cheap enough
 * that the extra bookkeeping isn't worth it. Every sample is pushed regardless of whether
 * it was flagged, so a persistent regime shift becomes the new normal after
 * ANOMALY_WINDOW_SIZE samples rather than flagging forever. */
export function pushSample(window, value) {
  const next = [...window, value];
  return next.length > ANOMALY_WINDOW_SIZE ? next.slice(next.length - ANOMALY_WINDOW_SIZE) : next;
}

/**
 * Which `readings` rows are even eligible for anomaly detection this tick: online, numeric
 * `power_w`, and belonging to a device in `meteredIds` (pass `shared/registry.mjs`'s
 * `METERED` list — the 11 devices with real metering — reused, not duplicated). Offline
 * rows are excluded for the same reason `shared/buildLatest.mjs`'s aggregates already
 * exclude them: a stale cached value must never look like a fresh anomalous one.
 */
export function selectAnomalyCandidates(readings, meteredIds) {
  return readings.filter(
    (r) => meteredIds.has(r.device_id) && r.online !== false && typeof r.power_w === 'number',
  );
}
