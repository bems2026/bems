/**
 * What is announcing on the device network right now — kept continuously, so Add Device can list a
 * device the moment it is paired in Smart Life, and enrolment can read its protocol version without a
 * twelve-second wait or a vendor cloud.
 *
 * Every Tuya device broadcasts its id, product key and protocol version about every five seconds.
 * This listens passively (with `reuseAddr`, as tuyapi does) and remembers when each was last heard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dgram from 'node:dgram';

import { createLanPresence } from './lanPresence.mjs';
import { UDP_KEY } from './lanDiscovery.mjs';

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function announce(gwId, version, productKey = 'pk1') {
  const c = crypto.createCipheriv('aes-128-ecb', UDP_KEY, null);
  const body = Buffer.concat([c.update(JSON.stringify({ ip: '10.0.0.9', gwId, productKey, version })), c.final()]);
  const head = Buffer.alloc(20);
  head.writeUInt32BE(0x000055aa, 0);
  head.writeUInt32BE(0x13, 8);
  head.writeUInt32BE(body.length + 12, 12);
  const withBody = Buffer.concat([head, body]);
  const tail = Buffer.alloc(8);
  tail.writeUInt32BE(crc32(withBody), 0);
  tail.writeUInt32BE(0x0000aa55, 4);
  return Buffer.concat([withBody, tail]);
}

const port = () => 40000 + Math.floor(Math.random() * 20000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('remembers every device it hears, with its version, product key and when', async () => {
  const p = port();
  let clock = 1_000_000;
  const presence = createLanPresence({ ports: [p], now: () => clock });
  presence.start();
  const s = dgram.createSocket('udp4');
  await wait(100);
  s.send(announce('dev-a', '3.4', 'pkA'), p, '127.0.0.1');
  s.send(announce('dev-b', '3.5', 'pkB'), p, '127.0.0.1');
  await wait(150);
  clock += 5000;
  s.send(announce('dev-a', '3.4', 'pkA'), p, '127.0.0.1');
  await wait(150);
  s.close();
  presence.stop();

  const a = presence.get('dev-a');
  assert.deepEqual([a.version, a.productKey, a.firstSeen, a.lastSeen, a.count], ['3.4', 'pkA', 1_000_000, 1_005_000, 2]);
  assert.equal(presence.get('dev-b').version, '3.5');
  assert.equal(presence.get('nobody'), null);
});

test('answers whether a device was heard recently, and whether the listener has run long enough to say it was not', async () => {
  let clock = 0;
  const p = port();
  const presence = createLanPresence({ ports: [p], now: () => clock });
  presence.start();
  const s = dgram.createSocket('udp4');
  await wait(100);
  s.send(announce('dev-a', '3.3'), p, '127.0.0.1');
  await wait(150);
  s.close();
  presence.stop();

  assert.equal(presence.heardWithin('dev-a', 60_000), true);
  // Not heard is only evidence once the listener has been up for longer than the window: a listener
  // started a second ago has heard nothing from anyone, and that says nothing about them.
  assert.equal(presence.isWarm(60_000), false);
  clock = 120_000;
  assert.equal(presence.isWarm(60_000), true);
  assert.equal(presence.heardWithin('dev-a', 60_000), false);
});

test('the snapshot never carries an address', async () => {
  const p = port();
  const presence = createLanPresence({ ports: [p] });
  presence.start();
  const s = dgram.createSocket('udp4');
  await wait(100);
  s.send(announce('dev-a', '3.3'), p, '127.0.0.1');
  await wait(150);
  s.close();
  presence.stop();
  assert.equal(JSON.stringify(presence.snapshot()).includes('10.0.0.9'), false);
});

test('garbage on the port is ignored, and stop() is safe to call twice', async () => {
  const p = port();
  const presence = createLanPresence({ ports: [p] });
  presence.start();
  const s = dgram.createSocket('udp4');
  await wait(100);
  s.send(Buffer.from('not a tuya packet'), p, '127.0.0.1');
  await wait(100);
  s.close();
  presence.stop();
  presence.stop();
  assert.deepEqual(presence.snapshot(), []);
});
