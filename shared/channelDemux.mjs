/**
 * Which CT clamp a dual-channel meter is currently reporting under which dp range — decided from
 * evidence, carried between samples, and never guessed.
 *
 * WHY THIS EXISTS. `mtr_co_yellow` (channel 1, dps 103–112) and `mtr_lo_yellow` (channel 2,
 * dps 113–122) are two logical meters on one physical device. On 2026-09-19 06:21–17:20 and again on
 * 2026-09-21 05:08–09:44 (plus four short flips that day) the device reported the outlet clamp under
 * channel 2 and the lighting clamp under channel 1. The flow could not have done that: one tuya
 * session feeds two generated parsers that are pure maps of dp number to context key. The device
 * did — its own `device_state<n>` enum went to `monitor` on the channel reading 0 W / 0.000 A, its own
 * per-channel registers froze on that side and jumped by thousands of kWh at each flip. So RM-019's
 * session collapse (EX-037b) removed a possible cause and not the actual one.
 *
 * EX-035b chose to detect and not correct, because "the ACU is usually the bigger one" is a guess.
 * What changed on 2026-09-21 is that the operator stated two PHYSICAL facts, and this module applies
 * only those:
 *
 *   1. The lighting branch (L5–L7) cannot draw more than `ceiling_w`. So a channel above it IS the
 *      outlet branch — the `ceiling` rule. Certain whenever the office is working.
 *   2. The outlet branch is never at 0 A: something is always plugged in. So a channel the device
 *      holds at `monitor` / 0 A IS the lighting branch — the `idle` rule. Certain whenever the lights
 *      are off.
 *
 * When neither rule can speak — both channels working at about 40 W, which is every evening — the
 * last certain assignment is CARRIED. A flip that begins and ends inside such a window is missed, and
 * the cost is bounded by the difference between the two loads, a few watts. That is the honest
 * residual, and the state records which rule last spoke so a reader can see it.
 *
 * A flip needs TWO consecutive agreeing samples (`FLIP_AFTER`). One sample cannot move the
 * assignment: a single glitched dp would otherwise trade a day's attribution, and the next sample
 * would trade it back, twice wrong. The first ever evidence is adopted at once — there is nothing to
 * debounce against, and seeding blind would misattribute until the second sample regardless.
 *
 * NO IMPORTS, ON PURPOSE. `node-red-bridge/channelDemuxPlan.mjs` inlines this file verbatim into a
 * Node-RED function node (exactly as `build-flow.mjs` inlines `buildLatest.mjs`), and
 * `server/scrub-meter-swap.mjs` imports it as a module. One classifier, two callers — the scrub and
 * the live node cannot disagree about what a swap looks like.
 */

/** Consecutive agreeing samples before the assignment moves. */
export const FLIP_AFTER = 2;

/** Is this channel one the device is holding at nothing — `monitor`, or exactly 0 W and 0 A? */
function isIdle(c) {
  if (!c) return false;
  if (c.state === 'monitor') return true;
  return c.p === 0 && c.c === 0;
}

function hasReading(c) {
  return !!c && typeof c.p === 'number' && Number.isFinite(c.p) && typeof c.c === 'number' && Number.isFinite(c.c);
}

/**
 * One sample's evidence: `{ assignment, rule }`, or null when this sample says nothing.
 *
 * @param {{ ch1: {p:number|null,c:number|null,state:string|null}|null, ch2: object|null }} sample
 * @param {{ ceiling_w: number }} rules
 */
export function classifySample(sample, rules) {
  const a = sample && sample.ch1, b = sample && sample.ch2;
  if (!hasReading(a) || !hasReading(b)) return null;
  const ceiling = rules.ceiling_w;

  // Rule 1 — physics: only the outlet branch can be above the ceiling.
  const aOver = a.p > ceiling, bOver = b.p > ceiling;
  if (aOver && bOver) return null;
  if (bOver) return { assignment: 'swapped', rule: 'ceiling' };
  if (aOver) return { assignment: 'direct', rule: 'ceiling' };

  // Rule 2 — the outlet branch is never idle, so the idle channel is the lighting branch.
  const aIdle = isIdle(a), bIdle = isIdle(b);
  if (aIdle && bIdle) return null;
  if (aIdle) return { assignment: 'swapped', rule: 'idle' };
  if (bIdle) return { assignment: 'direct', rule: 'idle' };

  return null;
}

