/**
 * Formatting a moment that belongs to the BUILDING — RM-033.
 *
 * WHY THIS EXISTS. The same defect was found three times in two days, each time one layer
 * further down: the Overview clock rendered the reader's time under the building's place name;
 * `weatherClient` parsed the forecast in the reader's zone (twelve hours out from New York); and
 * a sweep then found thirteen more `toLocale*String` calls with no `timeZone` at all. Every one
 * of them describes something that happened in the building — a meter reading, a device's last
 * report, a forecast day — and rendered it in whatever zone the reader's laptop happened to be
 * in. On the kiosk in the room they are all correct, which is exactly why none of them was
 * noticed: the one reader who would have seen it is the one reader it was right for.
 *
 * THE DISTINCTION THIS MODULE ENCODES, and it is the whole point:
 *
 *   - A timestamp that describes the BUILDING — when a reading was taken, when a device last
 *     reported, which day a forecast is for — is a fact about the building, and must read the
 *     same to everyone. That is what these helpers are for.
 *   - A timestamp that describes THIS READER's own action, just now — "saved at 14:32",
 *     "wrote 2 keys at 14:33" — is a fact about their session, and their own clock is the
 *     correct frame. Those call sites deliberately do NOT use this, and say so.
 *
 * THE LOCALE STAYS THE READER'S. Formatting is presentation and belongs to whoever is looking;
 * the instant is the fact and belongs to the building. The call sites this replaced hardcoded
 * `en-PH`, which was a second, quieter way of assuming who was reading.
 */
import { SITE } from '@shared/siteConfig.mjs';

/** The zone every helper here pins. Read once so a call site cannot accidentally pass another. */
const zone = SITE.timezone as string;

/** `14:05:09` — a moment in the building's day. */
export function siteTime(t: number | string | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(t).toLocaleTimeString(undefined, { hour12: false, timeZone: zone, ...opts });
}

/** `14:05` — the short form chart axes and log lines want. */
export function siteTimeShort(t: number | string | Date): string {
  return siteTime(t, { hour: '2-digit', minute: '2-digit' });
}

/** `31 Aug` and friends — a day in the building's calendar, which is not always the reader's. */
export function siteDate(t: number | string | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(t).toLocaleDateString(undefined, { timeZone: zone, ...opts });
}

/** Date and time together, for a tooltip that has room for both. */
export function siteDateTime(t: number | string | Date): string {
  return new Date(t).toLocaleString(undefined, { hour12: false, timeZone: zone });
}

/**
 * Whether an instant falls on the building's today. `toDateString()` compares in the reader's
 * zone, so a forecast strip could label the building's tomorrow as "Today" for a reader a few
 * hours ahead — the same mistake in miniature, and the reason this is a function rather than a
 * comparison written out at the call site.
 */
export function isSiteToday(t: number | string | Date, now: number = Date.now()): boolean {
  const key = (v: number | string | Date) => new Date(v).toLocaleDateString('en-CA', { timeZone: zone });
  return key(t) === key(now);
}
