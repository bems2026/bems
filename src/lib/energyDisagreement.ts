/**
 * RM-054 — when the two ways this building measures its own consumption stop agreeing.
 *
 * WHAT IS COMPARED, AND IT CHANGED AT RM-057. The branch figures are each meter's own cumulative
 * register, accumulated by the bridge (`node-red-bridge/energyAccumulator.mjs`). They used to be
 * compared against the building's headline counter — but since RM-057 that headline IS their sum,
 * so the comparison would be a number against itself. The independent figure is
 * `_totals.energy_kwh_*_integrated`: the legacy flow's two-second integration of the same
 * circuits, kept in the payload for exactly this purpose. Nothing compared them at all before
 * RM-054, which is how RM-053 put 99.546 kWh of branches next to a building week of 18.4 and
 * rendered both without comment for a day.
 *
 * ONE DIRECTION, AND RM-057 WEAKENED THE ARGUMENT FOR THAT — recorded here rather than quietly
 * left as it was. The original reasoning was that the branches are a SUBSET of the building's
 * load, so exceeding it is impossible and falling short is ordinary. Both figures now describe
 * the same four circuits, so that asymmetry is gone and a shortfall means something too: it is
 * precisely RM-056's signature, where the day-baseline tracker absorbed a third of one branch's
 * real consumption and the building-level shortfall was only 6.7%. **This function would not have
 * caught it, and does not catch it now.** The excess direction stays guarded because it is the
 * one with a measured tolerance; the shortfall direction needs a margin sized from more than a
 * single fault, and inventing one here would be the round number this file's thresholds exist to
 * avoid. ROADMAP RM-058 carries the measurements that would size it.
 *
 * In `lib/` rather than beside either card because both use it — RM-055. Its own tests live in
 * `components/analytics/EnergySection.test.tsx`, next to the rendering they were written against.
 */

/**
 * HOW FAR ABOVE THE BUILDING TOTAL THE BRANCHES MAY SUM BEFORE THE PAGE SAYS SOMETHING.
 *
 * Two bars, and BOTH must be cleared. A ratio on its own is meaningless when both figures are
 * near zero, and an absolute figure on its own would scale wrongly between a day and a month.
 *
 * WHY 25 %. Measured agreement between these two derivations, every figure from this building:
 *
 * | when | branches | building | branches/building |
 * |---|---|---|---|
 * | the week straight after RM-053's repair | 18.646 | 18.588 | **+0.31 %** |
 * | month, live 2026-09-08 13:32 | 61.907 | 61.957 | −0.08 % |
 * | week, same sample | 20.270 | 20.552 | −1.37 % |
 * | today, same sample | 4.746 | 5.086 | −6.68 % |
 * | today, the four meters' own 24 h power history integrated independently | 5.135 | 5.086 | +0.97 % |
 * | `mtr_co_yellow`'s whole day, 2026-09-02 (ROADMAP RM-053) | 8.057 | 8.0437 | +0.16 % |
 *
 * So the largest EXCESS ever measured healthy is about 1 %, and the largest disagreement in
 * either direction is 6.7 %. 25 % is ~3.7x that, and it is not merely a multiple of the noise:
 * the legacy two-second integrator behind the building counter accrues only while a meter reads
 * healthy AND while Node-RED is running, whereas each meter's own register counts through both.
 * Every outage therefore lands in the branch sum and in nothing else. Over the 24 h before this
 * was written the four meters read `online: false` for 1.0–1.5 % of samples, but outages here
 * are bursty and maintenance stops Node-RED outright — RM-053's own repair did. 25 % of a day is
 * six hours of the building counter recording nothing, which is longer than any stop this
 * project has performed, and `today` is the period where that share bites hardest.
 *
 * WHY 0.5 kWh. Minutes after local midnight both figures are a few watt-hours and any lag
 * between them is a large multiple — a ratio test alone would shout every night. The building
 * drew 799.5 W at the sample above and averaged 377 W across that day, so 0.5 kWh is upwards of
 * an hour of the whole building's load: larger than any lag or rounding between the two
 * derivations has ever produced (the biggest absolute gap in the table is 0.34 kWh, and it is in
 * the safe direction), and under 1 % of the 100 kWh per branch per day this site declares as
 * physically possible, so a branch drifting toward its own declared ceiling cannot hide beneath
 * it.
 *
 * WHAT THIS STILL CATCHES. The fault it was written for rendered 99.546 kWh of branches against
 * a building week of 18.4 — 5.41x, an excess of 81.1 kWh. That is 17x this ratio bar and 162x
 * this absolute one, so a fault an order of magnitude smaller than RM-053's still trips it.
 */
