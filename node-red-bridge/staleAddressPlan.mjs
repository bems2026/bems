/**
 * Recovery from a cached device address that has stopped existing — FI-025, as a pure function
 * over the flow array.
 *
 * WHY, measured 2026-09-03. After the access point renumbered its LAN (RM-046), two tuya nodes
 * produced **325 and 323 `EHOSTUNREACH`** in 3.6 h against leases that had been valid that
 * morning, while devices in the ordinary not-found state produced far fewer. That asymmetry is
 * the clue, and the mechanism is in `tuyapi@7.7.1` `index.js:996-1002`:
 *
 *     find({timeout = 10, all = false} = {}) {
 *       if (isValidString(this.device.id) && isValidString(this.device.ip)) {
 *         // Don't need to do anything
 *         return Promise.resolve(true);
 *
 * Once a `find()` has succeeded the resolved address is cached ON THE INSTANCE, and every later
 * `find()` returns instantly without broadcasting. The node's retry loop becomes
 * find (no-op) -> connect -> EHOSTUNREACH -> find (no-op), gated only by `retryTimeout` and not by
 * `findTimeout` at all — which is why those two spun roughly four times faster than the rest.
 * `find()` is the only thing that can discover a device's NEW address, and a node in this state
 * never really calls it. EX-160's back-off slows the loop; it cannot correct its aim.
 *
 * THE FIX is to make the node build a new `TuyaDevice`. `CONTROL`/`RECONNECT` does NOT do that —
 * it reuses the instance, cache and all, which is why the obvious control operation is the wrong
 * one. `CONTROL`/`CONNECT` does: the vendor node's handler runs `initTuya()`, which is
 * `tuyaDevice = new TuyaDevice(connectionParams)`, and `connectionParams.ip` is `node.deviceIp` —
 * empty on every node in this fleet. A fresh instance broadcasts.
 *
 * `DISCONNECT` is sent first because `closeComm()` clears the pending find timer. Without it,
 * `startComm()` sets a second one and the loop doubles. The vendor node's own 1 s delay inside
 * `startComm` exists for exactly this ordering — its comment says so.
 *
 * SELF-LIMITING BY CONSTRUCTION, which is what makes it safe to arm. After a recovery the node
 * really does broadcast, so a device that is genuinely absent produces a find TIMEOUT next rather
 * than an unreachable — and that resets the streak. A device that is gone gets one recovery
 * attempt, not a loop of them. The cooldown is a second belt on the same braces.
 *
 * WHY A `catch` NODE and not the status node EX-160 uses: the status text for a socket error is
 * `'Error : ' + JSON.stringify(error)`, and `JSON.stringify` of an `Error` is `{}` — the fill and
 * text carry no way to tell an unreachable address from a device that simply is not there. The
 * vendor node's `node.logger.error` calls `node.error()` (`src/utils.js:27`), so the full socket
 * message reaches a `catch` node intact. Different fault, different signal, different input.
 *
 * Pure: takes a flow array, returns a plan. `apply-stale-address.mjs` applies it, dry-run by
 * default.
 */

/**
 * Socket errors that mean "nothing answers at layer 3 on that address".
 *
 * Deliberately narrow. `ECONNREFUSED` is excluded because something IS there and refusing, which
 * is ADR-002's exhausted-socket-table case and wants a different remedy; `ECONNRESET` is a
 * mid-session drop, not a wrong address. Re-initing on either would be acting on a guess.
 */
export const UNREACHABLE_MARKERS = Object.freeze(['EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN']);

/**
 * Consecutive unreachable errors before a device is restarted.
 *
 * Three, not one: a single failure is also what a device that is merely rebooting produces, and
 * restarting a node costs a real reconnect. Three consecutive with no other error in between is
 * the signature of the stuck loop rather than of a transient.
 */
export const UNREACHABLE_STREAK = 3;

/** No device may be restarted more than once a minute, whatever the errors say. */
export const RECOVERY_COOLDOWN_MS = 60000;

