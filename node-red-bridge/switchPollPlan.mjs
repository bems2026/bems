/**
 * Adds a periodic refresh for the light-switch nodes, as a pure function over the flow array.
 *
 * WHY. A light switch reports when its relay changes and at almost no other time. That was fine
 * while the only thing read from it was on/off — but a `tdq` switch also holds a countdown, a
 * power-on mode, a switch type and an inching setting, and those change so rarely that a device
 * may never volunteer them at all. Measured on the Pi after the generated collector went live:
 * all seven lights were online, reporting relay state, and carrying **no capabilities**, while
 * every outlet and meter had a full set within minutes. The outlets only had one because
 * `outletPollPlan` already asks them.
 *
 * So this is the same fix as FI-013, for the class that was left out of it. Sending
 * `{ operation: 'GET' }` to a `tuya-smart-device` node makes it query the device and answer on
 * the SAME output the device's own reports use, so `tag L<n>` and `Collect status` handle the
 * reply exactly as they handle a spontaneous one. Nothing downstream needs to know a poll
 * happened.
 *
 * WHAT THIS DOES NOT FIX. A switch's reading still carries `ts = now` rather than a real arrival
 * time, so its freshness remains unmeasurable — that is FI-020, and closing it means threading
 * `lightStatus[n].lastSeen` into `buildLatest`, which changes the staleness behaviour of seven
 * live devices and deserves its own change. Note the interaction before anyone tries: `switch`
 * has a 30 s staleness budget and this polls every 60 s, so wiring the timestamp through WITHOUT
 * also widening that budget would make every light read stale for half of every minute. That is
 * exactly the fault EX-133 found on the outlets.
 *
 * Pure: takes a flow array, returns a plan. `poll-switches.mjs` applies it, dry-run by default.
 */

/** Deterministic ids so re-running produces the same plan rather than a growing pile of nodes. */
export const POLL_INJECT_ID = 'bems_switch_poll_tick';
export const POLL_FN_ID = 'bems_switch_poll_cmd';

/**
 * 60 s, matching the outlet poller and the ingestion cadence.
 *
 * Faster would buy nothing: these are settings that change when a person changes them, and the
 * relay state already arrives on its own. Slower would leave a freshly restarted flow without
 * capabilities for longer than an operator would wait before deciding the feature is broken.
 */
export const POLL_INTERVAL_S = 60;

/**
 * One output per switch, so a light already known to be disconnected can be skipped rather than
 * sent a message it cannot answer — the lesson `outletPollPlan` paid for, where three dead
 * outlets produced 180 `Device not connected` lines every thirty minutes, forever.
 *
 * Health comes from `global.lightStatus`, not from a `<ctx>_health` key: switches have no
 * metering context at all, which is the same reason their capabilities ride on the lightStatus
 * entry rather than on `<ctx>_dp`.
 *
 * `conn !== 'CONNECTED'` only skips when we positively know otherwise. A light with no entry, or
 * one whose context was wiped, is polled — refusing to would be the one thing that could keep a
 * device that has never reported silent forever. Unknown must poll.
 */
const POLL_FN = `// Ask each light for its current state. The tuya node answers on its normal
// output, so \`tag L<n>\` and \`Collect status\` handle the reply exactly as they
// handle a spontaneous report — see node-red-bridge/switchPollPlan.mjs.
//
// One output per switch. A light already flagged disconnected is skipped: polling
// it cannot succeed and only fills the journal with "Device not connected".
// Unknown (no lightStatus entry yet) is polled — refusing to would keep a light
// that has never reported silent forever.
const ids = IDS;
const poll = { operation: 'GET' };
const health = global.get('lightStatus') || {};
return ids.map(function (id) {
  const entry = health[id];
  return (entry && entry.conn && entry.conn !== 'CONNECTED') ? null : { payload: poll };
});`;

/** The poll function body for a given ordered list of light ids. */
export function pollFnFor(ids) {
  return POLL_FN.replace('IDS', JSON.stringify(ids));
}

