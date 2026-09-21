/**
 * When a Node-RED restart is the right move, decided from evidence — RM-131.
 *
 * Two device states look identical from the bridge ("offline") and need opposite responses:
 * a device that is gone (power-cycle it; nothing here helps — RM-020) and a device that is
 * reachable while its node has given up (restart Node-RED; the l6 case, and after the 09-21 outage
 * every switch and outlet). The watchdog restarts only on the second, only after seeing it twice,
 * and never more than once an hour — a restart drops every session for a minute, including the
 * meters', so it must be earned.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideRecovery, RESTART_COOLDOWN_MS, BOOT_GRACE_MS, STREAK_TO_RESTART } from './fleetRecover.mjs';

const T0 = Date.parse('2026-09-22T09:00:00Z');
const base = { now: T0, bootedAt: T0 - 3600_000, lastRestartAt: null, streaks: {} };
const cand = (name, evidence) => ({ name, offline: true, evidence });

test('a reachable-but-offline device seen once is noted, not acted on', () => {
  const d = decideRecovery({ ...base, observations: [cand('CO4', 'tcp 6668 open at 192.168.2.102')] });
  assert.equal(d.restart, false);
  assert.deepEqual(d.streaks, { CO4: 1 });
  assert.match(d.reasons.join(' '), /CO4.*once/);
});

test('seen on two consecutive checks, it earns a restart', () => {
  const d = decideRecovery({ ...base, streaks: { CO4: 1 }, observations: [cand('CO4', 'tcp 6668 open at 192.168.2.102')] });
  assert.equal(d.restart, true);
  assert.equal(d.streaks.CO4, STREAK_TO_RESTART);
  assert.match(d.reasons.join(' '), /CO4.*tcp 6668 open/);
});

test('a device that is simply offline, with nothing reaching it, never counts', () => {
  const d = decideRecovery({ ...base, streaks: { CO5: 5 }, observations: [{ name: 'CO5', offline: true, evidence: null }] });
  assert.equal(d.restart, false);
  assert.deepEqual(d.streaks, {}, 'the streak is dropped — the evidence went away');
});

test('an online device resets its streak', () => {
  const d = decideRecovery({ ...base, streaks: { CO4: 1 }, observations: [{ name: 'CO4', offline: false, evidence: 'tcp 6668 open' }] });
  assert.deepEqual(d.streaks, {});
});

test('no restart inside the cooldown after the last one, nor inside the boot grace', () => {
  const ready = { ...base, streaks: { CO4: 1 }, observations: [cand('CO4', 'announced 2 min ago')] };
  assert.equal(decideRecovery({ ...ready, lastRestartAt: T0 - RESTART_COOLDOWN_MS + 60_000 }).restart, false);
  assert.equal(decideRecovery({ ...ready, lastRestartAt: T0 - RESTART_COOLDOWN_MS - 60_000 }).restart, true);
  assert.equal(decideRecovery({ ...ready, bootedAt: T0 - BOOT_GRACE_MS + 60_000 }).restart, false);
});

test('the reasons name every device that earned it, so the journal explains the restart', () => {
  const d = decideRecovery({ ...base, streaks: { CO4: 1, l1: 1 }, observations: [cand('CO4', 'tcp open'), cand('l1', 'announced 1 min ago')] });
  assert.equal(d.restart, true);
  assert.ok(d.reasons.some((r) => /CO4/.test(r)) && d.reasons.some((r) => /l1/.test(r)));
});

// --- address drift: a pinned node whose device has moved --------------------------------------

test('a pinned node whose device announced lately from a different address is reported as drifted', async () => {
  const { driftedAddresses } = await import('./fleetRecover.mjs');
  const nodes = [
    { deviceName: 'CO4', deviceId: 'gw-co4', deviceIp: '192.168.2.102' },
    { deviceName: 'CO5', deviceId: 'gw-co5', deviceIp: '192.168.2.103' },
    { deviceName: 'L.O red', deviceId: 'gw-red', deviceIp: '' },
  ];
  const map = {
    'gw-co4': { ip: '192.168.2.150', lastSeen: new Date(T0 - 5 * 60_000).toISOString() },
    'gw-co5': { ip: '192.168.2.103', lastSeen: new Date(T0 - 5 * 60_000).toISOString() },
    'gw-red': { ip: '192.168.2.228', lastSeen: new Date(T0 - 5 * 60_000).toISOString() },
  };
  assert.deepEqual(driftedAddresses(nodes, map, { now: T0, withinMs: 15 * 60_000 }), [
    { name: 'CO4', pinned: '192.168.2.102', announced: '192.168.2.150' },
  ]);
});

test('an old announcement from another address is not drift — the device may simply have moved back since', async () => {
  const { driftedAddresses } = await import('./fleetRecover.mjs');
  const nodes = [{ deviceName: 'CO4', deviceId: 'gw-co4', deviceIp: '192.168.2.102' }];
  const map = { 'gw-co4': { ip: '192.168.2.150', lastSeen: new Date(T0 - 3 * 3600_000).toISOString() } };
  assert.deepEqual(driftedAddresses(nodes, map, { now: T0, withinMs: 15 * 60_000 }), []);
});
