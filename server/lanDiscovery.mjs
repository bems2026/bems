/**
 * A device's protocol version, read from its own LAN discovery broadcast.
 *
 * WHY THIS EXISTS. Enrolment needs the protocol version a device speaks, because a node that
 * declares the wrong one fails as `find() timed out` — which reads exactly like a network fault and
 * has cost this project days (`shared/tuyaNodeSettings.mjs`). `server/enrollService.mjs` asked the
 * vendor cloud for it, and the cloud does not have it: `/v1.0/devices/{id}` returns no version field,
 * checked on every device in the project on 2026-09-17. So every enrolment would have been refused,
 * and nobody had run one to find out.
 *
 * The answer this project has always trusted is the device's own announcement. Every Tuya device
 * broadcasts a small encrypted JSON datagram every ~5 s — `{ip, gwId, productKey, version, …}` — and
 * the key for those broadcasts is public (the MD5 of a fixed string every client library carries).
 * Listening for the target's `gwId` is how the versions in `TUYA_NODE_VERSIONS` were measured.
 *
 * FRAMING, per version:
 *   3.1        UDP 6666, 0x55AA frame, plaintext JSON.
 *   3.3 / 3.4  UDP 6667, 0x55AA frame, AES-128-ECB with PKCS#7 padding.
 *   3.5        UDP 6667, 0x6699 frame, AES-128-GCM: 14-byte header as AAD, 12-byte IV, 16-byte tag,
 *              plaintext prefixed by a 4-byte return code.
 *
 * PASSIVE AND SHARED. It only listens, binding with `reuseAddr` exactly as tuyapi's own `find()` does,
 * so it coexists with Node-RED's discovery on the Pi rather than taking the port from it. It means
 * something only on the device segment — which is where the proxy runs.
 *
 * No dependencies: `node:dgram` and `node:crypto`.
 */

import dgram from 'node:dgram';
import crypto from 'node:crypto';

/** The broadcast key every Tuya client carries. Public, not a credential. */
export const UDP_KEY = crypto.createHash('md5').update('yGAdlopoPVldABfn', 'utf8').digest();

/** How long a listen may take. Devices broadcast every 5 s; two full intervals plus slack. */
export const DISCOVERY_TIMEOUT_MS = 12_000;

const fromJson = (text) => {
  try {
    const j = JSON.parse(text);
    if (!j || typeof j.gwId !== 'string' || !j.gwId || j.version === undefined) return null;
    // The address is deliberately not returned: the caller needs the version, and results here end
    // up in responses and logs.
    return { gwId: j.gwId, version: String(j.version), productKey: j.productKey ?? null };
  } catch {
    return null;
  }
};

function decode55aa(buf) {
  const len = buf.readUInt32BE(12);
  const end = 8 + len; // the CRC starts here; the body runs from the return code (16) + 4
  if (end + 8 > buf.length || end < 20) return null;
  if (buf.readUInt32BE(end + 4) !== 0x0000aa55) return null;
  let body = buf.subarray(20, end);
  // Some firmwares prefix the encrypted body with a 15-byte version header ("3.3" + 12 bytes).
  if (body.subarray(0, 2).toString() === '3.') body = body.subarray(15);

  // Encrypted (3.3/3.4) first; a plaintext 3.1 body fails to decrypt and is read as it stands.
  try {
    const d = crypto.createDecipheriv('aes-128-ecb', UDP_KEY, null);
    const text = Buffer.concat([d.update(body), d.final()]).toString('utf8');
    const hit = fromJson(text);
    if (hit) return hit;
  } catch {
    // not encrypted, or not with this key
  }
  return fromJson(body.toString('utf8'));
}

function decode6699(buf) {
  if (buf.length < 4 + 14 + 12 + 16 + 4) return null;
  const header = buf.subarray(4, 18);
  const len = header.readUInt32BE(10); // iv + ciphertext + tag
  const end = 18 + len;
  if (end + 4 > buf.length || len < 12 + 16) return null;
  if (buf.readUInt32BE(end) !== 0x00009966) return null;
  const iv = buf.subarray(18, 30);
  const tag = buf.subarray(end - 16, end);
  const ct = buf.subarray(30, end - 16);
  try {
    const d = crypto.createDecipheriv('aes-128-gcm', UDP_KEY, iv);
    d.setAAD(header);
    d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(ct), d.final()]);
    return fromJson(plain.subarray(4).toString('utf8'));
  } catch {
    return null; // a tag that does not verify is not a packet to half-read
  }
}

/** One datagram -> `{gwId, version, productKey}`, or null for anything that is not an announcement. */
export function decodeDiscovery(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  const prefix = buf.readUInt32BE(0);
  if (prefix === 0x000055aa) return decode55aa(buf);
  if (prefix === 0x00006699) return decode6699(buf);
  return null;
}

/**
 * Listens until `deviceId` announces itself, or the timeout passes.
 * Resolves `{gwId, version, productKey}` or `null` — never rejects, never guesses.
 */
export function listenForAnnouncement(deviceId, { ports = [6666, 6667, 7000], timeoutMs = DISCOVERY_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const sockets = [];
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const s of sockets) {
        try {
          s.close();
        } catch {
          // already closed
        }
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    for (const port of ports) {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.on('message', (msg) => {
        const hit = decodeDiscovery(msg);
        if (hit && hit.gwId === deviceId) finish(hit);
      });
      // A port that cannot be bound is one fewer place to hear from, not a failure of the listen.
      s.on('error', () => {});
      s.bind(port);
      sockets.push(s);
    }
  });
}
