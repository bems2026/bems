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
 *
 * THE MAP IS RE-READ ON A MISS (2026-09-17). A device re-paired in Smart Life gets a new vendor id,
 * and the flow node is updated — by hand, as the IR blaster was, or by the Devices page's Rebind.
 * A map frozen at startup kept the old id until somebody restarted the proxy. A lookup that finds
 * nothing now re-reads the flow, at most once a minute, so a rebound device regains its route on its
 * own. A changed id for a device already in the map is picked up the same way on the next miss, and
 * by the restart every `server/` deploy already needs.
 */

import { readFileSync } from 'node:fs';
import { createTuyaClient, TUYA_HOSTS } from './tuyaCloud.mjs';
import { createAcRemoteResolver } from './acRemote.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';

export const DEFAULT_FLOW_PATH = '/home/bems/.node-red/flows.json';

const REREAD_AFTER_MS = 60_000;

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
 *
 * A registry entry that declares its `flow_node` is matched on that first: the aircon's node is
 * called "NBRIC IR Blaster", which no pattern could derive "acu_main" from, and the name is a fact
 * about the site that belongs in the site file.
 */
export function registryIdForNodeName(name, registry = DEVICE_REGISTRY) {
  if (!name) return null;
  const declared = registry.find((d) => d.flow_node === name);
  if (declared) return declared.id;
  let m = /^Light Switch (\d)$/.exec(name);
  if (m) return `l${m[1]}`;
  m = /^CO(\d)$/.exec(name);
  if (m) return `co${m[1]}`;
  return null;
}

export function buildCloudDispatch(env, { readFile = readFileSync, flowPath = DEFAULT_FLOW_PATH, now = Date.now } = {}) {
  const accessId = env.TUYA_ACCESS_ID;
  const accessSecret = env.TUYA_ACCESS_SECRET;
  const host = TUYA_HOSTS[(env.TUYA_REGION ?? '').toLowerCase()];
  if (!accessId || !accessSecret || !host) return null;

  const readMap = () => vendorIdMapFrom(JSON.parse(readFile(flowPath, 'utf8')), (n) => registryIdForNodeName(n));

  let map = {};
  try {
    map = readMap();
  } catch {
    return null;
  }
  if (!Object.keys(map).length) return null;

  let readAt = now();
  const client = createTuyaClient({ accessId, accessSecret, host });

  return {
    client,
    tuyaDeviceIdFor: (deviceId) => {
      if (map[deviceId] === undefined && now() - readAt >= REREAD_AFTER_MS) {
        readAt = now();
        try {
          map = readMap();
        } catch {
          // Keep the last good map: an unreadable flow mid-flight is not a reason to lose every route.
        }
      }
      return map[deviceId];
    },
    acRemoteId: createAcRemoteResolver({ client, now }),
  };
}
