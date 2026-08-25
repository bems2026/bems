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

/** The only fields that may reach the browser. Additions need a reason. */
const PUBLIC_FIELDS = ['id', 'name', 'online', 'category', 'product_name'];

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
  return assertNoSecrets(rawDevices.map((d) => ({ ...toPublicDevice(d), claimed: claimedIds.has(d.id) })));
}
