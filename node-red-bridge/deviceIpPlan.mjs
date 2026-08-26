/**
 * Giving a `tuya-smart-device` node a static address, as a pure function.
 *
 * WHY: the bridge locates a device only by its UDP discovery broadcast. A device that has
 * stopped broadcasting is invisible to `find()` and reports `online: false` — identical, from
 * the bridge's side, to one that is unplugged, and RM-020/RM-021 exist because that ambiguity
 * sends people to the office. When ARP proves the device is still associated to the access
 * point, the broadcast is the only thing missing, and `deviceIp` is the node's own supported way
 * to skip it: tuyapi's `find()` short-circuits when id and ip are both set
 * (`isValidString(this.device.id) && isValidString(this.device.ip)`), going straight to a TCP
 * connect. The field exists on every node in this flow and is empty on all of them, so this
 * fills a field rather than introducing one.
 *
 * THE ADDRESS IS RESOLVED AT RUN TIME, from the cloud's MAC joined against ARP, and is never
 * written down in this repository — it is public, and an address is also wrong the moment DHCP
 * moves it. A reservation on the access point is the durable version and is an operator action.
 *
 * THE INVARIANTS ARE STRICT BECAUSE THE TARGET IS. These nodes live on the hand-built source
 * tabs, which `build-flow.mjs` does not generate and nothing in the repo can restore.
 * `findTimeout` and `tuyaVersion` exist ONLY there — losing them presents as every device going
 * offline, which reads as a network fault and has already cost this project days. So the plan is
 * checked to change exactly one string on exactly the named nodes, and nothing else.
 */

/** Dotted quad, each octet 0-255. Deliberately not a hostname: see the note on DHCP above. */
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/**
 * @param flows        the live flow, as read from the admin API
 * @param assignments  { [deviceName]: address | null }. `null` clears it, which is `--undo`.
 * @returns { flows, changed, problems }
 */
export function planDeviceIp(flows, assignments) {
  const problems = [];
  const entries = Object.entries(assignments);

  for (const [name, addr] of entries) {
    if (!flows.some((n) => n.type === 'tuya-smart-device' && n.deviceName === name)) {
      problems.push(`no tuya-smart-device node named "${name}" in this flow`);
      continue;
    }
    // Rejected here rather than at connect time, where the failure would surface as a timeout
    // on the device and read as a hardware fault.
    if (addr !== null && !IPV4.test(String(addr))) {
      problems.push(`"${addr}" is not an IPv4 address (device "${name}")`);
    }
  }
  if (problems.length) return { flows, changed: [], problems };

  const wanted = new Map(entries.map(([name, addr]) => [name, addr === null ? '' : String(addr)]));
  const changed = [];
  const next = flows.map((n) => {
    if (n.type !== 'tuya-smart-device' || !wanted.has(n.deviceName)) return n;
    const target = wanted.get(n.deviceName);
    // Already correct. Returning the original object rather than a copy keeps a re-run
    // byte-identical, so "nothing to do" is provable rather than merely likely.
    if ((n.deviceIp ?? '') === target) return n;
    const updated = { ...n, deviceIp: target };
    changed.push(updated);
    return updated;
  });

  return { flows: next, changed, problems: [] };
}

/**
 * Invariants. Nothing added, nothing removed, and the only permitted difference anywhere is
 * `deviceIp` on a node that was explicitly named.
 */
export function validateDeviceIpPlan(before, after, assignments) {
  const problems = [];
  const wanted = new Set(Object.keys(assignments));

  if (after.length !== before.length) {
    problems.push(`node count changed: ${before.length} -> ${after.length}; this edit must never add or remove a node`);
    return problems;
  }

  const beforeById = new Map(before.map((n) => [n.id, n]));
  for (const n of after) {
    const was = beforeById.get(n.id);
    if (was === undefined) {
      problems.push(`node ${n.deviceName ?? n.name ?? n.id} was added`);
      continue;
    }
    if (JSON.stringify(was) === JSON.stringify(n)) continue;

    if (!(n.type === 'tuya-smart-device' && wanted.has(n.deviceName))) {
      problems.push(`${n.deviceName ?? n.name ?? n.id} was modified but was not named for addressing`);
      continue;
    }
    // Named, and different — the difference must be exactly `deviceIp`.
    if (JSON.stringify({ ...n, deviceIp: was.deviceIp }) !== JSON.stringify(was)) {
      problems.push(`${n.deviceName} was modified beyond deviceIp — findTimeout/tuyaVersion live only on this flow`);
    }
  }

  for (const id of beforeById.keys()) {
    if (!after.some((n) => n.id === id)) problems.push(`node ${id} would be removed`);
  }
  return problems;
}