export const DISAGREEMENT_MARGIN = 0.25;
export const DISAGREEMENT_FLOOR_KWH = 0.5;

export interface EnergyDisagreement {
  branchSum: number;
  total: number;
  excessKwh: number;
  /** `null` when the building counter is exactly 0 — a real contradiction, but not one with a
   * multiple to quote. */
  ratio: number | null;
}

/**
 * The branches summing to MORE than the building they are part of, by more than the two
 * derivations can explain.
 *
 * ONE DIRECTION ONLY. The integration misses time by construction — it accrues only while a
 * meter reads healthy and while Node-RED is running, whereas the registers count through both —
 * so the registers running AHEAD of it is expected and tolerated up to a measured margin.
 * RM-053's `weekBase` of 78.977 kWh against a real 1.5 showed up on this side. The other side is
 * discussed in the file header: it is meaningful since RM-057 and deliberately not guarded yet.
 *
 * A MISSING TOTAL IS NOT A ZERO ONE. `null` or absent means the building's integration never
 * counted that period — or that the bridge predates RM-057 and sends no independent figure at
 * all — so there is nothing to compare against and this returns nothing rather than treating the
 * absence as the smaller side of a comparison. An honest 0, on the other hand, IS a comparison,
 * and a week of branch consumption standing against it is exactly the kind of contradiction
 * worth surfacing.
 */
export function energyDisagreement(branchSum: number, total: number | null | undefined): EnergyDisagreement | null {
  if (typeof total !== 'number' || !Number.isFinite(total)) return null;
  // ONE SIGNED QUANTITY, and both bars are read off it — which is what makes the direction a
  // property of this function rather than a coincidence of two separate comparisons. Written as
  // `branchSum > total * (1 + MARGIN)` it is the same arithmetic, but a `Math.abs` slipped into
  // it would then be invisible to every test: no shortfall can clear a comparison against
  // `branchSum` itself, so nothing would fail. Here it fails one.
  const excessKwh = branchSum - total;
  if (excessKwh <= DISAGREEMENT_FLOOR_KWH) return null;
  if (excessKwh <= total * DISAGREEMENT_MARGIN) return null;
  return { branchSum, total, excessKwh, ratio: total > 0 ? branchSum / total : null };
}

/**
 * HOW FAR BELOW ITS OWN INTEGRATION A BRANCH MAY READ BEFORE THE PAGE NAMES IT — RM-058.
 *
 * THIS IS THE DIRECTION RM-057 MADE MEANINGFUL. While the building total came from a separate
 * source, the branches were a subset of it and reading low was ordinary. Both figures now
 * describe the same circuits, so a branch reading below its own two-second power integration is
 * a claim that energy was measured and then lost — which is exactly what RM-056 was doing.
 *
 * AND IT IS CHECKED PER BRANCH BECAUSE THAT IS WHERE IT IS AUDIBLE. RM-056 took 38 % of
 * `mtr_arec_acu` over one window and 11.4 % across the day, while the same fault at the building
 * was 6.7 % — under any threshold worth setting, which is why a building-wide check missed it for
 * hours and an operator's eye found it instead. Six times louder at the branch.
 *
 * WHY 5 %. Measured on this building at 15:35 on 2026-09-08, after RM-056's fix and RM-056b's
 * repair — each branch against its own `<ctx>_energy`:
 *
 * | branch | register-derived | its own integration | difference |
 * |---|---|---|---|
 * | `mtr_co_yellow` | 2.228 | 2.256 | **−1.26 %** |
 * | `mtr_lo_red` | 0.167 | 0.165 | +1.36 % |
 * | `mtr_arec_acu` | 3.958 | 3.908 | +1.28 % |
 * | `mtr_lo_yellow` | 0.302 | 0.301 | +0.29 % |
 *
 * So healthy sits inside ±1.4 %, and the largest healthy SHORTFALL is 1.26 %. The same meter
 * under RM-056 read 2.652 against 2.993 — **11.4 % short**. 5 % is ~4x the healthy shortfall and
 * less than half the fault, which is the widest gap the two measurements leave. Note the
 * asymmetry against the 25 % on the excess side: that side has outages legitimately pushing it
 * out, and this one does not.
 *
 * WHY 0.15 kWh, and why it is not the building's 0.5. A branch is a fraction of a building:
 * `mtr_lo_red` consumed 0.167 kWh across that whole day, so a 0.5 kWh floor would switch this
 * check off for three of the four branches. The register also trails the integration by up to one
 * reporting lump — ~0.015 kWh on the busiest branch here — and that lag is bounded in kWh, not in
 * percent, so early in the day it is a large fraction of a small number. 0.15 kWh is 10x that lag
 * and 3x the largest difference measured above.
 *
 * WHAT IT HONESTLY CANNOT DO. It only guards branches drawing more than about 3 kWh a day, since
 * below that the floor binds before the ratio does. On a branch consuming 0.17 kWh in a day no
 * proportional test can separate a fault from lump lag, and firing nightly on the small branches
 * would teach the operator to ignore it. RM-056 bit the BIGGEST branch — the fault scaled with
 * lump size — so this guards where that class of fault lives.
 *
 * TODAY ONLY. `energy_kwh_today_integrated` exists per branch because the legacy engine keeps a
 * per-meter daily figure; it keeps no per-meter week or month, so there is nothing to compare a
 * longer period against and this is not offered for one.
 */
