import { isStale } from './bridgeClient';
import type { Reading, Totals } from './types';

/**
 * A device (or the `_totals` row) is stale for two independent reasons, either of which
 * dims it: the bridge explicitly reports it unhealthy (`online: false`), or its own `ts`
 * hasn't advanced in 30s even though the feed still calls it online — an outlet whose
 * `_last_time` context key stopped updating while its `_health` flag lagged behind, for
 * instance. `_totals` has no `online` field, so only the timestamp check applies to it.
 */
export function isReadingStale(reading: Reading | Totals | null | undefined, nowMs: number = Date.now()): boolean {
  if (!reading) return true;
  if ('online' in reading && reading.online === false) return true;
  return isStale(Date.parse(reading.ts), nowMs);
}
