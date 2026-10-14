/**
 * Gives the CT meters a periodic refresh, as a pure function over the flow array — RM-134.
 *
 * WHY. Every outlet (`outletPollPlan`), every light switch (`switchPollPlan`) and the IR hub (the
 * Aircon tab's poll gate) is fed `{ operation: 'GET' }` on a timer. The meter sessions were fed
 * nothing, and the tuya node itself never reads a device's state on connect —
 * `issueGetOnConnect: false` and `issueRefreshOnConnect: false` are hard-coded in
 * node-red-contrib-tuya-smart-device 5.4.0, whatever the editor shows. So a meter was push-only:
 *
 *   - a change it pushed while the bridge was down (a reboot, a Node-RED restart, an access point
 *     dropping the session) was never seen, and
 *   - a channel then sitting at 0 W had nothing new to push, so the parser's context — persisted by
 *     `localfilesystem` — kept the last pushed value across every reconnect and restart.
 *
 * Measured 2026-09-22: the office power came back at 07:4x with the L5–L7 relays off while the Pi
 * was rebooting. L.O Yellow held 39.8 W / 0.446 A from 07:43:49 while its own register stood still —
 * which is what a circuit at 0 W does — and RM-133 read it as a frozen clamp needing a panel power
 * cycle. The same signature is on L.O Red's "freezes" of RM-076/077. A Node-RED restart could not
 * have helped: it re-reads nothing. The demux's raw record, persisted since 04:26 that day, had never
 * once received dp 103/113 (`device_state1/2`): the meters report a dp only when it changes.
 *
 * The tuya node answers a GET on the same output its own reports use, so the reply goes through the
 * channel demux and the generated parsers exactly as a spontaneous report does. Nothing downstream
 * needs to know a poll happened.
 *
 * TARGETS COME FROM THE REGISTRY, not a naming convention: each `class: 'meter'` device's parser is
 * found by the health key it writes (`findParserNodes`), and the session is the tuya node whose data
 * output reaches that parser — directly, or through one function node (the channel demux). The two
 * logical meters of the dual-channel device share one session and get ONE poll.
 */
import { findParserNodes } from './dpParserPlan.mjs';
import { measurementDpsFor } from '../shared/deviceCapabilities.mjs';

/** Deterministic ids, so re-running produces the same plan rather than a growing pile of nodes. */
export const POLL_INJECT_ID = 'bems_meter_poll_tick';
export const POLL_FN_ID = 'bems_meter_poll_cmd';

/** 60 s matches the ingestion cadence and the outlet and switch pollers. */
export const POLL_INTERVAL_S = 60;

/**
 * One output per SESSION, so a session the parser already knows is down is skipped rather than sent
 * a message it cannot answer — the outlet poller's reasoning (it once produced 180 "Device not
 * connected" lines every thirty minutes). `!== false`: a wiped context or a meter that has never
 * reported has no health key, and refusing to poll it is the one thing that could keep it silent.
 *
 * REFRESH, THEN GET — RM-163, 2026-10-14. With the site offline for a week the meters kept answering
 * the GET with the same cached figures (CO Yellow at 261.3 W and one voltage for 130 hours) while the
 * outlets stayed live. These meters re-read their measurements only on a DP_REFRESH request (tuyapi
 * `refresh`, command 18), and the vendor cloud had been the one sending those. Each session is now
 * asked to refresh its profile's measured dps (`measurementDpsFor`), then read. The refresh reply comes
 * back on the same output as any report, so the demux and the parsers need to know nothing.
 *
 * Every message is built fresh: the tuya node DELETES `operation` from the payload it is handed, so a
 * payload object shared between sessions would reach the second one emptied.
 */
const POLL_FN = `// Ask each CT meter session to re-measure, then for its full state — RM-134, RM-163.
// The tuya node never reads state on connect, and these meters answer a GET from a
// cache that only a DP_REFRESH renews (the vendor cloud used to send those; without
// internet nothing did, and the readings froze). The replies go through the channel
// demux and the parsers exactly like a spontaneous report.
// See node-red-bridge/meterPollPlan.mjs.
//
// One output per session. A session its parser has flagged disconnected is skipped;
// unknown (no health key yet) is polled. Messages are built fresh every time: the
// tuya node deletes \`operation\` from the payload it receives.
const sessions = SESSIONS;
return sessions.map(function (s) {
  if (flow.get(s.ctx + '_health') === false) return null;
  const get = { payload: { operation: 'GET' } };
  if (!s.dps.length) return get;
  return [{ payload: { operation: 'REFRESH', requestedDPS: s.dps.slice() } }, get];
});`;

