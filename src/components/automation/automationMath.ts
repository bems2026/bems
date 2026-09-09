import { minutesOfDay, parseDays, appDayIndex } from '@shared/scheduleDays.mjs';
import type { Schedule } from '@/lib/supabaseSchedules';
import type { Device, DeviceClass } from '@/lib/types';

/**
 * Overview's "Active Schedules" card, computed from the real `schedules` rows.
 *
 * TWO THINGS CHANGED IN RM-059 AND BOTH MATTER HERE.
 *
 * The day encoding moved to `@shared/scheduleDays.mjs` — it used to be implemented in this file
 * AND in `server/schedulePlan.mjs`, each claiming to mirror the other, and a disagreement
 * between them does not throw, it switches the office lights on the wrong day.
 *
 * And schedules stopped being flat `global.schedule.<device>.<field>` context keys, because
 * that shape can hold exactly one rule per device. So "next up" is no longer "every armed
 * device sorted by its on-time"; it is the next few EVENTS across every armed rule, which is
 * the question the card's title was always asking.
 */

export interface NextUpEntry {
  ruleId: string;
  deviceId: string;
  name: string;
  /** Resolved to an icon via the shared `CLASS_ICON` map (`lib/deviceIcons.ts`) at render
   * time, not baked in here — this module has no JSX/lucide dependency. */
  deviceClass: DeviceClass;
  time: string;
  action: 'on' | 'off';
  /** Minutes from `now` until it fires, for the ordering and for a relative label. */
  inMinutes: number;
}

/**
 * The next few things that will actually happen, soonest first.
 *
 * Looks FORWARD from `now` and wraps around the week, so at 18:30 the card shows tomorrow
 * morning rather than an empty list — the old version sorted every armed device's on-time as a
 * plain string, which meant a schedule that had already fired today still sat at the top.
 *
 * Disarmed rules are excluded, and so is any rule with no days: neither will fire.
 */
export function nextUpSchedules(devices: Device[], schedules: Schedule[], now: Date, limit = 4): NextUpEntry[] {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const nowMinute = appDayIndex(now) * 1440 + now.getHours() * 60 + now.getMinutes();
  const WEEK = 7 * 1440;
  const out: NextUpEntry[] = [];

  for (const rule of schedules) {
    if (!rule.enabled) continue;
    const device = byId.get(rule.deviceId);
    if (!device) continue;
    const days = parseDays(rule.days ?? undefined);

    for (const [action, time] of [['on', rule.on] as const, ['off', rule.off] as const]) {
      const min = minutesOfDay(time ?? '');
      if (min === null) continue;
      days.forEach((set, day) => {
        if (!set) return;
        const at = day * 1440 + min;
        // Wrap into the future: an event earlier today is next week's, not overdue.
        const inMinutes = (at - nowMinute + WEEK) % WEEK;
        out.push({ ruleId: rule.id, deviceId: rule.deviceId, name: device.display_name, deviceClass: device.class, time: time as string, action, inMinutes });
      });
    }
  }

  // ONE ENTRY PER EDGE, not one per occurrence. A rule that runs every day produces seven
  // matches for its on-time, and a card listing "Light Switch 1 · 07:30" four times over is
  // noise pretending to be information — what a reader wants is the next four DIFFERENT things
  // that will happen.
  const soonest = new Map<string, NextUpEntry>();
  for (const entry of out.sort((a, b) => a.inMinutes - b.inMinutes)) {
    const key = `${entry.ruleId}|${entry.action}`;
    if (!soonest.has(key)) soonest.set(key, entry);
  }
  return [...soonest.values()].slice(0, limit);
}

/** Armed RULES, not armed devices — since RM-059 one device can hold five rules with three of
 * them armed, and the device count stopped being the number anyone wants. */
export function armedScheduleCount(schedules: Schedule[]): number {
  return schedules.filter((s) => s.enabled).length;
}
