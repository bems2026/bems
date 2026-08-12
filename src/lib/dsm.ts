import type { ContextMap, Totals } from './types';

export interface DsmThresholds {
  maxPhaseA: number | null;
  maxTotalKw: number | null;
  autoShed: boolean;
}

function parseNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Reads the 3 real DSM keys `shared/context.mjs` validates out of the flat context map.
 * A key that was never written parses to `null` — "no limit configured" is a different
 * fact from "limit of 0", and only a genuinely configured threshold can ever breach. */
export function readDsmThresholds(context: ContextMap): DsmThresholds {
  return {
    maxPhaseA: parseNum(context['global.dsm.max_phase_a']),
    maxTotalKw: parseNum(context['global.dsm.max_total_kw']),
    autoShed: context['global.dsm.auto_shed'] === 'true',
  };
}

/** The heavier of the two real phases — Blue is never included, it has no meter (see
 * `mainPanelHealth.ts`). `null` only when there is no `_totals` reading at all. */
export function maxPhaseNow(totals: Totals | null): number | null {
  if (!totals) return null;
  return Math.max(totals.phase_current.red ?? 0, totals.phase_current.yellow ?? 0);
}

export function totalKwNow(totals: Totals | null): number | null {
  if (!totals || totals.total_power_w === null) return null;
  return totals.total_power_w / 1000;
}

export interface DsmBreach {
  breached: boolean;
  reason: string | null;
}

/**
 * Checks the real, current `_totals` reading against whichever thresholds are actually
 * configured. No threshold configured, or no `_totals` reading yet, both resolve to "not
 * breached" — a breach indicator arming itself off of an unset limit or a fabricated 0
 * would be exactly the kind of false alarm this app's "never fabricate" rule exists to
 * prevent.
 *
 * No current caller (Overview's banner that used this was removed in the bento-grid
 * revision) — kept because the logic is correct and independently tested, in case a
 * breach indicator returns in a different form.
 */
export function checkDsmBreach(thresholds: DsmThresholds, totals: Totals | null): DsmBreach {
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
