/**
 * Adds a periodic refresh for the outlet nodes, as a pure function over the flow array.
 *
 * WHY (ROADMAP FI-013): nothing in the flow ever asks an outlet for its state. The seven
 * `Cron O*` injects drive schedule logic and the 180 s triggers feed Google Sheets; neither
 * touches the device. So an outlet's reading only advances when it spontaneously reports a
 * change, and `<ctx>_last_time` stalls in between.
 *
 * That is not merely stale display. `readings` is keyed `(device_id, ts)` and ingestion upserts,
 * so a stalled timestamp overwrites its own row instead of adding one — an idle outlet
 * contributes far fewer samples than a meter over the same window. Measured 2026-08-24: `co1`
 * had 40 samples against a switch's 60 in the same hour. Every per-outlet figure downstream
 * inherits that: analytics gaps, thinner monthly-report coverage, and an uptime percentage
 * computed over a different denominator than its neighbours.
 *
 * The `tuya-smart-device` node accepts `{ operation: 'GET' }` on its input and answers on the
 * same output the device's own reports use, so the existing parser handles the reply unchanged.
 * Nothing downstream needs to know a poll happened.
 */

/** Deterministic ids so re-running produces the same plan rather than a growing pile of nodes. */
export const POLL_INJECT_ID = 'bems_outlet_poll_tick';
export const POLL_FN_ID = 'bems_outlet_poll_cmd';

/** 60s matches the ingestion cadence: polling faster would write rows nothing reads. */
export const POLL_INTERVAL_S = 60;

const POLL_FN = `// Ask each outlet for its current state. The tuya node answers on its normal
// output, so the existing parser handles the reply exactly as it handles a
// spontaneous report — see node-red-bridge/outletPollPlan.mjs.
msg.payload = { operation: 'GET' };
return msg;`;

/** The outlet device nodes, in flow order. */
export function outletNodes(flows) {
  return flows.filter((n) => n?.type === 'tuya-smart-device' && /^CO\d$/.test(n.deviceName ?? ''));
}

export function planOutletPoll(flows) {
  const outlets = outletNodes(flows);
  if (!outlets.length) return { flows, added: [], targets: [], unchanged: true, reason: 'no outlet nodes found' };

  // Idempotent: if the poller is already there, adding a second would double the traffic.
  if (flows.some((n) => n.id === POLL_INJECT_ID || n.id === POLL_FN_ID)) {
    return { flows, added: [], targets: [], unchanged: true, reason: 'poller already present' };
  }

  const z = outlets[0].z;
  // Placed clear of the existing layout rather than overlapping it — a node dropped on top of
  // another is invisible in the editor, and someone will open this flow eventually.
  const inject = {
    id: POLL_INJECT_ID,
    type: 'inject',
    z,
    name: 'Poll outlets',
    props: [{ p: 'payload' }],
    repeat: String(POLL_INTERVAL_S),
    once: true,
    onceDelay: '10',
    topic: '',
    payload: '',
    payloadType: 'date',
    x: 140,
    y: 1400,
    wires: [[POLL_FN_ID]],
  };
  const fn = {
    id: POLL_FN_ID,
    type: 'function',
    z,
    name: 'Outlet poll command',
    func: POLL_FN,
    outputs: 1,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 360,
    y: 1400,
    wires: [outlets.map((n) => n.id)],
  };

  return {
    flows: [...flows, inject, fn],
    added: [inject, fn],
    targets: outlets.map((n) => n.deviceName),
    unchanged: false,
    reason: null,
  };
}

/** Invariants, asserted by name rather than count — same reasoning as sessionCollapsePlan. */
export function validateOutletPoll(before, after) {
  const problems = [];

  if (after.length !== before.length + 2) problems.push(`expected exactly 2 new nodes, got ${after.length - before.length}`);

  // Nothing may be removed or rewired. This patch only ADDS: if an existing node changed, the
  // plan has done something it was not asked to.
  const beforeById = new Map(before.map((n) => [n.id, JSON.stringify(n)]));
  for (const n of after) {
    const original = beforeById.get(n.id);
    if (original !== undefined && original !== JSON.stringify(n)) problems.push(`existing node ${n.name ?? n.id} was modified`);
  }
  for (const id of beforeById.keys()) {
    if (!after.some((n) => n.id === id)) problems.push(`node ${id} would be removed`);
  }

  const ids = new Set(after.map((n) => n.id));
  for (const n of after) {
    for (const t of (n.wires ?? []).flat()) {
      if (!ids.has(t)) problems.push(`${n.name ?? n.id} wires to non-existent ${t}`);
    }
  }

  // The poller must actually reach every outlet, or it half-fixes the problem and nobody notices.
  const fn = after.find((n) => n.id === POLL_FN_ID);
  const outletIds = new Set(outletNodes(after).map((n) => n.id));
  const wired = new Set((fn?.wires ?? []).flat());
  for (const id of outletIds) if (!wired.has(id)) problems.push(`outlet ${id} would not be polled`);

  return problems;
}