/**
 * The poll function body for an ordered list of sessions, `{ ctx, dps }` each: the health-key prefix
 * the poll consults, and the measured dps to refresh (empty: GET alone).
 */
export function pollFnFor(sessions) {
  return POLL_FN.replace('SESSIONS', JSON.stringify(sessions.map((s) => ({ ctx: s.ctx, dps: s.dps ?? [] }))));
}

/** The measured dps of every device a session serves, merged and in order. */
function refreshDpsFor(session, registry) {
  const dps = new Set();
  for (const id of session.devices) {
    const device = (registry ?? []).find((d) => d.id === id);
    for (const dp of measurementDpsFor(device?.capability_profile)) dps.add(dp);
  }
  return [...dps].sort((a, b) => a - b);
}

/** The tuya node whose data output reaches `parserId` directly or through one function node. */
function sessionReaching(flows, parserId) {
  const byId = new Map(flows.map((n) => [n.id, n]));
  return flows.find((n) => {
    if (n?.type !== 'tuya-smart-device') return false;
    for (const t of n.wires?.[0] ?? []) {
      if (t === parserId) return true;
      const hop = byId.get(t);
      if (hop?.type === 'function' && (hop.wires ?? []).flat().includes(parserId)) return true;
    }
    return false;
  }) ?? null;
}

/**
 * Every meter session, in registry order of its first device: `{ node, ctx, devices }`, where `ctx`
 * is the health key the poll consults. `unresolved` names the meters that could not be located, which
 * the plan refuses on rather than half-doing.
 */
export function meterSessions(flows, registry) {
  return resolveMeterSessions(flows, registry).sessions;
}

function resolveMeterSessions(flows, registry) {
  const sessions = [];
  const unresolved = [];
  for (const device of registry ?? []) {
    if (device?.class !== 'meter') continue;
    if (!device.ctx) { unresolved.push(`${device.id}: no flow-context prefix`); continue; }
    // A parser is a function that writes the health key AND that a session feeds. The Aircon tab's
    // legacy "AREC ACU Daily Parser" writes `arec_health` too, fed by a timer in its own tab's
    // context; counting it would make the meter unlocatable (dpParserPlan leaves it alone as well).
    const reached = findParserNodes(flows, device)
      .map((p) => sessionReaching(flows, p.id))
      .filter(Boolean);
    if (reached.length !== 1) { unresolved.push(`${device.id}: expected one parser fed by a tuya session, found ${reached.length}`); continue; }
    const node = reached[0];
    const existing = sessions.find((s) => s.node.id === node.id);
    if (existing) existing.devices.push(device.id);
    else sessions.push({ node, ctx: device.ctx, devices: [device.id] });
  }
  return { sessions, unresolved };
}

