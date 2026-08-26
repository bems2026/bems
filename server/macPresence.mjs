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

import { execFileSync } from 'node:child_process';

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
 * the ones worth trying a static `deviceIp` on before sending anybody to the office.
 *
 * **Being on the segment is not the same as being reachable, and this list must not be read as
 * "no power-cycle needed".** An earlier version of this comment said exactly that. Measured on
 * `CO5` on 2026-08-26: it answered ARP throughout, took a correct static address, and then
 * refused every TCP connection on the Tuya port for six minutes — `find()` short-circuited
 * straight past discovery, as designed, and connected to nothing. ARP is answered by the
 * device's network layer; the Tuya session needs its application layer, and ADR-002 describes
 * exactly the state where the second is gone while the first is fine.
 * So this list is "try the cheap remedy first", not "the cheap remedy will work".
 */
export function reachableButDark(rows) {
  return rows.filter((r) => !r.cloudOnline && r.presence === PRESENCE.ON_SEGMENT);
}

/**
 * Reads this host's neighbour table, and says whether it managed to.
 *
 * WHY THE FLAG IS THE POINT: an empty neighbour list is not the same fact as an unreadable one,
 * but `joinMacPresence` cannot tell them apart — fed nothing, it marks every device ABSENT,
 * which is the strongest claim this module makes and would be served from the weakest evidence.
 * On screen that reads as "the entire fleet has left the network". The CLI never had this
 * problem because it only ever ran on the Pi; an HTTP endpoint can be called from anywhere.
 *
 * A command that exits 0 with nothing to say counts as unreadable for the same reason. A host
 * that is not on the device segment answers exactly that way, and "I cannot see" must not be
 * rendered as "there is nothing there".
 */
export function readNeighbours({ exec = () => execFileSync('ip', ['neigh'], { encoding: 'utf8' }) } = {}) {
  let text;
  try {
    text = exec();
  } catch (err) {
    return { readable: false, neighbours: [], reason: err?.message ?? String(err) };
  }
  const neighbours = parseNeighbours(text);
  if (!neighbours.length) {
    return { readable: false, neighbours: [], reason: 'no neighbour entries — this host is not on the device segment' };
  }
  return { readable: true, neighbours, reason: null };
}

/**
 * The presence rows, shaped for the browser.
 *
 * Two things are deliberately withheld. **`mac` and `ip` never leave the server**: the join
 * needs them, the page does not, and together they are a map of the building's network —
 * `tuya-devices.mjs` refuses to print them for the same reason, and a screenshot of a dashboard
 * travels further than a terminal does. **`presence` is null rather than a guess** when the ARP
 * table could not be read, so the page can say it does not know instead of implying absence.
 *
 * The cloud half is still served in that case: it is reached over the internet rather than the
 * local subnet, so it remains true regardless of what this host can see, and withholding it
 * would throw away the more portable of the two views.
 */
export function toPublicPresence(rows, { arpReadable } = {}) {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    cloud_online: r.cloudOnline,
    presence: arpReadable ? r.presence : null,
    arp_state: arpReadable ? r.arpState : null,
  }));
}
