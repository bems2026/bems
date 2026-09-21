/**
 * The LAN map: which device last announced itself from which address, remembered — RM-131.
 *
 * WHY THIS EXISTS. The 2026-09-21 outage test (mains off to the office: devices, Pi and access
 * point; then on) ended with every light switch, outlet and the IR hub in one state: associated to
 * the AP, answering ARP, accepting TCP on port 6668 — and not sending the UDP discovery broadcast.
 * Node-RED's `find()` waits for that broadcast, so reachable devices read "offline" for a day, and
 * a Node-RED restart cannot help, because there is nothing to find. `set-device-ip:pi` is the
 * remedy — a node with a `deviceIp` connects directly and never calls `find()` — but it mapped
 * devices to addresses through the vendor cloud, which is lapsed (RM-121).
 *
 * So: whenever a device DOES announce (after a power cycle, at least), remember it here. The runner
 * listens passively every few minutes and merges what it hears with the neighbour table, so each
 * entry carries the address and the MAC. `set-device-ip:pi --from-lan-map` then addresses every
 * node the map knows, with no cloud in the path; and `reservationRows` is the table to type into the
 * access point's DHCP reservations, so the addresses stay true across the next outage.
 *
 * Pure functions over plain data. The file is `server/data/lan-map.json` — live state, like the
 * audit queue beside it, and never committed (the repository is public and MACs are in it).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Default age beyond which a remembered address is not offered unasked. */
export const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Live state beside the audit queue; gitignored, because MACs are in it. */
export const LAN_MAP_PATH = join(dirname(fileURLToPath(import.meta.url)), 'data', 'lan-map.json');

export function readLanMap(path = LAN_MAP_PATH) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Atomic: a timer firing during a read leaves either the old file or the new one. */
export function writeLanMap(map, path = LAN_MAP_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n');
  renameSync(tmp, path);
}

/**
 * @param {Record<string, object>} map   gwId -> { ip, mac, version, firstSeen, lastSeen }
 * @param {Array<{gwId:string, ip:string, version?:string}>} heard   what the listener decoded
 * @param {Array<{ip:string, mac:string}>} neighbours   `ip neigh`, for the MAC behind each address
 * @param {string} nowIso
 */
export function mergeAnnouncements(map, heard, neighbours, nowIso) {
  const macByIp = new Map((neighbours ?? []).map((n) => [n.ip, n.mac]));
  const out = { ...map };
  for (const h of heard ?? []) {
    if (!h || typeof h.gwId !== 'string' || typeof h.ip !== 'string') continue;
    const prev = out[h.gwId];
    out[h.gwId] = {
      ip: h.ip,
      mac: macByIp.get(h.ip) ?? prev?.mac ?? null,
      version: h.version ?? prev?.version ?? null,
      firstSeen: prev?.firstSeen ?? nowIso,
      lastSeen: nowIso,
    };
  }
  return out;
}

const tuyaNodes = (flows) => flows.filter((n) => n?.type === 'tuya-smart-device' && typeof n.deviceId === 'string');

/**
 * `{ [deviceName]: ip }` for every tuya node whose device the map has heard recently, plus a note
 * for every node it could not address and why. A node already at the mapped address is left alone.
 */
export function assignmentsFromMap(flows, map, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const assignments = {};
  const notes = [];
  for (const node of tuyaNodes(flows)) {
    const entry = map[node.deviceId];
    if (!entry || !entry.ip) {
      notes.push(`"${node.deviceName}" has never announced itself while the listener was running — no address to give it.`);
      continue;
    }
    const age = now - Date.parse(entry.lastSeen ?? '');
    if (!(age <= maxAgeMs)) {
      notes.push(`"${node.deviceName}" last announced ${String(entry.lastSeen).slice(0, 10)} from ${entry.ip} — older than the limit, pass --max-age-days= to use it anyway.`);
      continue;
    }
    if (node.deviceIp === entry.ip) {
      notes.push(`"${node.deviceName}" is already at ${entry.ip}.`);
      continue;
    }
    assignments[node.deviceName] = entry.ip;
  }
  return { assignments, notes };
}

/** One row per mapped node — the DHCP reservation table for the access point, in flow order. */
export function reservationRows(flows, map) {
  return tuyaNodes(flows)
    .map((node) => ({ node, entry: map[node.deviceId] }))
    .filter(({ entry }) => entry && entry.ip)
    .map(({ node, entry }) => ({ name: node.deviceName, mac: entry.mac ?? null, ip: entry.ip, lastSeen: entry.lastSeen ?? null }));
}
