import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyEs256Jwt, jwkToKeyObject, JWT_FAIL } from './jwtVerify.mjs';

/**
 * Keys are generated per run rather than fixtured. A committed private key — even a throwaway
 * one — is a credential-shaped blob in a public repository, and the next person to find it has
 * to work out whether it matters.
 */
function makeKeypair(kid = 'test-kid') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };
  return { jwk, privateKey, kid };
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Signs a JWT the way Supabase does: ES256, JOSE (raw r||s) signature, not DER. */
function signJwt(privateKey, payload, { kid = 'test-kid', alg = 'ES256' } = {}) {
  const signingInput = `${b64({ alg, typ: 'JWT', kid })}.${b64(payload)}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${sig.toString('base64url')}`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;

const ISS = 'https://example.test/auth/v1';
const claims = (over = {}) => ({ sub: 'user-123', iss: ISS, exp: future(), role: 'authenticated', ...over });

test('accepts a correctly signed, unexpired token and returns the subject', () => {
  const { jwk, privateKey } = makeKeypair();
  const out = verifyEs256Jwt(signJwt(privateKey, claims()), [jwkToKeyObject(jwk)], { issuer: ISS });
  assert.equal(out.ok, true);
  assert.equal(out.userId, 'user-123');
});

test('rejects a token signed by a different key', () => {
  // The whole point. Without a real signature check this module would be a base64 decoder that
  // trusts whatever it is handed — and it is the thing standing between the LAN and a relay.
  const { jwk } = makeKeypair();
  const attacker = makeKeypair();
  const forged = signJwt(attacker.privateKey, claims());
  const out = verifyEs256Jwt(forged, [jwkToKeyObject(jwk)], { issuer: ISS });
  assert.equal(out.ok, false);
  assert.equal(out.reason, JWT_FAIL.SIGNATURE);
});

test('rejects a token whose payload was edited after signing', () => {
  // The specific attack that matters here: take a real token and promote yourself. The
  // signature covers header.payload, so re-encoding the payload must invalidate it.
  const { jwk, privateKey } = makeKeypair();
  const token = signJwt(privateKey, claims({ sub: 'user-123' }));
  const [h, , s] = token.split('.');
  const tampered = `${h}.${b64(claims({ sub: 'someone-else' }))}.${s}`;
  const out = verifyEs256Jwt(tampered, [jwkToKeyObject(jwk)], { issuer: ISS });
  assert.equal(out.ok, false);
  assert.equal(out.reason, JWT_FAIL.SIGNATURE);
});

test('rejects an expired token', () => {
  // Offline verification cannot see a revoked session, so expiry is the only thing that ever
  // ends one. Honouring it is not optional.
  const { jwk, privateKey } = makeKeypair();
  const out = verifyEs256Jwt(signJwt(privateKey, claims({ exp: past() })), [jwkToKeyObject(jwk)], { issuer: ISS });
  assert.equal(out.ok, false);
  assert.equal(out.reason, JWT_FAIL.EXPIRED);
});

test('rejects a token with no expiry at all', () => {
  // A token that never expires would grant permanent offline command rights to whoever holds
  // it. Absent is not the same as far away, and must not be treated as "fine for now".
  const { jwk, privateKey } = makeKeypair();
  const c = claims();
  delete c.exp;
  const out = verifyEs256Jwt(signJwt(privateKey, c), [jwkToKeyObject(jwk)], { issuer: ISS });
  assert.equal(out.ok, false);
  assert.equal(out.reason, JWT_FAIL.EXPIRED);
});

test('rejects a token from a different issuer', () => {
  // Anyone can mint an ES256 token. The issuer check is what ties it to this project.
  const { jwk, privateKey } = makeKeypair();
  const out = verifyEs256Jwt(signJwt(privateKey, claims({ iss: 'https://attacker.test/auth/v1' })), [jwkToKeyObject(jwk)], { issuer: ISS });
  assert.equal(out.ok, false);
  assert.equal(out.reason, JWT_FAIL.ISSUER);
});

test('refuses alg=none and refuses to be told which algorithm to use', () => {
  // The classic JWT break: the token names its own algorithm and a naive verifier obeys.
  const { jwk } = makeKeypair();
  const signingInput = `${b64({ alg: 'none', typ: 'JWT', kid: 'test-kid' })}.${b64(claims())}`;
  assert.equal(verifyEs256Jwt(`${signingInput}.`, [jwkToKeyObject(jwk)], { issuer: ISS }).reason, JWT_FAIL.ALGORITHM);

  // HS256 is the other half of it: an HMAC forged with the PUBLIC key as its secret verifies,
  // if the verifier lets the header choose. This module only ever does ES256.
  const pub = jwkToKeyObject(jwk).export({ type: 'spki', format: 'pem' });
  const hs = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims())}`;
  const mac = crypto.createHmac('sha256', pub).update(hs).digest('base64url');
  assert.equal(verifyEs256Jwt(`${hs}.${mac}`, [jwkToKeyObject(jwk)], { issuer: ISS }).reason, JWT_FAIL.ALGORITHM);
});

test('tries every key in the set, so a rotated signing key still verifies', () => {
  // Supabase can publish more than one JWKS key across a rotation. Matching only the first
  // would lock everyone out offline at exactly the moment nobody can fetch a new key set.
  const older = makeKeypair('kid-old');
  const current = makeKeypair('kid-new');
  const token = signJwt(current.privateKey, claims(), { kid: 'kid-new' });
  const keys = [jwkToKeyObject(older.jwk), jwkToKeyObject(current.jwk)];
  assert.equal(verifyEs256Jwt(token, keys, { issuer: ISS }).ok, true);
});

test('rejects when the key set is empty rather than passing anything through', () => {
  // No cached JWKS means no offline verification is possible. That must fail closed: an empty
  // key set is the state on a fresh install, and "no keys" must never mean "no checking".
  const { privateKey } = makeKeypair();
  const out = verifyEs256Jwt(signJwt(privateKey, claims()), [], { issuer: ISS });
  assert.equal(out.ok, false);
  assert.equal(out.reason, JWT_FAIL.NO_KEYS);
});

test('rejects malformed input without throwing', () => {
  // This is reachable pre-auth from the LAN, so a crash here is a denial of service.
  const { jwk } = makeKeypair();
  const keys = [jwkToKeyObject(jwk)];
  for (const bad of ['', 'not-a-jwt', 'a.b', 'a.b.c.d', '...', 'x.y.z']) {
    const out = verifyEs256Jwt(bad, keys, { issuer: ISS });
    assert.equal(out.ok, false, `expected "${bad}" to be rejected`);
  }
});

test('rejects a token whose subject is missing', () => {
  // The caller uses userId for audit attribution. A verified token with nobody in it would
  // write an audit row attributed to no one, which is worse than refusing.
  const { jwk, privateKey } = makeKeypair();
  const c = claims();
  delete c.sub;
  const out = verifyEs256Jwt(signJwt(privateKey, c), [jwkToKeyObject(jwk)], { issuer: ISS });
  assert.equal(out.ok, false);
  assert.equal(out.reason, JWT_FAIL.SUBJECT);
});
