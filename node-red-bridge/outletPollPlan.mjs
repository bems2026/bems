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

/**
 * One output per outlet, so an outlet the bridge already knows is disconnected can be skipped
 * rather than sent a message it cannot answer.
 *
 * WHY: measured on the Pi 2026-09-01, the three outlets that are off the network entirely
 * (RM-020, waiting on somebody to power-cycle them at the office) produced **180**
 * `Device not connected` lines and a large share of **490** `find() timed out` lines every
 * thirty minutes, forever — one poll each per minute, each failing. Nothing else in the journal
 * was doing this. It is not harmful, but a log whose steady state is 6 errors a minute is a log
 * nobody reads, and this project has already had a real fault sit unnoticed inside exactly that
 * kind of noise.
 *
 * SELF-HEALING, which is why this is preferred over quiescing them. `quiescePlan` sets
 * `disableAutoStart`, which stops the node reconnecting at all and would need a manual `--undo`
 * after the site visit — and it would not stop the poller sending to a stopped node anyway.
 * Here the tuya node's own reconnect loop is untouched, so the moment a device comes back its
 * parser sets `<ctx>_health` true and polling resumes with nobody doing anything.
 *
 * `!== false` rather than `=== true`: a flow whose context has been wiped, or an outlet that has
 * never reported, has no health key at all, and refusing to poll it would be the one thing that
 * could keep it silent forever. Unknown must poll.
 */
const POLL_FN = `// Ask each outlet for its current state. The tuya node answers on its normal
// output, so the existing parser handles the reply exactly as it handles a
// spontaneous report — see node-red-bridge/outletPollPlan.mjs.
//
// One output per outlet. An outlet the parser has flagged disconnected is skipped:
// polling it cannot succeed and only fills the journal with "Device not connected".
// Unknown (no health key yet) is polled — refusing to would keep a device that has
// never reported silent forever.
const ctxs = CTXS;
const poll = { operation: 'GET' };
return ctxs.map(function (c) {
  return flow.get(c + '_health') === false ? null : { payload: poll };
});`;

/** The poll function body for a given ordered list of context prefixes. */
export function pollFnFor(ctxs) {
  return POLL_FN.replace('CTXS', JSON.stringify(ctxs));
}

/** The outlet device nodes, in flow order. */
export function outletNodes(flows) {
  return flows.filter((n) => n?.type === 'tuya-smart-device' && /^CO\d$/.test(n.deviceName ?? ''));
}

/**
 * The flow-context prefix each outlet node's parser writes.
 *
 * Derived by lowercasing the node name, which is the same naming convention `outletNodes`
 * already depends on to find them at all. Deriving rather than being handed the registry keeps
 * this module pure over the flow, like its siblings — and if the convention ever breaks, the
 * poller stops skipping rather than starts skipping the wrong device: an unknown health key
 * reads as "poll it", which is the safe direction.
 */
export function outletCtxs(flows) {
  return outletNodes(flows).map((n) => String(n.deviceName).toLowerCase());
}

export function planOutletPoll(flows) {
  const outlets = outletNodes(flows);
  if (!outlets.length) return { flows, added: [], targets: [], unchanged: true, reason: 'no outlet nodes found' };

  const existingFn = flows.find((n) => n.id === POLL_FN_ID);
  const wantedFunc = pollFnFor(outletCtxs(flows));

  // An earlier poller is UPGRADED rather than left alone. The first version had one output
  // wired to every outlet at once, so it could not skip a device that was down — which is the
  // whole point of this revision. "Already present, nothing to do" would have silently declined
  // to fix the thing somebody ran this to fix.
  if (existingFn) {
    const upToDate = existingFn.func === wantedFunc && existingFn.outputs === outlets.length;
    if (upToDate) return { flows, added: [], targets: [], unchanged: true, reason: 'poller already present and current' };

    const upgraded = flows.map((n) =>
      n.id === POLL_FN_ID
        ? { ...n, func: wantedFunc, outputs: outlets.length, wires: outlets.map((o) => [o.id]) }
        : n,
    );
    return {
      flows: upgraded,
      added: [],
      upgraded: [POLL_FN_ID],
      targets: outlets.map((n) => n.deviceName),
      unchanged: false,
      reason: 'poller upgraded to skip disconnected outlets',
    };
  }

  // Idempotent: if only the inject is there, adding a second would double the traffic.
  if (flows.some((n) => n.id === POLL_INJECT_ID)) {
    return { flows, added: [], targets: [], unchanged: true, reason: 'poll inject present without its function — repair by hand' };
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
    func: wantedFunc,
    // One output per outlet, so a disconnected one can be skipped by returning null in its
    // slot. A single output wired to all of them cannot express "all but that one".
    outputs: outlets.length,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 360,
    y: 1400,
    wires: outlets.map((n) => [n.id]),
  };

  return {
    flows: [...flows, inject, fn],
    added: [inject, fn],
    targets: outlets.map((n) => n.deviceName),
    unchanged: false,
    reason: null,
  };
}

/**
 * Invariants, asserted by name rather than count — same reasoning as sessionCollapsePlan.
 *
 * Two shapes are legal now: a first install, which ADDS exactly two nodes and modifies nothing,
 * and an upgrade of an existing poller, which adds NOTHING and modifies exactly one node — the
 * poll function. Allowing both is not a weakening: each is checked to be only itself, and an
 * upgrade that touched anything besides `POLL_FN_ID` still fails.
 */
export function validateOutletPoll(before, after) {
  const problems = [];

  const added = after.length - before.length;
  const isUpgrade = added === 0;
  if (added !== 2 && added !== 0) problems.push(`expected 2 new nodes (install) or 0 (upgrade), got ${added}`);

  // On an install nothing existing may change at all. On an upgrade the ONLY node permitted to
  // differ is the poll function: an upgrade that rewired a tuya node would be doing something
  // nobody asked for, on a tab carrying live control logic.
  const beforeById = new Map(before.map((n) => [n.id, JSON.stringify(n)]));
  for (const n of after) {
    const original = beforeById.get(n.id);
    if (original === undefined || original === JSON.stringify(n)) continue;
    if (isUpgrade && n.id === POLL_FN_ID) continue;
    problems.push(`existing node ${n.name ?? n.id} was modified`);
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
  const outlets = outletNodes(after);
  const wired = new Set((fn?.wires ?? []).flat());
  for (const o of outlets) if (!wired.has(o.id)) problems.push(`outlet ${o.deviceName ?? o.id} would not be polled`);

  // One output per outlet, each wired to exactly one. A single output fanned out to all of them
  // is the shape this revision replaces: it cannot skip a device that is down, because there is
  // no per-outlet slot to return null in.
  if (fn) {
    if (fn.outputs !== outlets.length) problems.push(`poll function has ${fn.outputs} output(s) for ${outlets.length} outlets`);
    for (const [i, targets] of (fn.wires ?? []).entries()) {
      if ((targets ?? []).length !== 1) problems.push(`poll output ${i} wires to ${(targets ?? []).length} nodes; each output must drive exactly one outlet`);
    }
    // The function must consult each outlet's health key, or the outputs exist and skip nothing.
    for (const ctx of outletCtxs(after)) {
      if (!fn.func.includes(`"${ctx}"`)) problems.push(`poll function does not name ${ctx}, so that outlet cannot be skipped when it is down`);
    }
  }

  return problems;
}
