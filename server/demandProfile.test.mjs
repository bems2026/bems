import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize, suggestThreshold } from './demandProfile.mjs';

test('percentile uses nearest rank and never runs off the end', () => {
  const s = [1, 2, 3, 4, 5];
  assert.equal(percentile(s, 0.5), 3);
  assert.equal(percentile(s, 1), 5);
  assert.equal(percentile(s, 0), 1);
  assert.equal(percentile([], 0.5), null);
});

test('summarize ignores nulls and non-numbers rather than coercing them', () => {
  // A null reading is "no data", and averaging it as 0 would drag a limit downward — the
  // same rule format.ts holds on the display side.
  const s = summarize([5, null, 1, undefined, 3, NaN]);
  assert.equal(s.n, 3);
  assert.equal(s.max, 5);
});

test('summarize returns null for a series with nothing usable in it', () => {
  assert.equal(summarize([null, undefined, NaN]), null);
});

test('a threshold sits above the observed peak, not at a percentile of it', () => {
  // A limit anchored inside normal operation sheds load on an ordinary busy afternoon.
  const stats = summarize(Array.from({ length: 600 }, (_, i) => i));
  const { value } = suggestThreshold(stats);
  assert.ok(value > stats.max, 'the limit must exceed the peak the building actually reached');
  assert.ok(value > stats.p99, 'and must exceed p99 by more than rounding');
});

test('refuses to suggest a threshold from too few readings', () => {
  // A number derived from a handful of samples is a guess wearing a decimal point, and this
  // system can act on it by switching off lights.
  const { value, reason } = suggestThreshold(summarize([1, 2, 3]));
  assert.equal(value, null);
  assert.match(reason, /too few/);
});

test('refuses when there are no readings at all', () => {
  assert.equal(suggestThreshold(null).value, null);
});

test('the stated reason carries the peak and the sample size it was drawn from', () => {
  const stats = summarize(Array.from({ length: 600 }, () => 100));
  const { reason } = suggestThreshold(stats);
  assert.match(reason, /100\.00/);
  assert.match(reason, /600 readings/);
});
