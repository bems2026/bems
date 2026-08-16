/**
 * Break-glass password hashing — architecture plan Phase 5.
 *
 * `node:crypto`'s scrypt, not bcrypt: zero added dependencies, matching this repo's
 * existing house style (`mock-bridge/server.mjs`, `server/ingest.mjs`). Format is
 * `<salt-hex>:<hash-hex>`, stored in `server/.env` as `BREAK_GLASS_PASSWORD_HASH` — never
 * the plaintext password.
 */

import crypto from 'node:crypto';

const KEY_LENGTH = 64;

export function hashBreakGlassPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** Constant-time comparison — a break-glass login is exactly the kind of check where a
 * timing side-channel matters (it's reachable pre-auth, from the LAN). */
export function verifyBreakGlassPassword(password, stored) {
  if (typeof password !== 'string' || !stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  let salt, expected;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;
  const actual = crypto.scryptSync(password, salt, KEY_LENGTH);
  return crypto.timingSafeEqual(actual, expected);
}
