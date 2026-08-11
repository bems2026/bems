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
    out.push({ ts: aligned[0][i].ts, power_w });
  }
  return out;
}
