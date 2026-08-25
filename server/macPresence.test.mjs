import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMac, parseNeighbours, joinMacPresence, reachableButDark, PRESENCE } from './macPresence.mjs';

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
