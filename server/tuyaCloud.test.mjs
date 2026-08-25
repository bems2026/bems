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
import { createTuyaClient, TUYA_HOSTS, probeTuyaHost } from './tuyaCloud.mjs';

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

test('probeTuyaHost returns the first host that authenticates, and records what the others said', async () => {
  const hosts = { a: 'https://a.example', b: 'https://b.example' };
  const impl = async (url) =>
    url.startsWith('https://b.example')
      ? { status: 200, json: async () => tokenOk }
      : { status: 200, json: async () => ({ success: false, code: 1004, msg: 'sign invalid' }) };
  const { region, host, attempts } = await probeTuyaHost({ accessId: ID, accessSecret: SECRET, fetchImpl: impl, hosts });
  assert.equal(region, 'b');
  assert.equal(host, 'https://b.example');
  assert.equal(attempts.length, 1, 'the failing host is recorded, not swallowed');
  assert.match(attempts[0].error, /sign invalid/);
});

test('probeTuyaHost reports no match rather than throwing, so a wrong secret is distinguishable', async () => {
  // Every host failing means the credentials are wrong, not that one region is wrong. Throwing
  // here would make those two look the same at the call site.
  const impl = async () => ({ status: 200, json: async () => ({ success: false, code: 1004, msg: 'sign invalid' }) });
  const { region, attempts } = await probeTuyaHost({
    accessId: ID, accessSecret: SECRET, fetchImpl: impl, hosts: { a: 'https://a.example', b: 'https://b.example' },
  });
  assert.equal(region, null);
  assert.equal(attempts.length, 2);
});

test('probeTuyaHost rejects a host that issues a token but refuses business calls', async () => {
  // The real failure this was rewritten for: an unenabled data centre still hands out a token,
  // then answers business calls with "the data center is suspended". Probing on the token alone
  // reported that host with confidence and never tried the right one.
  const hosts = { bad: 'https://bad.example', good: 'https://good.example' };
  const impl = async (url) => {
    if (url.includes('/v1.0/token')) return { status: 200, json: async () => tokenOk };
    if (url.startsWith('https://good.example')) return { status: 200, json: async () => ({ success: true, result: { devices: [] } }) };
    return { status: 200, json: async () => ({ success: false, code: 28841107, msg: 'No permission. The data center is suspended.' }) };
  };
  const { region, attempts } = await probeTuyaHost({ accessId: ID, accessSecret: SECRET, fetchImpl: impl, hosts });
  assert.equal(region, 'good', 'a host that only authenticates must not win the probe');
  assert.match(attempts[0].error, /28841107/);
  assert.match(attempts[0].error, /suspended/, 'the actionable half of the message must survive truncation');
});

/**
 * `call()` fetches a token itself when the request needs one.
 *
 * It used not to: every wrapper (`listDevices`, `describeDevice`) called `ensureToken()` first,
 * and `call` assumed that had happened. `dispatchCloud.mjs` called `call` directly and did not,
 * so the vendor-cloud fallback failed with `code 1010: token invalid` — the recovery path for a
 * hung device, broken exactly when it was needed.
 *
 * It was intermittent, which is worse than broken: in the long-running proxy a token warmed by
 * some earlier call (opening the enrolment wizard, say) made it work, so it would pass a casual
 * test and fail in the incident. Found on the Pi 2026-08-25 by dispatching to a real device.
 *
 * Fixed in `call` rather than at that one call site, because the next caller would make the
 * same assumption. The token request itself passes `useToken: false` and so does not recurse.
 */
test('call() obtains a token before a request that needs one, without being asked', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, hasToken: Boolean(init.headers.access_token) });
    if (url.includes('/v1.0/token')) {
      return { json: async () => ({ success: true, result: { access_token: 'TOK', expire_time: 7200 } }) };
    }
    return { json: async () => ({ success: true, result: { ok: 1 } }) };
  };
  const client = createTuyaClient({ accessId: 'id', accessSecret: 'secret', host: 'https://h', fetchImpl });

  // Straight to a business call — no ensureToken(), exactly as dispatchCloud did.
  await client.call('POST', '/v1.0/devices/x/commands', { body: { commands: [] } });

  assert.equal(calls.length, 2, 'a token request then the business request');
  assert.match(calls[0].url, /\/v1\.0\/token/);
  assert.equal(calls[0].hasToken, false, 'the token request must not send a token');
  assert.match(calls[1].url, /\/commands$/);
  assert.equal(calls[1].hasToken, true, 'the business request must carry the token');
});

test('call() reuses a warm token instead of fetching one per request', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes('/v1.0/token')) {
      return { json: async () => ({ success: true, result: { access_token: 'TOK', expire_time: 7200 } }) };
    }
    return { json: async () => ({ success: true, result: {} }) };
  };
  const client = createTuyaClient({ accessId: 'id', accessSecret: 'secret', host: 'https://h', fetchImpl });
  await client.call('GET', '/a');
  await client.call('GET', '/b');
  assert.equal(urls.filter((u) => u.includes('/v1.0/token')).length, 1, 'one token for both calls');
});
