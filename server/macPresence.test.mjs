import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMac,
  parseNeighbours,
  joinMacPresence,
  reachableButDark,
  readNeighbours,
  toPublicPresence,
  PRESENCE,
} from './macPresence.mjs';

// Fixture MACs use the locally-administered 02:00:00:5e:… range on purpose. This repository is
// public; real device addresses do not belong in it, including in test data.

const cloud = (id, name, online) => ({ id, name, online });

test('matches a cloud MAC to an ARP line despite differing separators', () => {
  // Tuya returns bare hex; `ip neigh` prints colon-separated. Joining them literally finds
  // nothing, and "nothing" here reads as "the device is gone" — the wrong answer, arrived at
  // confidently.
  const rows = joinMacPresence({
    cloudDevices: [cloud('a1', 'CO1', false)],
    // Normalised on BOTH sides deliberately: the cloud side is bare lowercase hex today, so a
    // fixture using that form passes even with the cloud-side normalisation deleted. Feeding it
    // the awkward form is what makes this test able to fail.
    factoryInfos: [{ id: 'a1', mac: '02-00-00-5E-00-01' }],
    neighbours: parseNeighbours('192.168.9.5 dev wlan0 lladdr 02:00:00:5E:00:01 REACHABLE'),
  });
  assert.equal(rows[0].presence, PRESENCE.ON_SEGMENT);
  assert.equal(rows[0].ip, '192.168.9.5');
});

test('an unresolved ARP line is absence, not presence', () => {
  // A FAILED entry means the kernel asked and got no answer. Treating a line's mere existence
  // as presence would invert the conclusion this module exists to draw.
  const neighbours = parseNeighbours([
    '192.168.9.7 dev wlan0 FAILED',
    '192.168.9.8 dev wlan0  INCOMPLETE',
  ].join('\n'));
  assert.deepEqual(neighbours, [], 'a line with no lladdr must not count as a neighbour');

  const rows = joinMacPresence({
    cloudDevices: [cloud('a1', 'CO5', false)],
    factoryInfos: [{ id: 'a1', mac: '0200005e0005' }],
    neighbours,
  });
  assert.equal(rows[0].presence, PRESENCE.ABSENT);
});

test('splits dark devices into the two that need different remedies', () => {
  // This is the RM-020 split: same symptom at the bridge, opposite remedies. One needs a
  // person at the office; the other needs a config change and no visit at all.
  const rows = joinMacPresence({
    cloudDevices: [cloud('a1', 'CO1', false), cloud('a5', 'CO5', false), cloud('a7', 'CO7', true)],
    factoryInfos: [
      { id: 'a1', mac: '0200005e0001' },
      { id: 'a5', mac: '0200005e0005' },
      { id: 'a7', mac: '0200005e0007' },
    ],
    neighbours: parseNeighbours([
      '192.168.9.5 dev wlan0 lladdr 02:00:00:5e:00:01 STALE',
      '192.168.9.9 dev wlan0 lladdr 02:00:00:5e:00:07 REACHABLE',
    ].join('\n')),
  });
  assert.deepEqual(reachableButDark(rows).map((r) => r.name), ['CO1']);
  assert.equal(rows.find((r) => r.name === 'CO5').presence, PRESENCE.ABSENT);
});

test('STALE still counts as present — it means unused, not unreachable', () => {
  // STALE only says no traffic has confirmed the entry lately. The MAC was resolved, so the
  // device answered ARP. Requiring REACHABLE would call an idle device gone.
  const rows = joinMacPresence({
    cloudDevices: [cloud('a1', 'CO1', false)],
    factoryInfos: [{ id: 'a1', mac: '0200005e0001' }],
    neighbours: parseNeighbours('192.168.9.5 dev wlan0 lladdr 02:00:00:5e:00:01 STALE'),
  });
  assert.equal(rows[0].presence, PRESENCE.ON_SEGMENT);
});

test('a device with no MAC is unknown, not absent', () => {
  // Missing evidence is not evidence of absence. Reporting ABSENT here would send someone to
  // the office over a gap in the cloud metadata.
  const rows = joinMacPresence({
    cloudDevices: [cloud('a9', 'IR Blaster', false)],
    factoryInfos: [],
    neighbours: parseNeighbours('192.168.9.5 dev wlan0 lladdr 02:00:00:5e:00:01 REACHABLE'),
  });
  assert.equal(rows[0].presence, PRESENCE.UNKNOWN);
  assert.equal(reachableButDark(rows).length, 0);
});

