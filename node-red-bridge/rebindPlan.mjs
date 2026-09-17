/**
 * Pointing an existing `tuya-smart-device` node at a re-paired device, as a pure function.
 *
 * WHY THIS EXISTS. Re-pairing a device in Smart Life issues it a new vendor id and a new local key.
 * The node that polled it then points at a device the project no longer has, and reads offline
 * forever. Until now the fix was to open the Node-RED editor and paste the new id and key in by hand —
 * which is how the IR blaster was fixed on 2026-09-17, and exactly the copying of secrets between
 * browser tabs that enrolment was built to end. CO3, CO5 and CO6 went through the same thing in August.
 *
 * WHY A REBIND AND NOT A REMOVE-AND-ENROL. The node is more than an id: it carries the `findTimeout`
 * this project measured, the wiring to hand-built parsers on source tabs nothing in the repository can
 * regenerate, and the registry device whose readings history is keyed to it. A rebind keeps all of
 * that and changes only what the re-pair changed.
 *
 * THE INVARIANTS are the quiesce plan's, widened by exactly those fields: one named node; `deviceId`,
 * `deviceKey`, `tuyaVersion` and — only when asked — `disableAutoStart`; nothing else anywhere.
 */

/** The protocol versions a Tuya device can announce. */
const VERSIONS = new Set(['3.1', '3.2', '3.3', '3.4', '3.5']);

/** The only fields a rebind may change. */
export const REBIND_FIELDS = Object.freeze(['deviceId', 'deviceKey', 'tuyaVersion', 'disableAutoStart']);

/**
 * @param flows  the live flow
 * @param args   { nodeName, tuyaDeviceId, localKey, tuyaVersion, enable = true }
 * @returns { flows, changed: string[] (field names, never values), problems }
 */
export function planRebind(flows, { nodeName, tuyaDeviceId, localKey, tuyaVersion, enable = true } = {}) {
  const problems = [];
  const node = flows.find((n) => n.type === 'tuya-smart-device' && n.deviceName === nodeName);
  if (!node) problems.push(`no tuya-smart-device node named "${nodeName}" in this flow`);
  if (!tuyaDeviceId) problems.push('a vendor device id is required');
  if (!localKey) problems.push('a local key is required — the node cannot connect without one');
  if (!VERSIONS.has(String(tuyaVersion))) problems.push(`"${tuyaVersion}" is not a Tuya protocol version`);

  // Two nodes holding a session to one device each take a slot in its small socket table, which is how
  // a device ends up answering the cloud but not the LAN (EX-037b collapsed exactly this).
  const other = flows.find((n) => n.type === 'tuya-smart-device' && n.deviceId === tuyaDeviceId && n.deviceName !== nodeName);
  if (other) problems.push(`that vendor device is already polled by "${other.deviceName}"`);

  if (problems.length) return { flows, changed: [], problems };

  const wanted = { deviceId: tuyaDeviceId, deviceKey: localKey, tuyaVersion: String(tuyaVersion) };
  if (enable) wanted.disableAutoStart = false;
  const changed = Object.keys(wanted).filter((k) => node[k] !== wanted[k]);
  if (!changed.length) return { flows, changed: [], problems: [] };

  const updated = { ...node, ...wanted };
  return { flows: flows.map((n) => (n === node ? updated : n)), changed, problems: [] };
}

/** Invariants over the result. Empty means safe to write. Messages name fields and nodes, never values. */
export function validateRebindPlan(before, after, nodeName) {
  const problems = [];
  if (after.length !== before.length) {
    problems.push(`node count changed: ${before.length} -> ${after.length}; a rebind never adds or removes a node`);
  }
  const beforeById = new Map(before.map((n) => [n.id, n]));
  for (const now of after) {
    const was = beforeById.get(now.id);
    if (!was) {
      problems.push(`node ${now.name ?? now.deviceName ?? now.id} was added`);
      continue;
    }
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    const label = now.deviceName ?? now.name ?? now.id;
    if (now.type !== 'tuya-smart-device' || now.deviceName !== nodeName || was.deviceName !== nodeName) {
      problems.push(`${label} was modified but was not named for rebinding`);
      continue;
    }
    const keys = new Set([...Object.keys(was), ...Object.keys(now)]);
    for (const k of keys) {
      if (REBIND_FIELDS.includes(k)) continue;
      if (JSON.stringify(was[k]) !== JSON.stringify(now[k])) problems.push(`${label}: ${k} changed — a rebind may change only ${REBIND_FIELDS.join(', ')}`);
    }
    if (now.disableAutoStart === true && was.disableAutoStart !== true) problems.push(`${label}: a rebind must not quiesce a node`);
  }
  for (const id of beforeById.keys()) {
    if (!after.some((n) => n.id === id)) problems.push(`node ${id} would be removed`);
  }
  return problems;
}
