/**
 * The week, in the one encoding this system uses.
 *
 * WHY THIS FILE EXISTS. Until RM-066 there were two implementations of `parseDays` — one in
 * `src/components/automation/automationMath.ts` and one in `server/schedulePlan.mjs` — each
 * carrying a comment saying it mirrored the other exactly. Two copies of a rule that must
 * agree is the shape of defect this repo has already paid for elsewhere (see `shared/
 * commands.mjs` and `src/lib/shedTiers.ts` mirroring `server/shedPlan.mjs`), and this one is
 * worse than most: a disagreement here does not throw, it switches the office lights on the
 * wrong day and looks completely healthy doing it.
 *
 * THE DANGEROUS DETAIL, stated once. The app stores `days` as 7 characters, index 0 = MONDAY.
 * JavaScript's `Date.getDay()` returns 0 for SUNDAY. Converting between them is a ROTATION,
 * not an offset, and `appDayIndex` is the only place it happens.
 *
 * Plain `.mjs` in `shared/` because both halves import it: the browser through vite's
 * `@shared` alias, the daemon directly. No dependencies, so it stays importable from either.
 */

/** Chip labels, Monday-first. Two Ts and two Ss on purpose — the aria-label carries the name. */
export const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Full names, same order, for accessible labels. */
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** JS `getDay()` (0 = Sunday) -> this app's `days` string index (0 = Monday). A rotation. */
export function appDayIndex(date) {
  return (date.getDay() + 6) % 7;
}

/**
 * A 7-char '1'/'0' string, Mon..Sun, to booleans.
 *
 * An unset or malformed value is ALL-FALSE, not a fabricated every-day default. A schedule
 * nobody finished configuring must never fire — that asymmetry is deliberate and both the
 * daemon and the editor depend on it.
 */
export function parseDays(raw) {
  if (typeof raw !== 'string' || raw.length !== 7) return new Array(7).fill(false);
  return raw.split('').map((c) => c === '1');
}

export function formatDays(days) {
  return days.map((d) => (d ? '1' : '0')).join('');
}

/** Flips one day and re-encodes — the pure step every day-chip click performs. */
export function toggleDay(raw, index) {
  const days = parseDays(raw);
  days[index] = !days[index];
  return formatDays(days);
}

/** True when at least one day is set. A rule with no days can never fire. */
export function anyDaySet(raw) {
  return parseDays(raw).some(Boolean);
}

/** Local wall-clock `HH:MM`. Schedules are written by people looking at a clock, not at UTC. */
export function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * `HH:MM` to minutes since midnight, or null if it is not a well-formed time.
 *
 * Null rather than NaN or 0: a malformed time must be distinguishable from midnight, which is
 * a perfectly ordinary schedule value.
 */
export function minutesOfDay(value) {
  if (typeof value !== 'string') return null;
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
