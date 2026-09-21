/**
 * Refactoring the live Aircon tab for the re-paired IR hub, as a pure function.
 *
 * WHAT IT DOES (the sources and the reasons for each are in `airconSources.mjs`):
 *
 *   NBRIC IR Blaster          disableAutoStart -> false. Nothing else: its device id and local key
 *                             were entered by the operator, and its v3.3 is measured.
 *   the blaster's parser      -> the generated IR hub parser (same id, same wiring)
 *   Dashboard State Manager   -> the generated one; the Outside Temp branch is kept as it was
 *   AC Master Logic           -> generated around the live node's OWN head and library, with three
 *                                outputs: IR set, commanded state, HTTP reply
 *   ACU auth + validate       -> the full-state validator, wired to AC Master Logic only
 *   ACU 200 response          removed — it answered 200 before anything was known
 *   + AC hub poll, gate       a GET every HUB_POLL_INTERVAL_S
 *   legacy cron path, ESP32   disabled (`d: true`), never deleted
 *
 * WHAT IT MUST NEVER DO, and `validateAirconPlan` checks each: change a tuya node's id, key,
 * version or find timeout; wake Outside Temp; alter Outside Temp's parser; lose or alter an IR code;
 * touch a node on any other tab; add or remove anything beyond the three nodes named above.
 *
 * Nodes are found STRUCTURALLY where the flow allows it — the parser is whatever the blaster feeds,
 * the state manager is whatever that parser feeds, the sender is the function that feeds the
 * blaster and sends IR — so a node renamed in the editor is still found, and a re-run finds the
 * generated nodes it wrote.
 */

import {
  hubParserSource,
  STATE_MANAGER_SOURCE,
  acMasterLogicSource,
  ACU_AUTH_FN,
  HUB_POLL_GATE_SOURCE,
  HUB_POLL_INTERVAL_S,
  AC_DASH_STATE_KEYS,
  extractIrLibrary,
} from './airconSources.mjs';
import { tcl112Code } from '../shared/irTcl112.mjs';
import { LOCAL_LIBRARY_STATE } from '../shared/acState.mjs';

export const ACU_AUTH_ID = 'bems_acu_auth';
export const ACU_REPLY_ID = 'bems_acu_reply';
export const LEGACY_ACU_OK_ID = 'bems_acu_ok';
export const POLL_INJECT_ID = 'bems_acu_poll';
export const POLL_GATE_ID = 'bems_acu_poll_gate';

/** The legacy nodes disabled here, by type and name on the Aircon tab. */
export const LEGACY_NODES = Object.freeze([
  // Node-RED's own aircon schedule. It reads flow context `ac_sched` and fires AC Master Logic,
  // bypassing the dispatch gate and the audit trail. Harmless while the blaster was dead and the
  // array empty; an ungated IR path once the blaster is live. Supabase schedules replace it.
  ['inject', 'Cron AC'],
  ['function', 'Check Time AC'],
  ['function', 'Get Sched AC'],
  ['inject', 'Load on Refresh'],
  // RM-005: subscribed on the loopback-only broker and has never received a message.
  ['mqtt in', 'ESP32 AC Sniffer'],
]);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Returns `original` itself when the update changes nothing, so a re-run is provably a no-op. */
const updateIfDifferent = (original, patch) => {
  const next = { ...original, ...patch };
  return same(next, original) ? original : next;
};

/**
 * @param flows  the live flow, as read from the admin API
 * @param opts.flowNode   the blaster's `deviceName` (the registry's `flow_node`)
 * @param opts.enableHub  un-quiesce the blaster (default true; `--keep-quiesced` passes false)
 * @param opts.irProtocol the site's declared IR protocol (`SITE.aircon.ir_protocol`), or null. With
 *                        'tcl112', AC Master Logic also generates frames for states the captured
 *                        library lacks — but only if the generator reproduces every captured ON code
 *                        on THIS flow exactly; otherwise the plan refuses.
 * @returns {{ flows, changes: {id, name}[], added: string[], removed: string[], problems: string[], roles }}
 */
