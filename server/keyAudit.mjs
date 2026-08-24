/**
 * Compares the local keys in the Node-RED flow against the keys Tuya's cloud holds, and reports
 * only whether each one matches.
 *
 * WHY: a wrong local key does not fail loudly. The device is discovered, the connection is
 * attempted, and it fails in a way that reads as a network problem — which is exactly the wrong
 * diagnosis, and one already made once in this project's history (ROADMAP RM-001a first blamed
 * a stale key for l6/l7, wrongly, because nothing could check). Re-pairing a device rotates its
 * key, and three devices were re-paired on 2026-08-24 alone.
 *
 * SECRETS: this module never returns, logs, or renders a key. It compares and discards. The
 * comparison is done on a salted digest rather than the raw values so that even an accidental
 * dump of an intermediate object cannot leak one — the salt is per-run and never stored, which
 * makes the digests useless outside the single comparison they exist for.
 */

import crypto from 'node:crypto';

/**
 * A per-run salt. Without it, a digest of a 16-character key would be trivially reversible by
 * anyone with a candidate list — and a Tuya local key is drawn from a small enough space that
 * "hashed" would be a false comfort.
 */
function makeDigest() {
  const salt = crypto.randomBytes(32);
  return (value) => (value ? crypto.createHmac('sha256', salt).update(String(value)).digest('hex') : null);
}

export const KEY_STATUS = {
  MATCH: 'match',
  MISMATCH: 'mismatch',
  MISSING_LOCAL: 'missing in flow',
  MISSING_CLOUD: 'missing in cloud',
  NOT_IN_PROJECT: 'device not in project',
  UNAVAILABLE: 'could not be fetched',
};

/**
 * @param nodes    tuya-smart-device nodes from the live flow
 * @param fetchKey async (deviceId) => local key, or null when the cloud has no such device
 */
export async function auditKeys(nodes, fetchKey) {
  const digest = makeDigest();
  const results = [];
  for (const node of nodes) {
    const name = node.deviceName;
    const localKey = node.deviceKey;
    if (!node.deviceId) {
      results.push({ name, status: KEY_STATUS.MISSING_LOCAL });
      continue;
    }
    let cloudKey;
    try {
      cloudKey = await fetchKey(node.deviceId);
    } catch (e) {
      results.push({ name, status: KEY_STATUS.UNAVAILABLE, detail: String(e.message).slice(0, 80) });
      continue;
    }
    if (cloudKey === undefined) {
      results.push({ name, status: KEY_STATUS.NOT_IN_PROJECT });
      continue;
    }
    if (!localKey) {
      results.push({ name, status: KEY_STATUS.MISSING_LOCAL });
      continue;
    }
    if (!cloudKey) {
      results.push({ name, status: KEY_STATUS.MISSING_CLOUD });
      continue;
    }
    // Digests, not the values. Equality is all the caller needs and all it gets.
    results.push({
      name,
      status: digest(localKey) === digest(cloudKey) ? KEY_STATUS.MATCH : KEY_STATUS.MISMATCH,
    });
  }
  return results;
}

/** True when every node either matched or is legitimately absent from the project. */
export function auditIsClean(results) {
  return results.every((r) => r.status === KEY_STATUS.MATCH || r.status === KEY_STATUS.NOT_IN_PROJECT);
}
