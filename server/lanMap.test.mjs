/**
 * The LAN map — which device announced from which address, remembered — RM-131.
 *
 * WHY. After the 2026-09-21 outage test every light, outlet and the IR hub ended associated to the
 * AP, answering ARP and accepting TCP on 6668 — and silent on the discovery ports. Node-RED's
 * `find()` waits for that broadcast, so reachable devices stayed "offline" for a day. The vendor
 * cloud, which used to map devices to addresses, is lapsed (RM-121). So the announcements are
 * remembered whenever they happen, and the map is what addresses a node when discovery fails.
 *
 * Pure functions over plain data; the listener and the file are the runner's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignmentsFromMap, mergeAnnouncements, reservationRows } from './lanMap.mjs';

const NOW = '2026-09-22T09:00:00.000Z';
const heard = (gwId, ip, version = '3.4') => ({ gwId, ip, version });
const neigh = (ip, mac) => ({ ip, mac, state: 'REACHABLE' });

test('an announcement records the device\'s address, its MAC from the neighbour table, and when', () => {
  const map = mergeAnnouncements({}, [heard('gw-co1', '192.168.2.102')], [neigh('192.168.2.102', 'aa:bb:cc:00:00:01')], NOW);
  assert.deepEqual(map['gw-co1'], { ip: '192.168.2.102', mac: 'aa:bb:cc:00:00:01', version: '3.4', firstSeen: NOW, lastSeen: NOW });
});

test('a device heard again keeps its first sighting and moves its address if it moved', () => {
  const before = { 'gw-co1': { ip: '192.168.2.102', mac: 'aa:bb:cc:00:00:01', version: '3.4', firstSeen: '2026-09-01T00:00:00.000Z', lastSeen: '2026-09-01T00:00:00.000Z' } };
  const map = mergeAnnouncements(before, [heard('gw-co1', '192.168.2.150')], [neigh('192.168.2.150', 'aa:bb:cc:00:00:01')], NOW);
  assert.equal(map['gw-co1'].ip, '192.168.2.150');
  assert.equal(map['gw-co1'].firstSeen, '2026-09-01T00:00:00.000Z');
  assert.equal(map['gw-co1'].lastSeen, NOW);
  assert.notEqual(map, before, 'never mutates');
});

test('a device not heard this time is kept exactly as it was — silence is not absence', () => {
  const before = { 'gw-l1': { ip: '192.168.2.110', mac: 'aa:bb:cc:00:00:02', version: '3.5', firstSeen: NOW, lastSeen: NOW } };
  const map = mergeAnnouncements(before, [heard('gw-co1', '192.168.2.102')], [], '2026-09-22T10:00:00.000Z');
  assert.deepEqual(map['gw-l1'], before['gw-l1']);
});

test('a MAC the neighbour table cannot supply is kept from before, or left null', () => {
  const map = mergeAnnouncements({}, [heard('gw-x', '192.168.2.5')], [], NOW);
  assert.equal(map['gw-x'].mac, null);
  const again = mergeAnnouncements({ 'gw-x': { ...map['gw-x'], mac: 'aa:bb:cc:dd:ee:ff' } }, [heard('gw-x', '192.168.2.5')], [], NOW);
  assert.equal(again['gw-x'].mac, 'aa:bb:cc:dd:ee:ff');
});

const flows = [
  { id: 'n1', type: 'tuya-smart-device', deviceName: 'CO1', deviceId: 'gw-co1', deviceIp: '' },
  { id: 'n2', type: 'tuya-smart-device', deviceName: 'Light Switch 1', deviceId: 'gw-l1', deviceIp: '192.168.2.110' },
  { id: 'n3', type: 'tuya-smart-device', deviceName: 'CO2', deviceId: 'gw-co2', deviceIp: '' },
  { id: 'n4', type: 'function', name: 'not a device' },
];
const MAP = {
  'gw-co1': { ip: '192.168.2.102', mac: 'aa:bb:cc:00:00:01', version: '3.4', firstSeen: NOW, lastSeen: NOW },
  'gw-l1': { ip: '192.168.2.110', mac: 'aa:bb:cc:00:00:02', version: '3.5', firstSeen: NOW, lastSeen: NOW },
  'gw-old': { ip: '192.168.2.199', mac: null, version: '3.4', firstSeen: '2026-07-01T00:00:00.000Z', lastSeen: '2026-07-01T00:00:00.000Z' },
};

test('assignments address every node the map knows, skipping one already at that address, and say what it could not', () => {
  const { assignments, notes } = assignmentsFromMap(flows, MAP, { now: Date.parse(NOW) });
  assert.deepEqual(assignments, { CO1: '192.168.2.102' });
  assert.ok(notes.some((n) => /Light Switch 1.*already/.test(n)), notes.join('\n'));
  assert.ok(notes.some((n) => /CO2.*never announced/.test(n)), notes.join('\n'));
});

test('an entry older than the age limit is offered only when asked for, and said to be stale', () => {
  const stale = [{ id: 'n9', type: 'tuya-smart-device', deviceName: 'Old', deviceId: 'gw-old', deviceIp: '' }];
  const fresh = assignmentsFromMap(stale, MAP, { now: Date.parse(NOW), maxAgeMs: 30 * 86400000 });
  assert.deepEqual(fresh.assignments, {});
  assert.ok(fresh.notes.some((n) => /Old.*last announced.*2026-07-01/.test(n)));
  const any = assignmentsFromMap(stale, MAP, { now: Date.parse(NOW), maxAgeMs: Infinity });
  assert.deepEqual(any.assignments, { Old: '192.168.2.199' });
});

test('the reservation table is what the access point needs — name, MAC, address — for every mapped node', () => {
  const rows = reservationRows(flows, MAP);
  assert.deepEqual(rows, [
    { name: 'CO1', mac: 'aa:bb:cc:00:00:01', ip: '192.168.2.102', lastSeen: NOW },
    { name: 'Light Switch 1', mac: 'aa:bb:cc:00:00:02', ip: '192.168.2.110', lastSeen: NOW },
  ]);
});
