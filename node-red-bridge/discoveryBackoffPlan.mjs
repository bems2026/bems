/**
 * Exponential back-off on failed discovery, as a pure function over the flow array.
 *
 * WHY. `docs/adr-002-device-recovery-path.md` prescribed this — *"Back off on failed discovery
 * rather than retrying at a fixed rate forever"* — and nothing ever built it. Measured
 * 2026-09-03, with fourteen devices off the air after the RM-020 power cycle: every one sat in a
 * `find()` -> timeout -> retry loop at a fixed 1 s, producing ~230 journal lines a minute
 * (12,386 in 3.6 h) and holding the Pi's load average near 3.5. None of it could succeed —
 * `find()` only locates a device that BROADCASTS, and a 30 s listen heard three of twenty.
 *
 * The loop period is `findTimeout + retryTimeout`, so with the shipped 10 s and 1 s it is ~11 s.
 * Backing `retryTimeout` off to a 60 s cap makes it ~70 s, which is the whole of the reduction.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS DOES NOT EDIT `retryTimeout` IN THE FLOW, which is the obvious implementation.
 *
 * `retryTimeout`, `findTimeout` and `tuyaVersion` sit on the four hand-built source tabs,
 * are declared NOWHERE in this repository, and losing them produces no diff and no alarm while
 * making every device read offline — the trap CLAUDE.md and `docs/pi-session-brief.md` both
 * carry, and the reason `shared/tuyaNodeSettings.mjs` and `live-flow-baseline.json` exist.
 * A plan that rewrote them would be reintroducing exactly that hazard to reduce log volume.
 *
 * So the back-off is applied at RUN TIME, through the vendor node's own `CONTROL` /
 * `SET_RETRY_TIMEOUT` operation (verified in `node-red-contrib-tuya-smart-device@5.4.0`
 * `src/tuya-smart-device.js:206-214`, which assigns `node.retryTimeout` — the same field read by
 * the reconnect timer at :367 and by the re-find timer at :547 and :600). Nothing on disk
 * changes, `findSettingsDrift` stays valid, and **a Node-RED restart returns every node to its
 * declared 1 s.** Failing back to the noisy-but-correct behaviour is the right direction.
 * ---------------------------------------------------------------------------
 *
 * HOW IT KNOWS. Not from `<ctx>_health`: that lives in per-tab flow context, and Node-RED has no
 * cross-tab context read in a function node — the constraint `build-flow.mjs` was shaped around.
 * Instead a core `status` node watches the tuya nodes ON ITS OWN TAB, which needs no change to
 * any of them. The vendor node's status contract is `fill: 'green' | 'red' | 'yellow'`
 * (`:324-350`), and keying on the FILL rather than the text matters: the text is the error
 * message and varies, the fill does not.
 *
 * Pure: takes a flow array, returns a plan. `apply-discovery-backoff.mjs` applies it, dry-run by
 * default.
 */

/** The declared value on every node, and what a device is reset to the moment it connects. */
export const BASE_RETRY_MS = 1000;

/**
 * The ceiling, in ms.
 *
 * Chosen against recovery time, not against log volume. A device that rejoins the network is
 * noticed within `findTimeout + retryTimeout`, so 60 s means a worst case of ~70 s before a
 * returning device is picked up — slower than the 11 s it replaces, and far faster than the
 * "never" that fourteen absent devices actually get today. Raising it further buys diminishing
 * quiet for real delay on the one event anybody is waiting for.
 */
export const MAX_RETRY_MS = 60000;

export const STATUS_ID_PREFIX = 'bems_backoff_status_';
export const FN_ID_PREFIX = 'bems_backoff_fn_';

/** Every tuya device node on one tab, in flow order — the order the outputs are wired in. */
export function tuyaNodesOn(flows, z) {
  return flows.filter((n) => n?.type === 'tuya-smart-device' && n.z === z);
}

/** The tabs that have at least one tuya node, in first-appearance order. */
export function backoffTabs(flows) {
  const seen = [];
  for (const n of flows) {
    if (n?.type === 'tuya-smart-device' && n.z && !seen.includes(n.z)) seen.push(n.z);
  }
  return seen;
}

/**
 * The controller body for one tab's ordered node ids.
 *
 * Kept as a source string because it is injected verbatim into a Node-RED function node, and
 * exported so `discovery-backoff.test.mjs` can EXECUTE it rather than pattern-match against it —
 * the same reason `arrivalTracker.mjs` and the poller plans do. A back-off that never reset would
 * leave a returning device unreachable for a minute forever, which is worse than the noise it
 * cures, and only running it proves it resets.
 */
