/**
 * One-time fix for the root cause behind two live bugs in the iBEMS dashboard: devices
 * showing "online" forever after a real disconnect, and the building's energy totals
 * silently compounding a disconnected meter's last known wattage forever. Full root-cause
 * writeup is in the architecture plan's "Revision — Pre-Migration Data-Integrity Fixes"
 * section (`/home/bems/.claude/plans/dreamy-herding-lemur.md`).
 *
 *     node node-red-bridge/fix-tuya-health-signals.mjs [--host=127.0.0.1] [--port=1880]          # dry run
 *     node node-red-bridge/fix-tuya-health-signals.mjs [--host=127.0.0.1] [--port=1880] --apply   # actually deploy
 *     node node-red-bridge/fix-tuya-health-signals.mjs --apply --class=meters   # one class at a time
 *
 * Three fixes, applied together (they're one coherent change — a health flag that can't go
 * false is pointless without wiring for it to arrive, and vice versa):
 *
 *   1. Rewires each `tuya-smart-device` node's 2nd (status) output to feed the SAME target
 *      its 1st (data) output already reaches — today that output is either unwired
 *      entirely (the 4 energy meters) or wired to a disabled debug node (the 7 outlets),
 *      so the parser function that maintains `<ctx>_health` never receives a status
 *      message at all, only DPS data.
 *   2. Patches each of those 11 parser functions: `p.event === "..."` never matches
 *      (the tuya node emits `p.state`, confirmed against
 *      node_modules/node-red-contrib-tuya-smart-device's own source) — replaced with
 *      `p.state === "..."`, matching what the switches' own `Collect status` function
 *      already does correctly (the one device class that was wired right from the start).
 *   3. Gates `Calculate 3-Phase Totals` (the 2-second energy/power accumulator) and all 11
 *      "Fetch Memory & Format" GSheets loggers on each meter's health flag, so a
 *      disconnected meter contributes 0 — not its frozen last reading — to kWh totals and
 *      the permanent Sheets log.
 *
 * Deliberately scoped to 11 of the 21 devices (4 meters + 7 outlets) — NOT the 3
 * Aircon-tab devices (Outside Temp sensor, IR blaster, AREC's Aircon-tab duplicate
 * parser). Verified live: those write to a `flow`-scoped (tab-scoped) `arec_health` that
 * is a SEPARATE variable from the Energy-Monitoring-tab copy the iBEMS bridge actually
 * reads (`Bridge collect: Energy Monitoring`) — and `shared/buildLatest.mjs` hardcodes
 * `acu_ir`/`sensor_temp_humidity` devices to `online: true` regardless, by design (no
 * health signal exists for those classes). Fixing the Aircon tab's wiring would only
 * affect the legacy `/ui` dashboard being retired in Phase 8, not the bug the iBEMS app
 * actually has — out of scope for this fix.
 *
 * Never touches: any DPS `set`/write path, the Outlet Router, or anything that commands a
 * relay. Entirely on the read/observability side — worst case of a mistake here is wrong
 * displayed/logged data, never an unintended relay command.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadDotEnv, createAdminClient } from './nodeRedAdmin.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(HERE, '..'));

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const HOST = arg('host', '127.0.0.1');
const PORT = Number(arg('port', 1880));
const TIMEOUT_MS = Number(arg('timeout', 8000));
const APPLY = flag('apply');
const CLASS = arg('class', 'all'); // 'meters' | 'outlets' | 'all'

const admin = createAdminClient({ host: HOST, port: PORT, timeoutMs: TIMEOUT_MS });

// --- 1. Status-output rewiring: tuya node id -> its already-correct data-output target ---
const METER_REWIRES = [
  { device: 'co_yel meter', tuyaId: 'e66d327467675985', parserId: '89e9c8697b0785e9' },
  { device: 'lo_red meter', tuyaId: 'bcb82e251cbddf40', parserId: '67fc23ae5fc1ea76' },
  { device: 'arec meter', tuyaId: '1819261d415fe8a9', parserId: '079a2a362806dd9a' },
  { device: 'lo_yel2 meter', tuyaId: '05621905449d89fb', parserId: '34d96c0230b84707' },
];
const OUTLET_REWIRES = [
  { device: 'co1 outlet', tuyaId: '39018ba0805bdeaa', parserId: '85f8f717e5e059f4' },
  { device: 'co2 outlet', tuyaId: '53f703ade943803f', parserId: '9b6ee35b33d67b3c' },
  { device: 'co3 outlet', tuyaId: '6ff0476eed2c4f4c', parserId: '082689c6589dee25' },
  { device: 'co4 outlet', tuyaId: '3b6938448ed114dd', parserId: 'b98c424d8fa0a013' },
  { device: 'co5 outlet', tuyaId: 'ba2f219d4a3f5b76', parserId: 'b486e6f04a86c0da' },
  { device: 'co6 outlet', tuyaId: '7d9e20b509a0c3fb', parserId: '928b4f6459d42b9f' },
  { device: 'co7 outlet', tuyaId: '587e859954d33354', parserId: 'dab910c43b77b046' },
];

// --- 2. Parser text patches: the same two find/replace pairs across all 11 parsers ---
const PARSER_PATCHES = [
  { find: '(p.event && p.event === "CONNECTED")', replace: '(p.state && p.state === "CONNECTED")' },
  { find: '(p.event && (p.event === "DISCONNECTED" || p.event === "ERROR"))', replace: '(p.state && (p.state === "DISCONNECTED" || p.state === "ERROR"))' },
];
const PARSER_IDS = [...METER_REWIRES, ...OUTLET_REWIRES].map((r) => r.parserId);

// --- 3a. Accumulator gate: exact before/after per meter's v/c/p read ---
const ACCUMULATOR_ID = '81f2b23d30728b06';
const ACCUMULATOR_PATCHES = [
  {
    find: 'let v1 = parseFloat(flow.get("co_yel_last_v")) || 0;\nlet c1 = parseFloat(flow.get("co_yel_last_c")) || 0;\nlet p1 = parseFloat(flow.get("co_yel_last_p")) || 0;',
    replace:
      'let h1 = flow.get("co_yel_health") || false;\nlet v1 = h1 ? (parseFloat(flow.get("co_yel_last_v")) || 0) : 0;\nlet c1 = h1 ? (parseFloat(flow.get("co_yel_last_c")) || 0) : 0;\nlet p1 = h1 ? (parseFloat(flow.get("co_yel_last_p")) || 0) : 0;',
  },
  {
    find: 'let v2 = parseFloat(flow.get("lo_red_last_v")) || 0;\nlet c2 = parseFloat(flow.get("lo_red_last_c")) || 0;\nlet p2 = parseFloat(flow.get("lo_red_last_p")) || 0;',
    replace:
      'let h2 = flow.get("lo_red_health") || false;\nlet v2 = h2 ? (parseFloat(flow.get("lo_red_last_v")) || 0) : 0;\nlet c2 = h2 ? (parseFloat(flow.get("lo_red_last_c")) || 0) : 0;\nlet p2 = h2 ? (parseFloat(flow.get("lo_red_last_p")) || 0) : 0;',
  },
  {
    find: 'let v3 = parseFloat(flow.get("arec_last_v")) || 0;\nlet c3 = parseFloat(flow.get("arec_last_c")) || 0;\nlet p3 = parseFloat(flow.get("arec_last_p")) || 0;',
    replace:
      'let h3 = flow.get("arec_health") || false;\nlet v3 = h3 ? (parseFloat(flow.get("arec_last_v")) || 0) : 0;\nlet c3 = h3 ? (parseFloat(flow.get("arec_last_c")) || 0) : 0;\nlet p3 = h3 ? (parseFloat(flow.get("arec_last_p")) || 0) : 0;',
  },
  {
    find: 'let v4 = parseFloat(flow.get("lo_yel2_last_v")) || 0;\nlet c4 = parseFloat(flow.get("lo_yel2_last_c")) || 0;\nlet p4 = parseFloat(flow.get("lo_yel2_last_p")) || 0;',
    replace:
      'let h4 = flow.get("lo_yel2_health") || false;\nlet v4 = h4 ? (parseFloat(flow.get("lo_yel2_last_v")) || 0) : 0;\nlet c4 = h4 ? (parseFloat(flow.get("lo_yel2_last_c")) || 0) : 0;\nlet p4 = h4 ? (parseFloat(flow.get("lo_yel2_last_p")) || 0) : 0;',
  },
];

// --- 3b. GSheets logger gates ---
// Meter-style (4): array-averaging with a stale-value fallback when the 5-min sample
// array is empty. Only the fallback needs gating — a real quiet-but-connected period
// should still log the last value; a disconnected one should log nothing.
const METER_LOGGER_PATCHES = ['co_yel', 'lo_red', 'arec', 'lo_yel2'].map((prefix) => ({
  id: { co_yel: '35bed184a301e70a', lo_red: '7cd55dfa31556c8c', arec: 'b2f1c00798004913', lo_yel2: 'e3425dcff979eea0' }[prefix],
  find: `let lastV = flow.get("${prefix}_last_v") || 0;\nlet lastC = flow.get("${prefix}_last_c") || 0;\nlet lastP = flow.get("${prefix}_last_p") || 0;`,
  replace: `let health = flow.get("${prefix}_health") || false;\nlet lastV = flow.get("${prefix}_last_v") || 0;\nlet lastC = flow.get("${prefix}_last_c") || 0;\nlet lastP = flow.get("${prefix}_last_p") || 0;`,
  guardFind: 'msg.payload = [[ timestamp, Number(avgV), Number(avgC), Number(avgP) ]];\nreturn msg;',
  guardReplace:
    '// A disconnected meter with an empty sample array would otherwise fall back to its\n' +
    '// frozen last value here and log it as if it were a real 5-minute average.\n' +
    'if (arrV.length === 0 && !health) return null;\n' +
    'msg.payload = [[ timestamp, Number(avgV), Number(avgC), Number(avgP) ]];\nreturn msg;',
}));
// Outlet-style (7): logs the frozen last value on EVERY tick, no averaging, no existing
// empty-check to hang a guard off — gate the whole log on health instead.
const OUTLET_LOGGER_IDS = {
  co1: '21ced99795a056d1', co2: '0fa67f0863dc3692', co3: '225c6e07632ed185', co4: '04d0220bd52882c4',
  co5: 'ac69e82bcfb365d8', co6: 'cf7dd33f70dad34c', co7: 'a8f2230c43467f54',
};
const OUTLET_LOGGER_PATCHES = Object.entries(OUTLET_LOGGER_IDS).map(([prefix, id]) => ({
  id,
  find: `let lastV = flow.get("${prefix}_last_v") || 0;\nlet lastC = flow.get("${prefix}_last_c") || 0;\nlet lastP = flow.get("${prefix}_last_p") || 0;`,
  replace:
    `if (!(flow.get("${prefix}_health") || false)) return null; // disconnected — don't log a frozen reading as real\n` +
    `let lastV = flow.get("${prefix}_last_v") || 0;\nlet lastC = flow.get("${prefix}_last_c") || 0;\nlet lastP = flow.get("${prefix}_last_p") || 0;`,
}));

function selectRewires() {
  if (CLASS === 'meters') return METER_REWIRES;
  if (CLASS === 'outlets') return OUTLET_REWIRES;
  return [...METER_REWIRES, ...OUTLET_REWIRES];
}

/** Applies find->replace and records it on `applied` (an array the caller passes in) —
 * the dry-run report prints these pairs directly rather than line-diffing whole function
 * bodies, which produces a useless "every line after an insertion looks changed" diff for
 * multi-line replacements. The find/replace pair IS the exact, unambiguous change. */
