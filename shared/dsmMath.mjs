/**
 * Demand-side management maths: is the building over its configured limit right now.
 *
 * Lives in `shared/` because both sides need the identical answer — `src/lib/dsm.ts` for what
 * the operator sees, and `server/shedPlan.mjs` for deciding whether to actually switch load
 * off. Two implementations of "are we over the limit" would eventually disagree, and the one
 * that disagrees silently is the one wired to relays.
 *
 * Pure: no I/O, no clock, no config lookup.
 */

/** The heavier of the two real phases. Blue is never included — it has no CT meter, and
 * `shared/registry.mjs`'s PHASE_MAP.blue is deliberately empty. `null` only when there is no
 * `_totals` reading at all. */
export function maxPhaseNow(totals) {
  if (!totals) return null;
  return Math.max(totals.phase_current?.red ?? 0, totals.phase_current?.yellow ?? 0);
}

export function totalKwNow(totals) {
  if (!totals || totals.total_power_w === null || totals.total_power_w === undefined) return null;
  return totals.total_power_w / 1000;
}

/**
 * Checks the current `_totals` reading against whichever thresholds are actually configured.
 *
 * An unconfigured threshold and a missing reading both resolve to "not breached". A limit that
 * was never set is not a limit of zero, and arming load-shedding off a fabricated 0 would
 * switch the building off the first time it was ever read — the exact failure this codebase's
 * "never fabricate a value" rule exists to prevent.
 *
 * @param {{maxPhaseA: number|null, maxTotalKw: number|null, autoShed?: boolean}} thresholds
 *        `autoShed` is accepted but unread here: callers hold one DsmThresholds object and
 *        pass it whole, and whether to ACT on a breach is a separate decision from whether
 *        one is happening (see server/shedPlan.mjs).
 * @param {object|null} totals  a `_totals` reading
 * @returns {{breached: boolean, reason: string|null}}
 */
export function checkDsmBreach(thresholds, totals) {
  const phaseNow = maxPhaseNow(totals);
  if (thresholds.maxPhaseA !== null && phaseNow !== null && phaseNow > thresholds.maxPhaseA) {
    return { breached: true, reason: `Max phase current ${thresholds.maxPhaseA} A exceeded — reading ${phaseNow.toFixed(1)} A.` };
  }

  const kwNow = totalKwNow(totals);
  if (thresholds.maxTotalKw !== null && kwNow !== null && kwNow > thresholds.maxTotalKw) {
    return { breached: true, reason: `Max total draw ${thresholds.maxTotalKw} kW exceeded — reading ${kwNow.toFixed(2)} kW.` };
  }

  return { breached: false, reason: null };
}
