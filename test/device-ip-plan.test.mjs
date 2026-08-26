import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDeviceIp, validateDeviceIpPlan } from '../node-red-bridge/deviceIpPlan.mjs';

// Fixture addresses use the 192.168.9.x range and locally-administered 02:00:00:5e:… MACs, as
// server/macPresence.test.mjs already does. This repository is public; the site's real
// addresses do not belong in it, including in test data.

const node = (over = {}) => ({
  id: 'n1',
  type: 'tuya-smart-device',
  deviceName: 'CO5',
  deviceIp: '',
  findTimeout: 10000,
  tuyaVersion: '3.4',
  disableAutoStart: false,
  ...over,
});

test('sets deviceIp on exactly the named node', () => {
  const before = [node(), node({ id: 'n2', deviceName: 'CO7' })];
  const { flows, changed, problems } = planDeviceIp(before, { CO5: '192.168.9.5' });
  assert.deepEqual(problems, []);
  assert.equal(changed.length, 1);
  assert.equal(flows[0].deviceIp, '192.168.9.5');
  assert.equal(flows[1].deviceIp, '', 'a node that was not named must not be touched');
  assert.deepEqual(validateDeviceIpPlan(before, flows, { CO5: '192.168.9.5' }), []);
});

test('leaves findTimeout and tuyaVersion alone — they exist only on this flow', () => {
  // Losing either presents as every device going offline, which reads as a network fault and
  // has already cost this project days. Nothing in the repo can restore them.
  const before = [node()];
  const { flows } = planDeviceIp(before, { CO5: '192.168.9.5' });
  assert.equal(flows[0].findTimeout, 10000);
  assert.equal(flows[0].tuyaVersion, '3.4');
  assert.equal(flows[0].disableAutoStart, false);
});

test('a re-run is byte-identical, so "nothing to do" is provable', () => {
  const before = [node({ deviceIp: '192.168.9.5' })];
  const { flows, changed } = planDeviceIp(before, { CO5: '192.168.9.5' });
  assert.deepEqual(changed, []);
  assert.equal(flows[0], before[0], 'the original object should be returned, not a copy');
});

test('undo clears the address rather than inventing one', () => {
  const before = [node({ deviceIp: '192.168.9.5' })];
  const { flows, changed } = planDeviceIp(before, { CO5: null });
  assert.equal(changed.length, 1);
  assert.equal(flows[0].deviceIp, '');
});

test('refuses a device that has no node in this flow', () => {
  // Silently doing nothing would report success for an edit that never happened — the exact
  // shape of failure deploy:pi used to have.
  const { problems } = planDeviceIp([node()], { CO9: '192.168.9.9' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /CO9/);
});

test('refuses an address that is not an address', () => {
  // This value is passed straight to tuyapi as a connect target. A hostname would work by
  // accident until DNS moved; anything else fails at connect time, far from the cause.
  for (const bad of ['not-an-ip', '192.168.9', '192.168.9.256', '192.168.9.5:6668', ' ']) {
    const { problems } = planDeviceIp([node()], { CO5: bad });
    assert.equal(problems.length, 1, `expected "${bad}" to be rejected`);
  }
});

test('validation catches an edit that strayed beyond deviceIp', () => {
  // The validator is the real guard: the planner is what it checks, so a test that only drove
  // the planner would pass with the validator deleted.
  const before = [node()];
  const tampered = [{ ...before[0], deviceIp: '192.168.9.5', findTimeout: 1000 }];
  const problems = validateDeviceIpPlan(before, tampered, { CO5: '192.168.9.5' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /beyond deviceIp/);
});

test('validation catches a node being added or removed', () => {
  const before = [node()];
  assert.match(validateDeviceIpPlan(before, [], { CO5: '192.168.9.5' })[0], /count changed/);
  assert.match(
    validateDeviceIpPlan(before, [before[0], node({ id: 'n9' })], { CO5: '192.168.9.5' })[0],
    /count changed/,
  );
});

test('validation catches an unnamed node being modified', () => {
  const before = [node(), node({ id: 'n2', deviceName: 'CO7' })];
  const tampered = [before[0], { ...before[1], deviceIp: '192.168.9.7' }];
  const problems = validateDeviceIpPlan(before, tampered, { CO5: '192.168.9.5' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /CO7/);
});
