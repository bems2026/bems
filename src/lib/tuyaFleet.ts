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
 *
 * Since 2026-09-17 the list is not only the cloud's: it merges imported keys, the devices heard on the
 * device network, and the cloud while its subscription answers. `sources` says which of them did.
 */
export interface CloudDevice {
  id: string;
  name?: string | null;
  /** The vendor cloud's own view; null for a device known only from an import or the network. */
  online?: boolean | null;
  /**
   * Where this device's local key would come from (2026-09-17): an imported export, the vendor cloud,
   * or nowhere yet — `null` is a device heard on the network that no import or cloud listing names.
   */
  credential_source?: 'imported' | 'cloud' | null;
  /** Announced on the device network in the last few minutes, as the proxy's listener heard it. */
  on_lan?: boolean;
  /** The protocol version it announces. */
  lan_version?: string | null;
  /** Already has a node in the flow. Derived server-side — only it can read the flow. */
  claimed?: boolean;
  category?: string | null;
  product_name?: string | null;
  /** A sub-device with no network presence of its own — the IR hub's aircon remote is one. */
  sub?: boolean;
  /** The flow node that polls it, when claimed and the server could say. */
  claimed_by?: string | null;
}

/**
 * A flow node whose device the cloud project no longer has — what re-pairing in Smart Life leaves
 * behind. `class` is the registry class bound to it; a rebind is only ever offered to a device of
 * that kind, and a node with no bound class is never offered one.
 */
export interface OrphanNode {
  name: string;
  class: string | null;
}

/**
 * Which of the three sources answered (see server/deviceSources.mjs). The vendor cloud is optional —
 * its subscription lapses by design — so its state is reported, never inferred from an empty list.
 */
export interface DeviceSources {
  cloud: { status: 'ok' | 'unconfigured' | 'unavailable'; detail?: string };
  imported: { count: number; last_complete_at: string | null };
  lan: { listening_since: string | null };
}

/** `unconfigured` now only comes from a proxy that predates key import, which answered 501. */
export type CloudFleetStatus = 'loading' | 'ready' | 'unconfigured' | 'error';

export interface CloudFleet {
  byId: Record<string, CloudDevice>;
  status: CloudFleetStatus;
  /**
   * Whether the server could actually determine which devices are already enrolled. That read
   * needs Node-RED admin credentials the Tuya call does not, so it can fail on its own — and
   * when it does, every `claimed` is false, which is indistinguishable from a genuinely empty
   * flow. Carrying the distinction lets the wizard say "unknown" instead of implying "none".
   */
  claimedKnown: boolean;
  orphanNodes: OrphanNode[];
  /** Null from a proxy that predates the sources block. */
  sources: DeviceSources | null;
}

export const EMPTY_FLEET: CloudFleet = { byId: {}, status: 'loading', claimedKnown: false, orphanNodes: [], sources: null };

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
    const data = await fetchJson<{ devices?: CloudDevice[]; claimed_known?: boolean; orphan_nodes?: OrphanNode[]; sources?: DeviceSources }>('/tuya/devices');
    return {
      byId: fleetById(data.devices ?? []),
      status: 'ready',
      claimedKnown: data.claimed_known === true,
      orphanNodes: Array.isArray(data.orphan_nodes) ? data.orphan_nodes : [],
      sources: data.sources ?? null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('501')) return { ...EMPTY_FLEET, status: 'unconfigured' };
    return { ...EMPTY_FLEET, status: 'error' };
  }
}
