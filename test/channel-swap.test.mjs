import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findChannelSwaps, combinedPower } from '../shared/channelSwap.mjs';

const s = (ts, a, b) => ({ ts, a, b });

test('detects the observed 2026-08-25 event', () => {
  // The real one: co 42 -> 1289 while lo 1285 -> 41, in the same sample.
  const swaps = findChannelSwaps([s('t1', 42, 1285), s('t2', 1289, 41)]);
  assert.equal(swaps.length, 1);
  assert.equal(swaps[0].ts, 't2');
});

test('ignores two similar channels trading places, which they do constantly', () => {
  // 43 W and 52 W swapping order is two small loads drifting, not a channel remap. Firing on
  // this would bury the real event in noise.
  assert.deepEqual(findChannelSwaps([s('t1', 43, 52), s('t2', 52, 43)]), []);
});

test('ignores an ordinary load change, however large', () => {
  // Both rising is a compressor starting, not a swap.
  assert.deepEqual(findChannelSwaps([s('t1', 40, 1200), s('t2', 900, 1400)]), []);
});

test('ignores one channel changing while the other holds', () => {
  assert.deepEqual(findChannelSwaps([s('t1', 40, 1200), s('t2', 40, 300)]), []);
});

test('requires BOTH channels to take the other value, not just one', () => {
  // Only `a` picks up `b`'s reading; `b` keeps its own. That is not a trade.
  assert.deepEqual(findChannelSwaps([s('t1', 40, 1200), s('t2', 1200, 1200)]), []);
});

test('skips samples with a missing reading rather than treating null as zero', () => {
  // A gap is not a measurement. Coercing it would manufacture a 1200 -> 0 "swap".
  assert.deepEqual(findChannelSwaps([s('t1', 40, 1200), s('t2', null, 40)]), []);
  assert.deepEqual(findChannelSwaps([s('t1', 40, 1200), { ts: 't2' }]), []);
});

test('tolerates the small drift a real swap carries — 1285 becomes 1289, not exactly 1285', () => {
  assert.equal(findChannelSwaps([s('t1', 42, 1285), s('t2', 1289, 41)]).length, 1);
  // But not a 20% difference, which is a different load rather than the same one relabelled.
  assert.equal(findChannelSwaps([s('t1', 42, 1285), s('t2', 1600, 41)]).length, 0);
});

test('combinedPower is invariant across a swap, which is why totals stay correct', () => {
  const before = s('t1', 42, 1285);
  const after = s('t2', 1285, 42);
  assert.equal(combinedPower(before), combinedPower(after));
  assert.equal(combinedPower({ a: 1, b: null }), null);
});
