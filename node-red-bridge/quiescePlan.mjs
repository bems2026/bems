/**
 * Stopping a dead `tuya-smart-device` node from retrying forever, as a pure function.
 *
 * `NBRIC IR Blaster` and `Outside Temp` are not in the Tuya cloud project and have never
 * connected. Each calls `findDevice()` every ~10 s in perpetuity, filling the Node-RED log with
 * `find() timed out` and holding a discovery listen slot open for hardware that will never
 * answer. The registry entries stay on purpose — RM-016's chosen resolution is "leave them" —
 * so the correct edit is to stop them trying, not to remove them.
 *
 * `disableAutoStart` is the node's own supported way to say "do not connect on deploy". It is
 * already present on every node in this flow, set to `false`, so this flips a field that exists
 * rather than introducing one.
 *
 * THE INVARIANTS ARE STRICT BECAUSE THE TARGET IS. These nodes live on the four hand-built
 * source tabs, which `build-flow.mjs` does not generate and nothing in the repo can restore.
 * `findTimeout` and `tuyaVersion` exist ONLY there — losing them presents as every device going
 * offline, which reads as a network fault and has already cost this project days. So the plan
 * is checked to change exactly one boolean on exactly the named nodes, and nothing else.
 */

/**
 * @param flows  the live flow, as read from the admin API
 * @param names  `deviceName` values to quiesce
 * @returns { flows, changed, problems }
 */
export function planQuiesce(flows, names) {
  const problems = [];
  const wanted = new Set(names);

  for (const name of wanted) {
    if (!flows.some((n) => n.type === 'tuya-smart-device' && n.deviceName === name)) {
      problems.push(`no tuya-smart-device node named "${name}" in this flow`);
    }
  }
  if (problems.length) return { flows, changed: [], problems };

  const changed = [];
  const next = flows.map((n) => {
    if (n.type !== 'tuya-smart-device' || !wanted.has(n.deviceName)) return n;
    // Already quiet. Returning the original object rather than a copy keeps a re-run
    // byte-identical, so "nothing to do" is provable rather than merely likely.
    if (n.disableAutoStart === true) return n;
    const updated = { ...n, disableAutoStart: true };
    changed.push(updated);
    return updated;
  });

  return { flows: next, changed, problems: [] };
}

/**
 * Invariants. Nothing added, nothing removed, and the only permitted difference anywhere is
 * `disableAutoStart` flipping to `true` on a node that was explicitly named.
 */
export function validateQuiescePlan(before, after, names) {
  const problems = [];
  const wanted = new Set(names);

  if (after.length !== before.length) {
    problems.push(`node count changed: ${before.length} -> ${after.length}; this edit must never add or remove a node`);
  }

  const beforeById = new Map(before.map((n) => [n.id, n]));
  for (const n of after) {
    const was = beforeById.get(n.id);
    if (was === undefined) {
      problems.push(`node ${n.name ?? n.id} was added`);
      continue;
    }
    if (JSON.stringify(was) === JSON.stringify(n)) continue;

    const named = n.type === 'tuya-smart-device' && wanted.has(n.deviceName);
    if (!named) {
      problems.push(`${n.deviceName ?? n.name ?? n.id} was modified but was not named for quiescing`);
      continue;
    }
    // Named, and different — the difference must be exactly `disableAutoStart` becoming true.
    if (n.disableAutoStart !== true) {
      problems.push(`${n.deviceName} was modified without being disabled`);
      continue;
    }
    if (JSON.stringify({ ...n, disableAutoStart: was.disableAutoStart }) !== JSON.stringify(was)) {
      problems.push(`${n.deviceName} was modified beyond disableAutoStart — findTimeout/tuyaVersion live only on this flow`);
    }
  }

  for (const id of beforeById.keys()) {
    if (!after.some((n) => n.id === id)) problems.push(`node ${id} would be removed`);
  }
  return problems;
}