const BACKOFF_FN = `// Exponential back-off on failed discovery. See node-red-bridge/discoveryBackoffPlan.mjs.
//
// Driven by a status node scoped to this tab's tuya nodes. The vendor node reports
// fill 'green' when connected, 'red' when disconnected or errored, and 'yellow'
// while connecting — yellow is transitional and says nothing about the outcome, so
// counting it would make the schedule depend on an implementation detail.
const IDS_LIST = IDS;
const BASE = BASE_MS;
const MAX = MAX_MS;

const src = (msg && msg.source) || {};
const idx = IDS_LIST.indexOf(src.id);
const out = IDS_LIST.map(function () { return null; });
if (idx < 0) return out;

const fill = ((msg && msg.status) || {}).fill;
if (fill !== 'green' && fill !== 'red') return out;

const store = context.get('backoff') || {};
const entry = store[src.id] || { fails: 0, applied: BASE };

let want;
if (fill === 'green') {
  entry.fails = 0;
  want = BASE;
} else {
  entry.fails = entry.fails + 1;
  want = BASE * Math.pow(2, entry.fails - 1);
  if (want > MAX) want = MAX;
}

// Only on change. Without this the cap would be re-sent every cycle forever, trading a loop of
// find attempts for a loop of control messages.
const changed = want !== entry.applied;
entry.applied = want;
store[src.id] = entry;
context.set('backoff', store);

if (!changed) return out;
out[idx] = { payload: { operation: 'CONTROL', action: 'SET_RETRY_TIMEOUT', value: want } };
return out;`;

export function backoffFnFor(ids) {
  return BACKOFF_FN
    .replace('IDS_LIST = IDS', `IDS_LIST = ${JSON.stringify(ids)}`)
    .replace('BASE_MS', String(BASE_RETRY_MS))
    .replace('MAX_MS', String(MAX_RETRY_MS));
}

/**
 * Runs the controller against a fake node context, for tests.
 *
 * `store` stands in for the function node's `context`, so a caller can drive many status messages
 * through one controller and watch the schedule advance — which is the only way to prove it both
 * backs off AND resets.
 */
export function runBackoff(store, ids, msg) {
  const fn = new Function('context', 'msg', backoffFnFor(ids));
  const context = { get: (k) => store[k], set: (k, v) => { store[k] = v; } };
  return fn(context, msg);
}

/** Node-RED's own status node, watching only the ids given. */
function statusNode(z, ids, y) {
  return {
    id: STATUS_ID_PREFIX + z,
    type: 'status',
    z,
    name: 'Tuya device status',
    // Scoped. Unscoped it fires for every node on the tab — including this controller's own
    // function and the parsers, which change status constantly.
    scope: ids,
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
    name: 'Discovery back-off',
    func: backoffFnFor(ids),
    outputs: ids.length,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 380,
    y,
    wires: ids.map((id) => [id]),
  };
}

/**
 * Adds, or brings up to date, one controller pair per tab that carries tuya nodes.
 *
 * An existing controller is UPGRADED rather than left alone, for the reason `outletPollPlan`
 * records: "already present, nothing to do" would silently decline to fix the thing somebody ran
 * this to fix. A device enrolled after the first install would otherwise never back off.
 */
export function planDiscoveryBackoff(flows) {
  const tabs = backoffTabs(flows);
  if (!tabs.length) return { flows, added: [], upgraded: [], targets: [], unchanged: true, reason: 'no tuya device nodes found' };

  let next = flows;
  const added = [];
  const upgraded = [];
  const targets = [];
  // Placed clear of the existing layout: a node dropped on top of another is invisible in the
  // editor, and someone will open these tabs eventually.
  let y = 1700;

  for (const z of tabs) {
    const ids = tuyaNodesOn(next, z).map((n) => n.id);
    targets.push(...ids);
    const wantFn = controllerNode(z, ids, y);
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

    // Half-installed is a state to report, not to paper over: adding a second status node would
    // double every message the controller sees and halve the effective back-off.
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
    reason: unchanged ? 'back-off already present and current' : null,
  };
}

/**
 * Invariants, asserted by name rather than count.
 *
 * The one that matters most is that no tuya node is touched at all. Everything this plan is for
 * depends on the declared `retryTimeout` / `findTimeout` / `tuyaVersion` surviving untouched, so
 * a plan that edited one would be defeating its own purpose silently.
 */
export function validateDiscoveryBackoff(before, after) {
  const problems = [];
  const beforeById = new Map(before.map((n) => [n.id, JSON.stringify(n)]));

  for (const n of after) {
    const original = beforeById.get(n.id);
    if (original === undefined || original === JSON.stringify(n)) continue;
    const isOurs = n.id.startsWith(FN_ID_PREFIX) || n.id.startsWith(STATUS_ID_PREFIX);
    if (isOurs) continue;
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
