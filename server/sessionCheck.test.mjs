/**
 * RM-159: a session this project signed is asked about online once per token, not once a minute.
 *
 *     node --test server/sessionCheck.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSessionCheck, KEY_REFRESH_GAP_MS } from './sessionCheck.mjs';

const ISSUER = 'https://project.example/auth/v1';

function signingKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { publicKey, privateKey };
}

function mint(privateKey, { sub = 'user-1', iss = ISSUER, expAtSec, alg = 'ES256' } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc({ alg, typ: 'JWT' })}.${enc({ sub, iss, exp: expAtSec })}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

/** A clock, a counting fake of `/auth/v1/user`, and the check under test. */
function harness({ answer = { answered: true, ok: true, userId: 'user-1' }, seed = true } = {}) {
  const key = signingKey();
  let t = 1_800_000_000_000;
  const calls = [];
  const state = { answer, keys: seed ? [key.publicKey] : [], refreshes: 0 };
  const check = createSessionCheck({
    askOnline: async (token) => {
      calls.push(token);
      return typeof state.answer === 'function' ? state.answer(token) : state.answer;
    },
    keys: () => state.keys,
    refreshKeys: async () => { state.refreshes += 1; },
    issuer: ISSUER,
    now: () => t,
  });
  return {
    key, check, calls, state,
    advance: (ms) => { t += ms; },
    nowSec: () => Math.floor(t / 1000),
  };
}

test('a signed token is asked about once, and then read from for the rest of its life', async () => {
  const h = harness();
  const token = mint(h.key.privateKey, { expAtSec: h.nowSec() + 3600 });
  for (let i = 0; i < 10; i++) {
    assert.deepEqual(await h.check.check(token), { ok: true, userId: 'user-1' });
    h.advance(5 * 60_000); // 50 minutes in all: well past the old one-minute cache
  }
  assert.equal(h.calls.length, 1, 'one online question per token, not one a minute');
});

test('a command wants an online answer no older than a minute', async () => {
  const h = harness();
  const token = mint(h.key.privateKey, { expAtSec: h.nowSec() + 3600 });
  await h.check.check(token);
  await h.check.check(token, { fresh: true });
  assert.equal(h.calls.length, 1, 'an answer seconds old is fresh enough for a command');
  h.advance(61_000);
  await h.check.check(token);
  assert.equal(h.calls.length, 1, 'a read still uses it');
  await h.check.check(token, { fresh: true });
  assert.equal(h.calls.length, 2, 'a command a minute later asks again');
});

test('a session refused online stays refused until its token expires, with no further questions', async () => {
  const h = harness({ answer: { answered: true, ok: false } });
  const token = mint(h.key.privateKey, { expAtSec: h.nowSec() + 3600 });
  assert.equal((await h.check.check(token)).ok, false);
  h.advance(30 * 60_000);
  assert.equal((await h.check.check(token)).ok, false);
  assert.equal(h.calls.length, 1);
});

test('an expired token, or one for another issuer, is refused on the edge without asking', async () => {
  const h = harness();
  const expired = mint(h.key.privateKey, { expAtSec: h.nowSec() - 1 });
  const elsewhere = mint(h.key.privateKey, { expAtSec: h.nowSec() + 3600, iss: 'https://other.example/auth/v1' });
  assert.equal((await h.check.check(expired)).ok, false);
  assert.equal((await h.check.check(elsewhere)).ok, false);
  assert.equal(h.calls.length, 0);
});

test('a token signed by a key the edge does not know takes the old path, and fetches the keys again at most every ten minutes', async () => {
  const h = harness({ answer: { answered: true, ok: false } });
  const stranger = signingKey();
  const token = mint(stranger.privateKey, { expAtSec: h.nowSec() + 3600 });
  assert.equal((await h.check.check(token)).ok, false);
  assert.equal(h.calls.length, 1, 'asked online, as before RM-159');
  await new Promise((r) => setImmediate(r));
  assert.equal(h.state.refreshes, 1, 'a rotated key is the likely reason, so the key set is fetched again');

  h.advance(61_000);
  await h.check.check(token);
  assert.equal(h.calls.length, 2, 'the old path keeps an answer a minute');
  await new Promise((r) => setImmediate(r));
  assert.equal(h.state.refreshes, 1, 'not again within ten minutes');
  h.advance(KEY_REFRESH_GAP_MS);
  await h.check.check(token);
  await new Promise((r) => setImmediate(r));
  assert.equal(h.state.refreshes, 2);
});

test('a token the keys cannot judge (not a JWT, no keys cached) keeps the one-minute online check', async () => {
  const h = harness({ seed: false, answer: { answered: true, ok: true, userId: 'user-9' } });
  assert.deepEqual(await h.check.check('opaque-token'), { ok: true, userId: 'user-9' });
  await h.check.check('opaque-token');
  assert.equal(h.calls.length, 1);
  h.advance(60_000);
  await h.check.check('opaque-token');
  assert.equal(h.calls.length, 2);
});

test('offline, a signed token is accepted on its signature and the verdict is not kept', async () => {
  const h = harness({ answer: { answered: false, detail: 'ECONNREFUSED' } });
  const token = mint(h.key.privateKey, { sub: 'user-offline', expAtSec: h.nowSec() + 3600 });
  assert.deepEqual(await h.check.check(token), { ok: true, userId: 'user-offline', offline: true });
  h.state.answer = { answered: true, ok: false };
  assert.equal((await h.check.check(token)).ok, false, 'once Supabase answers again, its answer is the one that counts');
  assert.equal(h.calls.length, 2);
});

test('offline, a token the keys cannot verify is refused, and the refusal is kept a minute', async () => {
  const h = harness({ answer: { answered: false } });
  const stranger = signingKey();
  const token = mint(stranger.privateKey, { expAtSec: h.nowSec() + 3600 });
  assert.equal((await h.check.check(token)).ok, false);
  await h.check.check(token);
  assert.equal(h.calls.length, 1);
});

test('simultaneous checks of one token make one question', async () => {
  const h = harness();
  const token = mint(h.key.privateKey, { expAtSec: h.nowSec() + 3600 });
  const all = await Promise.all(Array.from({ length: 5 }, () => h.check.check(token)));
  assert.ok(all.every((v) => v.ok));
  assert.equal(h.calls.length, 1);
});

test('sweep drops answers whose token has expired', async () => {
  const h = harness();
  const token = mint(h.key.privateKey, { expAtSec: h.nowSec() + 120 });
  await h.check.check(token);
  assert.equal(h.check.size(), 1);
  h.advance(121_000);
  h.check.sweep();
  assert.equal(h.check.size(), 0);
});
