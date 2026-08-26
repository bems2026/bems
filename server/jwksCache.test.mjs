import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJwksCache } from './jwksCache.mjs';

function tmpPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ibems-jwks-')), 'jwks.json');
}

function makeJwks(kid = 'k1') {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' }] };
}

const okFetch = (body) => async () => ({ ok: true, status: 200, json: async () => body });
const deadFetch = () => async () => {
  throw new Error('getaddrinfo ENOTFOUND');
};

test('fetches, caches to disk, and returns usable key objects', async () => {
  const cachePath = tmpPath();
  const cache = createJwksCache({ url: 'https://x.test/jwks', cachePath, fetchImpl: okFetch(makeJwks()) });
  const res = await cache.refresh();
  assert.equal(res.ok, true);
  assert.equal(res.count, 1);
  assert.equal(cache.keys().length, 1);
  assert.ok(fs.existsSync(cachePath), 'the key set must survive a restart, so it goes to disk');
});

test('loads keys from disk without any network — the entire point', async () => {
  // A proxy restarted DURING an outage has no way to fetch. If the cache only lived in
  // memory, the restart would silently remove offline command capability at the worst moment.
  const cachePath = tmpPath();
  const seeded = createJwksCache({ url: 'https://x.test/jwks', cachePath, fetchImpl: okFetch(makeJwks()) });
  await seeded.refresh();

  const cold = createJwksCache({ url: 'https://x.test/jwks', cachePath, fetchImpl: deadFetch() });
  assert.equal(cold.keys().length, 1, 'keys must come off disk with no fetch at all');
});

test('a failed refresh keeps the keys it already had', async () => {
  // The refresh that matters is the one that fails, and it fails exactly when the cached keys
  // are about to be needed. Blanking them on failure would disable offline verification at
  // precisely the moment it becomes the only verification available.
  const cachePath = tmpPath();
  const cache = createJwksCache({ url: 'https://x.test/jwks', cachePath, fetchImpl: okFetch(makeJwks()) });
  await cache.refresh();
  assert.equal(cache.keys().length, 1);

  cache.setFetch(deadFetch());
  const res = await cache.refresh();
  assert.equal(res.ok, false);
  assert.equal(cache.keys().length, 1, 'a failed refresh must not blank the cache');
});

test('an empty or malformed key set never replaces good keys', async () => {
  // A 200 carrying `{keys: []}` is a plausible transient from a misrouted proxy or a captive
  // portal. Treating it as authoritative would erase the cache while reporting success.
  const cachePath = tmpPath();
  const cache = createJwksCache({ url: 'https://x.test/jwks', cachePath, fetchImpl: okFetch(makeJwks()) });
  await cache.refresh();

  for (const junk of [{ keys: [] }, {}, { keys: 'nope' }, null]) {
    cache.setFetch(okFetch(junk));
    const res = await cache.refresh();
    assert.equal(res.ok, false, `expected ${JSON.stringify(junk)} to be refused`);
    assert.equal(cache.keys().length, 1, 'good keys must survive a junk response');
  }
});

test('a corrupt cache file yields no keys rather than throwing', async () => {
  // Fails closed. A truncated file after a power cut must disable offline verification, not
  // crash the proxy on startup — this runs before anything is serving.
  const cachePath = tmpPath();
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, '{ this is not json');
  const cache = createJwksCache({ url: 'https://x.test/jwks', cachePath, fetchImpl: deadFetch() });
  assert.deepEqual(cache.keys(), []);
});

test('a non-2xx response is refused even when it carries a valid key set', async () => {
  // The body deliberately LOOKS fine. Written with an empty body this test passed with the
  // status check deleted, because a downstream guard caught the emptiness instead — so it
  // proved nothing about the status check. A 503 that still serves a cached or generic body
  // is exactly what a gateway in front of an outage returns, and trusting it would mean
  // caching whatever an intermediary felt like handing us.
  const cachePath = tmpPath();
  const cache = createJwksCache({
    url: 'https://x.test/jwks',
    cachePath,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => makeJwks('from-an-error-page') }),
  });
  const res = await cache.refresh();
  assert.equal(res.ok, false);
  assert.deepEqual(cache.keys(), [], 'a refused response must not seed the cache');
});

test('drops non-EC entries instead of failing the whole set', async () => {
  // Supabase may publish more than one key type. One unusable entry must not cost us the
  // usable ones beside it.
  const cachePath = tmpPath();
  const good = makeJwks('good');
  const mixed = { keys: [{ kty: 'oct', k: 'nope', kid: 'sym' }, ...good.keys] };
  const cache = createJwksCache({ url: 'https://x.test/jwks', cachePath, fetchImpl: okFetch(mixed) });
  const res = await cache.refresh();
  assert.equal(res.ok, true);
  assert.equal(cache.keys().length, 1);
});
