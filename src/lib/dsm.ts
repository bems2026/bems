import type { ContextMap } from './types';

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

export { maxPhaseNow, totalKwNow, checkDsmBreach } from '@shared/dsmMath.mjs';

export interface DsmBreach {
  breached: boolean;
  reason: string | null;
}
