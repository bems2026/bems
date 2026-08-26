/**
 * Verifying a Supabase access token **without asking Supabase** — the offline half of the
 * session check.
 *
 * WHY THIS EXISTS: `verifySupabaseSession` in `server/proxy.mjs` authenticates by calling
 * `/auth/v1/user`, which is a network round trip. That is the right answer while the internet
 * is up — it is authoritative, and it is the only check that notices a session the user has
 * since signed out of. But it means an internet outage removes the ability to command a fleet
 * of devices that are, by design, entirely local. The Tuya devices sit on the same L2 segment
 * as the Pi and answer local keys; nothing about controlling them needs the internet. Losing
 * control of the building's lights because a WAN link dropped is the failure this closes.
 *
 * SCOPE, DELIBERATELY NARROW. This is a fallback, used only when the network check could not
 * be completed. It is strictly weaker than the real one: a signature proves the token was
 * minted by the project, not that the session is still valid, so a token revoked during an
 * outage keeps working here until it expires. That is why `exp` is mandatory below and why
 * the caller must prefer the network answer whenever it can get one.
 *
 * NO NEW SECRET, AND NO NEW DEPENDENCY. This project's access tokens are **ES256**, and the
 * public key is published at `/auth/v1/.well-known/jwks.json` — measured, not assumed. So
 * verification needs a *public* key that can be cached from a public endpoint, rather than a
 * shared JWT secret that would have to be added to `server/.env`. `node:crypto` verifies
 * ES256 natively, which keeps `server/` free of external dependencies as CLAUDE.md requires.
 *
 * THE ALGORITHM IS NOT NEGOTIABLE, and that is the point of the check below. The oldest JWT
 * vulnerability is a verifier that reads `alg` out of the header and does what it is told —
 * `alg: "none"` accepts anything, and `alg: "HS256"` lets an attacker HMAC a token using the
 * public key as the shared secret, because the public key is, by definition, public. This
 * module verifies ES256 and nothing else, whatever the header claims.
 */

import crypto from 'node:crypto';

export const JWT_FAIL = {
  MALFORMED: 'malformed',
  ALGORITHM: 'algorithm not ES256',
  NO_KEYS: 'no verification keys cached',
  SIGNATURE: 'signature does not verify',
  EXPIRED: 'expired or has no expiry',
  ISSUER: 'issuer mismatch',
  SUBJECT: 'no subject claim',
};

/** A JWKS entry -> a KeyObject usable by `crypto.verify`. Throws on anything not an EC key. */
export function jwkToKeyObject(jwk) {
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/**
 * @param token   the raw JWT
 * @param keys    KeyObjects from the cached JWKS. Empty means offline verification is not
 *                possible, which fails closed — never "no keys, no checking".
 * @param issuer  expected `iss`. Anyone can mint an ES256 token; this is what ties one to
 *                this project.
 * @param now     seconds since epoch, injectable so expiry is testable without sleeping.
 * @returns {{ok: boolean, userId: string|null, reason: string|null}}
 */
export function verifyEs256Jwt(token, keys, { issuer, now = Math.floor(Date.now() / 1000) } = {}) {
  const fail = (reason) => ({ ok: false, userId: null, reason });

  const parts = String(token ?? '').split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1]) return fail(JWT_FAIL.MALFORMED);

  let header;
  let payload;
  try {
    header = decodeSegment(parts[0]);
    payload = decodeSegment(parts[1]);
  } catch {
    return fail(JWT_FAIL.MALFORMED);
  }
  if (!payload || typeof payload !== 'object') return fail(JWT_FAIL.MALFORMED);

  // Checked before anything else touches the signature. See the note above on `alg`.
  if (header?.alg !== 'ES256') return fail(JWT_FAIL.ALGORITHM);
  if (!keys?.length) return fail(JWT_FAIL.NO_KEYS);

  let signature;
  try {
    signature = Buffer.from(parts[2], 'base64url');
  } catch {
    return fail(JWT_FAIL.MALFORMED);
  }
  // P-256 JOSE signatures are exactly 64 bytes of raw r||s. Checked because `crypto.verify`
  // with `ieee-p1363` throws on a wrong-length buffer rather than returning false, and this
  // path is reachable pre-auth from the LAN — a crash here would be a denial of service.
  if (signature.length !== 64) return fail(JWT_FAIL.SIGNATURE);

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  // Every key, not just the one matching `kid`: Supabase can publish more than one across a
  // rotation, and matching only the first would lock everyone out offline at precisely the
  // moment no new key set can be fetched.
  let verified = false;
  for (const key of keys) {
    try {
      if (crypto.verify('sha256', signingInput, { key, dsaEncoding: 'ieee-p1363' }, signature)) {
        verified = true;
        break;
      }
    } catch {
      // A key of the wrong type or curve. Try the next rather than failing the whole set.
    }
  }
  if (!verified) return fail(JWT_FAIL.SIGNATURE);

  // Mandatory, not "honoured if present". Offline verification cannot see a revoked session,
  // so expiry is the only thing that ever ends one — a token without it would be a permanent
  // offline command grant to whoever holds it.
  if (typeof payload.exp !== 'number' || payload.exp <= now) return fail(JWT_FAIL.EXPIRED);
  if (issuer && payload.iss !== issuer) return fail(JWT_FAIL.ISSUER);
  // The caller attributes an audit row to this. A verified token with nobody in it would
  // produce a row attributed to no one, which is worse than refusing the command.
  if (typeof payload.sub !== 'string' || !payload.sub) return fail(JWT_FAIL.SUBJECT);

  return { ok: true, userId: payload.sub, reason: null };
}
