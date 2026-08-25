/**
 * Joins Tuya's per-device MAC address against the Pi's ARP table, to answer the one question
 * that decides whether a dark device needs a person or a config change:
 *
 *     is it OFF THE NETWORK, or is it ON the network but no longer discoverable?
 *
 * WHY THIS EXISTS: the bridge finds devices only by their UDP discovery broadcast. A device that
 * has stopped broadcasting is invisible to `find()` and reports `online: false` — identical, from
 * the bridge's side, to one that is unplugged. The cloud view (`tuya-devices.mjs`) narrows it but
 * cannot close it: a device can be offline to Tuya because its *uplink* is gone while it is still
 * perfectly well associated to the local AP.
 *
 * ARP closes it. If the Pi holds a resolved MAC for the device, the device answered an ARP
 * request — layer 2 works, whatever ICMP, UDP discovery or the cloud say. That is the same
 * reasoning CLAUDE.md already records for ruling out client isolation, applied per device.
 *
 * The join key is the MAC, from Tuya's `/v1.0/iot-03/devices/factory-infos`. It is the only
 * identifier both sides carry: the cloud's `ip` field is the WAN egress address as of last
 * contact, which is stale for exactly the devices in question and never maps to a LAN address.
 *
 * On 2026-08-25 this distinguished four outlets that were still associated to the segment from
 * two that were genuinely gone — a split that RM-020 had recorded as six devices all needing a
 * power-cycle on site.
 *
 * READ-ONLY, and it touches no device: cloud metadata plus the Pi's own neighbour table. That
 * matters — probing the devices directly costs their single local connection slot.
 */

export const PRESENCE = {
  /** The Pi holds a resolved MAC for this device. It is associated to the segment. */
  ON_SEGMENT: 'on segment',
  /** Tuya knows this device's MAC and the Pi has no resolved entry for it. */
  ABSENT: 'absent from segment',
  /** No MAC from the cloud, so nothing can be concluded either way. */
  UNKNOWN: 'no MAC available',
};

/** Lowercase hex, separators stripped. Returns null unless it is exactly 12 hex digits. */
export function normalizeMac(value) {
  if (!value) return null;
  const hex = String(value).toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length === 12 ? hex : null;
}

/**
 * Parses `ip neigh` output.
 *
 * Entries without an `lladdr` are deliberately dropped rather than recorded as present. A line
 * in state FAILED or INCOMPLETE means the kernel asked and got no answer — that is evidence of
 * ABSENCE, and counting it as a neighbour would invert the very conclusion this module exists to
 * draw. The Pi's own table carried exactly such a line on 2026-08-25.
 */
export function parseNeighbours(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const at = parts.indexOf('lladdr');
    if (at === -1) continue;
    const mac = normalizeMac(parts[at + 1]);
    if (!mac) continue;
    out.push({ ip: parts[0], mac, state: parts[parts.length - 1] });
  }
  return out;
}

/**
 * @param cloudDevices  [{ id, name, online }] from listDevices()
 * @param factoryInfos  [{ id, mac }] from the factory-infos endpoint
 * @param neighbours    parseNeighbours(...) output
 * @returns one row per cloud device, sorted by name
 */
export function joinMacPresence({ cloudDevices = [], factoryInfos = [], neighbours = [] } = {}) {
  const macById = new Map();
  for (const f of factoryInfos) {
    const mac = normalizeMac(f?.mac);
    if (f?.id && mac) macById.set(f.id, mac);
  }
  // Last entry wins: a device that changed address leaves the older line behind, and the
  // freshest resolution is the one that describes where it is now.
  const byMac = new Map();
  for (const n of neighbours) byMac.set(n.mac, n);

  return cloudDevices
    .map((d) => {
      const mac = macById.get(d.id) ?? null;
      const hit = mac ? byMac.get(mac) : undefined;
      return {
        name: d.name,
        id: d.id,
        mac,
        cloudOnline: Boolean(d.online),
        ip: hit?.ip ?? null,
        arpState: hit?.state ?? null,
        presence: !mac ? PRESENCE.UNKNOWN : hit ? PRESENCE.ON_SEGMENT : PRESENCE.ABSENT,
      };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * The rows worth acting on: dark to the cloud, yet demonstrably still on the segment. These are
 * the ones a power-cycle would be the wrong remedy for.
 */
export function reachableButDark(rows) {
  return rows.filter((r) => !r.cloudOnline && r.presence === PRESENCE.ON_SEGMENT);
}
