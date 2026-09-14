/**
 * The 24h history ring buffer behind `GET /api/readings/history` — moved out of `build-flow.mjs`
 * (RM-079) so a test can execute it, the same move `energyAccumulator.mjs` made.
 *
 * WHAT CHANGED WHEN IT MOVED. Each sample now carries `sample_ts`, the tick that took it, beside
 * `ts`, which `buildLatest` sets to when the device last REPORTED. The frontend used to have to
 * reconstruct which tick a sample belonged to from arrival stamps alone: `mtr_lo_red` had 298
 * intervals of 1-29 s and 347 of 90-129 s in one day, and a device that stopped reporting carries the
 * same arrival stamp on every sample, so its samples could not be told apart at all (RM-076). With the
 * tick, every device's sample from one pass sits on the same instant. A sample also carries
 * `frozen: true` when `buildLatest` flagged the reading, so stored history keeps what the live reading
 * said.
 *
 * Everything else is exactly what it was, and the reasoning for each rule is kept with it below.
 *
 * NOTE: worthless unless `settings.js` enables `contextStorage.localfilesystem` — otherwise this is
 * memory-only and a restart wipes it.
 */

/** @param {number} cap samples kept per device — `TIMING.HISTORY_MAX_POINTS`. */
export const appendHistorySrc = (cap) => `
// Ring buffer. Required because no 24h history exists anywhere in the live flow:
// the *_arr_* keys are 3-minute averaging buffers that get emptied each cycle, and
// the ui_chart nodes' 12h window is locked inside the dashboard with no API.
// NOTE: worthless unless settings.js enables contextStorage.localfilesystem —
// otherwise this is memory-only and a restart wipes it.
const CAP = ${cap};
const rows = Array.isArray(msg.payload) ? msg.payload : [];
// The tick that took this pass (RM-079), read once so every device's sample carries the same
// instant. ts stays what buildLatest set: when the device itself last reported.
const tick = new Date(Date.now()).toISOString();
for (const r of rows) {
  if (r.device_id === '_totals') continue;
  if (typeof r.power_w !== 'number') continue;
  const key = 'hist_' + r.device_id;
  const buf = flow.get(key) || [];
  // voltage/current are recorded alongside power so Analytics can chart them over time,
  // not just as instantaneous values. Each is written ONLY when the poll actually carried
  // it — same "omitted, never zeroed" rule buildLatest follows, so a point predating this
  // change (or a meter that didn't report V/A) stays a gap in the chart rather than a
  // fabricated 0. Points already in the buffer keep power only; V/A accrues going forward.
  const p = { ts: r.ts, power_w: r.power_w };
  if (typeof r.voltage === 'number') p.voltage = r.voltage;
  if (typeof r.current === 'number') p.current = r.current;
  // Whether the device was actually reporting when this sample was taken (FI-010). Every
  // meter's last known wattage is carried forward into each sample, so without this a device
  // offline all day drew a confident flat line for hardware that was not reporting — the same
  // dishonesty already fixed for the 7d/30d charts. Written only when it is a real boolean, so
  // points from a bridge that never reported it stay unknown rather than being assumed online.
  if (typeof r.online === 'boolean') p.online = r.online;
  p.sample_ts = tick;
  // Written only when buildLatest flagged the reading (RM-079), so history keeps what the live
  // reading said. Absent means not flagged, never "known not frozen".
  if (r.measurement_frozen === true) p.frozen = true;
  buf.push(p);
  if (buf.length > CAP) buf.splice(0, buf.length - CAP);
  flow.set(key, buf);
}
return null;`;

/**
 * Runs the ring against a fake flow context, for tests. `nowMs` overrides `Date.now` for the call,
 * so the code under test is byte-identical to the code that ships.
 */
export function runAppendHistory(store, rows, nowMs, cap) {
  const fn = new Function('flow', 'msg', appendHistorySrc(cap));
  const flow = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
  const realNow = Date.now;
  if (typeof nowMs === 'number') Date.now = () => nowMs;
  try {
    fn(flow, { payload: rows });
  } finally {
    Date.now = realNow;
  }
  return store;
}
