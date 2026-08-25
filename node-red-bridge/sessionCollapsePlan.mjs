/**
 * Decides how to collapse duplicate local sessions to a shared physical device, as a pure
 * function over the flow array.
 *
 * Kept separate from the script that applies it so the decision can be unit-tested without a
 * live system, and so a dry run and a real apply compute the SAME plan rather than two
 * implementations that could drift — the split `cleanupPlan.mjs` already uses.
 *
 * WHAT AND WHY:
 * Two `tuya-smart-device` nodes can carry the same `deviceId`, each holding its own TCP session
 * to one physical device. That happens twice here: `C.O yellow`/`L.O yellow` on the dual-channel
 * meter, and `AREC ACU`/`ACU` on the branch meter that measures the aircon. Both pairs are
 * legitimate as *logical* devices — they read different DPS ranges, or feed a live parser and a
 * daily one — but there is no reason for two sockets.
 *
 * Collapsing them buys two things:
 *
 *   1. **Halves the socket pressure on those devices.** An ESP device has a small connection
 *      table, and exhausting it is what leaves a device answering the cloud but not the LAN
 *      (docs/adr-002-device-recovery-path.md).
 *   2. **Makes the channel interchange impossible by construction** (ROADMAP RM-017). Today the
 *      two yellow channels arrive on two sessions and can disagree about which snapshot they
 *      came from. One session means both parsers read the same message, so there is no longer
 *      an ordering for them to get wrong.
 *
 * WHAT IT DOES NOT CHANGE: the parsers, their DPS selection, their context keys, or any
 * downstream consumer. The surviving node simply fans out to both parsers that the pair fed
 * between them. Nothing gains or loses a data source.
 */

/** Nodes whose `deviceId` appears more than once, grouped. */
export function findDuplicateSessions(flows) {
  const byDevice = new Map();
  for (const n of flows) {
    if (n?.type !== 'tuya-smart-device' || !n.deviceId) continue;
    if (!byDevice.has(n.deviceId)) byDevice.set(n.deviceId, []);
    byDevice.get(n.deviceId).push(n);
  }
  return [...byDevice.entries()].filter(([, nodes]) => nodes.length > 1).map(([deviceId, nodes]) => ({ deviceId, nodes }));
}

/** Every downstream target of a node, across all output ports, de-duplicated in order. */
function targetsOf(node) {
  const seen = [];
  for (const port of node.wires ?? []) {
    for (const id of port ?? []) if (!seen.includes(id)) seen.push(id);
  }
  return seen;
}

/**
 * @returns {{ flows, collapse: Array, unchanged: boolean }}
 *
 * The survivor is the FIRST node in flow order, chosen for stability rather than merit: the
 * plan must be identical across runs, and any preference based on name or wiring would change
 * the moment someone renamed a node.
 */
export function planSessionCollapse(flows) {
  const groups = findDuplicateSessions(flows);
  if (!groups.length) return { flows, collapse: [], unchanged: true };

  const removeIds = new Set();
  const collapse = [];

  const next = flows.map((n) => ({ ...n }));
  const byId = new Map(next.map((n) => [n.id, n]));

  for (const { deviceId, nodes } of groups) {
    const [survivor, ...retired] = nodes.map((n) => byId.get(n.id));
    // Union of what the whole group fed, so no parser loses its input.
    const merged = targetsOf(survivor);
    for (const r of retired) {
      for (const t of targetsOf(r)) if (!merged.includes(t)) merged.push(t);
      removeIds.add(r.id);
    }
    // Single output port carrying every consumer. The contrib node emits data and status on
    // separate ports, and both parsers already accept either — they branch on the payload
    // shape, not on which port it arrived by.
    survivor.wires = [merged];
    collapse.push({
      deviceId,
      keep: survivor.deviceName,
      retire: retired.map((r) => r.deviceName),
      feeds: merged.length,
    });
  }

  return { flows: next.filter((n) => !removeIds.has(n.id)), collapse, unchanged: false };
}

/**
 * Invariants that make applying this safe. Returns a list of problems; empty means safe.
 *
 * Asserted by name rather than by count: a count check either blocks the intended removal or,
 * once relaxed, stops noticing an unintended one. Same reasoning as `prune-dead-flow.mjs`.
 */
export function validateCollapse(before, after) {
  const problems = [];

  const tabsBefore = before.filter((n) => n.type === 'tab').length;
  const tabsAfter = after.filter((n) => n.type === 'tab').length;
  if (tabsBefore !== tabsAfter) problems.push('a tab would be removed');

  // Every physical device must still have exactly one session — none lost entirely.
  const devicesBefore = new Set(before.filter((n) => n.type === 'tuya-smart-device').map((n) => n.deviceId));
  const devicesAfter = new Set(after.filter((n) => n.type === 'tuya-smart-device').map((n) => n.deviceId));
  for (const id of devicesBefore) {
    if (!devicesAfter.has(id)) problems.push(`device ${String(id).slice(0, 8)} would lose its only session`);
  }

  // No parser may lose its input. This is the invariant that matters most: a parser with no
  // upstream stops updating and its readings silently freeze.
  const fedBefore = new Set(before.flatMap((n) => (n.wires ?? []).flat()));
  const fedAfter = new Set(after.flatMap((n) => (n.wires ?? []).flat()));
  const survivingIds = new Set(after.map((n) => n.id));
  for (const id of fedBefore) {
    if (survivingIds.has(id) && !fedAfter.has(id)) problems.push(`node ${id} would lose every input`);
  }

  // Nothing may point at a node that no longer exists.
  for (const n of after) {
    for (const target of (n.wires ?? []).flat()) {
      if (!survivingIds.has(target)) problems.push(`${n.name ?? n.type} wires to removed node ${target}`);
    }
  }

  // HTTP endpoints are the command path; none may disappear.
  const urlsBefore = new Set(before.filter((n) => n.type === 'http in').map((n) => n.url));
  for (const n of before.filter((x) => x.type === 'http in')) {
    if (!after.some((a) => a.type === 'http in' && a.url === n.url)) problems.push(`endpoint ${n.url} would be removed`);
  }
  void urlsBefore;

  return problems;
}
