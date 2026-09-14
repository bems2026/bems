/**
 * When each metered device's measurement last MOVED — the source of `snapshot.valueSince` (RM-079).
 *
 * WHY IT EXISTS BESIDE `arrivalTracker.mjs`. That tracker answers "is this device still reporting?",
 * and its signature deliberately includes the tab's sample-buffer depth `n`, which grows on every
 * message. A frozen meter keeps sending messages. On 2026-09-12 L.O Red repeated one reading for
 * fifteen hours and never looked stale, because it never was: it was reporting, and reporting the same
 * numbers. This asks the narrower question — have the measured values themselves changed?
 *
 * THE SIGNATURE IS v, c AND p, AND NOTHING ELSE.
 *   - Not `n`: it moves on every message, frozen or not. That is the reason this module exists.
 *   - Not `e`: the legacy integrator moves it on a TIMER from the last known power, so a frozen meter
 *     drawing power moves it constantly — the fault itself would reset the clock that detects it.
 *   - Not `h`: going offline is a louder fact with its own handling; `buildLatest` does not call an
 *     offline device frozen.
 *
 * STAMPED ON CHANGE, NOT ON READ. This node sits on the read path, which runs on the 2 s WebSocket
 * push and on every HTTP GET — a cadence set by how many people are looking. RM-056 was a rate check
 * that timestamped every RUN and so tightened as more clients connected; this timestamps only a
 * change, so how often it runs cannot move the answer.
 *
 * What it produces is only a timestamp per device. Whether that is long enough to call frozen, and
 * whether the device is drawing power and online, is `buildLatest`'s decision against
 * `shared/measurementFreeze.mjs`.
 *
 * Kept as a source string because it is injected verbatim into a Node-RED function node, and
 * exported with a runner so `test/value-freeze-tracker.test.mjs` executes what ships — the same
 * reasoning as `arrivalTracker.mjs` and `energyDayBase.mjs`.
 *
 * NOTE: like the history ring, this is only durable if `settings.js` enables
 * `contextStorage.localfilesystem`. Without it a restart starts every clock at zero, which is the safe
 * direction: no freeze is invented, one is merely found later.
 */
export const VALUE_FREEZE_SRC = `
const now = Date.now();
const seen = flow.get('value_freeze') || {};
const snap = msg.snapshot || {};
const groups = [((snap.energy || {}).meters) || {}, ((snap.outlet || {}).meters) || {}];
for (const meters of groups) {
  for (const k of Object.keys(meters)) {
    const m = meters[k] || {};
    // v, c and p only. Not n, which grows on every message; not e, which the integrator moves on a
    // timer from the last power. See valueFreezeTracker.mjs.
    const sig = [m.v, m.c, m.p].join('|');
    const prev = seen[k];
    if (!prev || prev.sig !== sig) seen[k] = { sig: sig, since: now };
  }
}
flow.set('value_freeze', seen);
const since = {};
for (const k of Object.keys(seen)) since[k] = seen[k].since;
msg.snapshot = snap;
msg.snapshot.valueSince = since;
return msg;`;

/**
 * Runs the tracker against a fake flow context, for tests. `nowMs` overrides `Date.now` for the call,
 * so the code under test is byte-identical to the code that ships.
 */
export function runValueFreezeTracker(store, snapshot, nowMs) {
  const fn = new Function('flow', 'msg', VALUE_FREEZE_SRC);
  const flow = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
  const realNow = Date.now;
  if (typeof nowMs === 'number') Date.now = () => nowMs;
  try {
    return fn(flow, { snapshot }).snapshot.valueSince;
  } finally {
    Date.now = realNow;
  }
}
