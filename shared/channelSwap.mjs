/**
 * Detects the two channels of a shared dual-channel meter trading their readings.
 *
 * WHY: `mtr_co_yellow` and `mtr_lo_yellow` are two logical meters on one physical device,
 * distinguished only by which DPS range each is read from (105-107 vs 115-117). On 2026-08-25
 * they were observed swapping outright — `co` went 42 -> 1289 W in the same sample that `lo`
 * went 1285 -> 41 W. Each took the other's previous value.
 *
 * No part of the software can cause that. The parsers key on DPS number, write to distinct
 * context keys, and the totals engine reads those keys by name; there is no stage where
 * position could substitute for identity. The device itself remapped its channels.
 *
 * 2026-09-21 (RM-122): the episode of 2026-09-19 was a HAND-OFF, not a trade — the channel the
 * device put into `monitor` read exactly 0 while the other took its value — and this detector
 * reported "no interchange" for the whole day. It now reports both shapes, each tagged `kind`.
 * The correcting half now exists elsewhere, on two physical facts the operator confirmed:
 * `shared/channelDemux.mjs`. This file stays what it was: the thing that notices.
 *
 * WHY THIS DETECTS RATHER THAN CORRECTS — the important decision:
 * Correcting a swap means deciding which assignment is the true one, and nothing in the data
 * can settle that. Both circuits are real loads that can legitimately be large or small, so a
 * heuristic ("the ACU is usually the bigger one") would be a guess applied silently to
 * measurements, which is how a plausible number ends up in a report nobody can audit. This
 * project's standing rule is that a missing or doubtful fact is rendered as such, never
 * substituted.
 *
 * WHAT IS AND IS NOT AFFECTED, which is the reassuring half:
 * Building and phase totals sum both channels, and a sum is invariant under a swap — those
 * stay correct throughout. Only per-circuit attribution is corrupted, and only from the swap
 * onward, including the per-meter energy accumulators.
 */

/** Within 3% (or 1 W for small values) — tight enough that an ordinary load change will not match. */
function near(a, b) {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.03);
}

/** Within 10 % (or 2 W for small values) — the hand-off's tolerance; see its comment below. */
function nearLoose(a, b) {
  return Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.1);
}

/**
 * @param samples  [{ ts, a, b }] in time order — `a` and `b` are the two channels' power
 * @param minGap   how far apart the two channels must have been for a trade to be meaningful.
 *                 Two channels reading 42 W and 43 W "trade" constantly and mean nothing by it;
 *                 requiring a real separation is what keeps this from firing on noise.
 */
export function findChannelSwaps(samples, { minGap = 20 } = {}) {
  const swaps = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (![prev.a, prev.b, cur.a, cur.b].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    if (Math.abs(prev.a - prev.b) <= minGap) continue;
    if (near(cur.a, prev.b) && near(cur.b, prev.a)) {
      swaps.push({ ts: cur.ts, kind: 'trade', from: { a: prev.a, b: prev.b }, to: { a: cur.a, b: cur.b } });
      continue;
    }
    // RM-122 — the hand-off. The 2026-09-19 episode never traded cleanly: the channel the device
    // put into `monitor` read exactly 0 while the OTHER channel took the value it had been
    // carrying. A trade check cannot see that, because 0 is near nothing; this looks for one
    // side at zero and the other side holding what the zeroed side last reported. A channel
    // that merely switched off fails the second half, so it is not reported.
    // Matched at 10 %, not the trade's 3 %: a load keeps varying while it changes clamp, and the
    // measured hand-off carried 40.2 W across as 37.4 W. A trade compares two values taken in
    // the same instant; a hand-off compares one value with the next sample's.
    const aHanded = cur.a === 0 && prev.a !== 0 && nearLoose(cur.b, prev.a);
    const bHanded = cur.b === 0 && prev.b !== 0 && nearLoose(cur.a, prev.b);
    if (aHanded || bHanded) {
      swaps.push({ ts: cur.ts, kind: 'handoff', from: { a: prev.a, b: prev.b }, to: { a: cur.a, b: cur.b } });
    }
  }
  return swaps;
}

/**
 * The sum across both channels, which is what building and phase totals use. Exported so a
 * caller can show that the total is unaffected while the split is not — the two facts travel
 * together or the reassurance is unverifiable.
 */
export function combinedPower(sample) {
  if (typeof sample?.a !== 'number' || typeof sample?.b !== 'number') return null;
  return sample.a + sample.b;
}
