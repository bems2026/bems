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
 * `find()` returns instantly without broadcasting. `find()` is the only thing that can discover a
 * device's NEW address, so a node in this state can never recover from a DHCP change on its own.
 * EX-160's back-off slows that loop; it cannot correct its aim.
 *
 * Note how a node ENTERS the state: any device that connects once and then goes away leaves its
 * address cached, so the next connect failure re-enters `findDevice`, which short-circuits. It is
 * not an exotic case — it is the normal fate of every device that has ever been reachable.
 *
 * ---------------------------------------------------------------------------
 * HOW IT IS DETECTED, and why it is not detected the obvious way.
 *
 * The obvious way is to read the socket error. **Nothing in Node-RED carries it.** All three
 * candidate signals were read rather than assumed, and all three are dead ends:
 *
 *   - the STATUS text for a socket error is `'Error : ' + JSON.stringify(error)`, and
 *     `JSON.stringify` of an `Error` is `{}` (`src/tuya-smart-device.js:435`);
 *   - a CATCH node never sees these at all: `node.logger.error` calls `node.error(msg)` with one
 *     argument (`src/utils.js:27`), and `Node.prototype.error` only routes to catch nodes when a
 *     second, object argument is present (`@node-red/runtime/lib/nodes/Node.js:570`);
 *   - the node's own STATUS OUTPUT carries `{ payload: { state } }` and no error text
 *     (`:311-318`).
 *
 * The error text exists only in the journal. So the detection is derived from the MECHANISM
 * instead, and is strictly better for it: **a find/connect cycle cannot complete faster than
 * `findTimeout` unless `find()` short-circuited.** The node goes yellow when `findDevice` starts
 * and red when the cycle fails; a real, broadcasting `find()` spends `findTimeout` before failing,
 * while a short-circuited one falls straight through to a connect that fails in well under a
 * second. Measuring that latency needs no error text and cannot be fooled by a reworded message.
 *
 * The threshold is derived per device from that node's OWN declared `findTimeout` rather than
 * hard-coded, so it stays correct if a node is ever tuned differently — and `findTimeout` is one
 * of the values that lives only on the live flow, so reading it here rather than assuming 10 s is
 * the difference between a check that tracks reality and one that quietly stops matching it.
 * ---------------------------------------------------------------------------
 *
 * THE REMEDY is `CONTROL`/`DISCONNECT` then `CONTROL`/`CONNECT`, because CONNECT runs the vendor
 * node's `initTuya()` — `tuyaDevice = new TuyaDevice(connectionParams)`, a fresh instance with no
 * cached address, and `connectionParams.ip` is `node.deviceIp`, empty on every node in this fleet.
 * `RECONNECT`, the obvious choice, does NOT do this: it reuses the instance, cache and all.
 * DISCONNECT goes first because `closeComm()` clears the pending find timer; without it
 * `startComm()` sets a second and the loop doubles. The vendor node's own 1 s delay inside
 * `startComm` exists for exactly this ordering — its comment says so.
 *
 * SELF-LIMITING BY CONSTRUCTION, which is what makes it safe to arm. After a recovery the node
 * really does broadcast, so its next failed cycle takes the full `findTimeout` — which is not a
 * short-circuit, and resets the streak. A device that is genuinely absent gets one recovery
 * attempt, not a loop of them. The cooldown is a second belt on the same braces.
 *
 * Pure: takes a flow array, returns a plan. `apply-stale-address.mjs` applies it, dry-run by
 * default.
 */

/**
 * A cycle shorter than this fraction of the node's own `findTimeout` is taken as proof that
 * `find()` returned without broadcasting.
 *
 * A half is a wide margin in the direction that matters. A real failing find takes the whole
 * `findTimeout` (10 s on this fleet); a short-circuited one takes as long as one TCP connect to
 * an address nothing answers on, which is well under a second even when ARP has to time out.
 * Erring high would restart healthy nodes; erring low only delays a recovery.
 */
export const SHORTCIRCUIT_FRACTION = 0.5;

/** Used when a node declares no `findTimeout` — the same default the vendor node falls back to. */
export const DEFAULT_FIND_TIMEOUT_MS = 10000;

