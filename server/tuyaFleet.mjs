/**
 * The cloud device list, shaped for the browser.
 *
 * WHY A SHAPING STEP RATHER THAN FORWARDING THE CLOUD REPLY:
 * Tuya's device payload carries `local_key` alongside the harmless fields. Forwarding it and
 * trusting the frontend not to render it would put the most sensitive credential in this system
 * one careless `JSON.stringify` away from a browser devtools pane, a screenshot, or a bug
 * report. So the allowlist below is the contract: fields are copied in by name, and anything
 * Tuya adds later — including a future credential — is dropped by default rather than passed
 * through by default.
 *
 * `assertNoSecrets` then checks the result rather than trusting the allowlist, because an
 * allowlist is only as good as the last person who edited it.
 */

/**
 * The only fields that may reach the browser. Additions need a reason.
 *
 * `sub` (2026-09-17): whether the device is a sub-device with no network presence of its own. The IR
 * hub's aircon remote is one, and without this the Add Device wizard offered it for enrolment as an
 * outlet — a node that could never connect.
 */
const PUBLIC_FIELDS = ['id', 'name', 'online', 'category', 'product_name', 'sub'];

/** Anything whose name suggests a credential. Checked against keys, not values. */
const SECRET_KEY_PATTERN = /key|secret|token|password|uid|sid/i;

export function toPublicDevice(raw) {
  const out = {};
  for (const field of PUBLIC_FIELDS) {
    if (raw[field] !== undefined) out[field] = raw[field];
  }
  return out;
}

/**
 * Throws if any object in the payload carries a credential-shaped key. Deliberately a throw and
 * not a filter: a payload that reached here with a secret in it means the allowlist above was
 * edited wrongly, and failing the request is the correct response to that — quietly stripping
 * it would hide the mistake until the next edit reintroduced it somewhere else.
 */
export function assertNoSecrets(payload) {
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        throw new Error(`refusing to serve a credential-shaped field: ${path}.${key}`);
      }
      walk(node[key], `${path}.${key}`);
    }
  };
  walk(payload, 'payload');
  return payload;
}

/**
 * @param claimedIds  vendor ids that already have a node in the flow. Marked rather than
 *                    filtered out: the enrolment wizard needs to distinguish "already enrolled"
 *                    from "not in the project at all", and a device missing from a list tells
 *                    you neither. `claimed` is derived here rather than in the browser because
 *                    only the server can read the flow.
 */
export function toPublicFleet(rawDevices, claimedIds = new Set()) {
  // A Map of vendor id -> flow node name also says WHICH node claims it, so the wizard can print
  // "already in the flow as NBRIC IR Blaster" instead of a bare "claimed". A Set still works.
  const nodeFor = (id) => (claimedIds instanceof Map ? (claimedIds.get(id) ?? null) : null);
  return assertNoSecrets(
    rawDevices.map((d) => ({ ...toPublicDevice(d), claimed: claimedIds.has(d.id), claimed_by: nodeFor(d.id) })),
  );
}

/** Vendor id -> the `deviceName` of the flow node that polls it. */
export function claimedNodesFrom(flows) {
  return new Map(
    (flows ?? []).filter((n) => n?.type === 'tuya-smart-device' && n.deviceId).map((n) => [n.deviceId, n.deviceName]),
  );
}

/**
 * Flow nodes whose vendor id this cloud project no longer has — what re-pairing a device in Smart Life
 * leaves behind, as it did the IR blaster on 2026-09-17. Named with the class of the registry device
 * bound to each (`classForNode`), which is what lets the wizard offer a rebind only to a device of the
 * same kind; a node with no bound device gets `null` and is never offered one.
 *
 * Names and classes only. The stale vendor id is not a secret, but it is not something a browser
 * needs, and this list is served to one.
 */
export function orphanNodesFrom(flows, cloudIds, classForNode) {
  const inProject = new Set(cloudIds ?? []);
  return (flows ?? [])
    .filter((n) => n?.type === 'tuya-smart-device' && n.deviceId && !inProject.has(n.deviceId))
    .map((n) => ({ name: n.deviceName, class: classForNode(n.deviceName) ?? null }));
}
