/**
 * Reading a device's protocol version from its own LAN broadcast.
 *
 * WHY: enrolment asked the vendor cloud for `detail.version`, and `/v1.0/devices/{id}` has no such
 * field — checked on every device in the project on 2026-09-17. So every enrolment would have been
 * refused at the credentials step, and nothing had ever run one to find out. The version this
 * project trusts has always been the device's own announcement (`shared/tuyaNodeSettings.mjs`):
 * a node declaring the wrong one fails as `find() timed out`, which reads as a network fault.
 *
 * The fixtures are encrypted here, in the test, with the same public UDP key and framing the
 * devices use — v3.1 plaintext on 6666, v3.3/3.4 AES-ECB on 6667, v3.5 AES-GCM on 6667 — so each
 * decoder is checked against a packet it did not produce.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dgram from 'node:dgram';

import { decodeDiscovery, listenForAnnouncement, UDP_KEY } from './lanDiscovery.mjs';

const announce = (gwId, version) => ({ ip: '10.0.0.9', gwId, active: 2, encrypt: version !== '3.1', productKey: 'pk123', version });

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** 0x55AA framing: prefix, seq, cmd, len, retcode, body, crc, suffix. `len` counts from retcode on. */
function frame55aa(body, cmd = 0x13) {
  const head = Buffer.alloc(20);
  head.writeUInt32BE(0x000055aa, 0);
  head.writeUInt32BE(0, 4);
  head.writeUInt32BE(cmd, 8);
  head.writeUInt32BE(body.length + 12, 12);
  head.writeUInt32BE(0, 16);
  const withBody = Buffer.concat([head, body]);
  const tail = Buffer.alloc(8);
  tail.writeUInt32BE(crc32(withBody), 0);
  tail.writeUInt32BE(0x0000aa55, 4);
  return Buffer.concat([withBody, tail]);
}

const packet31 = (json) => frame55aa(Buffer.from(JSON.stringify(json)), 0x12);

function packetEcb(json) {
  const c = crypto.createCipheriv('aes-128-ecb', UDP_KEY, null);
  return frame55aa(Buffer.concat([c.update(JSON.stringify(json)), c.final()]));
}

/** 0x6699 framing: prefix, unknown(2), seq, cmd, len, iv(12), ciphertext, tag(16), suffix. */
function packet35(json) {
  const iv = crypto.randomBytes(12);
  const plaintext = Buffer.concat([Buffer.alloc(4), Buffer.from(JSON.stringify(json))]); // return code first
  const header = Buffer.alloc(14);
  header.writeUInt16BE(0, 0);
  header.writeUInt32BE(1, 2);
  header.writeUInt32BE(0x13, 6);
  const cipher = crypto.createCipheriv('aes-128-gcm', UDP_KEY, iv);
  cipher.setAAD(Buffer.alloc(0)); // replaced below once the length is known
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  header.writeUInt32BE(12 + ct.length + 16, 10);
  // Re-encrypt with the real header as AAD, now that it carries the length.
  const real = crypto.createCipheriv('aes-128-gcm', UDP_KEY, iv);
  real.setAAD(header);
  const ct2 = Buffer.concat([real.update(plaintext), real.final()]);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(0x00006699, 0);
  const suffix = Buffer.alloc(4);
  suffix.writeUInt32BE(0x00009966, 0);
  return Buffer.concat([prefix, header, iv, ct2, real.getAuthTag(), suffix]);
}

test('decodes a v3.1 plaintext announcement', () => {
  assert.deepEqual(decodeDiscovery(packet31(announce('dev31', '3.1'))), { gwId: 'dev31', version: '3.1', productKey: 'pk123' });
});

test('decodes a v3.3 announcement — the IR hub announced this on 2026-09-17', () => {
  assert.deepEqual(decodeDiscovery(packetEcb(announce('hub33', '3.3'))), { gwId: 'hub33', version: '3.3', productKey: 'pk123' });
});

test('decodes a v3.4 announcement, which uses the same ECB framing on the broadcast', () => {
  assert.equal(decodeDiscovery(packetEcb(announce('co34', '3.4'))).version, '3.4');
});

test('decodes a v3.5 announcement, authenticated with its header', () => {
  assert.deepEqual(decodeDiscovery(packet35(announce('sw35', '3.5'))), { gwId: 'sw35', version: '3.5', productKey: 'pk123' });
});

test('a tampered v3.5 packet is refused, not half-read', () => {
  const p = packet35(announce('sw35', '3.5'));
  p[30] ^= 0xff; // inside the ciphertext
  assert.equal(decodeDiscovery(p), null);
});

test('never returns the announcing address — the caller needs the version, and this repo is public', () => {
  assert.equal('ip' in decodeDiscovery(packetEcb(announce('hub33', '3.3'))), false);
});

test('garbage, truncation and an announcement without an id are all null', () => {
  assert.equal(decodeDiscovery(Buffer.from('hello')), null);
  assert.equal(decodeDiscovery(packetEcb(announce('x', '3.3')).subarray(0, 30)), null);
  assert.equal(decodeDiscovery(packetEcb({ version: '3.3' })), null);
  assert.equal(decodeDiscovery(Buffer.alloc(64)), null);
});

test('the listener resolves with the target device and ignores every other announcement', async () => {
  const port = 40000 + Math.floor(Math.random() * 20000);
  const waiting = listenForAnnouncement('hub33', { ports: [port], timeoutMs: 3000 });
  const sender = dgram.createSocket('udp4');
  await new Promise((r) => setTimeout(r, 100));
  sender.send(packetEcb(announce('someone-else', '3.4')), port, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 50));
  sender.send(packetEcb(announce('hub33', '3.3')), port, '127.0.0.1');
  const found = await waiting;
  sender.close();
  assert.deepEqual(found, { gwId: 'hub33', version: '3.3', productKey: 'pk123' });
});

test('the listener gives up with null rather than guessing', async () => {
  const port = 40000 + Math.floor(Math.random() * 20000);
  assert.equal(await listenForAnnouncement('nobody', { ports: [port], timeoutMs: 200 }), null);
});