/**
 * The light-switch device nodes, in flow order.
 *
 * Matched on `Light Switch <n>`, the same convention `shared/tuyaNodeSettings.mjs` keys its
 * protocol-version declarations on and `server/cloudDispatchConfig.mjs` uses to map a vendor id
 * back to a registry id. Three places depending on it is an argument for keeping it, not for
 * inventing a fourth spelling here.
 */
export function switchNodes(flows) {
  return flows.filter((n) => n?.type === 'tuya-smart-device' && /^Light Switch \d+$/.test(n.deviceName ?? ''));
}

/**
 * The `lightStatus` key each switch node's status is recorded under.
 *
 * `Collect status` keys on `msg.lightId`, which the `tag L<n>` change node sets to the NUMBER
 * n — so these are numbers, and `buildLatest` reads them back as `state_key.slice(1)`, a string.
 * That round-trip works because object keys are strings either way, and it is the reason this
 * derives the id from the node name rather than assuming flow order.
 */
export function switchIds(flows) {
  return switchNodes(flows).map((n) => Number(String(n.deviceName).replace(/\D+/g, '')));
}

export function planSwitchPoll(flows) {
  const switches = switchNodes(flows);
  if (!switches.length) return { flows, added: [], targets: [], unchanged: true, reason: 'no light switch nodes found' };

  const wantedFunc = pollFnFor(switchIds(flows));
  const existingFn = flows.find((n) => n.id === POLL_FN_ID);

  // An existing poller is UPGRADED rather than left alone, for the reason outletPollPlan
  // records: "already present, nothing to do" would silently decline to fix the thing somebody
  // ran this to fix.
  if (existingFn) {
    const upToDate = existingFn.func === wantedFunc && existingFn.outputs === switches.length;
    if (upToDate) return { flows, added: [], targets: [], unchanged: true, reason: 'poller already present and current' };

    const upgraded = flows.map((n) =>
      n.id === POLL_FN_ID
        ? { ...n, func: wantedFunc, outputs: switches.length, wires: switches.map((s) => [s.id]) }
        : n,
    );
    return {
      flows: upgraded,
      added: [],
      upgraded: [POLL_FN_ID],
      targets: switches.map((n) => n.deviceName),
      unchanged: false,
      reason: 'poller upgraded to match the current switch set',
    };
  }

  // Idempotent: if only the inject is there, adding a second would double the traffic.
  if (flows.some((n) => n.id === POLL_INJECT_ID)) {
    return { flows, added: [], targets: [], unchanged: true, reason: 'poll inject present without its function — repair by hand' };
  }

  const z = switches[0].z;
  // Placed clear of the existing layout: a node dropped on top of another is invisible in the
  // editor, and someone will open this tab eventually.
  const inject = {
    id: POLL_INJECT_ID,
    type: 'inject',
    z,
    name: 'Poll switches',
    props: [{ p: 'payload' }],
    repeat: String(POLL_INTERVAL_S),
    once: true,
    // Offset from the outlet poller's 10 s so the two do not fire together and put fourteen
    // simultaneous queries on one radio segment every minute.
    onceDelay: '25',
    topic: '',
    payload: '',
    payloadType: 'date',
    x: 140,
    y: 1500,
    wires: [[POLL_FN_ID]],
  };
  const fn = {
    id: POLL_FN_ID,
    type: 'function',
    z,
    name: 'Switch poll command',
    func: wantedFunc,
    outputs: switches.length,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 360,
    y: 1500,
    wires: switches.map((n) => [n.id]),
  };

  return {
    flows: [...flows, inject, fn],
    added: [inject, fn],
    targets: switches.map((n) => n.deviceName),
    unchanged: false,
    reason: null,
  };
}

/**
 * Invariants, asserted by name rather than count — the same shape as `validateOutletPoll`.
 *
 * Two outcomes are legal: a first install, which ADDS exactly two nodes and modifies nothing,
 * and an upgrade, which adds nothing and modifies exactly one node. An upgrade that rewired a
 * tuya node would be doing something nobody asked for, on a tab carrying live control logic.
 */
export function validateSwitchPoll(before, after) {
  const problems = [];

  const added = after.length - before.length;
  const isUpgrade = added === 0;
  if (added !== 2 && added !== 0) problems.push(`expected 2 new nodes (install) or 0 (upgrade), got ${added}`);

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

  return problems;
}
