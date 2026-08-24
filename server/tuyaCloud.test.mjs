/**
 * Tuya signing is the kind of thing that fails as a flat `sign invalid` with no indication of
 * which half was wrong, so these tests pin the canonical string exactly rather than checking
 * that a request merely went out.
 *
 * No mocking library and no network: `fetchImpl` is injected and the assertions are made
 * against what the fake received. Same approach as the rest of `server/`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createTuyaClient, TUYA_HOSTS } from './tuyaCloud.mjs';

const ID = 'test-access-id';
const SECRET = 'test-access-secret';
const HOST = TUYA_HOSTS.us;
const T = 1_700_000_000_000;

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (payload) => crypto.createHmac('sha256', SECRET).update(payload, 'utf8').digest('hex').toUpperCase();

/** Records every request and replies with whatever the queue says next. */
function fakeFetch(queue) {
  const seen = [];
  const impl = async (url, opts) => {
    seen.push({ url, ...opts });
    const next = queue.shift();
    return { status: 200, json: async () => next };
  };
  return { impl, seen };
}

const tokenOk = { success: true, result: { access_token: 'tok-1', expire_time: 7200 } };

test('the token request signs client_id + t + the canonical string, with no access token', async () => {
  const { impl, seen } = fakeFetch([tokenOk, { success: true, result: { devices: [] } }]);
  const c = createTuyaClient({ accessId: ID, accessSecret: SECRET, host: HOST, fetchImpl: impl, now: () => T });
  await c.listDevices();

  const tokenReq = seen[0];
  assert.equal(tokenReq.url, `${HOST}/v1.0/token?grant_type=1`);
  assert.equal(tokenReq.headers.access_token, undefined, 'the token request cannot carry a token');
  const expected = hmac(`${ID}${T}` + `GET\n${sha256('')}\n\n/v1.0/token?grant_type=1`);
  assert.equal(tokenReq.headers.sign, expected);
});

test('a business request inserts the access token between client_id and t', async () => {
  const { impl, seen } = fakeFetch([tokenOk, { success: true, result: { devices: [] } }]);
  const c = createTuyaClient({ accessId: ID, accessSecret: SECRET, host: HOST, fetchImpl: impl, now: () => T });
  await c.listDevices();

  const path = '/v1.0/iot-01/associated-users/devices?size=100';
  const call = seen[1];
  assert.equal(call.url, `${HOST}${path}`);
  assert.equal(call.headers.access_token, 'tok-1');
  assert.equal(call.headers.sign, hmac(`${ID}tok-1${T}` + `GET\n${sha256('')}\n\n${path}`));
});

test('an empty body hashes to the SHA-256 of the empty string, not to nothing', async () => {
  const { impl, seen } = fakeFetch([tokenOk, { success: true, result: {} }]);
  const c = createTuyaClient({ accessId: ID, accessSecret: SECRET, host: HOST, fetchImpl: impl, now: () => T });
  await c.describeDevice('dev1');
  assert.ok(seen[1].headers.sign.includes(''), 'sign present');
  assert.equal(seen[1].body, undefined, 'no body is sent when there is none');
  // The proof is that the signature matches one built with the empty-string hash.
  const path = '/v1.0/devices/dev1';
  assert.equal(seen[1].headers.sign, hmac(`${ID}tok-1${T}` + `GET\n${sha256('')}\n\n${path}`));
});

test('the signature is uppercase — Tuya rejects lowercase hex', async () => {
  const { impl, seen } = fakeFetch([tokenOk, { success: true, result: { devices: [] } }]);
  const c = createTuyaClient({ accessId: ID, accessSecret: SECRET, host: HOST, fetchImpl: impl, now: () => T });
  await c.listDevices();
  assert.equal(seen[0].headers.sign, seen[0].headers.sign.toUpperCase());
});

test('a failure reported as HTTP 200 with success:false is treated as a failure', async () => {
  // Tuya, PostgREST's silent truncation, and its RLS-blocked writes all share this shape.
  // Never infer success from a 200.
  const { impl } = fakeFetch([{ success: false, code: 1004, msg: 'sign invalid' }]);
  const c = createTuyaClient({ accessId: ID, accessSecret: SECRET, host: HOST, fetchImpl: impl, now: () => T });
  await assert.rejects(() => c.listDevices(), /code 1004.*sign invalid/);
});

test('the token is reused rather than re-fetched on every call', async () => {
  const { impl, seen } = fakeFetch([tokenOk, { success: true, result: { devices: [] } }, { success: true, result: { devices: [] } }]);
  const c = createTuyaClient({ accessId: ID, accessSecret: SECRET, host: HOST, fetchImpl: impl, now: () => T });
  await c.listDevices();
  await c.listDevices();
  assert.equal(seen.filter((r) => r.url.includes('/v1.0/token')).length, 1);
});

test('a token near expiry is refreshed before it can fail mid-flight', async () => {
  let clock = T;
  const { impl, seen } = fakeFetch([
    tokenOk,
    { success: true, result: { devices: [] } },
    tokenOk,
    { success: true, result: { devices: [] } },
  ]);
  const c = createTuyaClient({ accessId: ID, accessSecret: SECRET, host: HOST, fetchImpl: impl, now: () => clock });
  await c.listDevices();
  clock = T + 7200_000 - 30_000; // inside the 60s slack
  await c.listDevices();
  assert.equal(seen.filter((r) => r.url.includes('/v1.0/token')).length, 2);
});

test('refuses to construct without credentials, rather than failing later as an auth error', () => {
  assert.throws(() => createTuyaClient({ accessId: '', accessSecret: SECRET, host: HOST }), /required/);
  assert.throws(() => createTuyaClient({ accessId: ID, accessSecret: '', host: HOST }), /required/);
  assert.throws(() => createTuyaClient({ accessId: ID, accessSecret: SECRET, host: '' }), /host is required/);
});
