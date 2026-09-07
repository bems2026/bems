/**
 * Anomaly detection requires the two methods to AGREE — RM-004.
 *
 * THE FAULT, measured on the live database 2026-09-07 over the preceding four days:
 *
 *     2,833 anomalies recorded        by method: iqr 2,152 · both 667 · zscore 14
 *     1,675 of them (59.1%) had an IQR fence collapsed to the +-3 W floor
 *     median |z| across every flagged row: 2.37, against a threshold of 3.5
 *
 * The median thing this system called an anomaly was not anomalous by z-score at all, and
 * three quarters of them were flagged by the IQR check alone.
 *
 * WHY THE IQR CHECK COLLAPSES, narrowed down by running the real numbers rather than reasoning
 * about them. A switched outlet spends most of a 20-sample window at exactly 0 W, so `q1 = q3 = 0`
 * and the window's own IQR is 0. `ANOMALY_MIN_IQR_W` substitutes 1 W and the Tukey fence becomes
 * `0 - 3x1` to `0 + 3x1` — plus or minus **three watts**.
 *
 * But that alone does not produce an `iqr`-only flag, and assuming it did was wrong: on an
 * ALL-zero window the stddev floor makes z = 74 as well, so both checks fire and the sample is
 * recorded either way. The false positive lives in a narrow band one sample wide:
 *
 *     window                          z       fence            method
 *     ten zeros                       74.00   [-3.0, 3.0]      both     <- kept
 *     nine zeros + one 74              3.00   [-3.0, 3.0]      iqr      <- the false positive
 *     seven zeros + three 74s          1.53   [-166.5, 222.0]  none
 *
 * One prior "on" sample lifts the stddev enough to pull z under 3.5, while two zeros still sit at
 * both quartiles so the fence stays at three watts. That is the shape that produced 2,152 rows.
 * The noise floor was written to stop sub-watt jitter on a flat window; on a bimodal one it turns
 * the second sample of every switch-on into an alarm.
 *
 * RM-004 asked for a false-positive re-check once a week of continuous telemetry existed. This
 * is that re-check, and the answer is that the OR was wrong. Requiring agreement takes 2,833 to
 * 667 on the measured window — 76.5% fewer — while leaving every case the noise floor was built
 * to catch, because a real step change on a flat window flags on both counts at once.
 *
 *     node --test server/anomalyAgreement.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectAnomaly, ANOMALY_MIN_SAMPLES, ANOMALY_MIN_IQR_W, ANOMALY_IQR_MULTIPLIER,
} from './anomalyStats.mjs';

/** A window of `n` identical samples. */
const flat = (value, n = ANOMALY_MIN_SAMPLES) => Array.from({ length: n }, () => value);

/**
 * The window that actually breaks: a socket that has just been switched on, so one "on" sample
 * sits in an otherwise idle history. Measured z = 3.00 against a 3.5 threshold, with the fence
 * still collapsed to +-3 W. See the header table.
 */
const SWITCH_ON = [0, 0, 0, 0, 0, 0, 0, 0, 0, 74];

// ---------------------------------------------------------------------------
// The measured false positive.
// ---------------------------------------------------------------------------

test('a switched outlet turning on is no longer an anomaly', () => {
  // co6 and co5 alone produced 1,836 of the 2,833. The fence is +-3 W while the socket is off,
  // and the SECOND "on" sample lands with z already pulled under threshold by the first — so
  // the IQR check flags a socket being used, which is not a fault.
  const detection = detectAnomaly(SWITCH_ON, 74);
  assert.ok(Math.abs(detection.zScore) < 3.5, 'z-score correctly says this is not remarkable');
  assert.equal(detection.method, 'iqr', 'the IQR check still fires, and is still recorded');
  assert.equal(detection.isAnomaly, false, 'but one method alone no longer records an anomaly');
});

test('the fence really does collapse to +-3 W — this is the mechanism, measured', () => {
  const detection = detectAnomaly(SWITCH_ON, 74);
  assert.equal(detection.iqrLower, -ANOMALY_IQR_MULTIPLIER * ANOMALY_MIN_IQR_W);
  assert.equal(detection.iqrUpper, ANOMALY_IQR_MULTIPLIER * ANOMALY_MIN_IQR_W);
  assert.equal(detection.iqrUpper - detection.iqrLower, 6);
});