export const BRANCH_SHORTFALL_MARGIN = 0.05;
export const BRANCH_SHORTFALL_FLOOR_KWH = 0.15;

export interface BranchShortfall {
  id: string;
  name: string;
  /** What the page is showing for this branch — its own register, less the day's baseline. */
  reported: number;
  /** The same meter's power, integrated by the building's own flow over the same day. */
  integrated: number;
  missingKwh: number;
  /** The share of its own integration this branch is not reporting, 0..1. */
  fraction: number;
}

/**
 * The branches reading materially below their own power integration, worst first.
 *
 * ONE DIRECTION, the opposite of `energyDisagreement`'s. A branch reading ABOVE its integration
 * is expected — the integrator accrues only while the meter reads healthy and while Node-RED is
 * running, so every outage puts the register ahead — and that side is watched by the building-wide
 * check with a margin sized for it.
 *
 * A branch with no integrated figure is SKIPPED, not assumed: an outlet has no cumulative
 * register to disagree with, and a bridge older than RM-058 sends the field for nobody. An
 * integration of zero is skipped too — nothing can be short of nothing, and the fraction would be
 * a division by zero the page would then try to render.
 */
export function branchShortfalls(
  branches: { id: string; name: string; kwh: number; integrated?: number | null }[],
  period: 'today' | 'week' | 'month' = 'today',
): BranchShortfall[] {
  // TODAY ONLY, AND THE RULE LIVES HERE RATHER THAN AT THE CALL SITE — deliberately, because a
  // caller-side `period === 'today' ? … : undefined` was unobservable: a week register is always
  // at least today's, so comparing it against today's integration could never report a shortfall
  // and neutering the guard failed no test. A rule no test can reach is a rule the suite is not
  // holding. Here a direct call with 'week' is checkable, and it will matter the moment a
  // per-branch week integration exists to compare against.
  if (period !== 'today') return [];
  const found: BranchShortfall[] = [];
  for (const b of branches) {
    const integrated = b.integrated;
    if (typeof integrated !== 'number' || !Number.isFinite(integrated) || integrated <= 0) continue;
    // ONE SIGNED QUANTITY, and both bars read off it — the same shape as `energyDisagreement`,
    // and for the same reason: written as two separate comparisons against `kwh`, the direction
    // would be a coincidence of both rather than a property of this function, and an `abs`
    // slipped into it would fail no test.
    const missingKwh = integrated - b.kwh;
    if (missingKwh <= BRANCH_SHORTFALL_FLOOR_KWH) continue;
    if (missingKwh <= integrated * BRANCH_SHORTFALL_MARGIN) continue;
    found.push({ id: b.id, name: b.name, reported: b.kwh, integrated, missingKwh, fraction: missingKwh / integrated });
  }
  return found.sort((a, b) => b.missingKwh - a.missingKwh);
}
