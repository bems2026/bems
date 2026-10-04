/**
 * Whether a Supabase session may use the edge — RM-159.
 *
 * WHY THIS EXISTS. The proxy asked Supabase's `/auth/v1/user` about every session at most once a
 * minute, and the kiosk calls the edge every minute — so in practice once a minute, for ever: about
 * 1,440 lines a day in the project's log for one open screen, when log ingestion was over the Free
 * plan's 1 GB. RM-158 moved the alert bell from Supabase to the edge and so made every bell poll
 * cost one of these checks instead, which is how that change saved half of what it claimed (F-043).
 *
 * THE RULE (the operator's decision, 2026-10-04):
 *
 * - **A token this project signed** (its ES256 signature verifies against the cached JWKS) is asked
 *   about ONCE, online, the first time it is seen; that answer then stands until the token expires.
 *   Supabase mints a new token about hourly, so this is about 24 questions a day per open screen.
 *   The signature and expiry are still checked on every request, on the edge — the same check
 *   Supabase's own database applies to every read it serves.
 * - **A command** wants an online answer no older than `freshMs` (a minute), exactly as before. A
 *   session signed out elsewhere therefore stops commanding within a minute, and stops reading
 *   within the life of its token (at most an hour).
 * - **Anything else** — a token the keys cannot judge (another algorithm, no keys cached, a key we
 *   have not seen) — takes the old path unchanged: asked online, the answer kept a minute.
 *
 * OFFLINE (RM-157) is unchanged: a question that could not be ASKED — no answer, or one that does
 * not judge the token (402, 408, 425, 429, 5xx) — falls back to the signature alone, and that
 * verdict is never kept, so it cannot outlive the outage.
 */

import { verifyEs256Jwt, JWT_FAIL } from './jwtVerify.mjs';

/** Signed with this project's key, and refused for what it says. No online answer could change these. */
const SIGNED_BUT_REFUSED = new Set([JWT_FAIL.EXPIRED, JWT_FAIL.ISSUER, JWT_FAIL.SUBJECT]);

/** How often an unknown signature may make the edge fetch the key set again. Unauthenticated callers can cause it. */
export const KEY_REFRESH_GAP_MS = 10 * 60_000;

/**
 * @param {{
 *   askOnline: (token: string) => Promise<{answered: boolean, ok?: boolean, userId?: string|null, detail?: string}>,
 *   keys: () => import('node:crypto').KeyObject[],
 *   refreshKeys?: () => Promise<unknown>,
 *   issuer: string|null,
 *   now?: () => number,
 *   freshMs?: number,
 *   legacyCacheMs?: number,
 *   maxEntries?: number,
 *   log?: (line: string) => void,
 * }} deps
 */
export function createSessionCheck({
  askOnline, keys, refreshKeys = async () => {}, issuer, now = Date.now,
  freshMs = 60_000, legacyCacheMs = 60_000, maxEntries = 5000, log = () => {},
}) {
  /** token -> { ok, userId, checkedAt, validUntil } — online answers only. */
  const verdicts = new Map();
  /** One question per token at a time (RM-158): a page opening fetches several things at once. */
  const inFlight = new Map();
  let lastKeyRefresh = -Infinity;

  function remember(token, verdict) {
    verdicts.set(token, verdict);
    // Map keeps insertion order, so the front is the oldest.
    while (verdicts.size > maxEntries) verdicts.delete(verdicts.keys().next().value);
  }

  function ask(token) {
    const pending = inFlight.get(token);
    if (pending) return pending;
    const asking = Promise.resolve()
      .then(() => askOnline(token))
      .catch((err) => ({ answered: false, detail: String(err?.message ?? err) }))
      .finally(() => inFlight.delete(token));
    inFlight.set(token, asking);
    return asking;
  }

  const verdictOf = (v) => (v.ok ? { ok: true, userId: v.userId } : { ok: false, userId: null });

  function maybeRefreshKeys(t) {
    if (t - lastKeyRefresh < KEY_REFRESH_GAP_MS) return;
    lastKeyRefresh = t;
    // In the background: this request is answered by the old path either way.
    Promise.resolve().then(refreshKeys).catch(() => {});
  }

  async function signed(token, local, fresh) {
    const t = now();
    const known = verdicts.get(token);
    if (known && t < known.validUntil && (!fresh || t - known.checkedAt < freshMs)) return verdictOf(known);
    const answer = await ask(token);
    if (!answer.answered) {
      // RM-157's offline path: the signature is all there is. Not kept — see the header.
      return { ok: true, userId: local.userId, offline: true };
    }
    const verdict = { ok: Boolean(answer.ok), userId: answer.ok ? (answer.userId ?? local.userId) : null, checkedAt: now(), validUntil: local.exp * 1000 };
    remember(token, verdict);
    return verdictOf(verdict);
  }

  async function unsigned(token, local) {
    const t = now();
    const known = verdicts.get(token);
    if (known && t < known.validUntil) return verdictOf(known);
    const answer = await ask(token);
    let verdict;
    if (answer.answered) {
      verdict = { ok: Boolean(answer.ok), userId: answer.ok ? (answer.userId ?? null) : null, checkedAt: now(), validUntil: now() + legacyCacheMs };
    } else {
      log(`Supabase unreachable and offline verification failed: ${local.reason}`);
      verdict = { ok: false, userId: null, checkedAt: now(), validUntil: now() + legacyCacheMs };
    }
    remember(token, verdict);
    return verdictOf(verdict);
  }

  return {
    /**
     * `{ok, userId, offline?}`. `fresh` is for commands: an online answer no older than `freshMs`.
     */
    async check(token, { fresh = false } = {}) {
      const local = verifyEs256Jwt(token, keys(), { issuer, now: Math.floor(now() / 1000) });
      if (local.ok) return signed(token, local, fresh);
      if (SIGNED_BUT_REFUSED.has(local.reason)) return { ok: false, userId: null };
      if (local.reason === JWT_FAIL.SIGNATURE) maybeRefreshKeys(now());
      return unsigned(token, local);
    },
    /** Drops every answer whose time is up. The proxy calls it once a minute. */
    sweep() {
      const t = now();
      for (const [token, v] of verdicts) if (t >= v.validUntil) verdicts.delete(token);
    },
    size: () => verdicts.size,
  };
}
