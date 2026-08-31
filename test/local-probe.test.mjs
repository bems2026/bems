/**
 * Guards `localProbePlan` — the read-only answer to "is local control actually working".
 *
 * The properties worth pinning are all about what it REFUSES to claim. A probe exists to be
 * believed, so a verdict it cannot support is worse than no verdict at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planLocalProbe, deviceSessions, nodeSessions, LOCAL_SILENT_MS } from '../node-red-bridge/localProbePlan.mjs';
import { POLL_INTERVAL_S } from '../node-red-bridge/outletPollPlan.mjs';
import { STALE_READING_MS } from '../shared/buildLatest.mjs';

const NOW = 1786000000000;
const at = (agoMs) => new Date(NOW - agoMs).toISOString();

const outlet = { id: 'x1', class: 'outlet_dual', ctx: 'x1' };
const meter = { id: 'm1', class: 'meter', ctx: 'm1' };
const sw = { id: 's1', class: 'switch' };

test('the silence window sits between the slowest poll and the point the bridge stops believing online', () => {
  // Below the poll cadence it would call a healthy device dead between two polls — precisely
  // when somebody is already suspicious and least able to discount it. Above the bridge's own
  // window it would report "live" for a device the bridge has already disowned.
  assert.ok(LOCAL_SILENT_MS > POLL_INTERVAL_S * 1000, 'must clear the outlet poll cadence');
  assert.ok(LOCAL_SILENT_MS < STALE_READING_MS, 'must sit inside the bridge own staleness window');
});

test('a device reporting inside the window over the local protocol reads as live', () => {
  const [row] = deviceSessions({
    readings: [{ device_id: 'x1', ts: at(20_000), online: true }],
    registry: [outlet],
    nowMs: NOW,
  });
  assert.equal(row.local, 'live');
  assert.equal(row.lastReportMs, 20_000);
});

test('a device polled 55s ago — normal, between polls — is still live', () => {
  const [row] = deviceSessions({
    readings: [{ device_id: 'x1', ts: at(55_000), online: true }],
    registry: [outlet],
    nowMs: NOW,
  });
  assert.equal(row.local, 'live');
});

test('a device the bridge reports offline is down, whatever its timestamp says', () => {
  // An offline device's ts is synthesized by buildLatest, so its age is not evidence of
  // anything. Reading "recent" off it would be reading a fabrication.
  const [row] = deviceSessions({
    readings: [{ device_id: 'x1', ts: at(1000), online: false }],
    registry: [outlet],
    nowMs: NOW,
  });
  assert.equal(row.local, 'down');
});

test('a device present but long silent is silent, not down — the distinction is the diagnosis', () => {
  const [row] = deviceSessions({
    readings: [{ device_id: 'm1', ts: at(LOCAL_SILENT_MS + 1), online: true }],
    registry: [meter],
    nowMs: NOW,
  });
  assert.equal(row.local, 'silent');
});

test('a device absent from the feed is unknown, not down — that is a registry/flow mismatch', () => {
  const [row] = deviceSessions({ readings: [], registry: [outlet], nowMs: NOW });
  assert.equal(row.local, 'unknown');
  assert.equal(row.online, null);
});

test('a switch is never called live on the strength of a timestamp it does not have', () => {
  // buildLatest stamps ts = now for a switch, so an age-based verdict here would be reading
  // back a value this code put there itself. Its health signal is the only real evidence.
  const [row] = deviceSessions({
    readings: [{ device_id: 's1', ts: at(0), online: true }],
    registry: [sw],
    nowMs: NOW,
  });
  assert.equal(row.local, 'live-unmeasured');
});

test('an unhealthy switch is unknown rather than down, because nothing measured says down', () => {
  const [row] = deviceSessions({
    readings: [{ device_id: 's1', ts: at(0), online: false }],
    registry: [sw],
    nowMs: NOW,
  });
  assert.equal(row.local, 'down');
});

test('the node table reports the declared protocol, because the wrong one reads as a network fault', () => {
  const rows = nodeSessions([
    { type: 'tuya-smart-device', deviceName: 'A', tuyaVersion: '3.4', findTimeout: '10000', disableAutoStart: false },
    { type: 'tuya-smart-device', deviceName: 'B', tuyaVersion: '3.5', findTimeout: '10000', disableAutoStart: true },
    { type: 'function', name: 'not a device' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].protocol, '3.4');
  assert.equal(rows[1].quiesced, true, 'a deliberately quiesced node must not look broken');
});

test('the node table never emits a device address, because this output is quoted into a public repo', () => {
  const rows = nodeSessions([{ type: 'tuya-smart-device', deviceName: 'A', deviceIp: '10.0.0.9', deviceKey: 'secret', deviceId: 'bf123' }]);
  assert.equal(rows[0].staticAddress, true);
  const serialised = JSON.stringify(rows);
  assert.doesNotMatch(serialised, /10\.0\.0\.9/);
  assert.doesNotMatch(serialised, /secret/);
  assert.doesNotMatch(serialised, /bf123/);
});

test('nodes and devices are reported side by side and never joined by name', () => {
  // Three nodes back two devices between them in the live flow, and one node feeds two metered
  // channels, so any name-based join would be a guess that looks like a fact.
  const report = planLocalProbe({
    flows: [{ type: 'tuya-smart-device', deviceName: 'C.O yellow', tuyaVersion: '3.5' }],
    readings: [{ device_id: 'x1', ts: at(10_000), online: true }],
    registry: [outlet],
    nowMs: NOW,
  });
  assert.equal(report.summary.devices, 1);
  assert.equal(report.summary.nodes, 1);
  assert.equal(report.devices[0].deviceId, 'x1');
  assert.equal(report.nodes[0].node, 'C.O yellow');
  assert.equal(report.nodes[0].deviceId, undefined, 'a node row must make no claim about which device it is');
});

test('the summary counts every device exactly once, so a verdict cannot go missing', () => {
  const report = planLocalProbe({
    flows: [],
    readings: [
      { device_id: 'x1', ts: at(1000), online: true },
      { device_id: 'm1', ts: at(LOCAL_SILENT_MS + 1), online: true },
    ],
    registry: [outlet, meter, sw],
    nowMs: NOW,
  });
  const { live, liveUnmeasured, silent, down, unknown, devices } = report.summary;
  assert.equal(live + liveUnmeasured + silent + down + unknown, devices);
});
