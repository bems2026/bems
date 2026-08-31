/**
 * When each energy meter last actually REPORTED — the source of `snapshot.arrivals`.
 *
 * WHY IT EXISTS. The energy tab's parsers write no timestamp of any kind, unlike the outlet
 * tab's (`<ctx>_last_time`). So `buildLatest` has no per-meter arrival stamp to read and would
 * otherwise stamp `ts = now` for every meter — an always-fresh timestamp that can never look
 * old, which is precisely how a fleet-wide outage went unnoticed for half an hour on 2026-08-26.
 * This node supplies the missing signal by watching for change between polls.
 *
 * THE SIGNATURE IS THE WHOLE DESIGN, so it is worth saying exactly what is in it and why.
 *
 * `n` — the depth of the tab's own sample buffer (`<ctx>_arr_v`). The tab appends one entry per
 * message and drains on a five-minute cycle, so this moves when the meter REPORTS, including
 * when its measured values do not. That is the case that matters: `mtr_lo_yellow` and
 * `mtr_co_yellow` are two channels of one physical meter, and over ten minutes the first sat
 * byte-identical at 0 W while the second swung between 215 V and 229 V. Treating "the numbers
 * stopped moving" as death would have marked a healthy idle circuit offline and quietly
 * subtracted it from the building totals.
 *
 * `v`, `c`, `p`, `h` — written by the parser only when a message arrives, so they corroborate
 * `n` and cost nothing.
 *
 * `e` IS DELIBERATELY EXCLUDED, and it used to be included. Measured on the Pi 2026-09-01: over
 * fourteen seconds in which `co_yel_arr_v` stayed at length 1 — no message at all — `co_yel_energy`
 * moved 0.14347 → 0.14351 → 0.14355. The energy accumulator is integrated on a TIMER from each
 * meter's last known power, not on arrival, so including it made a meter drawing power look like
 * it was reporting every two seconds when it was really reporting about once a minute.
 *
 * That was not merely imprecise. `buildLatest`'s `STALE_READING_MS` rule exists as the BACKSTOP
 * for when a meter's health flag lies — the exact failure that had left three metered channels
 * unable to report a disconnect at all until 2026-09-01. A meter that died while drawing power
 * would keep producing "arrivals" from its own frozen wattage, so the backstop could never fire
 * for it, and the two independent signals were not independent. Dropping `e` restores that.
 *
 * (The accumulator is gated on the health flag, so in practice `e` freezes once health goes
 * false. That is exactly the coupling being removed: a backstop must not depend on the signal it
 * is backing up.)
 *
 * Kept as a source string because it is injected verbatim into a Node-RED function node, and
 * exported so `arrival-tracker.test.mjs` can EXECUTE it rather than pattern-match against it —
 * matching what the outlet poller's tests do, for the same reason: what ships is the string.
 */
export const TRACK_ARRIVALS_SRC = `
const now = Date.now();
const seen = flow.get('meter_arrivals') || {};
const meters = ((msg.snapshot || {}).energy || {}).meters || {};
for (const k of Object.keys(meters)) {
  const m = meters[k] || {};
  // NOT m.e — it is integrated on a timer rather than on arrival. See arrivalTracker.mjs.
  const sig = [m.n, m.v, m.c, m.p, m.h].join('|');
  const prev = seen[k];
  if (!prev || prev.sig !== sig) seen[k] = { sig: sig, at: now };
}
flow.set('meter_arrivals', seen);
const arrivals = {};
for (const k of Object.keys(seen)) arrivals[k] = seen[k].at;
msg.snapshot = msg.snapshot || {};
msg.snapshot.arrivals = arrivals;
return msg;`;

/**
 * Runs the tracker against a fake flow context, for tests.
 *
 * `stamping unseen meters with now on first run` is deliberate and preserved: after a restart
 * nothing has any history, and the safe reading of "no evidence yet" is not "offline".
 */
export function runArrivalTracker(store, snapshot) {
  const fn = new Function('flow', 'msg', TRACK_ARRIVALS_SRC);
  const flow = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
  const msg = { snapshot };
  return fn(flow, msg).snapshot.arrivals;
}
