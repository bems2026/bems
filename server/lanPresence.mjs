/**
 * A standing, passive view of which Tuya devices are announcing on the device network.
 *
 * WHY STANDING. `lanDiscovery.listenForAnnouncement` answers one question about one device and takes
 * up to twelve seconds. Add Device needs the whole picture at once — a device paired in Smart Life a
 * minute ago appears here within five seconds, with its id, product key and protocol version, and
 * with no vendor cloud involved at all. And a flow node whose device has not been heard for minutes
 * is the local evidence that it was re-paired (a new id) or has left the network.
 *
 * Runs inside the proxy, on the Pi, which is the only place these broadcasts exist. Binds with
 * `reuseAddr` so Node-RED's own discovery keeps working beside it. Addresses are not kept: the
 * snapshot is served to a browser, and nothing here needs them.
 */

import dgram from 'node:dgram';
import { decodeDiscovery } from './lanDiscovery.mjs';

export function createLanPresence({ ports = [6666, 6667, 7000], now = Date.now } = {}) {
  const seen = new Map();
  let sockets = [];
  let startedAt = null;

  const onMessage = (msg) => {
    const hit = decodeDiscovery(msg);
    if (!hit) return;
    const t = now();
    const prior = seen.get(hit.gwId);
    seen.set(hit.gwId, {
      id: hit.gwId,
      version: hit.version,
      productKey: hit.productKey,
      firstSeen: prior?.firstSeen ?? t,
      lastSeen: t,
      count: (prior?.count ?? 0) + 1,
    });
  };

  return {
    start() {
      if (sockets.length) return;
      startedAt = now();
      for (const port of ports) {
        const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        s.on('message', onMessage);
        // A port that cannot be bound is one fewer place to hear from, not a reason to stop the proxy.
        s.on('error', () => {});
        s.bind(port);
        sockets.push(s);
      }
    },
    stop() {
      for (const s of sockets) {
        try {
          s.close();
        } catch {
          // already closed
        }
      }
      sockets = [];
    },
    get(id) {
      return seen.get(id) ?? null;
    },
    heardWithin(id, ms) {
      const e = seen.get(id);
      return Boolean(e) && now() - e.lastSeen <= ms;
    },
    /** Whether "not heard in `ms`" means anything yet — the listener must have run that long. */
    isWarm(ms) {
      return startedAt !== null && now() - startedAt >= ms;
    },
    startedAt: () => startedAt,
    snapshot() {
      return [...seen.values()].map((e) => ({ ...e }));
    },
  };
}
