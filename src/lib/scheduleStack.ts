/**
 * What a device's stack of schedules actually DOES — targets, faults, conflicts, and the week
 * it paints.
 *
 * DOES NOT MIRROR THE DAEMON — IT SHARES ITS CODE. The older precedent here is
 * `src/lib/shedTiers.ts`, which reimplements `server/shedPlan.mjs` "rule for rule" because one
 * is browser TypeScript and the other daemon JavaScript, and then tests the two against each
 * other. `shared/` is how this repo avoids paying that cost, so the question of whether a rule
 * is dead is answered by `@shared/scheduleRules.mjs` for both halves. What lives here is only
 * what the daemon has no use for: which targets exist, how a stack reads, and what week it
 * paints.
 *
 * Pure: no store, no clock beyond what is passed in, no JSX. All of it is unit-tested.
 */

import { minutesOfDay, parseDays, DAY_NAMES } from '@shared/scheduleDays.mjs';
import { UNFIREABLE_REASONS, UNFIREABLE_TEXT, scheduleProblem } from '@shared/scheduleRules.mjs';
import type { Schedule } from './supabaseSchedules';
import type { Device, SocketIndex } from './types';

export const MINUTES_PER_DAY = 1440;

/* ===========================================================================
 * Targets — the thing a rule is written against
 * ======================================================================== */

/**
 * One switchable target. An outlet contributes TWO — its sockets are independent relays and
 * the Control page has always shown them that way (`RelayToggle variant="socket"`). Everything
 * else contributes one, with a null socket.
 *
 * This is the change RM-066 is really about: before it, the Automation page could not express
 * a socket at all, so both halves of every outlet moved together whether that made sense or not.
 */
export interface ScheduleTarget {
  key: string;
  device: Device;
  socket: SocketIndex | null;
  /** "Outlet 3 · S1", or just the device name where there is only one relay. */
  name: string;
}

export const targetKey = (deviceId: string, socket: SocketIndex | null): string =>
  socket === null ? deviceId : `${deviceId}:${socket}`;

export function scheduleTargets(devices: Device[]): ScheduleTarget[] {
  const out: ScheduleTarget[] = [];
  for (const device of devices) {
    if (device.class === 'outlet_dual') {
      // Socket count comes from the registry, never a hardcoded 2 — the runtime fan-out already
      // refuses that shortcut and this must not reintroduce it one layer up.
      const count = device.sockets?.length ?? 2;
      for (let n = 1; n <= count; n += 1) {
        const socket = n as SocketIndex;
        out.push({ key: targetKey(device.id, socket), device, socket, name: `${device.display_name} · S${n}` });
      }
    } else {
      out.push({ key: targetKey(device.id, null), device, socket: null, name: device.display_name });
    }
  }
  return out;
}

/**
 * The rules belonging to one target, in the order they should be read.
 *
 * A legacy whole-outlet rule (`socket: null` on an outlet) appears under BOTH sockets, because
 * that is exactly what it does: `fanOutCommand` expands it to both at dispatch. Hiding it under
 * neither would leave a rule that switches the building invisible on the page that manages it.
 */
export function stackFor(schedules: Schedule[], target: ScheduleTarget): Schedule[] {
  return schedules
    .filter((s) => {
      if (s.deviceId !== target.device.id) return false;
      if (target.socket === null) return true;
      return s.socket === target.socket || s.socket === null;
    })
    .sort(sortRules);
}

/** Chronological by on-time, then off-time, then creation — so the list reads as the day.
 * A rule with no on-time sorts last: it is unfinished, and unfinished belongs at the bottom. */
function sortRules(a: Schedule, b: Schedule): number {
  const am = minutesOfDay(a.on ?? '') ?? minutesOfDay(a.off ?? '') ?? Number.MAX_SAFE_INTEGER;
  const bm = minutesOfDay(b.on ?? '') ?? minutesOfDay(b.off ?? '') ?? Number.MAX_SAFE_INTEGER;
  if (am !== bm) return am - bm;
  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
}

/* ===========================================================================
 * Faults — rules that are armed and can never fire
 * ======================================================================== */

export type RuleProblem = (typeof UNFIREABLE_REASONS)[number];

export const RULE_PROBLEMS: readonly string[] = UNFIREABLE_REASONS;

export function explainProblem(reason: RuleProblem): string {
  return (UNFIREABLE_TEXT as Record<string, string>)[reason] ?? reason;
}