function applyExactPatch(text, find, replace, label, applied) {
  if (!text.includes(find)) {
    throw new Error(`Expected substring not found in ${label} — the live flow has drifted from what this script was verified against. Aborting rather than guessing.\n  Looking for: ${JSON.stringify(find)}`);
  }
  applied.push({ find, replace });
  return text.split(find).join(replace);
}

async function main() {
  console.log(`${APPLY ? 'Applying' : 'Dry run (pass --apply to actually deploy)'} to http://${HOST}:${PORT} — class=${CLASS}\n`);

  let authHeader;
  try {
    authHeader = await admin.login();
    if (authHeader) console.log(`Logged in as ${process.env.NODE_RED_ADMIN_USER} (adminAuth).\n`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  let liveFlows, rev;
  try {
    ({ flows: liveFlows, rev } = await admin.getFlows(authHeader));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  console.log(`Read ${liveFlows.length} existing nodes (rev ${rev}).\n`);

  const byId = new Map(liveFlows.map((n) => [n.id, n]));
  const rewires = selectRewires();
  const patchedIds = new Set(rewires.map((r) => r.parserId));
  const loggerPatches = CLASS === 'meters' ? METER_LOGGER_PATCHES : CLASS === 'outlets' ? OUTLET_LOGGER_PATCHES : [...METER_LOGGER_PATCHES, ...OUTLET_LOGGER_PATCHES];

  const changes = []; // { id, name, kind, wireBefore?, wireAfter?, patches? } — for the report

  // --- Rewire status outputs ---
  for (const { device, tuyaId, parserId } of rewires) {
    const node = byId.get(tuyaId);
    if (!node) throw new Error(`tuya-smart-device node ${tuyaId} (${device}) not found on the live instance.`);
    const wireBefore = JSON.stringify(node.wires);
    const dataTargets = node.wires[0] || [];
    if (!dataTargets.includes(parserId)) {
      throw new Error(`${device}: expected output-1 to include ${parserId}, got ${JSON.stringify(node.wires[0])} — live flow has drifted, aborting.`);
    }
    node.wires[1] = [...dataTargets];
    changes.push({ id: tuyaId, name: `${device} (tuya node)`, kind: 'wires', wireBefore, wireAfter: JSON.stringify(node.wires) });
  }

  // --- Patch parser functions (only those touched by this run's --class) ---
  for (const id of PARSER_IDS) {
    if (!patchedIds.has(id)) continue;
    const node = byId.get(id);
    if (!node) throw new Error(`Parser function ${id} not found on the live instance.`);
    let text = node.func;
    const applied = [];
    for (const { find, replace } of PARSER_PATCHES) {
      text = applyExactPatch(text, find, replace, node.name, applied);
    }
    node.func = text;
    changes.push({ id, name: node.name, kind: 'func', patches: applied });
  }

  // --- Patch the accumulator (only relevant patches for this run's --class) ---
  if (CLASS === 'all' || CLASS === 'meters') {
    const node = byId.get(ACCUMULATOR_ID);
    if (!node) throw new Error('Calculate 3-Phase Totals not found on the live instance.');
    let text = node.func;
    const applied = [];
    for (const { find, replace } of ACCUMULATOR_PATCHES) {
      text = applyExactPatch(text, find, replace, node.name, applied);
    }
    node.func = text;
    changes.push({ id: ACCUMULATOR_ID, name: node.name, kind: 'func', patches: applied });
  }

  // --- Patch GSheets loggers ---
  for (const p of loggerPatches) {
    const node = byId.get(p.id);
    if (!node) throw new Error(`Logger function ${p.id} not found on the live instance.`);
    let text = node.func;
    const applied = [];
    text = applyExactPatch(text, p.find, p.replace, node.name, applied);
    if (p.guardFind) text = applyExactPatch(text, p.guardFind, p.guardReplace, node.name, applied);
    node.func = text;
    changes.push({ id: p.id, name: node.name, kind: 'func', patches: applied });
  }

  // --- Report ---
  console.log(`Plan: ${changes.length} node(s) touched.\n`);
  for (const c of changes) {
    console.log(`--- ${c.name} (${c.id}) [${c.kind}] ---`);
    if (c.kind === 'wires') {
      console.log(`  before: ${c.wireBefore}`);
      console.log(`  after:  ${c.wireAfter}`);
    } else {
      for (const { find, replace } of c.patches) {
        for (const line of find.split('\n')) console.log(`  - ${line}`);
        for (const line of replace.split('\n')) console.log(`  + ${line}`);
      }
    }
    console.log();
  }

  if (!APPLY) {
    console.log('Dry run only — nothing was written. Re-run with --apply to deploy.');
    return;
  }

  const deployRes = await admin.postFlows(authHeader, liveFlows, rev);
  if (deployRes.status === 409) {
    console.error('\nABORT: HTTP 409 — the flow was edited (in the Node-RED editor, presumably) between the GET and this POST.');
    console.error('Re-run this script to pick up the latest state.');
    process.exit(1);
  }
  if (!deployRes.ok) {
    console.error(`\nDeploy failed: HTTP ${deployRes.status}`);
    console.error(await deployRes.text().catch(() => ''));
    process.exit(1);
  }
  console.log('Deployed.');
}

main();
