import test from 'node:test';
import assert from 'node:assert/strict';
import { planShed } from './shedPlan.mjs';

const USER = '22222222-2222-2222-2222-222222222222';
const totals = (over = {}) => ({ total_power_w: 9000, phase_current: { red: 10, yellow: 12, blue: null }, ...over });
const on = (ids) => Object.fromEntries(ids.map((id) => [id, { state: 'on' }]));

const base = {
  thresholds: { maxPhaseA: 20, maxTotalKw: 5, autoShed: true },
  totals: totals(),
  configs: { l1: 'group_1', l2: 'group_1', l3: 'group_2', l4: 'never', l5: null },
  readings: on(['l1', 'l2', 'l3', 'l4', 'l5']),
  dispatchableDeviceIds: ['l1', 'l2', 'l3', 'l4', 'l5'],
  actorUserId: USER,
};
const plan = (over = {}) => planShed({ ...base, ...over });
const ids = (p) => p.shed.map((c) => c.device_id).sort();

test('sheds nothing when nothing is over the limit', () => {
  const p = plan({ totals: totals({ total_power_w: 1000, phase_current: { red: 1, yellow: 1, blue: null } }) });
  assert.equal(p.breached, false);
  assert.equal(p.shed.length, 0);
});

test('sheds the first tier when the total-draw limit is breached', () => {
  const p = plan();
  assert.equal(p.breached, true);
  assert.equal(p.tier, 'group_1');
  assert.deepEqual(ids(p), ['l1', 'l2']);
  assert.ok(p.shed.every((c) => c.action === 'off'));
});

test('escalates one tier at a time — group_2 only once group_1 has nothing left to shed', () => {
  const p = plan({ readings: { ...on(['l3', 'l4', 'l5']), l1: { state: 'off' }, l2: { state: 'off' } } });
  assert.equal(p.tier, 'group_2');
  assert.deepEqual(ids(p), ['l3']);
});

test('never sheds a Protected device, even when every tier is exhausted', () => {
  const p = plan({ configs: { l4: 'never' }, readings: on(['l4']) });
  assert.equal(p.breached, true, 'still over the limit');
  assert.equal(p.shed.length, 0, 'but nothing may be shed');
});

test('never sheds a device with no shed group assigned — an unconfigured device is not a volunteer', () => {
  const p = plan({ configs: { l5: null }, readings: on(['l5']) });
  assert.equal(p.shed.length, 0);
});

test('does not shed a device that is already off — no pointless command, no misleading audit row', () => {
  const p = plan({ readings: { ...on(['l2']), l1: { state: 'off' } } });
  assert.deepEqual(ids(p), ['l2']);
});

test('does not shed a device the command path cannot actually dispatch', () => {
  const p = plan({ configs: { co1: 'group_1' }, readings: on(['co1']), dispatchableDeviceIds: [] });
  assert.equal(p.shed.length, 0);
});

test('sheds nothing when auto-shed is switched off, though the breach is still reported', () => {
  const p = plan({ thresholds: { ...base.thresholds, autoShed: false } });
  assert.equal(p.breached, true);
  assert.equal(p.reason !== null, true);
  assert.equal(p.shed.length, 0);
});

test('an unconfigured threshold never sheds — no limit set is not a limit of zero', () => {
  const p = plan({ thresholds: { maxPhaseA: null, maxTotalKw: null, autoShed: true } });
  assert.equal(p.breached, false);
  assert.equal(p.shed.length, 0);
});

test('sheds on a phase-current breach as well as a total-draw one', () => {
  const p = plan({ thresholds: { maxPhaseA: 5, maxTotalKw: null, autoShed: true } });
  assert.equal(p.breached, true);
  assert.match(p.reason, /phase current/i);
  assert.deepEqual(ids(p), ['l1', 'l2']);
});

test('sheds nothing with no reading at all, rather than treating missing data as an overload', () => {
  const p = plan({ totals: null });
  assert.equal(p.breached, false);
  assert.equal(p.shed.length, 0);
});

test('skips shedding when nobody is on record as having enabled it', () => {
  const p = plan({ actorUserId: null });
  assert.equal(p.breached, true);
  assert.equal(p.shed.length, 0);
});

test('attributes each shed command to whoever configured the thresholds, and marks its source', () => {
  const p = plan();
  assert.ok(p.shed.every((c) => c.requested_by === USER));
  assert.ok(p.shed.every((c) => c.source === 'dsm_autoshed'));
});
