/**
 * `POST /api/rebind` — the HTTP half of rebinding a flow node to a re-paired device.
 *
 * Thin on purpose, as `enrollRoute.mjs` is: every decision lives in `rebindService.mjs`, which the CLI
 * also calls. Preview and apply are the same request with `apply` differing, so the preview the Add
 * Device wizard shows is exactly the write it confirms.
 *
 * Environment is NOT loaded here, for the reason `enrollRoute.mjs` gives: the proxy's systemd unit
 * supplies it, and a module-level load would pull every secret into any process that imports this.
 */

import { createTuyaClient, TUYA_HOSTS } from './tuyaCloud.mjs';
import { createAdminClient } from '../node-red-bridge/nodeRedAdmin.mjs';
import { DEVICE_REGISTRY } from '../shared/registry.mjs';
import { TUYA_NODE_VERSIONS } from '../shared/tuyaNodeSettings.mjs';
import { registryIdForNodeName } from './cloudDispatchConfig.mjs';
import { listenForAnnouncement } from './lanDiscovery.mjs';
import { rebindDevice } from './rebindService.mjs';

/** The class of the registry device bound to a flow node, or null. Shared with the CLI. */
export function classForNode(name) {
  const id = registryIdForNodeName(name);
  return DEVICE_REGISTRY.find((d) => d.id === id)?.class ?? null;
}

/**
 * The real dependencies. With `sources` (deviceSources.mjs) keys come from an import or the cloud,
 * the version from LAN presence, and "is this node orphaned" needs both a complete list without its
 * device and network silence. Without `sources`, the vendor cloud alone decides, as it always did.
 */
export function realRebindDeps({ sources = null, accessId, accessSecret, host, apply, adminHost = '127.0.0.1', adminPort = 1880 }) {
  const cloud = sources ? sources.asDeviceSource() : createTuyaClient({ accessId, accessSecret, host });
  return {
    cloud,
    admin: createAdminClient({ host: adminHost, port: adminPort, timeoutMs: 20000 }),
    discoverVersion: sources
      ? (id) => sources.versionFor(id, { listen: listenForAnnouncement })
      : async (id) => (await listenForAnnouncement(id))?.version ?? null,
    classForNode,
    declaredVersionFor: (name) => TUYA_NODE_VERSIONS[name],
    ...(sources ? { isOrphan: (node) => sources.isOrphan(node, classForNode, { listen: listenForAnnouncement }) } : {}),
    apply,
  };
}

export async function handleRebind(req, res, { readJsonBody, sendJson, sources = null }) {
  const host = TUYA_HOSTS[(process.env.TUYA_REGION ?? '').toLowerCase()];
  if (!sources && (!process.env.TUYA_ACCESS_ID || !process.env.TUYA_ACCESS_SECRET || !host)) {
    return sendJson(res, 503, {
      ok: false,
      stage: 'unconfigured',
      problems: ['no source of device keys is configured on this deployment'],
      summary: null,
    });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { ok: false, stage: 'request', problems: ['malformed request body'], summary: null });
  }

  let result;
  try {
    result = await rebindDevice(
      { nodeName: body?.nodeName, tuyaDeviceId: body?.tuyaDeviceId },
      realRebindDeps({ sources, accessId: process.env.TUYA_ACCESS_ID, accessSecret: process.env.TUYA_ACCESS_SECRET, host, apply: body?.apply === true }),
    );
  } catch (err) {
    // An upstream that threw — Node-RED's admin API, or a cloud used without `sources`. Short, and never
    // the upstream body.
    return sendJson(res, 502, { ok: false, stage: 'upstream', problems: [String(err?.message ?? err).slice(0, 200)], summary: null });
  }
  return sendJson(res, result.ok ? 200 : 422, result);
}
