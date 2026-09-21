#!/usr/bin/env node
/**
 * Listens for Tuya discovery broadcasts and remembers who announced from where — RM-131.
 *
 *     node server/lan-map-learn.mjs [--seconds=30] [--print]
 *
 * PASSIVE. Binds the discovery ports with `reuseAddr`, exactly as tuyapi's own `find()` does, so
 * it coexists with Node-RED on the Pi; sends nothing, opens no connection to any device. Run by
 * `ibems-lan-map.timer` every ten minutes, and by hand with `--print` to see the map.
 *
 * The map is `server/data/lan-map.json` — live state, never committed (MACs are in it). Written
 * atomically, so a timer firing during a read leaves either the old file or the new one.
 */
import dgram from 'node:dgram';
import { decodeDiscovery } from './lanDiscovery.mjs';
import { readNeighbours } from './macPresence.mjs';
import { mergeAnnouncements, readLanMap, writeLanMap } from './lanMap.mjs';

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const SECONDS = Number(arg('seconds', '30'));
const PRINT = process.argv.includes('--print');

/** Every distinct announcement heard in the window: gwId -> { ip, version }. */
function listen(seconds) {
  return new Promise((resolve) => {
    const heard = new Map();
    const sockets = [6666, 6667, 7000].map((port) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.on('message', (buf, rinfo) => {
        const hit = decodeDiscovery(buf);
        if (hit?.gwId) heard.set(hit.gwId, { gwId: hit.gwId, ip: rinfo.address, version: hit.version });
      });
      s.on('error', () => {});
      try { s.bind(port); } catch { /* another listener owns it exclusively; the others still work */ }
      return s;
    });
    setTimeout(() => {
      for (const s of sockets) { try { s.close(); } catch { /* already closed */ } }
      resolve([...heard.values()]);
    }, seconds * 1000);
  });
}

const before = readLanMap();
const heard = await listen(SECONDS);
const { neighbours } = readNeighbours();
const map = mergeAnnouncements(before, heard, neighbours, new Date().toISOString());
writeLanMap(map);

const moved = heard.filter((h) => before[h.gwId] && before[h.gwId].ip !== h.ip).map((h) => `${h.gwId.slice(0, 6)}… ${before[h.gwId].ip} -> ${h.ip}`);
const fresh = heard.filter((h) => !before[h.gwId]).length;
console.log(`[ibems-lan-map] heard ${heard.length} device(s) in ${SECONDS} s; map holds ${Object.keys(map).length} (${fresh} new${moved.length ? `, moved: ${moved.join(', ')}` : ''})`);
if (PRINT) {
  for (const [gwId, e] of Object.entries(map).sort((a, b) => a[1].ip.localeCompare(b[1].ip, undefined, { numeric: true }))) {
    console.log(`  ${gwId.slice(0, 6)}…  ${e.ip.padEnd(15)}  ${e.mac ?? '(no MAC seen)'}  v${e.version ?? '?'}  last ${e.lastSeen}`);
  }
}