/**
 * Why an armed rule can never fire, or null.
 *
 * The rules themselves live in `@shared/scheduleRules.mjs` and are the SAME CODE the daemon
 * runs — not a mirror of it. `Schedule`'s field names were chosen to match that function's
 * parameter shape so this is a pass-through rather than an adapter, which is the point: the
 * page and the thing that switches power cannot disagree about whether a rule is dead.
 *
 * A DISARMED rule returns null: disarmed is a state somebody chose, not a fault.
 */
export function ruleProblem(rule: Schedule, device: Device | undefined, dispatchableIds: Set<string>): RuleProblem | null {
  return scheduleProblem(rule, device, dispatchableIds) as RuleProblem | null;
}

/* ===========================================================================
 * Conflicts — rules that fire, but not the way they read
 * ======================================================================== */

export type ConflictKind = 'collision' | 'duplicate' | 'overnight' | 'same-on-and-off' | 'acu-window';

export interface StackConflict {
  kind: ConflictKind;
  /** The rule ids involved, so the list can mark them. */
  ruleIds: string[];
  message: string;
}

/**
 * Things about a stack an operator would want told rather than discovered.
 *
 * `collision` is the one with teeth: two armed rules with an ON and an OFF at the same minute on
 * the same day. The daemon resolves it to OFF — deliberately, because off fails safe — but the
 * page it was written on should say so rather than leave the operator to find out that their
 * 08:00 "on" never happened.
 *
 * `overnight` is informational, NOT an error. `on 22:00 / off 06:00` is a legitimate and common
 * rule — it is how a security light is meant to be configured — it just does not read
 * left-to-right, and the timeline draws it wrapping past midnight. RM-067 reached the same
 * conclusion independently and its reasoning is worth keeping: a warning that cries wolf on a
 * correct configuration gets ignored on an incorrect one.
 */
export function stackConflicts(stack: Schedule[]): StackConflict[] {
  const armed = stack.filter((s) => s.enabled);
  const out: StackConflict[] = [];

  // Same minute, same day, opposite directions.
  const events = new Map<string, { on: string[]; off: string[] }>();
  for (const rule of armed) {
    const days = parseDays(rule.days ?? undefined);
    days.forEach((set, day) => {
      if (!set) return;
      for (const [action, time] of [['on', rule.on] as const, ['off', rule.off] as const]) {
        if (!time) continue;
        const key = `${day}|${time}`;
        const slot = events.get(key) ?? { on: [], off: [] };
        slot[action].push(rule.id);
        events.set(key, slot);
      }
    });
  }
  for (const [key, slot] of events) {
    // DIFFERENT rules. A single rule whose own ON and OFF are the same minute lands in both
    // lists, and reporting that as "two rules act at 08:00" is wrong about the count and sends
    // the reader looking for a second rule. It has its own kind below.
    const across = slot.on.some((id) => slot.off.some((other) => other !== id));
    if (across) {
      const [day, time] = key.split('|');
      out.push({
        kind: 'collision',
        ruleIds: [...new Set([...slot.on, ...slot.off])],
        message: `Two rules act at ${time} on ${DAY_NAMES[Number(day)]}, one on and one off. The scheduler resolves this to OFF, because off is the one that fails safe.`,
      });
    }
  }

  // Exact duplicates: harmless at the relay, but they make a stack unreadable and one of them
  // is almost always an edit that was meant to replace the other.
  const seen = new Map<string, string>();
  for (const rule of armed) {
    const sig = `${rule.on ?? ''}|${rule.off ?? ''}|${rule.days ?? ''}|${rule.socket ?? ''}`;
    const first = seen.get(sig);
    if (first) {
      out.push({ kind: 'duplicate', ruleIds: [first, rule.id], message: 'Two rules have identical times and days. One of them does nothing the other does not.' });
    } else {
      seen.set(sig, rule.id);
    }
  }

  for (const rule of armed) {
    const on = minutesOfDay(rule.on ?? '');
    const off = minutesOfDay(rule.off ?? '');
    if (on === null || off === null) continue;
    // From RM-067. A zero-length instruction: the daemon checks `off` second, so the two resolve
    // to OFF and the ON the operator wrote never happens. Deterministic rather than broken, which
    // is why it is a conflict to warn about here and not an `unfireable` reason the daemon skips.
    if (on === off) {
      out.push({ kind: 'same-on-and-off', ruleIds: [rule.id], message: `ON and OFF are both ${rule.on}. The scheduler resolves that to OFF, so this rule never switches anything on.` });
    } else if (off < on) {
      out.push({ kind: 'overnight', ruleIds: [rule.id], message: `Runs overnight: on at ${rule.on}, off at ${rule.off} the next morning.` });
    }
  }

  return out;
}

