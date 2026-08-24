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

/**
 * How old a reading may get before its numbers stop being treated as measurements at all.
 *
 * Deliberately much larger than the 30s staleness window, because the two answer different
 * questions. Staleness asks "should this be dimmed?" — a late reading still describes the
 * building. Expiry asks "is this still a measurement, or a memory?"
 *
 * Five minutes is five missed bridge samples (`TIMING.HISTORY_SAMPLE_MS` is 60s), which is
 * far beyond ordinary lateness and well short of the 15 minutes that made this visible.
 *
 * NOT added to `TIMING`: that table mirrors `shared/registry.mjs` exactly and
 * `timing.test.ts` enforces the equality. This threshold is the frontend's own presentation
 * rule, and the bridge has no opinion about it.
 */
export const EXPIRED_AFTER_MS = 300_000;

/**
 * Whether a reading is too old for its values to be shown as figures.
 *
 * Found on site 2026-08-24: the Outlet tab's parser refreshes `<ctx>_last_time` when the
 * device *connects*, without touching the measurements. An outlet that reconnects but never
 * reports therefore presents a fresh-looking timestamp over values captured days earlier —
 * `co1` was serving a four-day-old 235.9 V while the device itself read 224.9 V. `online`
 * was `true` throughout, so nothing downstream had any reason to doubt it.
 *
 * Note what this does NOT key on: `online === false`. A device that went offline one second
 * after reporting still has a perfectly real last reading, and blanking it would throw away
 * the most useful number on the screen at exactly the moment someone needs it. Age is the
 * only thing that makes a measurement stop being one.
 */
export function isReadingExpired(reading: Reading | Totals | null | undefined, nowMs: number = Date.now()): boolean {
  if (!reading) return true;
  const ts = Date.parse(reading.ts);
  if (Number.isNaN(ts)) return true;
  return nowMs - ts > EXPIRED_AFTER_MS;
}

/**
 * A reading's value if it is still a measurement, `undefined` once it has expired — so it
 * flows into `format.ts`'s formatters and renders `—` by the same rule that already governs
 * a value that was never there.
 *
 * This is `format.ts`'s "missing renders `—`, never 0" discipline extended one step: a value
 * whose *age* has made it meaningless is as missing as one that is absent. The zero case is
 * the one that matters most — a stale `0 W` is precisely the reading that makes a device
 * that stopped reporting look like a device sitting idle.
 */
export function measured<T>(
  value: T,
  reading: Reading | Totals | null | undefined,
  nowMs: number = Date.now(),
): T | undefined {
  return isReadingExpired(reading, nowMs) ? undefined : value;
}
