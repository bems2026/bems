/**
 * The few moments worth reading, out of a per-minute reading series.
 *
 * phase28 stores what a device reports beyond volts, amps and watts, and its migration names the
 * questions that were previously unanswerable — three of which are about WHEN something changed:
 * which branch tripped its power warning, whether an outlet reported a fault before it went dark,
 * and whether a device was on the cloud or the local segment when it stopped answering.
 *
 * THE ANSWER IS NOT A ROW LIST. `readings` holds one row per device per minute, and on a healthy
 * fleet every one of them says the same thing. Returning rows returns thousands of identical
 * answers to "when did this go wrong". What the question wants is the episode: it began here,
 * ended here, lasted this long.
 *
 * Pure — no I/O, no Supabase. `supabaseCapabilityHistory.ts` fetches; this decides what the rows
 * mean, which is the half worth testing.
 */

import { isSiteToday, siteDate, siteTimeShort } from './siteTime';

/**
 * How far apart two samples may be and still belong to the same episode.
 *
 * A device that reports a fault, goes off the air for two hours, comes back still faulted and is
 * fixed an hour later did not have one three-hour fault. It had two episodes with a hole between
 * them, and the hole is part of the story — joining them asserts a continuity nobody observed.
 * The same reasoning as `MAX_INTEGRATION_GAP_MS` in the bridge and phase31's weight cap, and the
 * same direction of caution.
 *
 * Fifteen minutes: comfortably above the ~1 min report interval and its measured 30/60/90 s
 * spread, and above `STALE_READING_MS`'s ten-minute backstop, so a merely slow device does not
 * fragment into single-sample episodes. Well under an outage worth telling apart.
 */
export const EPISODE_GAP_MS = 15 * 60 * 1000;

/** What kind of trouble an episode describes. */
export type EpisodeKind = 'fault' | 'power_warn' | 'net_degraded';

/** One abnormal reading, as fetched. */
export interface EpisodeSample {
  device_id: string;
  ts: string;
  value: string | number;
  /** RM-152: what the device drew at that minute, when the fetch asked. */
  power_w?: number | null;
  /** RM-152: the limit set on the meter at that minute (`warn_power_w`), when the fetch asked. */
  limit_w?: number | null;
}

/** A stretch during which one device held one abnormal value. */
export interface CapabilityEpisode {
  device_id: string;
  kind: EpisodeKind;
  value: string | number;
  /** First sample in the stretch. */
  from: string;
  /** Last sample in the stretch — NOT when it recovered, which is a different claim. */
  to: string;
  samples: number;
  /** The most drawn in the stretch, or null when the samples carried no power. */
  peakW?: number | null;
  /** The meter's own limit, as last reported in the stretch, or null. */
  limitW?: number | null;
  /** RM-152: the first sample sits at the edge of what was fetched, so it may have begun earlier. */
  clipped?: boolean;
}

/**
 * Collapse abnormal samples into episodes.
 *
 * Sorted here rather than trusted from the caller: the fetch asks for `order=ts.asc`, but a fold
 * that silently depends on that produces nonsense the first time somebody asks for descending
 * order to get a most-recent-first list. Grouped per device for the same class of reason — the
 * rows interleave when more than one device is abnormal, and folding on value alone would
 * attribute one outlet's fault to another.
 *
 * A sample whose timestamp will not parse is dropped rather than placed. It cannot be ordered
 * against the others, and putting it somewhere would invent a position for it.
 */