/**
 * Advance the assignment state by one sample. Pure: returns a new state, never mutates.
 *
 * State shape: `{ assignment, rule, since, lastRule, pending }` — `rule`/`since` describe the
 * evidence that established the current assignment; `lastRule` is what the latest sample
 * contributed (`'carry'` when nothing); `pending` is a contradicting candidate being debounced.
 *
 * @param {object|null} state
 * @param {{ ts: number, ch1: object|null, ch2: object|null }} sample
 * @param {{ ceiling_w: number }} rules
 */
export function nextChannelState(state, sample, rules) {
  const ev = classifySample(sample, rules);

  if (!state) {
    if (ev) return { assignment: ev.assignment, rule: ev.rule, since: sample.ts, lastRule: ev.rule, pending: null };
    return { assignment: 'direct', rule: 'seed', since: sample.ts, lastRule: 'seed', pending: null };
  }

  if (!ev) return { ...state, lastRule: 'carry' };

  if (ev.assignment === state.assignment) {
    return { ...state, lastRule: ev.rule, pending: null };
  }

  const count = state.pending && state.pending.assignment === ev.assignment ? state.pending.count + 1 : 1;
  if (count >= FLIP_AFTER) {
    return { assignment: ev.assignment, rule: ev.rule, since: sample.ts, lastRule: ev.rule, pending: null };
  }
  return { ...state, lastRule: ev.rule, pending: { assignment: ev.assignment, rule: ev.rule, count } };
}

/**
 * dp -> dp: each channel-1 dp paired with the channel-2 dp of the same base code, both ways.
 * Device-wide dps (no channel) are absent, so `renumberDps` leaves them where they are.
 *
 * @param {{ capabilities: ReadonlyArray<{dp:number, base:string, channel:number|null}> }} profile
 */
export function dpSwapMapFor(profile) {
  const byBase = {};
  for (const cap of profile.capabilities) {
    if (cap.channel == null) continue;
    (byBase[cap.base] = byBase[cap.base] || {})[cap.channel] = cap.dp;
  }
  const map = {};
  for (const base in byBase) {
    const pair = byBase[base];
    if (pair[1] == null || pair[2] == null) continue;
    map[pair[1]] = pair[2];
    map[pair[2]] = pair[1];
  }
  return map;
}

/** A copy of `dps` with every key in `map` moved to its twin. Its own inverse. */
export function renumberDps(dps, map) {
  const out = {};
  for (const k in dps) {
    const to = map[k];
    out[to == null ? k : to] = dps[k];
  }
  return out;
}

/**
 * The classifier's inputs from raw dps, at the catalogue's scale. A channel with no reading yet is
 * `{ p: null, c: null, state: null }` — absent is not zero, here as everywhere else in this system.
 */
export function readChannels(rawDps, profile) {
  const find = (base, channel) => profile.capabilities.find((c) => c.base === base && c.channel === channel);
  const num = (cap) => {
    if (!cap || rawDps[cap.dp] === undefined || rawDps[cap.dp] === null) return null;
    const n = Number(rawDps[cap.dp]);
    return Number.isFinite(n) ? Math.round((n / Math.pow(10, cap.scale || 0)) * 1e6) / 1e6 : null;
  };
  const str = (cap) => (cap && rawDps[cap.dp] !== undefined && rawDps[cap.dp] !== null ? String(rawDps[cap.dp]) : null);
  const one = (n) => ({ p: num(find('cur_power', n)), c: num(find('cur_current', n)), state: str(find('device_state', n)) });
  return { ch1: one(1), ch2: one(2) };
}

/** Decoded capability codes traded between channels — `cur_power1` <-> `cur_power2` — by base code. */
export function swapChannelCodes(caps, profile) {
  const twin = {};
  for (const cap of profile.capabilities) {
    if (cap.channel == null) continue;
    const other = profile.capabilities.find((o) => o.base === cap.base && o.channel != null && o.channel !== cap.channel);
    if (other) twin[cap.code] = other.code;
  }
  const out = {};
  for (const k in caps) out[twin[k] || k] = caps[k];
  return out;
}