export function planMeterPoll(flows, { registry } = {}) {
  const none = (reason) => ({ flows, added: [], upgraded: [], targets: [], refreshing: [], unchanged: true, reason });
  const { sessions, unresolved } = resolveMeterSessions(flows, registry);
  if (unresolved.length) return none(`cannot locate every meter — ${unresolved.join('; ')}`);
  if (!sessions.length) return none('no meter sessions found');

  const tabs = new Set(sessions.map((s) => s.node.z));
  if (tabs.size !== 1) return none('the meter sessions are on more than one tab; one poll function reads one tab\'s context');
  const [z] = tabs;

  const withDps = sessions.map((s) => ({ ...s, dps: refreshDpsFor(s, registry) }));
  const wantedFunc = pollFnFor(withDps);
  const wantedWires = sessions.map((s) => [s.node.id]);
  const targets = sessions.map((s) => s.node.deviceName ?? s.node.id);
  const refreshing = withDps.filter((s) => s.dps.length).map((s) => s.node.deviceName ?? s.node.id);

  const existingFn = flows.find((n) => n.id === POLL_FN_ID);
  if (existingFn) {
    const current = existingFn.func === wantedFunc && existingFn.outputs === sessions.length
      && JSON.stringify(existingFn.wires) === JSON.stringify(wantedWires);
    if (current) return none('poller already present and current');
    return {
      flows: flows.map((n) => (n.id === POLL_FN_ID ? { ...n, func: wantedFunc, outputs: sessions.length, wires: wantedWires } : n)),
      added: [],
      upgraded: [POLL_FN_ID],
      targets,
      refreshing,
      unchanged: false,
      reason: 'poller upgraded to the current set of meter sessions',
    };
  }
  // Idempotent: an inject without its function would double the traffic if a second were added.
  if (flows.some((n) => n.id === POLL_INJECT_ID)) return none('poll inject present without its function — repair by hand');

  // Below everything already on the tab — a node dropped on top of another is invisible in the editor.
  const y = Math.max(0, ...flows.filter((n) => n.z === z && typeof n.y === 'number').map((n) => n.y)) + 100;
  const inject = {
    id: POLL_INJECT_ID,
    type: 'inject',
    z,
    name: 'Poll meters',
    props: [{ p: 'payload' }],
    repeat: String(POLL_INTERVAL_S),
    once: true,
    onceDelay: '10',
    topic: '',
    payload: '',
    payloadType: 'date',
    x: 140,
    y,
    wires: [[POLL_FN_ID]],
  };
  const fn = {
    id: POLL_FN_ID,
    type: 'function',
    z,
    name: 'Meter poll command',
    func: wantedFunc,
    outputs: sessions.length,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 360,
    y,
    wires: wantedWires,
  };
  return { flows: [...flows, inject, fn], added: [inject, fn], upgraded: [], targets, refreshing, unchanged: false, reason: null };
}

/**
 * Invariants, asserted by name. An install ADDS exactly two nodes and modifies nothing; an upgrade adds
 * nothing and modifies only the poll function. Either way every meter session has its own output, and
 * the function consults every session's health key.
 */
export function validateMeterPoll(before, after, { registry } = {}) {
  const problems = [];
  const added = after.length - before.length;
  const isUpgrade = added === 0;
  if (added !== 2 && added !== 0) problems.push(`expected 2 new nodes (install) or 0 (upgrade), got ${added}`);

  const beforeById = new Map(before.map((n) => [n.id, JSON.stringify(n)]));
  for (const n of after) {
    const original = beforeById.get(n.id);
    if (original === undefined || original === JSON.stringify(n)) continue;
    if (isUpgrade && n.id === POLL_FN_ID) continue;
    problems.push(`existing node ${n.name ?? n.deviceName ?? n.id} was modified`);
  }
  for (const id of beforeById.keys()) {
    if (!after.some((n) => n.id === id)) problems.push(`node ${id} would be removed`);
  }

  const ids = new Set(after.map((n) => n.id));
  for (const n of after) {
    for (const t of (n.wires ?? []).flat()) if (!ids.has(t)) problems.push(`${n.name ?? n.id} wires to non-existent ${t}`);
  }

  const fn = after.find((n) => n.id === POLL_FN_ID);
  const sessions = meterSessions(after, registry);
  const wired = new Set((fn?.wires ?? []).flat());
  for (const s of sessions) if (!wired.has(s.node.id)) problems.push(`meter session ${s.node.deviceName ?? s.node.id} would not be polled`);
  if (fn) {
    if (fn.outputs !== sessions.length) problems.push(`poll function has ${fn.outputs} output(s) for ${sessions.length} meter session(s)`);
    for (const [i, targets] of (fn.wires ?? []).entries()) {
      if ((targets ?? []).length !== 1) problems.push(`poll output ${i} wires to ${(targets ?? []).length} nodes; each output must drive exactly one session`);
    }
    for (const s of sessions) {
      if (!String(fn.func).includes(`"${s.ctx}"`)) problems.push(`poll function does not name ${s.ctx}, so that session cannot be skipped when it is down`);
    }
  }
  return problems;
}