/**
 * Consecutive short-circuited cycles before a device is restarted.
 *
 * Three, not one: restarting a node costs a real reconnect, and one fast cycle is also what a
 * device that is merely rebooting can produce. Three in a row with no full-length cycle between
 * them is the signature of the stuck loop rather than of a transient.
 */
export const SHORTCIRCUIT_STREAK = 3;

/** No device may be restarted more than once a minute, whatever the cycles say. */
export const RECOVERY_COOLDOWN_MS = 60000;

/**
 * Where the per-device streak and cooldown live — FLOW context, not node context, and that is a
 * deliberate difference from `discoveryBackoffPlan.mjs`.
 *
 * Node context is invisible: it is not written to `~/.node-red/context/<tab>/flow.json`, so there
 * is no way to tell a controller that is working from one that is silently receiving nothing.
 * EX-160 shipped to live hardware in exactly that state and changed nothing, and nothing anywhere
 * said so. **This is not hypothetical for this feature either:** the first implementation used a
 * catch node, deployed cleanly, raised no error, and received nothing at all — and the only
 * reason that was caught rather than declared a success is that this key was empty on disk.
 *
 * The back-off keeps NODE context for the opposite and equally deliberate reason: its state
 * describes `node.retryTimeout`, which a Node-RED restart resets. Persisting it would leave a
 * remembered value describing a node that had gone back to 1 s.
 */
export const STATE_KEY = 'bems_stale_recovery';

export const STATUS_ID_PREFIX = 'bems_stale_status_';
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

/**
 * The short-circuit threshold for one node, from its OWN declared `findTimeout`.
 *
 * `findTimeout` is a string on the live flow and may be absent or nonsense; anything unusable
 * falls back to the vendor default rather than to zero, because a zero threshold would classify
 * every cycle as a short circuit and restart the whole fleet.
 */
export function shortCircuitMsFor(node) {
  const declared = Number(node?.findTimeout);
  const findTimeout = Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_FIND_TIMEOUT_MS;
  return Math.floor(findTimeout * SHORTCIRCUIT_FRACTION);
}

