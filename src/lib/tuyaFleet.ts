import { fetchJson } from './bridgeClient';

/**
 * The Tuya cloud's view of each device, fetched through the proxy.
 *
 * WHY IT MATTERS ON SCREEN: the cloud reaches devices over the internet rather than the local
 * subnet, so when it disagrees with the bridge that disagreement *is* the diagnosis — cloud-up
 * and locally-down means the device is fine and the network is in the way. Until now that
 * comparison existed only in a CLI script, which meant the person looking at the dashboard
 * could see a device was offline but not why.
 *
 * The credential stays server-side. `server/tuyaFleet.mjs` allowlists the fields that may be
 * served, so nothing here can receive a local key even if Tuya starts returning new ones.
 */
export interface CloudDevice {
  id: string;
  name?: string;
  online?: boolean;
  /** Already has a node in the flow. Derived server-side — only it can read the flow. */
  claimed?: boolean;
  category?: string;
  product_name?: string;
}

export type CloudFleetStatus = 'loading' | 'ready' | 'unconfigured' | 'error';

export interface CloudFleet {
  byId: Record<string, CloudDevice>;
  status: CloudFleetStatus;
}

export const EMPTY_FLEET: CloudFleet = { byId: {}, status: 'loading' };

export function fleetById(devices: CloudDevice[]): Record<string, CloudDevice> {
  const out: Record<string, CloudDevice> = {};
  for (const d of devices) if (d.id) out[d.id] = d;
  return out;
}

/**
 * `unconfigured` is a distinct outcome from `error` on purpose. A deployment with no Tuya
 * credentials is not broken, and showing it an error for a feature it was never given would be
 * noise — the UI hides the column instead.
 */
export async function fetchCloudFleet(): Promise<CloudFleet> {
  try {
    const data = await fetchJson<{ devices?: CloudDevice[] }>('/tuya/devices');
    return { byId: fleetById(data.devices ?? []), status: 'ready' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('501')) return { byId: {}, status: 'unconfigured' };
    return { byId: {}, status: 'error' };
  }
}