export function planAircon(flows, { flowNode = 'NBRIC IR Blaster', enableHub = true, irProtocol = null } = {}) {
  const problems = [];
  const refuse = () => ({ flows, changes: [], added: [], removed: [], problems, roles: null });

  const ir = flows.find((n) => n.type === 'tuya-smart-device' && n.deviceName === flowNode);
  if (!ir) {
    problems.push(`no tuya-smart-device node named "${flowNode}" in this flow`);
    return refuse();
  }
  const tabId = ir.z;
  const onTab = (n) => n.z === tabId;
  const byId = new Map(flows.map((n) => [n.id, n]));

  const soleTarget = (node, output, what) => {
    const targets = node?.wires?.[output] ?? [];
    if (targets.length !== 1) {
      problems.push(`${what}: expected exactly one wire on output ${output + 1}, found ${targets.length}`);
      return null;
    }
    return byId.get(targets[0]) ?? null;
  };

  const parser = soleTarget(ir, 0, `"${flowNode}"`);
  if (!parser || parser.type !== 'function' || !onTab(parser)) {
    problems.push(`the node "${flowNode}" feeds is not a function on its tab — cannot locate its parser`);
    return refuse();
  }
  const stateManager = soleTarget(parser, 0, 'the blaster parser');
  if (!stateManager || stateManager.type !== 'function' || !/ac_dash_state/.test(stateManager.func ?? '')) {
    problems.push('the blaster parser does not feed a function that writes ac_dash_state — cannot locate the state manager');
    return refuse();
  }

  const senders = flows.filter(
    (n) => n.type === 'function' && onTab(n) && (n.wires?.[0] ?? []).includes(ir.id) && /send_ir/.test(n.func ?? ''),
  );
  if (senders.length !== 1) {
    problems.push(`expected exactly one function sending IR to "${flowNode}", found ${senders.length}`);
    return refuse();
  }
  const master = senders[0];
  const library = extractIrLibrary(master.func);
  if (!library) {
    problems.push('could not read the IR code library (head + library) out of AC Master Logic — refusing to regenerate it without every code');
    return refuse();
  }
  if (irProtocol === 'tcl112') {
    // The generator is trusted for states nobody captured only because it rebuilds every state
    // somebody did. One mismatch means this library is not the protocol the site declares.
    const onKeys = Object.keys(library.library).filter((k) => /^[0-9]+$/.test(k));
    const template = library.library[onKeys.includes('24') ? '24' : onKeys[0]];
    const mismatched = onKeys.filter(
      (k) => tcl112Code(template, { power: 'on', ...LOCAL_LIBRARY_STATE, setpoint_c: Number(k) }) !== library.library[k],
    );
    if (!onKeys.length || mismatched.length) {
      problems.push(`the captured IR library does not reproduce as tcl112 (it does not reproduce ${mismatched.join(', ') || 'any code'} °C) — refusing to generate frames for a protocol this aircon may not speak`);
      return refuse();
    }
  } else if (irProtocol !== null) {
    problems.push(`unsupported IR protocol "${irProtocol}" — only tcl112 can be generated`);
    return refuse();
  }

  const auth = byId.get(ACU_AUTH_ID);
  const reply = byId.get(ACU_REPLY_ID);
  if (!auth || !reply) {
    problems.push('the /acu endpoint is not on this flow — run `npm run add-endpoints:pi` first');
    return refuse();
  }

  const legacy = LEGACY_NODES.map(([type, name]) => flows.find((n) => onTab(n) && n.type === type && n.name === name)).filter(Boolean);

  // --- the rewrite --------------------------------------------------------------------------
  const replacements = new Map();
  const put = (original, patch) => {
    const next = updateIfDifferent(original, patch);
    if (next !== original) replacements.set(original.id, next);
  };

  if (enableHub) put(ir, { disableAutoStart: false });
  put(parser, { name: 'IR hub parser', func: hubParserSource(), outputs: 2, wires: [[stateManager.id], [stateManager.id]] });
  put(stateManager, { func: STATE_MANAGER_SOURCE });
  put(master, { func: acMasterLogicSource({ ...library, protocol: irProtocol }), outputs: 3, wires: [[ir.id], [stateManager.id], [ACU_REPLY_ID]] });
  put(auth, { func: ACU_AUTH_FN, outputs: 2, wires: [[master.id], [ACU_REPLY_ID]] });
  for (const n of legacy) put(n, { d: true });

  const removed = byId.has(LEGACY_ACU_OK_ID) ? [LEGACY_ACU_OK_ID] : [];

  // Placed below everything else on the tab — a node dropped on top of another is invisible in
  // the editor, and someone will open this flow.
  const lowest = Math.max(0, ...flows.filter((n) => onTab(n) && typeof n.y === 'number').map((n) => n.y));
  const wantInject = {
    id: POLL_INJECT_ID, type: 'inject', z: tabId, name: 'AC hub poll',
    props: [{ p: 'payload' }], repeat: String(HUB_POLL_INTERVAL_S), crontab: '', once: true, onceDelay: '15',
    topic: '', payload: '', payloadType: 'date', x: 160, y: lowest + 80, wires: [[POLL_GATE_ID]],
  };
  const wantGate = {
    id: POLL_GATE_ID, type: 'function', z: tabId, name: 'AC hub poll gate', func: HUB_POLL_GATE_SOURCE,
    outputs: 1, noerr: 0, initialize: '', finalize: '', libs: [], x: 380, y: lowest + 80, wires: [[ir.id]],
  };
  const added = [];
  const extra = [];
  for (const want of [wantInject, wantGate]) {
    const existing = byId.get(want.id);
    if (!existing) {
      added.push(want.id);
      extra.push(want);
    } else {
      // Present from an earlier run: keep its position (someone may have moved it), refresh the rest.
      put(existing, { ...want, x: existing.x, y: existing.y });
    }
  }

  const next = flows
    .filter((n) => !removed.includes(n.id))
    .map((n) => replacements.get(n.id) ?? n)
    .concat(extra);

  const changes = [...replacements.values()].map((n) => ({ id: n.id, name: n.name ?? n.deviceName ?? n.id }));
  const roles = {
    tabId,
    irId: ir.id,
    parserId: parser.id,
    stateManagerId: stateManager.id,
    masterId: master.id,
    legacyIds: legacy.map((n) => n.id),
    enableHub,
  };
  return { flows: next, changes, added, removed, problems: [], roles };
}