export function foldEpisodes(samples: EpisodeSample[], kind: EpisodeKind): CapabilityEpisode[] {
  const usable = samples
    .filter((s) => Number.isFinite(Date.parse(s.ts)))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

  const open = new Map<string, CapabilityEpisode>();
  const lastSeen = new Map<string, number>();
  const out: CapabilityEpisode[] = [];

  for (const s of usable) {
    const at = Date.parse(s.ts);
    const current = open.get(s.device_id);
    const gap = at - (lastSeen.get(s.device_id) ?? at);

    const power = typeof s.power_w === 'number' && Number.isFinite(s.power_w) ? s.power_w : null;
    const limit = typeof s.limit_w === 'number' && Number.isFinite(s.limit_w) ? s.limit_w : null;
    if (current && current.value === s.value && gap <= EPISODE_GAP_MS) {
      current.to = s.ts;
      current.samples += 1;
      if (power !== null) current.peakW = Math.max(current.peakW ?? power, power);
      if (limit !== null) current.limitW = limit;
    } else {
      if (current) out.push(current);
      open.set(s.device_id, {
        device_id: s.device_id, kind, value: s.value, from: s.ts, to: s.ts, samples: 1, peakW: power, limitW: limit,
      });
    }
    lastSeen.set(s.device_id, at);
  }

  for (const e of open.values()) out.push(e);
  return out.sort((a, b) => Date.parse(a.from) - Date.parse(b.from) || a.device_id.localeCompare(b.device_id));
}

/**
 * The outlet fault bitmap's bits, in English.
 *
 * A TRANSLATION, NOT A SECOND SOURCE OF TRUTH. The bits and their order are the catalogue's —
 * phase28's own column comment restates them: "low to high: ov_cr, ov_vol, ov_pwr, ls_cr,
 * ls_vol, ls_pow — over/under current, voltage and power". What is decided here is only how to
 * say them to a person, which is a presentation choice and belongs in the frontend.
 *
 * `capabilityEpisodes.test.ts` asserts this covers exactly the bits the catalogue declares, so a
 * vendor adding or renaming one fails there rather than showing an operator a raw code.
 */
export const FAULT_BIT_LABELS: Record<string, string> = {
  ov_cr: 'over-current',
  ov_vol: 'over-voltage',
  ov_pwr: 'over-power',
  ls_cr: 'under-current',
  ls_vol: 'under-voltage',
  ls_pow: 'under-power',
};

/** The bit order, low to high — the catalogue's, restated by phase28's column comment. */
const FAULT_BIT_ORDER = ['ov_cr', 'ov_vol', 'ov_pwr', 'ls_cr', 'ls_vol', 'ls_pow'];

/** A length of time, the way a person says it: "4 min", "8 h", "under a minute". */
export function durationText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return 'under a minute';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/** Which fault bits a raw bitmap has set, in English, or the raw value if none are known. */
function faultText(value: string | number): string {
  if (typeof value !== 'number' || !Number.isInteger(value)) return String(value);
  const named = FAULT_BIT_ORDER.filter((_, i) => (value & (1 << i)) !== 0).map((b) => FAULT_BIT_LABELS[b]);
  // An unknown bit is reported raw rather than dropped: "the device reported something this
  // build does not recognise" is a fact, and inventing a name for it would not be.
  return named.length ? named.join(' and ') : `fault code ${value}`;
}

/**
 * How recently an episode's last sample must be for it to be happening NOW — RM-152.
 *
 * Readings reach the cloud every 5 minutes (RM-149) and the bell asks every 5, so a warning that is
 * still on can look ten minutes old. Twenty leaves room without letting an ended one linger.
 */
export const ACTIVE_WINDOW_MS = 20 * 60_000;

/**
 * One device's one kind of trouble, however many times it came and went — RM-152.
 *
 * The bell used to show every EPISODE as its own row, keyed by its start. A week-old power warning
 * therefore sat in the list as if current, and because the 7-day window's edge slid through it on
 * every poll, its start (and so its key, and its "for X min") changed every five minutes: marked as
 * seen, it came straight back. One incident per device and kind, keyed by neither time, is the fix.
 */
export interface TroubleIncident {
  /** Stable for the life of the condition: `trouble:<kind>:<device>`. */
  key: string;
  device_id: string;
  kind: EpisodeKind;
  /** Its latest episode's last sample is within `ACTIVE_WINDOW_MS`. */
  active: boolean;
  /** The newest episode. */
  latest: CapabilityEpisode;
  /** The older episodes in the window, newest first. */
  history: CapabilityEpisode[];
}

