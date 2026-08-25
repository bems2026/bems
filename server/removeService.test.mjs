/**
 * The removal service — the mirror of enrolment, and the same emphasis: what it refuses, and
 * what it says when the second write fails.
 *
 * THE ORDER IS REVERSED, DELIBERATELY. Enrolment writes the registry first, so a failed flow
 * write leaves a device the app knows about but nothing polls — visible on the Devices page as
 * NO DATA, and fixed by re-running. Removal writes the FLOW first, for the same reason read
 * backwards: if the registry write then fails, the app still lists a device nothing polls,
 * which is again visible and re-runnable. The other order would leave hardware being polled
 * that nothing displays, which is the state nobody notices.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeDevice } from './removeService.mjs';
import { planEnrollment } from '../node-red-bridge/enrollPlan.mjs';

const entry = { id: 'co8', display_name: 'Outlet 8', class: 'outlet_dual', ctx: 'co8', dps_map: 'type_b', tuya_device_id: 'vendor-new' };
const creds = { tuyaDeviceId: 'vendor-new', localKey: 'k'.repeat(16), tuyaVersion: '3.4' };

/** A flow with co8 actually enrolled, built through the real planner so the two stay in step. */
const liveFlow = () => planEnrollment([{ id: 'tab', type: 'tab', label: 'Outlet' }], entry, creds, { z: 'tab', x: 0, y: 0 }).flows;

const ENROLLED_SRC = `export const ENROLLED_DEVICES = ${JSON.stringify([entry], null, 2)};\n`;

function deps(over = {}) {
  const written = { source: null, flows: null };
  return {
    written,
    deps: {
      registry: [{ id: 'co1', class: 'outlet_dual' }, entry],
      admin: {
        login: async () => 'auth',
        getFlows: async () => ({ flows: liveFlow(), rev: 'r1' }),
        postFlows: async (_a, flows) => { written.flows = flows; return { ok: true, status: 200 }; },
      },
      readEnrolled: () => ({ source: ENROLLED_SRC, devices: [entry] }),
      writeEnrolled: (s) => { written.source = s; },
      ...over,
    },
  };
}

test('a dry run reports what would go and writes nothing', async () => {
  const { deps: d, written } = deps();
  const r = await removeDevice({ deviceId: 'co8' }, d);
  assert.equal(r.ok, true);
  assert.equal(r.stage, 'dry-run');
  assert.equal(written.source, null, 'registry untouched');
  assert.equal(written.flows, null, 'flow untouched');
  assert.equal(r.summary.deviceId, 'co8');
  assert.equal(r.summary.nodesBefore - r.summary.nodesAfter, 2);
});

test('applying writes the flow and then the registry', async () => {
  const { deps: d, written } = deps({ apply: true });
  const r = await removeDevice({ deviceId: 'co8' }, d);
  assert.equal(r.ok, true);
  assert.equal(r.stage, 'applied');
  assert.equal(written.flows.length, 1, 'only the tab is left');
  assert.match(written.source, /ENROLLED_DEVICES = \[\]/, 'the entry is gone from the registry');
});

test('refuses a device that was never enrolled, naming it as built-in rather than missing', async () => {
  // co1 is hand-written in registry.mjs. A script cannot remove it, and saying "not found"
  // would send someone looking for a bug that is not there.
  const { deps: d, written } = deps({ apply: true });
  const r = await removeDevice({ deviceId: 'co1' }, d);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'validate');
  assert.match(r.problems.join(' '), /built-in|hand-written/i);
  assert.equal(written.flows, null);
  assert.equal(written.source, null);
});

test('refuses a device that is in no registry at all', async () => {
  const { deps: d } = deps({ apply: true });
  const r = await removeDevice({ deviceId: 'nope' }, d);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'validate');
});

test('reports the flow write failing, and leaves the registry entry in place', async () => {
  // The registry entry surviving is the point: the device still appears, so the failure is
  // visible and re-running is safe. Removing it first would hide a device still being polled.
  const { deps: d, written } = deps({
    apply: true,
    admin: {
      login: async () => 'auth',
      getFlows: async () => ({ flows: liveFlow(), rev: 'r1' }),
      postFlows: async () => ({ ok: false, status: 500 }),
    },
  });
  const r = await removeDevice({ deviceId: 'co8' }, d);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'flow');
  assert.equal(written.source, null, 'registry must NOT have been written');
});

test('says so specifically when the flow changed under it', async () => {
  const { deps: d } = deps({
    apply: true,
    admin: {
      login: async () => 'auth',
      getFlows: async () => ({ flows: liveFlow(), rev: 'r1' }),
      postFlows: async () => ({ ok: false, status: 409 }),
    },
  });
  const r = await removeDevice({ deviceId: 'co8' }, d);
  assert.equal(r.stage, 'flow');
  assert.match(r.problems.join(' '), /changed between/);
});

test('refuses when the device is in the registry but has no nodes in the flow', async () => {
  // Half-removed already, or never fully enrolled. Saying which half is missing is the whole
  // value of the message — the fix differs.
  const { deps: d } = deps({
    apply: true,
    admin: {
      login: async () => 'auth',
      getFlows: async () => ({ flows: [{ id: 'tab', type: 'tab' }], rev: 'r1' }),
      postFlows: async () => ({ ok: true, status: 200 }),
    },
  });
  const r = await removeDevice({ deviceId: 'co8' }, d);
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'plan');
  assert.match(r.problems.join(' '), /no enrolled nodes/);
});

test('never reports a device it did not remove as removed', async () => {
  const { deps: d, written } = deps({ apply: true });
  await removeDevice({ deviceId: 'co8' }, d);
  const remaining = JSON.parse(written.source.replace(/^export const ENROLLED_DEVICES = /, '').replace(/;\s*$/, ''));
  assert.deepEqual(remaining, []);
});
