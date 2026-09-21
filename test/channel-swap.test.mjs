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

// --- RM-122: the hand-off shape the 2026-09-19 episode actually had ------------------------------

test('detects a hand-off: one channel drops to nothing as the other takes its value', () => {
  // 2026-09-19 08:11 — C.O (a) went from 40.2 W to exactly 0 while L.O (b) went 278.9 -> 37.4:
  // a clean trade of neither, but a's load reappearing on b with a at zero. `check:meters`
  // reported "no interchange" for that whole day.
  const swaps = findChannelSwaps([
    { ts: 't0', a: 40.2, b: 278.9 },
    { ts: 't1', a: 0, b: 37.4 },
  ]);
  assert.equal(swaps.length, 1);
  assert.equal(swaps[0].kind, 'handoff');
  assert.equal(swaps[0].ts, 't1');
});

test('a hand-off in the other direction is detected too', () => {
  // 17:21 the same day — L.O dropped to 0 as C.O picked up the ~40 W L.O had been carrying.
  const swaps = findChannelSwaps([
    { ts: 't0', a: 0, b: 37.4 },
    { ts: 't1', a: 40.6, b: 0 },
  ]);
  assert.equal(swaps.length, 1);
  assert.equal(swaps[0].kind, 'handoff');
});

test('a channel simply switching off is not a hand-off — the other must have taken its value', () => {
  assert.deepEqual(findChannelSwaps([{ ts: 't0', a: 40.2, b: 800 }, { ts: 't1', a: 0, b: 800 }]), []);
  assert.deepEqual(findChannelSwaps([{ ts: 't0', a: 40.2, b: 800 }, { ts: 't1', a: 0, b: 300 }]), []);
});

test('a clean trade is still reported as a trade', () => {
  const swaps = findChannelSwaps([{ ts: 't0', a: 42, b: 1285 }, { ts: 't1', a: 1289, b: 41 }]);
  assert.equal(swaps[0].kind, 'trade');
});
