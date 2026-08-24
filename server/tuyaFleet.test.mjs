import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPublicDevice, toPublicFleet, assertNoSecrets } from './tuyaFleet.mjs';

const raw = {
  id: 'dev1',
  name: 'CO1',
  online: true,
  category: 'cz',
  product_name: 'Smart Socket',
  local_key: 'THE-SECRET-KEY-1',
  uid: 'user-id',
  ip: '192.168.2.5',
};

test('copies only the allowlisted fields', () => {
  assert.deepEqual(toPublicDevice(raw), {
    id: 'dev1', name: 'CO1', online: true, category: 'cz', product_name: 'Smart Socket',
  });
});

test('drops the local key, which is the whole point', () => {
  assert.equal(JSON.stringify(toPublicFleet([raw])).includes('THE-SECRET-KEY-1'), false);
});

test('drops fields Tuya adds later by default, rather than passing them through', () => {
  // An allowlist fails closed. A denylist would have shipped whatever the next API version
  // introduced, which is exactly how a credential leaks without anyone editing this file.
  const withNewField = { ...raw, some_future_token: 'oops' };
  assert.equal('some_future_token' in toPublicDevice(withNewField), false);
});

test('assertNoSecrets throws rather than silently stripping', () => {
  // Quietly filtering would hide a wrong edit to the allowlist until it reappeared elsewhere.
  assert.throws(() => assertNoSecrets([{ id: 'a', local_key: 'x' }]), /credential-shaped/);
  assert.throws(() => assertNoSecrets([{ id: 'a', nested: { access_token: 'x' } }]), /credential-shaped/);
});

test('assertNoSecrets names where it found the problem', () => {
  assert.throws(() => assertNoSecrets([{ id: 'a' }, { id: 'b', secret: 1 }]), /payload\[1\]\.secret/);
});

test('a clean payload passes through unchanged', () => {
  const clean = [{ id: 'a', name: 'A', online: false }];
  assert.deepEqual(assertNoSecrets(clean), clean);
});

test('an empty fleet is not an error', () => {
  assert.deepEqual(toPublicFleet([]), []);
});
