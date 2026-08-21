import type { Device, Reading } from '@/lib/types';
import { shareOfTotal } from '@/lib/format';

export interface OnlineCount {
  online: number;
  total: number;
}

/** Devices actually reporting `online: true` right now, out of the full catalogue. */
export function countOnline(devices: Device[], readings: Record<string, Reading>): OnlineCount {
  let online = 0;
  for (const d of devices) if (readings[d.id]?.online) online++;
  return { online, total: devices.length };
}

/**
 * Today's energy as a fraction of the week's implied daily average (week / 7). A real,
 * derivable comparison, not a fabricated target — a value above 1 means "today is running
 * hotter than the week's average pace," not "you hit some invented goal the bridge never
 * reported." Returns `null` when either input is missing or the average is non-positive,
 * rather than a misleading 0.
 */
export function todayVsWeeklyAveragePace(todayKwh: number | null, weekKwh: number | null): number | null {
  if (todayKwh === null || weekKwh === null) return null;
  const dailyAverage = weekKwh / 7;
  if (dailyAverage <= 0) return null;
  return todayKwh / dailyAverage;
}

export interface PowerBar {
  id: string;
  label: string;
  power_w: number;
}

/**
 * Devices with an actual power reading right now, sorted descending, capped to `limit`.
 * Devices with no `power_w` at all (switches, sensors, an offline meter) are omitted
 * rather than shown as a 0 W bar — "no reading" and "zero watts" stay distinct facts.
 *
 * An offline device is omitted too, even when it still has a cached `power_w` — that
 * value is the device's last reading before it went quiet, not a live one, and listing it
 * here is exactly the "field devices project their last reading constantly" symptom
 * caught live in the Node-RED health-signal fix this pairs with.
 */
export function topByPower(devices: Device[], readings: Record<string, Reading>, limit: number): PowerBar[] {
  const bars: PowerBar[] = [];
  for (const d of devices) {
    const reading = readings[d.id];
    if (reading?.online === false) continue;
    const p = reading?.power_w;
    if (typeof p === 'number') bars.push({ id: d.id, label: d.display_name, power_w: p });
  }
  return bars.sort((a, b) => b.power_w - a.power_w).slice(0, limit);
}

export interface MeteredSplit {
  meteredW: number;
  totalW: number | null;
  untrackedW: number | null;
  meteredPct: number | null;
}

/**
 * "Metered" here means the 7 individually-metered dual-socket outlets specifically — not
 * the 4 CHNT branch meters `total_power_w` itself is summed from (see
 * `shared/buildLatest.mjs`). "Untracked" is what's left once those 7 are subtracted from
 * the panel total: hardwired lighting circuits, the ACU, anything else on the other 3
 * branch meters that isn't individually socket-metered. Missing OR offline outlet readings
 * both count as 0 toward the metered sum — a device with no reading yet, and a device
 * whose last reading is stale because it's gone offline, contribute nothing measurable for
 * the same reason (`shared/buildLatest.mjs` applies the identical online check to
 * `_totals.total_power_w` this is compared against, so both sides of the split stay
 * consistent) — but the total stays `null`, not a fabricated 0, when the bridge hasn't
 * reported one.
 */
export function meteredVsUntracked(devices: Device[], readings: Record<string, Reading>, totalPowerW: number | null): MeteredSplit {
  const meteredW = devices
    .filter((d) => d.class === 'outlet_dual')
    .reduce((sum, d) => {
      const reading = readings[d.id];
      if (reading?.online === false) return sum;
      return sum + (reading?.power_w ?? 0);
    }, 0);

  if (totalPowerW === null) return { meteredW, totalW: null, untrackedW: null, meteredPct: null };

  const untrackedW = Math.max(0, totalPowerW - meteredW);
  const meteredPct = shareOfTotal(meteredW, totalPowerW);
  return { meteredW, totalW: totalPowerW, untrackedW, meteredPct };
}
