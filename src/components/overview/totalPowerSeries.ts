import type { HistoryPoint } from '@/lib/types';

/**
 * Sums several devices' history series into one total-power series, for Overview's
 * "Edge buffer · 24 h" chart — there's no single `/api/readings/history` endpoint for
 * building-wide totals, only per-device, so this is derived client-side from the 4 branch
 * meters (the same devices `_totals.total_power_w` itself sums server-side in
 * `shared/buildLatest.mjs`, so this stays consistent with the current-value totals shown
 * elsewhere on the page).
 *
 * Safe to sum by index rather than matching timestamps: the mock's `sampleHistory()` (and
 * the equivalent Node-RED cron) populates every metered device's ring buffer from the same
 * tick, so same-index points across devices share a timestamp. Right-aligned to the
 * shortest series as a defensive measure — a device fetched slightly later than the others
 * could have one extra point — rather than assuming exact equality and throwing on it.
 *
 * A SUM IS ONLY AS HONEST AS ITS LEAST HONEST TERM. If any contributor's point is marked
 * `online: false`, the summed point is marked offline too, so `pointValue` suppresses it and
 * the chart shows a gap. This was the one path by which a frozen reading could still reach a
 * chart after FI-010/EX-102: those made `pointValue` return `undefined` for an offline point,
 * and this function never went through `pointValue` — it added `power_w` straight.
 *
 * Measured on the Pi 2026-09-01: `co5` had 60 consecutive points, all `online: false`, all
 * carrying a frozen 513.9 W from before it left the network, while the whole building was
 * drawing ~35 W. Analytics' "Metered vs total" was plotting an outlet line about fifteen times
 * the building's real demand.
 *
 * Neither alternative is available. Summing the frozen value fabricates a reading; substituting
 * zero fabricates a different one — it asserts the circuit drew nothing, when the truth is that
 * nobody knows. A dip in a summed line is indistinguishable from the building actually using
 * less, which is the misreading that costs something: an energy saving that was a disconnection.
 */
export function sumHistories(seriesList: HistoryPoint[][]): HistoryPoint[] {
  const nonEmpty = seriesList.filter((s) => s.length > 0);
  if (nonEmpty.length === 0) return [];

  const length = Math.min(...nonEmpty.map((s) => s.length));
  if (length === 0) return [];

  const aligned = nonEmpty.map((s) => s.slice(s.length - length));
  const out: HistoryPoint[] = [];
  for (let i = 0; i < length; i++) {
    const power_w = aligned.reduce((sum, s) => sum + s[i].power_w, 0);
    // `=== false`, not falsy. A point with no `online` field predates EX-102 and its state is
    // genuinely unknown rather than false — suppressing those would erase real history in the
    // name of honesty, which is its own kind of lie. Same rule `pointValue` already applies.
    const anyOffline = aligned.some((s) => s[i].online === false);
    const anyKnown = aligned.some((s) => s[i].online !== undefined);
    out.push({
      ts: aligned[0][i].ts,
      power_w,
      // Left absent when nothing said either way, so an all-legacy buffer sums exactly as before.
      ...(anyKnown ? { online: !anyOffline } : {}),
    });
  }
  return out;
}