export function toIncidents(episodes: CapabilityEpisode[], nowMs: number): TroubleIncident[] {
  const byKey = new Map<string, CapabilityEpisode[]>();
  for (const e of episodes) {
    const key = `trouble:${e.kind}:${e.device_id}`;
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }
  const out: TroubleIncident[] = [];
  for (const [key, list] of byKey) {
    const [latest, ...history] = [...list].sort((a, b) => Date.parse(b.from) - Date.parse(a.from));
    out.push({ key, device_id: latest.device_id, kind: latest.kind, active: nowMs - Date.parse(latest.to) <= ACTIVE_WINDOW_MS, latest, history });
  }
  // What is happening now first, then what ended most recently.
  return out.sort((a, b) => Number(b.active) - Number(a.active) || Date.parse(b.latest.to) - Date.parse(a.latest.to));
}

export type AlertSeverity = 'critical' | 'warning' | 'notice';

/** Watts as a person reads them: "2,000 W". */
const watts = (w: number) => `${Math.round(w).toLocaleString(undefined)} W`;

/** When an episode happened, in the building's own clock, the way a person would say it. */
export function episodeWhen(e: CapabilityEpisode, active: boolean, nowMs: number): string {
  const from = Date.parse(e.from);
  const to = Date.parse(e.to);
  const day = (t: number) => siteDate(t, { weekday: 'short', day: 'numeric', month: 'short' });
  const onDay = (t: number) => (isSiteToday(t, nowMs) ? 'today' : `on ${day(t)}`);
  const start = e.clipped ? `before ${siteTimeShort(from)} ${onDay(from)}` : `${siteTimeShort(from)} ${onDay(from)}`;
  if (active) return `since ${start} (${durationText(nowMs - from)} so far)`;
  if (e.samples <= 1) return `in one reading at ${siteTimeShort(from)} ${onDay(from)}`;
  const sameDay = siteDate(from) === siteDate(to);
  const span = sameDay
    ? `${e.clipped ? 'before ' : ''}${siteTimeShort(from)} to ${siteTimeShort(to)} ${onDay(from)}`
    : `${start} to ${siteTimeShort(to)} ${onDay(to)}`;
  return `from ${span} (${durationText(to - from)})`;
}

/**
 * An incident, as a person would read it — RM-152.
 *
 * Plain words and one short source label ("From the meter") instead of a paragraph about whose verdict
 * it is. The distinction still matters, and the label keeps it: every other row in the bell is this
 * system's inference, these are the device's own report.
 */
export function describeIncident(
  incident: TroubleIncident,
  deviceName: string,
  nowMs: number,
): { title: string; body: string; severity: AlertSeverity; source: string } {
  const e = incident.latest;
  const when = episodeWhen(e, incident.active, nowMs);
  const ended = !incident.active;
  switch (incident.kind) {
    case 'power_warn': {
      const limit = e.limitW ? `The meter's own limit is ${watts(e.limitW)}.` : 'The meter has a limit set on it.';
      const peak = e.peakW ? `, peaking at ${watts(e.peakW)}` : '';
      return {
        title: `${deviceName}: power above its limit`,
        body: `${limit} ${ended ? 'It read above it' : 'It has been above it'} ${when}${peak}.`,
        severity: ended ? 'notice' : 'warning',
        source: 'From the meter',
      };
    }
    case 'fault':
      return {
        title: `${deviceName}: device fault`,
        body: `The device reported ${faultText(e.value)} ${when}.`,
        severity: ended ? 'notice' : 'critical',
        source: 'From the device',
      };
    case 'net_degraded':
      return {
        title: `${deviceName}: no network`,
        body: `The device said it could reach neither the local network nor the vendor cloud ${when}.`,
        severity: ended ? 'notice' : 'warning',
        source: 'From the device',
      };
  }
}
