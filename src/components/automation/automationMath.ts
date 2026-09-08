import { hasSwitchableState } from '@/lib/deviceClass';
import type { ContextMap, Device, DeviceClass } from '@/lib/types';

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

export interface NextUpEntry {
  deviceId: string;
  name: string;
  /** Resolved to an icon via the shared `CLASS_ICON` map (`lib/deviceIcons.ts`) at render
   * time, not baked in here — this module has no JSX/lucide dependency. */
  deviceClass: DeviceClass;
  time: string;
}

/**
 * Overview's "Active Schedules" card — v3's chronological sort (`localeCompare` on the
 * zero-padded `HH:MM` on-time, which sorts correctly as plain strings) applied to real,
 * SAVED schedules only. `draft` is deliberately excluded: an unsaved Automation edit hasn't
 * reached Node-RED's context, so it isn't really "next" yet.
 */
export function nextUpSchedules(devices: Device[], saved: ContextMap, limit = 4): NextUpEntry[] {
  const entries: NextUpEntry[] = [];
  for (const d of devices) {
    if (!hasSwitchableState(d.class)) continue;
    const armed = saved[scheduleKey(d.id, 'armed')] === 'true';
    const on = saved[scheduleKey(d.id, 'on')];
    if (!armed || !on) continue;
    entries.push({ deviceId: d.id, name: d.display_name, deviceClass: d.class, time: on });
  }
  return entries.sort((a, b) => a.time.localeCompare(b.time)).slice(0, limit);
}

/** Total count of genuinely armed (and saved) schedules — not capped to `limit`, for the
 * card's "N armed" header, which should state the real total even when only 4 rows show. */
export function armedScheduleCount(devices: Device[], saved: ContextMap): number {
  return devices.filter((d) => hasSwitchableState(d.class) && saved[scheduleKey(d.id, 'armed')] === 'true').length;
}

/**
 * RM-060 — the ways a schedule row can be saved, look configured, and do nothing.
 *
 * WHY THESE THREE AND NOT MORE. Each is a state the UI accepts silently today and which has no
 * reading under which it does what the operator meant. An armed row with no day ticked never
 * fires; `parseDays` returns all-false for an unset value, so a blank `days` string is not a
 * placeholder, it is a schedule that will not run — and the symptom presents as broken hardware
 * rather than as an empty field. An armed row with no ON time has nothing to schedule. An ON
 * equal to its OFF is a zero-length instruction.
 *
 * WHAT IS DELIBERATELY NOT A PROBLEM, because warnings that cry wolf get ignored:
 *   - OFF earlier in the day than ON. That is an OVERNIGHT schedule (on at 18:00, off at 06:00)
 *     and it is how a security light is meant to be configured. `server/scheduler.mjs` fires the
 *     two edges independently, so nothing here needs them ordered.
 *   - ON with no OFF. Switching something on and leaving it is a real choice, and the mirror of
 *     the auto-shed rule this project already holds: shedding is automatic, restoring is not.
 *   - An unarmed row that is merely incomplete. That is a draft.
 */
export type ScheduleProblem = 'armed-without-days' | 'armed-without-on-time' | 'same-on-and-off';

export interface ScheduleRule {
  armed: boolean;
  on: string | undefined;
  off: string | undefined;
  /** The raw 7-char Mon..Sun string, or undefined when never set. */
  days: string | undefined;
}

/** One sentence per problem, kept beside the rule that raises it so the two cannot drift. */
export const SCHEDULE_PROBLEM_TEXT: Record<ScheduleProblem, string> = {
  'armed-without-days': 'Armed, but no day is selected — this will never run.',
  'armed-without-on-time': 'Armed, but no ON time is set — there is nothing to schedule.',
  'same-on-and-off': 'ON and OFF are the same time.',
};

export function scheduleProblems(rule: ScheduleRule): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  if (rule.armed && !parseDays(rule.days).some(Boolean)) problems.push('armed-without-days');
  if (rule.armed && !rule.on) problems.push('armed-without-on-time');
  if (rule.on && rule.off && rule.on === rule.off) problems.push('same-on-and-off');
  return problems;
}

/**
 * How many of a fleet's schedules cannot run as configured — the count behind Automation's one
 * summary line.
 *
 * WHY A SUMMARY EXISTS AT ALL. "Arm all" stages `armed = true` for every filtered device in a
 * single click, which can turn a dozen quiet rows into a dozen warning rows at once. Making each
 * row's note a live region meant that click fired a dozen simultaneous announcements — noise that
 * a screen reader user cannot act on and cannot skip. One polite summary announces the fact once;
 * the per-row notes stay on their rows, describing the control that made them true.
 *
 * Counts ROWS, not problems: a row with two faults is one broken schedule, and the operator fixes
 * it in one place.
 */
export function brokenScheduleCount(devices: readonly Device[], context: ContextMap): number {
  let n = 0;
  for (const d of devices) {
    const at = (field: 'on' | 'off' | 'days' | 'armed') => context[scheduleKey(d.id, field)];
    const problems = scheduleProblems({
      armed: at('armed') === 'true',
      on: at('on') || undefined,
      off: at('off') || undefined,
      days: at('days'),
    });
    if (problems.length > 0) n += 1;
  }
  return n;
}
