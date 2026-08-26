import { fetchJson } from './bridgeClient';

/**
 * Which devices are still on the local segment, and which have left it.
 *
 * WHY THIS IS WORTH A SCREEN: the bridge finds devices only by their UDP discovery broadcast,
 * so a device that has stopped broadcasting reports `online: false` — identical, from here, to
 * one that is unplugged. The vendor cloud narrows it but cannot close it, because a device can
 * lose its uplink while staying perfectly well associated to the access point. The Pi's own ARP
 * table closes it: if the device answers an ARP request, layer 2 works whatever else says.
 *
 * The two outcomes need opposite remedies, and the cost of confusing them is a wasted journey:
 *   - dark, still on the segment -> a config change (a static `deviceIp`). Nobody drives.
 *   - dark, absent from the segment -> somebody has to walk to the outlet and cut its power.
 *
 * This existed only as `npm run tuya:macs`, which is correct and reachable solely over SSH. The
 * split it reports moved twice inside one hour on 2026-08-26, so reading it needs to be cheap.
 */

/** Produced by `server/macPresence.mjs`. A test asserts these still match it. */
export const PRESENCE_ON_SEGMENT = 'on segment';
export const PRESENCE_ABSENT = 'absent from segment';

export interface PresenceDevice {
  id: string;
  name?: string;
  /** The vendor cloud's view, reached over the internet rather than the local subnet. */
  cloud_online?: boolean;
  /** `null` when the server could not read a neighbour table — a withheld answer, not absence. */
  presence?: string | null;
  arp_state?: string | null;
}

export type PresenceStatus = 'loading' | 'ready' | 'unconfigured' | 'error';

export interface DevicePresence {
  devices: PresenceDevice[];
  /**
   * Whether the server could read an ARP table at all. False off the Pi, where the join would
   * otherwise mark every device absent — the strongest claim available, from no evidence.
   */
  arpReadable: boolean;
  status: PresenceStatus;
}

export const EMPTY_PRESENCE: DevicePresence = { devices: [], arpReadable: false, status: 'loading' };

export interface PresenceSplit {
  /** Dark to the cloud, still answering ARP. A config change, not a journey. */
  onSegment: PresenceDevice[];
  /** Dark to the cloud and absent from the segment. This is the one that needs a person. */
  absent: PresenceDevice[];
}

/**
 * Cloud-online devices are excluded on purpose: they are reachable over the internet, so
 * whatever ARP says they are not what anyone needs to act on, and listing them would bury the
 * ones that are. When the ARP table is unreadable both groups are empty — the page must be able
 * to say it does not know, and an empty group here is rendered as silence, never as "all clear".
 */
export function presenceSplit({ devices, arpReadable }: DevicePresence): PresenceSplit {
  if (!arpReadable) return { onSegment: [], absent: [] };
  const dark = devices.filter((d) => d.cloud_online === false);
  return {
    onSegment: dark.filter((d) => d.presence === PRESENCE_ON_SEGMENT),
    absent: dark.filter((d) => d.presence === PRESENCE_ABSENT),
  };
}

export async function fetchDevicePresence(): Promise<DevicePresence> {
  try {
    const data = await fetchJson<{ devices?: PresenceDevice[]; arp_readable?: boolean }>('/tuya/presence');
    // `=== true`, not a truthiness check with a default: a reply that omits the flag — an older
    // server, a truncated body — must not be read as a confident segment survey.
    return { devices: data.devices ?? [], arpReadable: data.arp_readable === true, status: 'ready' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('501')) return { devices: [], arpReadable: false, status: 'unconfigured' };
    return { devices: [], arpReadable: false, status: 'error' };
  }
}