/* ===========================================================================
 * The week timeline
 * ======================================================================== */

export interface TimelineSpan {
  /** 0 = Monday, matching the app's day encoding everywhere else. */
  day: number;
  /** Minutes from midnight. `end` is exclusive; a span reaching midnight ends at 1440. */
  startMin: number;
  endMin: number;
}

export interface WeekTimeline {
  spans: TimelineSpan[];
  /** True when the stack has no armed events at all — nothing is known, and the strip should
   * say so rather than draw an empty week that looks like "always off". */
  empty: boolean;
  /** True when the stack only ever switches ON. The device would never come back off, which is
   * almost always a half-written stack rather than an intention. */
  neverOff: boolean;
}

/**
 * What the stack actually does across a week, as spans of "on".
 *
 * SIMULATED, NOT READ OFF EACH RULE. A rule with an on-time and no off-time does not describe a
 * span; it describes an edge, and the device stays on until some OTHER rule turns it off —
 * possibly on a different day. Painting each rule as its own bar would draw a week that never
 * happens. So this collects every edge the armed rules produce, sorts them, and walks.
 *
 * THE WEEK IS A LOOP, which is what makes the starting state knowable. The schedule repeats, so
 * the state at Monday 00:00 is the state left by the last event of the previous week — the last
 * event in the sorted list. That is why a Friday-evening ON with a Monday-morning OFF paints
 * correctly across the weekend instead of vanishing.
 *
 * OFF WINS AT AN EQUAL MINUTE, the same rule the daemon applies, so the picture and the
 * building agree.
 */
export function weekTimeline(stack: Schedule[]): WeekTimeline {
  interface Edge { at: number; action: 'on' | 'off' }
  const edges: Edge[] = [];

  for (const rule of stack) {
    if (!rule.enabled) continue;
    const days = parseDays(rule.days ?? undefined);
    const on = minutesOfDay(rule.on ?? '');
    const off = minutesOfDay(rule.off ?? '');
    days.forEach((set, day) => {
      if (!set) return;
      if (on !== null) edges.push({ at: day * MINUTES_PER_DAY + on, action: 'on' });
      if (off !== null) edges.push({ at: day * MINUTES_PER_DAY + off, action: 'off' });
    });
  }

  if (edges.length === 0) return { spans: [], empty: true, neverOff: false };

  // Off before on at the same minute, so the walk below sees the same winner the daemon picks.
  edges.sort((a, b) => a.at - b.at || (a.action === 'off' ? -1 : 1));

  const neverOff = edges.every((e) => e.action === 'on');
  if (neverOff) {
    // Honest rendering: on from the first edge, and never off again. Drawing it as a full week
    // would hide that the stack has no way back.
    const first = edges[0].at;
    return { spans: splitByDay(first, 7 * MINUTES_PER_DAY), empty: false, neverOff: true };
  }

  // The week repeats, so the state at minute 0 is whatever the LAST event of the week left.
  let on = edges[edges.length - 1].action === 'on';
  let openedAt = on ? 0 : null;
  const spans: TimelineSpan[] = [];

  for (const edge of edges) {
    if (edge.action === 'on' && !on) {
      on = true;
      openedAt = edge.at;
    } else if (edge.action === 'off' && on) {
      on = false;
      if (openedAt !== null && edge.at > openedAt) spans.push(...splitByDay(openedAt, edge.at));
      openedAt = null;
    }
  }
  // Still on at the end of the week: it wraps into the next one, which is the same week, so it
  // runs to the boundary. The matching head span was already opened at minute 0 above.
  if (on && openedAt !== null) spans.push(...splitByDay(openedAt, 7 * MINUTES_PER_DAY));

  return { spans: mergeAdjacent(spans), empty: false, neverOff: false };
}

/** One absolute [start, end) range in week-minutes, cut into per-day pieces for rendering. */
function splitByDay(startAbs: number, endAbs: number): TimelineSpan[] {
  const out: TimelineSpan[] = [];
  let cursor = startAbs;
  while (cursor < endAbs) {
    const day = Math.floor(cursor / MINUTES_PER_DAY);
    const dayEnd = (day + 1) * MINUTES_PER_DAY;
    const sliceEnd = Math.min(endAbs, dayEnd);
    out.push({ day, startMin: cursor - day * MINUTES_PER_DAY, endMin: sliceEnd - day * MINUTES_PER_DAY });
    cursor = sliceEnd;
  }
  return out;
}

