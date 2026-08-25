/**
 * Assembles the vendor-cloud fallback for `dispatchCommand`, or returns null when it is not
 * configured — which is the ordinary deployment and not an error.
 *
 * WHY THE MAPPING IS READ FROM THE LIVE FLOW:
 * Cloud dispatch needs each device's *vendor* id, and those live only in the Node-RED flow on
 * the Pi — never in this repository, which is public. Reading them from `flows.json` at
 * startup keeps it that way: no new secret, no new file to keep in sync, and the ids stay
 * exactly where they already are. `flowPath` and `readFile` are injected so this is testable
 * without a flow on disk.
 *
 * A missing or unreadable flow disables the fallback rather than failing the proxy. The
 * fallback is a recovery path; a system that would not start because its recovery path was
 * unavailable would be worse than one that simply lacks it.
 */

import { readFileSync } from 'node:fs';
import { createTuyaClient, TUYA_HOSTS } from './tuyaCloud.mjs';

export const DEFAULT_FLOW_PATH = '/home/bems/.node-red/flows.json';

/** registry device id -> vendor device id, from the flow's `tuya-smart-device` nodes. */
export function vendorIdMapFrom(flowJson, registryIdForNodeName) {
  const map = {};
  for (const node of flowJson) {
    if (node?.type !== 'tuya-smart-device' || !node.deviceId) continue;
    const registryId = registryIdForNodeName(node.deviceName);
    if (registryId) map[registryId] = node.deviceId;
  }
  return map;
}

/**
 * Node names in the flow are not registry ids ("Light Switch 1" against "l1"), and nothing in
 * the repo recorded the binding until now. Derived rather than hand-listed so a renamed node
 * fails to map — and therefore falls back to no cloud route — instead of silently addressing
 * the wrong device.
 */
export function registryIdForNodeName(name) {
  if (!name) return null;
  let m = /^Light Switch (\d)$/.exec(name);
  if (m) return `l${m[1]}`;
  m = /^CO(\d)$/.exec(name);
  if (m) return `co${m[1]}`;
  return null;
}

export function buildCloudDispatch(env, { readFile = readFileSync, flowPath = DEFAULT_FLOW_PATH } = {}) {
  const accessId = env.TUYA_ACCESS_ID;
  const accessSecret = env.TUYA_ACCESS_SECRET;
  const host = TUYA_HOSTS[(env.TUYA_REGION ?? '').toLowerCase()];
  if (!accessId || !accessSecret || !host) return null;

  let map = {};
  try {
    map = vendorIdMapFrom(JSON.parse(readFile(flowPath, 'utf8')), registryIdForNodeName);
  } catch {
    return null;
  }
  if (!Object.keys(map).length) return null;

  return {
    client: createTuyaClient({ accessId, accessSecret, host }),
    tuyaDeviceIdFor: (deviceId) => map[deviceId],
  };
}