/**
 * Where the per-device streak and cooldown live — FLOW context, not node context, and that is a
 * deliberate difference from `discoveryBackoffPlan.mjs`.
 *
 * Node context is invisible: it is not written to `~/.node-red/context/<tab>/flow.json`, so there
 * is no way to tell a controller that is working from one that is silently receiving nothing.
 * EX-160 shipped to live hardware in exactly that state and changed nothing for twenty minutes
 * because its input shape was wrong, and nothing anywhere said so. This one can be checked:
 * a populated `bems_stale_recovery` proves the catch node is delivering, even when no device is
 * currently stuck and the recovery path is therefore never taken.
 *
 * The back-off keeps NODE context for the opposite and equally deliberate reason: its state
 * describes `node.retryTimeout`, which is reset by a Node-RED restart. Persisting it would leave
 * a remembered `applied` value describing a node that had gone back to 1 s.
 */
export const STATE_KEY = 'bems_stale_recovery';

export const CATCH_ID_PREFIX = 'bems_stale_catch_';
export const FN_ID_PREFIX = 'bems_stale_fn_';

/** Every tuya device node on one tab, in flow order — the order the outputs are wired in. */
export function tuyaNodesOn(flows, z) {
  return flows.filter((n) => n?.type === 'tuya-smart-device' && n.z === z);
}

/** The tabs that have at least one tuya node, in first-appearance order. */
export function staleAddressTabs(flows) {
  const seen = [];
  for (const n of flows) {
    if (n?.type === 'tuya-smart-device' && n.z && !seen.includes(n.z)) seen.push(n.z);
  }
  return seen;
}

const STALE_FN = `// Force a fresh discovery when a node is dialling an address that no longer exists.
// See node-red-bridge/staleAddressPlan.mjs for the tuyapi short-circuit this works around.
const IDS_LIST = IDS;
const MARKERS = MARKERS_JSON;
const STREAK = STREAK_N;
const COOLDOWN = COOLDOWN_MS;

// The reporting node is at msg.error.source — @node-red/runtime/lib/flows/Flow.js, handleError:
//   errorMessage.error = { message, source: { id, type, name, count } }
const err = (msg && msg.error) || {};
const src = err.source || {};
const idx = IDS_LIST.indexOf(src.id);
const out = IDS_LIST.map(function () { return null; });
if (idx < 0) return out;

const text = String(err.message === undefined ? '' : err.message).toUpperCase();
let unreachable = false;
for (let i = 0; i < MARKERS.length; i++) {
  if (text.indexOf(MARKERS[i]) !== -1) { unreachable = true; break; }
}

const store = flow.get(STATE_KEY) || {};
const entry = store[src.id] || { hits: 0, lastAt: null };

if (!unreachable) {
  // Any other error means this node is not dialling a dead address. A find() timeout in
  // particular PROVES it is broadcasting again, which is the state we are trying to restore —
  // so a genuinely absent device gets one recovery attempt rather than a loop of them.
  entry.hits = 0;
  store[src.id] = entry;
  flow.set(STATE_KEY, store);
  return out;
}

entry.hits = entry.hits + 1;
// lastAt null means never recovered, which is not the same as recovered at the epoch — the
// cooldown must not block the FIRST recovery.
if (entry.hits < STREAK || (entry.lastAt !== null && (NOW - entry.lastAt) < COOLDOWN)) {
  store[src.id] = entry;
  flow.set(STATE_KEY, store);
  return out;
}

entry.hits = 0;
entry.lastAt = NOW;
store[src.id] = entry;
flow.set(STATE_KEY, store);

// DISCONNECT then CONNECT, in that order and on the one output. closeComm() clears the pending
// find timer; CONNECT's initTuya() then builds a NEW TuyaDevice, which is the whole point —
// tuyapi caches the resolved address on the instance, so only a new instance will broadcast.
out[idx] = [
  { payload: { operation: 'CONTROL', action: 'DISCONNECT' } },
  { payload: { operation: 'CONTROL', action: 'CONNECT' } }
];
return out;`;

export function staleAddressFnFor(ids) {
  return STALE_FN
    .replace('IDS_LIST = IDS', `IDS_LIST = ${JSON.stringify(ids)}`)
    .replace('MARKERS_JSON', JSON.stringify(UNREACHABLE_MARKERS))
    .replace(/STATE_KEY/g, JSON.stringify(STATE_KEY))
    .replace('STREAK_N', String(UNREACHABLE_STREAK))
    .replace('COOLDOWN_MS', String(RECOVERY_COOLDOWN_MS))
    .replace(/NOW/g, 'Date.now()');
}

/**
 * Runs the controller against a fake node context, for tests.
 *
 * `nowMs` is injected by overriding `Date.now` for the duration of the call rather than by
 * threading a parameter into the source, so the thing under test is byte-identical to the thing
 * that ships — the cooldown is only testable if time is controllable.
 */
