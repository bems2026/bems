/**
 * Reconnecting a `tuya-smart-device` node's STATUS output, as a pure function over the flow.
 *
 * THE FAULT. Each of these nodes has two outputs: DPS data on the first, connection status on
 * the second. The parser that maintains `<ctx>_health` reads both — it sets the flag `true` on
 * `CONNECTED` or on any data arriving, and `false` on `DISCONNECTED`/`ERROR`. If output 2 is
 * unwired, only the true branch can ever be reached. **The health flag becomes structurally
 * incapable of going false.**
 *
 * It is not hypothetical. Measured on the live flow 2026-09-01: of the three meter nodes, only
 * one had its status output wired. The other two — which between them feed three of the four
 * metered channels, carrying roughly 98% of the building's measured demand — could report
 * `online: true` forever regardless of what the hardware did. The only thing that could
 * falsify them was `buildLatest`'s ten-minute arrival rule, i.e. the backstop, doing the job
 * the primary signal was supposed to do.
 *
 * That matters beyond a status pill. `buildLatest` drops `online: false` meters from the
 * building totals, and `Calculate 3-Phase Totals` gates its accumulator on the same flag — so a
 * meter whose flag cannot go false contributes its last frozen reading to the building's kWh
 * for as long as it stays disconnected.
 *
 * WHY THIS REPLACES `fix-tuya-health-signals.mjs`'s FIRST FIX. That script did this once, by
 * name, from a hardcoded list of node ids. Its parser and accumulator patches did land, but its
 * rewire list names a fourth meter node that no longer exists in the flow, so today the script
 * throws before it can help — and a one-shot repair keyed to node ids cannot survive the flow
 * it repairs being edited. This is the same fix expressed as an invariant instead: any tuya
 * node whose data output goes somewhere and whose status output goes nowhere is wrong, and can
 * be corrected without naming anything.
 *
 * SCOPE, DELIBERATELY NARROW. Mirroring output 1 into output 2 is exactly what the working node
 * already does, so the change introduces no new wiring shape. Nodes whose status output is
 * already wired are left byte-identical — including one wired somewhere unusual on purpose,
 * which this must never "correct".
 */

/** The `tuya-smart-device` nodes in a flow. */
export function tuyaNodes(flows) {
  return (flows ?? []).filter((n) => n?.type === 'tuya-smart-device');
}

/**
 * Nodes whose status output leads nowhere while their data output leads somewhere.
 *
 * Both halves of that condition matter. A node with NO data target either is not participating
 * in the flow at all or is wired in some way this plan does not understand; either way, copying
 * an empty list into output 2 achieves nothing and pretending otherwise would make the report
 * claim a repair it did not perform.
 */
export function needsHealthWiring(flows) {
  return tuyaNodes(flows).filter((n) => {
    const wires = Array.isArray(n.wires) ? n.wires : [];
    const data = Array.isArray(wires[0]) ? wires[0] : [];
    const status = Array.isArray(wires[1]) ? wires[1] : [];
    return data.length > 0 && status.length === 0;
  });
}

/**
 * @param flows the live flow, as read from the admin API
 * @returns { flows, changed, problems } — `changed` names the nodes whose output 2 was filled in
 */
export function planHealthWiring(flows) {
  const targets = new Set(needsHealthWiring(flows).map((n) => n.id));
  const changed = [];

  const next = (flows ?? []).map((n) => {
    if (!targets.has(n.id)) return n;
    const data = n.wires[0];
    // A fresh array rather than the same reference: the two outputs must not alias, or a later
    // edit to one silently rewires the other.
    const updated = { ...n, wires: [...n.wires.slice(0, 1), [...data], ...n.wires.slice(2)] };
    changed.push({
      id: n.id,
      node: n.deviceName ?? n.name ?? n.id,
      targets: [...data],
      // Reported so a quiesced node in the list is not read as a surprise. Wiring its status
      // output is still correct — it costs nothing while the node is stopped and works the day
      // somebody re-pairs the device — but an operator scanning this should be able to see at a
      // glance which entries change anything today.
      quiesced: n.disableAutoStart === true,
    });
    return updated;
  });

  return { flows: next, changed, problems: [] };
}

/**
 * Invariants. Nothing added, nothing removed, and the only permitted difference anywhere is
 * output 2 of a named node becoming a copy of its own output 1.
 *
 * Strict for the same reason `quiescePlan`'s validator is: these nodes live on the four
 * hand-built source tabs, which `build-flow.mjs` does not generate and nothing in this repo can
 * restore. `findTimeout` and `tuyaVersion` exist only there, and losing them presents as every
 * device going offline — which reads as a network fault and has already cost this project days.
 */
export function validateHealthWiring(before, after) {
  const problems = [];

  if (after.length !== before.length) {
    problems.push(`node count changed: ${before.length} -> ${after.length}; this edit must never add or remove a node`);
    return problems;
  }

  const beforeById = new Map(before.map((n) => [n.id, n]));
  for (const node of after) {
    const original = beforeById.get(node.id);
    if (!original) {
      problems.push(`node ${node.id} did not exist before`);
      continue;
    }
    if (JSON.stringify(original) === JSON.stringify(node)) continue;

    // Something changed. It must be output 2 of a tuya node, and nothing else.
    if (node.type !== 'tuya-smart-device') {
      problems.push(`${node.name ?? node.id} is not a tuya node and must not have been touched`);
      continue;
    }
    const withoutWires = (n) => JSON.stringify({ ...n, wires: null });
    if (withoutWires(original) !== withoutWires(node)) {
      problems.push(`${node.deviceName ?? node.id}: a property other than wires changed`);
    }
    if (JSON.stringify(original.wires?.[0]) !== JSON.stringify(node.wires?.[0])) {
      problems.push(`${node.deviceName ?? node.id}: the DATA output was modified; only the status output may change`);
    }
    if ((original.wires?.[1] ?? []).length !== 0) {
      problems.push(`${node.deviceName ?? node.id}: its status output was already wired and must have been left alone`);
    }
    if (JSON.stringify(node.wires?.[1]) !== JSON.stringify(node.wires?.[0])) {
      problems.push(`${node.deviceName ?? node.id}: the status output must mirror the data output exactly`);
    }
  }

  return problems;
}
