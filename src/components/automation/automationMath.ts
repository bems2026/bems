import { hasSwitchableState } from '@/lib/deviceClass';
import type { ContextMap, Device } from '@/lib/types';

export const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** `global.schedule.<device>.days` is a 7-char '1'/'0' string, Mon..Sun — the same
 * wire-friendly encoding every other context value uses (plain strings, no nested JSON).
 * An unset or malformed value parses to all-false, not a fabricated default schedule. */
export function parseDays(raw: string | undefined): boolean[] {
  if (raw === undefined || raw.length !== 7) return Array(7).fill(false);
  return raw.split('').map((c) => c === '1');
}

export function formatDays(days: boolean[]): string {
  return days.map((d) => (d ? '1' : '0')).join('');
}

/** Flips one day and re-encodes — the pure step every day-chip click performs. */
export function toggleDay(raw: string | undefined, index: number): string {
  const days = parseDays(raw);
  days[index] = !days[index];
  return formatDays(days);
}

export function scheduleKey(deviceId: string, field: 'on' | 'off' | 'days' | 'armed'): string {
  return `global.schedule.${deviceId}.${field}`;
}

const CLASS_ICON: Partial<Record<Device['class'], string>> = { switch: '💡', outlet_dual: '🔌', acu_ir: '❄️' };

export interface NextUpEntry {
  deviceId: string;
  name: string;
  icon: string;
  time: string;
}

/**
 * Overview's "Next up" card — v3's chronological sort (`localeCompare` on the zero-padded
 * `HH:MM` on-time, which sorts correctly as plain strings) applied to real, SAVED schedules
 * only. `draft` is deliberately excluded, same reasoning as `LoadShedBanner`: an unsaved
 * Automation edit hasn't reached Node-RED's context, so it isn't really "next" yet.
 */
export function nextUpSchedules(devices: Device[], saved: ContextMap, limit = 4): NextUpEntry[] {
  const entries: NextUpEntry[] = [];
  for (const d of devices) {
    if (!hasSwitchableState(d.class)) continue;
    const armed = saved[scheduleKey(d.id, 'armed')] === 'true';
    const on = saved[scheduleKey(d.id, 'on')];
    if (!armed || !on) continue;
    entries.push({ deviceId: d.id, name: d.display_name, icon: CLASS_ICON[d.class] ?? '•', time: on });
  }
  return entries.sort((a, b) => a.time.localeCompare(b.time)).slice(0, limit);
}

/** Total count of genuinely armed (and saved) schedules — not capped to `limit`, for the
 * card's "N armed" header, which should state the real total even when only 4 rows show. */
export function armedScheduleCount(devices: Device[], saved: ContextMap): number {
  return devices.filter((d) => hasSwitchableState(d.class) && saved[scheduleKey(d.id, 'armed')] === 'true').length;
}
