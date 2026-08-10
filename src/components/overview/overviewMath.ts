import type { Device, Reading } from '@/lib/types';

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
 */
export function topByPower(devices: Device[], readings: Record<string, Reading>, limit: number): PowerBar[] {
  const bars: PowerBar[] = [];
  for (const d of devices) {
    const p = readings[d.id]?.power_w;
    if (typeof p === 'number') bars.push({ id: d.id, label: d.display_name, power_w: p });
  }
  return bars.sort((a, b) => b.power_w - a.power_w).slice(0, limit);
}