export function runStaleAddress(store, ids, msg, nowMs) {
  const fn = new Function('flow', 'msg', staleAddressFnFor(ids));
  const flow = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
  const realNow = Date.now;
  if (typeof nowMs === 'number') Date.now = () => nowMs;
  try {
    return fn(flow, msg);
  } finally {
    Date.now = realNow;
  }
}

function catchNode(z, ids, y) {
  return {
    id: CATCH_ID_PREFIX + z,
    type: 'catch',
    z,
    name: 'Tuya device errors',
    // Scoped to the tuya nodes so this never sees an error from anything else on the tab.
    scope: ids,
    // false, not true: `uncaught` means "only errors no other catch node handled". These errors
    // are raised by the vendor node's own logger and are ordinary caught errors.
    uncaught: false,
    x: 140,
    y,
    wires: [[FN_ID_PREFIX + z]],
  };
}

function controllerNode(z, ids, y) {
  return {
    id: FN_ID_PREFIX + z,
    type: 'function',
    z,
    name: 'Stale address recovery',
    func: staleAddressFnFor(ids),
    outputs: ids.length,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 400,
    y,
    wires: ids.map((id) => [id]),
  };
}

export function planStaleAddress(flows) {
  const tabs = staleAddressTabs(flows);
  if (!tabs.length) return { flows, added: [], upgraded: [], targets: [], unchanged: true, reason: 'no tuya device nodes found' };

  let next = flows;
  const added = [];
  const upgraded = [];
  const targets = [];
  // Clear of the layout, and clear of EX-160's back-off nodes at 1700+.
  let y = 1900;

  for (const z of tabs) {
    const ids = tuyaNodesOn(next, z).map((n) => n.id);
    targets.push(...ids);
    const wantFn = controllerNode(z, ids, y);
    const wantCatch = catchNode(z, ids, y);
    const existingFn = next.find((n) => n.id === wantFn.id);
    const existingCatch = next.find((n) => n.id === wantCatch.id);

    if (existingFn && existingCatch) {
      const current = existingFn.func === wantFn.func
        && existingFn.outputs === wantFn.outputs
        && JSON.stringify(existingFn.wires) === JSON.stringify(wantFn.wires)
        && JSON.stringify(existingCatch.scope ?? []) === JSON.stringify(wantCatch.scope);
      if (current) continue;
      next = next.map((n) => {
        if (n.id === wantFn.id) return { ...n, func: wantFn.func, outputs: wantFn.outputs, wires: wantFn.wires };
        if (n.id === wantCatch.id) return { ...n, scope: wantCatch.scope };
        return n;
      });
      upgraded.push(wantFn.id, wantCatch.id);
      y += 80;
      continue;
    }

    if (existingFn || existingCatch) {
      return { flows, added: [], upgraded: [], targets: [], unchanged: true, reason: `tab ${z} has half a controller — repair by hand` };
    }

    next = [...next, wantCatch, wantFn];
    added.push(wantCatch, wantFn);
    y += 80;
  }

  const unchanged = added.length === 0 && upgraded.length === 0;
  return {
    flows: next,
    added,
    upgraded,
    targets,
    unchanged,
    reason: unchanged ? 'stale-address recovery already present and current' : null,
  };
}

/**
 * Invariants. The one that matters is that no tuya node is touched: this whole approach exists so
 * that `retryTimeout`, `findTimeout`, `tuyaVersion` and `deviceIp` — declared nowhere in this
 * repository — survive untouched.
 */
export function validateStaleAddress(before, after) {
  const problems = [];
  const beforeById = new Map(before.map((n) => [n.id, JSON.stringify(n)]));

  for (const n of after) {
    const original = beforeById.get(n.id);
    if (original === undefined || original === JSON.stringify(n)) continue;
    if (n.id.startsWith(FN_ID_PREFIX) || n.id.startsWith(CATCH_ID_PREFIX)) continue;
    problems.push(`existing node ${n.name ?? n.deviceName ?? n.id} was modified`);
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
  for (const n of after) {
    if (!n.id?.startsWith?.(CATCH_ID_PREFIX)) continue;
    for (const t of n.scope ?? []) {
      if (!ids.has(t)) problems.push(`${n.id} is scoped to non-existent ${t}`);
    }
  }

  return problems;
}