/**
 * Invariants over the result, independent of how the plan was built. Returns a list of problems;
 * empty means the write is safe to make.
 */
export function validateAirconPlan(before, after, plan) {
  const problems = [];
  const roles = plan?.roles;
  if (!roles) return ['no plan roles — the plan refused, so there is nothing to validate'];

  const beforeById = new Map(before.map((n) => [n.id, n]));
  const afterById = new Map(after.map((n) => [n.id, n]));
  const label = (n) => n?.name || n?.deviceName || n?.id;

  const mayChange = new Set([roles.irId, roles.parserId, roles.stateManagerId, roles.masterId, ACU_AUTH_ID, POLL_GATE_ID, POLL_INJECT_ID, ...roles.legacyIds]);
  const mayRemove = new Set([LEGACY_ACU_OK_ID]);
  const mayAdd = new Set([POLL_INJECT_ID, POLL_GATE_ID]);

  for (const [id, was] of beforeById) {
    const now = afterById.get(id);
    if (!now) {
      if (!mayRemove.has(id)) problems.push(`${label(was)} would be removed`);
      continue;
    }
    if (same(was, now)) continue;
    if (!mayChange.has(id)) {
      problems.push(`${label(now)} was modified but is not part of the aircon refactor`);
      continue;
    }
    if (now.z !== roles.tabId || was.z !== roles.tabId) problems.push(`${label(now)} moved tabs`);
  }
  for (const [id, now] of afterById) {
    if (beforeById.has(id)) continue;
    if (!mayAdd.has(id)) problems.push(`${label(now)} was added but is not part of the aircon refactor`);
    else if (now.z !== roles.tabId) problems.push(`${label(now)} was added to the wrong tab`);
  }

  // Every tuya node: identity, key, version and find timeout exactly as they were. Only the blaster
  // may change, and only by being enabled.
  for (const was of before.filter((n) => n.type === 'tuya-smart-device')) {
    const now = afterById.get(was.id);
    if (!now) continue;
    const { disableAutoStart: wasDas, ...wasRest } = was;
    const { disableAutoStart: nowDas, ...nowRest } = now;
    if (!same(wasRest, nowRest)) {
      problems.push(`${label(now)}: a tuya node's id, key, version, find timeout or wiring changed — these live only on this flow`);
    }
    if (wasDas !== nowDas && !(was.id === roles.irId && roles.enableHub && nowDas === false)) {
      problems.push(`${label(now)}: disableAutoStart changed from ${wasDas} to ${nowDas}, which this refactor must not do`);
    }
  }

  // Outside Temp's whole path, apart from the shared state manager, byte for byte.
  for (const outside of before.filter((n) => n.type === 'tuya-smart-device' && n.z === roles.tabId && n.id !== roles.irId)) {
    for (const id of [...new Set((outside.wires ?? []).flat())]) {
      if (id === roles.stateManagerId) continue;
      if (!same(beforeById.get(id), afterById.get(id))) problems.push(`${label(beforeById.get(id))} (${label(outside)}'s parser) changed`);
    }
  }

  // Legacy nodes may only become disabled.
  for (const id of roles.legacyIds) {
    const was = beforeById.get(id);
    const now = afterById.get(id);
    if (!now) continue;
    const { d, ...rest } = now;
    const { d: wasD, ...wasRest } = was;
    if (!same(rest, wasRest)) problems.push(`${label(now)} changed beyond being disabled`);
  }

  // The IR library, code for code.
  const libBefore = extractIrLibrary(beforeById.get(roles.masterId)?.func);
  const libAfter = extractIrLibrary(afterById.get(roles.masterId)?.func);
  if (!libAfter || !same(libBefore, libAfter)) problems.push('the IR code library in AC Master Logic is not identical to the live one');

  // The state manager still writes every key buildLatest reads, and still serves Outside Temp.
  const stateSrc = afterById.get(roles.stateManagerId)?.func ?? '';
  for (const key of AC_DASH_STATE_KEYS) {
    if (!new RegExp(`state\\.${key}\\s*=|\\b${key}:`).test(stateSrc)) problems.push(`the state manager no longer writes ac_dash_state.${key}`);
  }
  if (!/"Breaker_Ambient_Temp"[\s\S]*state\.outTemp = p;/.test(stateSrc)) problems.push('the state manager lost the Outside Temp branch');

  // No dangling wires anywhere on the tab.
  for (const n of after.filter((x) => x.z === roles.tabId)) {
    for (const target of (n.wires ?? []).flat()) {
      if (!afterById.has(target)) problems.push(`${label(n)} is wired to ${target}, which does not exist`);
    }
  }
  return problems;
}