const STALE_FN = `// Force a fresh discovery when a node's find() has stopped broadcasting.
// See node-red-bridge/staleAddressPlan.mjs for the tuyapi short-circuit this works around.
//
// A find/connect cycle CANNOT complete faster than findTimeout unless find() short-circuited,
// so the yellow -> red latency is the detector. No error text is involved, because Node-RED
// carries none: the status text for a socket error is 'Error : {}'.
const IDS_LIST = IDS;
const LIMITS = LIMITS_JSON;
const STREAK = STREAK_N;
const COOLDOWN = COOLDOWN_MS;

// The reporting node is at msg.status.source — @node-red/runtime/lib/flows/Flow.js, handleStatus:
//   message.status.source = { id: node.id, type: node.type, name: node.name }
const st = (msg && msg.status) || {};
const src = st.source || (msg && msg.source) || {};
const idx = IDS_LIST.indexOf(src.id);
const out = IDS_LIST.map(function () { return null; });
if (idx < 0) return out;

const fill = st.fill;
if (fill !== 'green' && fill !== 'red' && fill !== 'yellow') return out;

const now = NOW;
const store = flow.get(STATE_KEY) || {};
const entry = store[src.id] || { hits: 0, lastAt: null, yellowAt: null };

if (fill === 'yellow') {
  // findDevice() has just started. Only the FIRST yellow of a cycle matters: the vendor node
  // guards its state transitions, but a re-entered connecting must not restart the clock.
  if (entry.yellowAt === null) entry.yellowAt = now;
  store[src.id] = entry;
  flow.set(STATE_KEY, store);
  return out;
}

if (fill === 'green') {
  entry.hits = 0;
  entry.yellowAt = null;
  store[src.id] = entry;
  flow.set(STATE_KEY, store);
  return out;
}

// red: the cycle failed. How long it took is the whole signal.
const started = entry.yellowAt;
entry.yellowAt = null;
if (started === null) {
  // No cycle start seen — nothing can be concluded, so conclude nothing.
  store[src.id] = entry;
  flow.set(STATE_KEY, store);
  return out;
}

if ((now - started) >= LIMITS[idx]) {
  // A full-length cycle: find() really did broadcast. This is the state we are trying to
  // restore, so it clears the streak — which is what stops an absent device looping.
  entry.hits = 0;
  store[src.id] = entry;
  flow.set(STATE_KEY, store);
  return out;
}

entry.hits = entry.hits + 1;
// lastAt null means never recovered, which is not the same as recovered at the epoch — the
// cooldown must not block the FIRST recovery.
if (entry.hits < STREAK || (entry.lastAt !== null && (now - entry.lastAt) < COOLDOWN)) {
  store[src.id] = entry;
  flow.set(STATE_KEY, store);
  return out;
}

entry.hits = 0;
entry.lastAt = now;
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

export function staleAddressFnFor(ids, limits) {
  return STALE_FN
    .replace('IDS_LIST = IDS', `IDS_LIST = ${JSON.stringify(ids)}`)
    .replace('LIMITS_JSON', JSON.stringify(limits))
    .replace('STREAK_N', String(SHORTCIRCUIT_STREAK))
    .replace('COOLDOWN_MS', String(RECOVERY_COOLDOWN_MS))
    .replace(/STATE_KEY/g, JSON.stringify(STATE_KEY))
    .replace('NOW', 'Date.now()');
}

/**
 * Runs the controller against a fake flow context, for tests.
 *
 * `nowMs` is injected by overriding `Date.now` for the duration of the call rather than by
 * threading a parameter into the source, so the thing under test is byte-identical to the thing
 * that ships — both the latency measurement and the cooldown are only testable if time is
 * controllable.
 */
export function runStaleAddress(store, ids, limits, msg, nowMs) {
  const fn = new Function('flow', 'msg', staleAddressFnFor(ids, limits));
  const flow = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
  const realNow = Date.now;
  if (typeof nowMs === 'number') Date.now = () => nowMs;
  try {
    return fn(flow, msg);
  } finally {
    Date.now = realNow;
  }
}

function statusNode(z, ids, y) {
  return {
    id: STATUS_ID_PREFIX + z,
    type: 'status',
    z,
    name: 'Tuya find cycle',
    scope: ids,
    x: 140,
    y,
    wires: [[FN_ID_PREFIX + z]],
  };
}

function controllerNode(z, ids, limits, y) {
  return {
    id: FN_ID_PREFIX + z,
    type: 'function',
    z,
    name: 'Stale address recovery',
    func: staleAddressFnFor(ids, limits),
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
    const nodes = tuyaNodesOn(next, z);
    const ids = nodes.map((n) => n.id);
    const limits = nodes.map((n) => shortCircuitMsFor(n));
    targets.push(...ids);
    const wantFn = controllerNode(z, ids, limits, y);
    const wantStatus = statusNode(z, ids, y);
    const existingFn = next.find((n) => n.id === wantFn.id);
    const existingStatus = next.find((n) => n.id === wantStatus.id);

    if (existingFn && existingStatus) {
      const current = existingFn.func === wantFn.func
        && existingFn.outputs === wantFn.outputs
        && JSON.stringify(existingFn.wires) === JSON.stringify(wantFn.wires)
        && JSON.stringify(existingStatus.scope ?? []) === JSON.stringify(wantStatus.scope);
      if (current) continue;
      next = next.map((n) => {
        if (n.id === wantFn.id) return { ...n, func: wantFn.func, outputs: wantFn.outputs, wires: wantFn.wires };
        if (n.id === wantStatus.id) return { ...n, scope: wantStatus.scope };
        return n;
      });
      upgraded.push(wantFn.id, wantStatus.id);
      y += 80;
      continue;
    }

    if (existingFn || existingStatus) {
      return { flows, added: [], upgraded: [], targets: [], unchanged: true, reason: `tab ${z} has half a controller — repair by hand` };
    }

    next = [...next, wantStatus, wantFn];
    added.push(wantStatus, wantFn);
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
    if (n.id.startsWith(FN_ID_PREFIX) || n.id.startsWith(STATUS_ID_PREFIX)) continue;
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
    if (!n.id?.startsWith?.(STATUS_ID_PREFIX)) continue;
    for (const t of n.scope ?? []) {
      if (!ids.has(t)) problems.push(`${n.id} is scoped to non-existent ${t}`);
    }
  }

  return problems;
}