/** Two spans meeting exactly (an off and an on at the same minute) are one span, not two. */
function mergeAdjacent(spans: TimelineSpan[]): TimelineSpan[] {
  const sorted = [...spans].sort((a, b) => a.day - b.day || a.startMin - b.startMin);
  const out: TimelineSpan[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && last.day === span.day && span.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, span.endMin);
    } else {
      out.push({ ...span });
    }
  }
  return out;
}

/** `HH:MM` for a minute-of-day, for axis labels and span tooltips. */
export function formatMinute(min: number): string {
  const m = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(min)));
  if (m === MINUTES_PER_DAY) return '24:00';
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/* ===========================================================================
 * Cross-domain: a schedule that silences the aircon loop
 * ======================================================================== */

/**
 * The one conflict on this page that spans two automation strategies.
 *
 * WHAT IT CATCHES. A schedule switches the aircon OFF at a time that falls inside an armed ACU
 * rule's active window. The loop is setpoint-only and acts only while the unit reports `on`, so
 * from that minute to the end of the window it holds on `acu_off` and does nothing at all. The
 * rule stays armed, the status strip explains itself, and nothing is broken — but "configured
 * and nothing is happening" is exactly the state `holds` was designed to stop being
 * indistinguishable from a bug, and it is cheaper to say so where the schedule is written.
 *
 * WHY THIS ONE AND NOT A DSM CROSS-CHECK. The brief that prompted this asked for a warning when
 * a schedule conflicts with a DSM threshold. That is not computable: a threshold is a power
 * limit and a schedule is a time, and they do not intersect deterministically — whether a rule
 * trips a limit depends on what else is drawing at that moment. Inventing a warning for it would
 * mean crying wolf on correct configurations, which is the argument `overnight` already makes.
 * This check is deterministic: two windows either overlap on a shared day or they do not.
 *
 * BOTH SIDES USE THE SAME 7-CHAR Mon..Sun ENCODING, which is why the overlap is a bitwise
 * question and not a date-library one. That was a deliberate choice when `acu_rules` was
 * designed — one convention in this database — and this is the first thing to collect on it.
 *
 * DORMANT TODAY, and worth building anyway: `acu_main` currently has no schedule rows at all,
 * because the operator deleted the one it had. That was one click.
 */
export interface AcuWindowRule {
  acuDeviceId: string;
  /** 7 chars of '1'/'0', Mon..Sun — the same encoding schedules use. */
  days: string;
  windowStart: string;
  windowEnd: string;
  enabled: boolean;
  label: string | null;
}

export function acuWindowConflicts(stack: Schedule[], acuRules: AcuWindowRule[], target: ScheduleTarget): StackConflict[] {
  // Only the aircon itself can be silenced this way. A schedule on a light has no bearing on it.
  if (target.device.class !== 'acu_ir') return [];

  const armedRules = acuRules.filter((r) => r.enabled && r.acuDeviceId === target.device.id);
  if (armedRules.length === 0) return [];

  const out: StackConflict[] = [];
  for (const rule of stack.filter((s) => s.enabled)) {
    const off = minutesOfDay(rule.off ?? '');
    if (off === null) continue;
    const offDays = parseDays(rule.days ?? undefined);

    for (const acu of armedRules) {
      const start = minutesOfDay(acu.windowStart);
      const end = minutesOfDay(acu.windowEnd);
      if (start === null || end === null || end <= start) continue; // a window is never treated as wrapping midnight
      if (off < start || off >= end) continue;

      const acuDays = parseDays(acu.days);
      const shared = DAY_NAMES.filter((_, i) => offDays[i] && acuDays[i]);
      if (shared.length === 0) continue;

      const which = acu.label ? `"${acu.label}"` : 'the aircon rule';
      out.push({
        kind: 'acu-window',
        ruleIds: [rule.id],
        message:
          `This switches the aircon off at ${rule.off}, inside ${which}'s ${acu.windowStart}–${acu.windowEnd} window ` +
          `(${shared.length === 7 ? 'every day' : shared.join(', ')}). ` +
          `The controller only adjusts a unit that is running, so from ${rule.off} it holds and does nothing until ${acu.windowEnd}.`,
      });
    }
  }
  return out;
}
