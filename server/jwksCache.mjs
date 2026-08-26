/**
 * The public keys that make offline session verification possible, cached so they are there
 * when the network is not.
 *
 * WHY IT PERSISTS TO DISK: the whole point of `jwtVerify.mjs` is to keep working during an
 * internet outage. An in-memory cache would satisfy that right up until the proxy restarted —
 * and a process restart during an outage is not a remote possibility, it is a power blip or a
 * `systemctl restart` by whoever is trying to fix the outage. Losing offline command
 * capability at that exact moment, silently, is the failure this avoids.
 *
 * WHY A BAD ANSWER NEVER REPLACES A GOOD ONE: every refusal below keeps the previously cached
 * keys. The refresh that matters is the one that fails, and it fails precisely when those keys
 * are about to become the only ones available. A 200 carrying an empty `keys` array is a
 * plausible transient — a captive portal, a misrouted proxy — and treating it as authoritative
 * would erase the cache while reporting success.
 *
 * These are PUBLIC keys from a public endpoint. Nothing here is a secret, and the file it
 * writes is not sensitive — which is exactly why this approach was chosen over a shared JWT
 * secret that would have had to be added to `server/.env`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { jwkToKeyObject } from './jwtVerify.mjs';

/** JWKS entries -> KeyObjects, dropping any that cannot be used rather than failing the set. */
function toKeyObjects(jwks) {
  const out = [];
  for (const jwk of jwks?.keys ?? []) {
    try {
      out.push(jwkToKeyObject(jwk));
    } catch {
      // A key type this cannot verify with (Supabase may publish more than one). One unusable
      // entry must not cost us the usable ones beside it.
    }
  }
  return out;
}

function isUsableJwks(body) {
  return Boolean(body && Array.isArray(body.keys) && body.keys.length);
}

/**
 * @param url        the JWKS endpoint
 * @param cachePath  where to persist the last good key set
 * @param fetchImpl  injectable for tests; this module is the only thing that fetches
 */
export function createJwksCache({ url, cachePath, fetchImpl = fetch, timeoutMs = 8000 }) {
  let keys = null;
  let doFetch = fetchImpl;

  function loadFromDisk() {
    try {
      return toKeyObjects(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
    } catch {
      // Missing, truncated after a power cut, or not JSON. Fails closed: no keys means no
      // offline verification, never "no keys, so no checking". This runs during startup, so
      // it must not throw.
      return [];
    }
  }

  return {
    /** Cached keys, loaded from disk on first use. Never throws. */
    keys() {
      if (keys === null) keys = loadFromDisk();
      return keys;
    },

    /** Test seam: this module owns fetching, so tests need a way to change it mid-life. */
    setFetch(next) {
      doFetch = next;
    },

    /**
     * Best-effort. Returns `{ok, count, detail}` and never throws — a failed refresh is an
     * ordinary condition here, not an error worth propagating into a request path.
     */
    async refresh() {
      let body;
      try {
        const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return { ok: false, count: this.keys().length, detail: `HTTP ${res.status}` };
        body = await res.json();
      } catch (err) {
        return { ok: false, count: this.keys().length, detail: String(err?.message ?? err) };
      }

      if (!isUsableJwks(body)) {
        return { ok: false, count: this.keys().length, detail: 'no usable keys in response' };
      }
      const next = toKeyObjects(body);
      if (!next.length) {
        return { ok: false, count: this.keys().length, detail: 'no verifiable key types in response' };
      }

      keys = next;
      try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify(body));
      } catch (err) {
        // The keys are live in memory either way; only the restart-survival property is lost,
        // and saying so is better than failing a refresh that otherwise worked.
        return { ok: true, count: next.length, detail: `cached in memory only: ${err?.message ?? err}` };
      }
      return { ok: true, count: next.length, detail: null };
    },
  };
}
