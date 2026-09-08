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

    if (current && current.value === s.value && gap <= EPISODE_GAP_MS) {
      current.to = s.ts;
      current.samples += 1;
    } else {
      if (current) out.push(current);
      open.set(s.device_id, {
        device_id: s.device_id, kind, value: s.value, from: s.ts, to: s.ts, samples: 1,
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

/** How long an episode ran, said the way a person would say it. */
function spanText(episode: CapabilityEpisode): string {
  if (episode.samples <= 1) return 'in one reading';
  const ms = Date.parse(episode.to) - Date.parse(episode.from);
  if (!Number.isFinite(ms) || ms < 60_000) return `across ${episode.samples} readings`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `for ${minutes} min`;
  return `for ${Math.round(minutes / 60)} h`;
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
 * One episode, as a person would read it.
 *
 * The wording keeps one distinction throughout: this is what the DEVICE said about itself, not
 * what this system inferred. Every other row in the alerts list is an inference — a watchdog, a
 * z-score, a fleet heuristic — and where the two disagree the device is the one wired to the
 * circuit.
 */
export function describeEpisode(
  episode: CapabilityEpisode,
  deviceName: string,
): { title: string; body: string } {
  const when = spanText(episode);
  switch (episode.kind) {
    case 'fault':
      return {
        title: `${deviceName} reported a fault`,
        body: `The device itself raised ${faultText(episode.value)}, ${when}.`,
      };
    case 'power_warn':
      return {
        title: `${deviceName} raised its own power warning`,
        body: `The meter reported it was over the warning threshold set on it, ${when}. This is the device's verdict, not a threshold this system evaluated.`,
      };
    case 'net_degraded':
      return {
        title: `${deviceName} reported no network`,
        body: `The device said it could reach neither the local segment nor the vendor cloud, ${when}. A device that goes dark having last reported this was already in trouble.`,
      };
  }
}