test('the false positive is the switch-on shape at any wattage, not one lucky fixture', () => {
  // The median flagged row had |z| = 2.37 against a 3.5 threshold. Those are the 2,152. co6 runs
  // near 26 W, co5 near 74, co1 near 105 — the band is a property of the shape, not the load.
  for (const watts of [26, 74, 105, 431]) {
    const detection = detectAnomaly([0, 0, 0, 0, 0, 0, 0, 0, 0, watts], watts);
    assert.ok(Math.abs(detection.zScore) < 3.5, `${watts} W: z was ${detection.zScore}`);
    assert.equal(detection.method, 'iqr', `${watts} W`);
    assert.equal(detection.isAnomaly, false, `${watts} W`);
  }
});

// ---------------------------------------------------------------------------
// What must still be caught. The docblock's own justification for the noise floor was the
// stuck-relay case, and it survives — because a real jump trips both checks at once.
// ---------------------------------------------------------------------------

test('a large jump on a flat baseline IS still flagged — both checks agree on it', () => {
  // The case ANOMALY_MIN_STDDEV_W exists for. 500 W against a rock-steady 74 W window is
  // z = 426 and far outside the fence, so agreement costs nothing here.
  const detection = detectAnomaly(flat(74), 500);
  assert.equal(detection.method, 'both');
  assert.equal(detection.isAnomaly, true);
});

test('a genuine step change on a device with real variance is still flagged', () => {
  const window = [740, 752, 738, 761, 745, 750, 742, 758, 747, 751];
  const detection = detectAnomaly(window, 2400);
  assert.equal(detection.method, 'both');
  assert.equal(detection.isAnomaly, true);
});

test('a collapse to zero on a busy circuit is still flagged', () => {
  // The other direction, and the one that matters for a tripped breaker.
  const window = [740, 752, 738, 761, 745, 750, 742, 758, 747, 751];
  const detection = detectAnomaly(window, 0);
  assert.equal(detection.isAnomaly, true);
});

test('a small wobble on a flat baseline is still not flagged', () => {
  const detection = detectAnomaly(flat(74), 74.5);
  assert.equal(detection.method, 'none');
  assert.equal(detection.isAnomaly, false);
});

// ---------------------------------------------------------------------------
// What agreement gives up, stated rather than hidden.
// ---------------------------------------------------------------------------

test('a z-only outlier is no longer recorded, and the method column still says so', () => {
  // THIS IS WHAT THE CHANGE GIVES UP — 14 rows of 2,833 over the measured window, and it should
  // be stated rather than buried. A tight window with a modest excursion: 47 W against a steady
  // 41 W circuit is 4.18 sigma, but Tukey's "far out" fence at multiplier 3.0 reaches to 48 and
  // contains it. Under the old OR this was recorded; now it is not.
  const detection = detectAnomaly([40, 42, 41, 43, 40, 44, 41, 42, 43, 41], 47);
  assert.ok(Math.abs(detection.zScore) > 3.5, 'the z-score genuinely fires');
  assert.ok(detection.iqrLower < 47 && 47 < detection.iqrUpper, 'the fence genuinely contains it');
  assert.equal(detection.method, 'zscore');
  assert.equal(detection.isAnomaly, false);
});

test('the method column is still populated when nothing is recorded', () => {
  // The column is what makes the change verifiable afterwards: every row written from now on
  // reads `both`, and a run of `iqr` rows would mean this was reverted.
  for (const [window, value, expected] of [
    [SWITCH_ON, 74, 'iqr'],
    [flat(74), 500, 'both'],
    [flat(74), 74.5, 'none'],
  ]) {
    assert.equal(detectAnomaly(window, value).method, expected);
  }
});

test('an untrusted window still returns null rather than a verdict', () => {
  assert.equal(detectAnomaly(flat(0, ANOMALY_MIN_SAMPLES - 1), 500), null);
});

test('isAnomaly is exactly "method is both"', () => {
  // Stated as an invariant so the two cannot drift apart — a caller that filtered on `method`
  // and one that filtered on `isAnomaly` must never disagree about the same sample.
  const cases = [
    [SWITCH_ON, 74], [flat(0), 74], [flat(74), 500], [flat(74), 74.5],
    [[40, 42, 41, 43, 40, 44, 41, 42, 43, 41], 48],
    [[740, 752, 738, 761, 745, 750, 742, 758, 747, 751], 2400],
    [[740, 752, 738, 761, 745, 750, 742, 758, 747, 751], 0],
  ];
  for (const [window, value] of cases) {
    const d = detectAnomaly(window, value);
    assert.equal(d.isAnomaly, d.method === 'both', `window ${window[0]}... value ${value}`);
  }
});