test('normalizeMac rejects anything that is not twelve hex digits', () => {
  assert.equal(normalizeMac('02:00:00:5e:00:01'), '0200005e0001');
  assert.equal(normalizeMac('02-00-00-5E-00-01'), '0200005e0001');
  assert.equal(normalizeMac('0200005e000'), null, 'eleven digits must not pass');
  assert.equal(normalizeMac(''), null);
  assert.equal(normalizeMac(null), null);
  assert.equal(normalizeMac('not-a-mac-at-all'), null);
});

test('a device online in the cloud is never listed as needing attention', () => {
  const rows = joinMacPresence({
    cloudDevices: [cloud('a7', 'CO7', true)],
    factoryInfos: [{ id: 'a7', mac: '0200005e0007' }],
    neighbours: parseNeighbours('192.168.9.9 dev wlan0 lladdr 02:00:00:5e:00:07 REACHABLE'),
  });
  assert.equal(reachableButDark(rows).length, 0);
});

// ---------------------------------------------------------------------------
// FI-015: the same split, served over HTTP rather than read off a terminal.
// ---------------------------------------------------------------------------

test('readNeighbours reports unreadable rather than empty when `ip` is not there', () => {
  // The whole point of the flag. Off the Pi there is no neighbour table, and an empty list
  // joined against the cloud marks EVERY device absent — a confident wrong answer that would
  // read on screen as "the entire fleet has left the network".
  const out = readNeighbours({
    exec: () => {
      throw new Error('spawn ip ENOENT');
    },
  });
  assert.equal(out.readable, false);
  assert.deepEqual(out.neighbours, []);
  assert.match(out.reason, /ENOENT/);
});

test('readNeighbours treats a successful but empty table as unreadable too', () => {
  // A machine that HAS `ip` but sits on no segment answers with nothing. That is not evidence
  // that the devices are gone, it is evidence that this host cannot say — and the two must not
  // collapse into the same answer just because the command exited 0.
  const out = readNeighbours({ exec: () => '\n  \n' });
  assert.equal(out.readable, false);
  assert.deepEqual(out.neighbours, []);
});

test('readNeighbours parses a real-shaped table', () => {
  const out = readNeighbours({
    exec: () => [
      '192.168.9.5 dev wlan0 lladdr 02:00:00:5e:00:01 REACHABLE',
      '192.168.9.9 dev wlan0 FAILED',
    ].join('\n'),
  });
  assert.equal(out.readable, true);
  assert.equal(out.neighbours.length, 1, 'the FAILED line is absence, not a neighbour');
  assert.equal(out.neighbours[0].mac, '0200005e0001');
});

test('toPublicPresence never serves a MAC or an address to the browser', () => {
  // `tuya-devices.mjs` refuses to print these for the same reason: together they are a map of
  // the building's network, and this repo — plus any screenshot or bug report of the page — is
  // public. The join needs them; the browser does not.
  const rows = joinMacPresence({
    cloudDevices: [cloud('a1', 'CO5', false)],
    factoryInfos: [{ id: 'a1', mac: '02:00:00:5e:00:05' }],
    neighbours: parseNeighbours('192.168.9.5 dev wlan0 lladdr 02:00:00:5e:00:05 STALE'),
  });
  assert.equal(rows[0].mac, '0200005e0005', 'precondition: the join really did carry a MAC');

  const pub = toPublicPresence(rows, { arpReadable: true });
  assert.equal(pub[0].presence, PRESENCE.ON_SEGMENT);
  assert.equal(pub[0].arp_state, 'STALE');
  const serialised = JSON.stringify(pub);
  assert.doesNotMatch(serialised, /0200005e0005/, 'a MAC reached the payload');
  assert.doesNotMatch(serialised, /192\.168\.9\.5/, 'an address reached the payload');
});

test('toPublicPresence says "unknown", not "absent", when the ARP table could not be read', () => {
  // joinMacPresence with no neighbours legitimately returns ABSENT for everything, because
  // that is what an empty segment looks like. Serving that when the truth is "this host cannot
  // see a segment at all" is the exact failure FI-015 asks to avoid.
  const rows = joinMacPresence({
    cloudDevices: [cloud('a1', 'CO5', false), cloud('a2', 'CO7', true)],
    factoryInfos: [{ id: 'a1', mac: '0200005e0005' }, { id: 'a2', mac: '0200005e0007' }],
    neighbours: [],
  });
  assert.equal(rows[0].presence, PRESENCE.ABSENT, 'precondition: the join does claim absence');

  const pub = toPublicPresence(rows, { arpReadable: false });
  assert.equal(pub.length, 2, 'the cloud half is still worth serving');
  for (const r of pub) {
    assert.equal(r.presence, null, 'presence must be withheld, not guessed');
    assert.equal(r.arp_state, null);
  }
  assert.equal(pub[1].cloud_online, true, 'the cloud view survives an unreadable ARP table');
});
