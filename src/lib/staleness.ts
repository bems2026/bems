import { isStale } from './bridgeClient';
import type { Reading, Totals } from './types';

/**
 * A device (or the `_totals` row) is stale for two independent reasons, either of which
 * dims it: the bridge explicitly reports it unhealthy (`online: false`), or its own `ts`
 * hasn't advanced within the budget the bridge sent for it even though the feed still calls
 * it online — an outlet whose `_last_time` context key stopped updating while its `_health`
 * flag lagged behind, for instance. `_totals` has no `online` field, so only the timestamp
 * check applies to it.
 *
 * THE BUDGET IS PER DEVICE, and this used to be one global 30s. That was the bug behind
 * "the outlet keeps flipping between stale and live while Node-RED says it is connected":
 * `node-red-bridge/outletPollPlan.mjs` polls an outlet every 60s and nothing else asks it
 * anything, so a perfectly healthy outlet's reading reaches ~60s of age once a minute, every
 * minute. Measured on the Pi 2026-09-01 over 240s: the four live outlets and `mtr_lo_red` all
 * peaked at 59.9s. Half of every minute, every one of them was called stale.
 *
 * It is worth being precise about why that mattered, because "a badge flickers" undersells it.
 * This function has fifteen call sites. The same sawtooth flipped the Devices table between
 * LIVE and STALE, raised and cleared a COMM FAULT in the alerts bell once a minute per outlet
 * (which trains an operator to ignore the bell), desaturated devices in the 3D scene — and
 * `commandStore.reconcile` gates its success path on this function, so a command that had
 * genuinely switched a relay was reported as "the device did not report the new state" roughly
 * half the time.
 *
 * `online: false` still wins over any budget. That is the bridge saying it has no connection
 * to the device at all, and a longer budget must never launder a refusal into freshness.
 */
export function isReadingStale(reading: Reading | Totals | null | undefined, nowMs: number = Date.now()): boolean {
  if (!reading) return true;
  if ('online' in reading && reading.online === false) return true;
  // `_totals` carries no budget, and neither does a bridge predating the field — both fall
  // back to `isStale`'s own 30s default, which is what they were measured against before.
  const budget = 'stale_after_ms' in reading ? reading.stale_after_ms : undefined;
  return isStale(Date.parse(reading.ts), nowMs, budget);
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
 * An offline reading expires immediately, whatever its timestamp says. This originally did the
 * opposite — age was the only test, on the reasoning that a device which dropped one second
 * after reporting still has a real last value worth showing. That was wrong for a reason the
 * first version missed: `shared/buildLatest.mjs` stamps `ts = now` and only overrides it when
 * the device reports its own time, so **an offline device's timestamp is synthesized**. Its age
 * is not evidence of anything, and the age rule can therefore never fire for it.
 *
 * Observed 2026-08-24: `co5` rendered `OFFLINE` beside `230.4 V / 2.23 A / 514 W` — values of
 * genuinely unknown age, presented as current, next to a badge saying the device was
 * unreachable. The badge is the fact; the figures were not.
 */
export function isReadingExpired(reading: Reading | Totals | null | undefined, nowMs: number = Date.now()): boolean {
  if (!reading) return true;
  // `Totals` has no `online` field, so this only narrows for a device reading.
  if ('online' in reading && reading.online === false) return true;
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
