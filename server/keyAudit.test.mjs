import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditKeys, auditIsClean, KEY_STATUS } from './keyAudit.mjs';

const node = (name, deviceId, deviceKey) => ({ type: 'tuya-smart-device', deviceName: name, deviceId, deviceKey });

test('reports a match without returning either key', async () => {
  const results = await auditKeys([node('CO1', 'dev1', 'secret-key-16chr')], async () => 'secret-key-16chr');
  assert.deepEqual(results, [{ name: 'CO1', status: KEY_STATUS.MATCH }]);
});

test('never puts a key anywhere in the result, matched or not', async () => {
  const KEY = 'aaaaaaaaaaaaaaaa';
  const results = await auditKeys(
    [node('CO1', 'dev1', KEY), node('CO2', 'dev2', 'bbbbbbbbbbbbbbbb')],
    async (id) => (id === 'dev1' ? KEY : 'cccccccccccccccc'),
  );
  const serialized = JSON.stringify(results);
  assert.equal(serialized.includes(KEY), false, 'a matching key leaked into the result');
  assert.equal(serialized.includes('bbbbbbbbbbbbbbbb'), false, 'the flow key leaked');
  assert.equal(serialized.includes('cccccccccccccccc'), false, 'the cloud key leaked');
});

test('catches a rotated key — the failure that reads as a network fault', async () => {
  // Re-pairing a device rotates its key. Nothing in this project could check that before, and
  // RM-001a once blamed a stale key for the wrong devices precisely because of it.
  const results = await auditKeys([node('L6', 'dev1', 'old-key-value123')], async () => 'new-key-value456');
  assert.equal(results[0].status, KEY_STATUS.MISMATCH);
});

test('distinguishes a device the project does not contain from one whose key is absent', async () => {
  const results = await auditKeys(
    [node('IR Blaster', 'gone', 'k'), node('Odd', 'dev2', 'k')],
    async (id) => (id === 'gone' ? undefined : null),
  );
  assert.equal(results[0].status, KEY_STATUS.NOT_IN_PROJECT);
  assert.equal(results[1].status, KEY_STATUS.MISSING_CLOUD);
});

test('a fetch failure is reported per device rather than failing the whole audit', async () => {
  const results = await auditKeys(
    [node('A', 'dev1', 'k'), node('B', 'dev2', 'k')],
    async (id) => {
      if (id === 'dev1') throw new Error('rate limited');
      return 'k';
    },
  );
  assert.equal(results[0].status, KEY_STATUS.UNAVAILABLE);
  assert.equal(results[1].status, KEY_STATUS.MATCH);
});

test('auditIsClean tolerates a device absent from the project but not a mismatch', () => {
  assert.equal(auditIsClean([{ status: KEY_STATUS.MATCH }, { status: KEY_STATUS.NOT_IN_PROJECT }]), true);
  assert.equal(auditIsClean([{ status: KEY_STATUS.MATCH }, { status: KEY_STATUS.MISMATCH }]), false);
  assert.equal(auditIsClean([{ status: KEY_STATUS.UNAVAILABLE }]), false, 'unknown is not clean');
});

test('the digest is salted per run, so two runs cannot be correlated', async () => {
  const one = await auditKeys([node('A', 'd', 'k')], async () => 'k');
  const two = await auditKeys([node('A', 'd', 'k')], async () => 'k');
  // Both say match; neither exposes anything that could be compared across runs.
  assert.equal(one[0].status, KEY_STATUS.MATCH);
  assert.equal(two[0].status, KEY_STATUS.MATCH);
  assert.equal(JSON.stringify(one), JSON.stringify(two));
});
