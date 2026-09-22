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
 * AND A SECOND CLOCK FOR THE REGISTERS (RM-133). On 2026-09-22 the yellow meter's channel 2 held
 * 39.8 W from 07:43 with the lights off, and from 10:58 its voltage dp followed channel 1's, because
 * the voltage is one measurement shared by both clamps. That restarted the v/c/p clock every minute.
 * (RM-134 found the held value was the bridge's, not the clamp's. The meters were never polled, and
 * the change to 0 W was pushed while the Pi was rebooting. The register clock is what caught it.) So the device's OWN energy registers (`today_acc_energy<n>`,
 * `total_energy<n>` in `dp`, never the shared `all_energy`) get a clock of their own: a clamp that
 * is measuring moves its counter; a shared voltage proves nothing. `buildLatest` applies
 * `shared/measurementFreeze.mjs`'s stall rule to it. A device whose `dp` carries no register (the
 * outlets) gets no register clock, so nothing can call it stalled.
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
    const prev = seen[k] || {};
    // A value change restarts the value clock and carries the register clock over untouched.
    const entry = prev.sig === sig ? prev : { sig: sig, since: now, reg: prev.reg, regSince: prev.regSince };
    // The channel's own registers, by code. all_energy is both clamps' sum and is left out.
    const dp = m.dp && typeof m.dp === 'object' ? m.dp : {};
    const codes = Object.keys(dp).filter(function (c) { return /^(today_acc_energy|total_energy)\\d*$/.test(c); }).sort();
    if (codes.length) {
      const reg = codes.map(function (c) { return c + '=' + dp[c]; }).join('|');
      if (entry.reg !== reg) { entry.reg = reg; entry.regSince = now; }
    }
    seen[k] = entry;
  }
}
flow.set('value_freeze', seen);
const since = {};
const regSince = {};
for (const k of Object.keys(seen)) {
  since[k] = seen[k].since;
  if (seen[k].regSince !== undefined) regSince[k] = seen[k].regSince;
}
msg.snapshot = snap;
msg.snapshot.valueSince = since;
msg.snapshot.registerSince = regSince;
return msg;`;

/**
 * Runs the tracker against a fake flow context, for tests. `nowMs` overrides `Date.now` for the call,
 * so the code under test is byte-identical to the code that ships.
 */
export function runValueFreezeTracker(store, snapshot, nowMs) {
  return runValueFreezeTrackerFull(store, snapshot, nowMs).valueSince;
}

/** As above, returning both clocks: `{ valueSince, registerSince }`. */
export function runValueFreezeTrackerFull(store, snapshot, nowMs) {
  const fn = new Function('flow', 'msg', VALUE_FREEZE_SRC);
  const flow = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
  const realNow = Date.now;
  if (typeof nowMs === 'number') Date.now = () => nowMs;
  try {
    const out = fn(flow, { snapshot }).snapshot;
    return { valueSince: out.valueSince, registerSince: out.registerSince };
  } finally {
    Date.now = realNow;
  }
}
