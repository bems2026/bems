/**
 *     node --test server/anomalyStats.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBaseline, detectAnomaly, pushSample, selectAnomalyCandidates, ANOMALY_WINDOW_SIZE,
} from './anomalyStats.mjs';

test('computeBaseline returns null before ANOMALY_MIN_SAMPLES samples are collected', () => {
  assert.equal(computeBaseline([1, 2, 3, 4, 5, 6, 7, 8, 9]), null); // 9 < 10
});

test('computeBaseline computes mean/stddev/quartiles from a trusted window', () => {
  const baseline = computeBaseline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(baseline.mean, 5.5);
  assert.equal(Math.round(baseline.stddev * 1000) / 1000, 2.872);
  assert.equal(baseline.q1, 3.25);
  assert.equal(baseline.q3, 7.75);
  assert.equal(baseline.iqr, 4.5);
  assert.equal(baseline.sampleCount, 10);
});

test('detectAnomaly returns null (not a false "no anomaly") when the window is not yet trusted', () => {
  assert.equal(detectAnomaly([1, 2, 3], 100), null);
});

test('detectAnomaly flags a value far outside a window with real variance, via both checks', () => {
  const window = [100, 102, 98, 101, 99, 100, 103, 97, 101, 99];
  const result = detectAnomaly(window, 150);
  assert.equal(result.isAnomaly, true);
  assert.equal(result.method, 'both');
  assert.equal(Math.round(result.zScore * 100) / 100, 28.87);
  assert.equal(result.baselineMean, 100);
  assert.equal(Math.round(result.baselineStddev * 1000) / 1000, 1.732);
  assert.equal(result.iqrLower, 93);
  assert.equal(result.iqrUpper, 107);
  assert.equal(result.sampleCount, 10);
});

test('detectAnomaly does not flag a value inside the normal range', () => {
  const window = [100, 102, 98, 101, 99, 100, 103, 97, 101, 99];
  const result = detectAnomaly(window, 101);
  assert.equal(result.isAnomaly, false);
  assert.equal(result.method, 'none');
});

test('a small wobble on a perfectly flat baseline is NOT flagged — the noise floor guards near-zero variance', () => {
  const window = new Array(10).fill(50);
  const result = detectAnomaly(window, 52);
  assert.equal(result.isAnomaly, false);
  assert.equal(result.zScore, 2); // (52-50) / floor(1), not divided by the real stddev of 0
});

test('a large jump on a perfectly flat baseline IS still flagged — the floor is a noise guard, not a blind spot', () => {
  const window = new Array(10).fill(50);
  const result = detectAnomaly(window, 200);
  assert.equal(result.isAnomaly, true);
  assert.equal(result.method, 'both');
});

test('pushSample caps the window at ANOMALY_WINDOW_SIZE, dropping the oldest sample first', () => {
  let window = [];
  for (let i = 1; i <= ANOMALY_WINDOW_SIZE + 5; i++) window = pushSample(window, i);
  assert.equal(window.length, ANOMALY_WINDOW_SIZE);
  assert.deepEqual(window, Array.from({ length: ANOMALY_WINDOW_SIZE }, (_, i) => i + 6));
});

test('selectAnomalyCandidates keeps only online, numeric-power_w readings for metered devices', () => {
  const metered = new Set(['co1', 'mtr_lo_red']);
  const readings = [
    { device_id: 'co1', ts: 't', power_w: 120, online: true },
    { device_id: 'co1', ts: 't', power_w: 120, online: false }, // offline — excluded
    { device_id: 'l1', ts: 't', power_w: null, online: true }, // unmetered switch — excluded
    { device_id: 'mtr_lo_red', ts: 't', power_w: null, online: true }, // metered, no reading yet — excluded
    { device_id: 'mtr_lo_red', ts: 't', power_w: 45.2, online: true }, // kept
  ];
  const kept = selectAnomalyCandidates(readings, metered);
  assert.deepEqual(kept.map((r) => `${r.device_id}:${r.power_w}`), ['co1:120', 'mtr_lo_red:45.2']);
});
