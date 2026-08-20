/**
 * The current session token (Supabase access token, or a break-glass local-session
 * token), if any. A plain module-level accessor — not Zustand — so `bridgeClient.ts`
 * stays framework/store-agnostic per its own header comment. `authStore.ts` calls
 * `setAuthToken` on login/logout/refresh; `bridgeClient.ts` calls `getAuthToken` on every
 * request and WS (re)connect.
 *
 * This file is also the seam in the OTHER direction: `bridgeClient.ts` needs to report
 * "the server rejected this token" without importing a store, and `authStore.ts` needs to
 * hear about it without being imported by the client. `setAuthFailureHandler` /
 * `notifyAuthFailure` are that channel — deliberately here, next to the token they concern,
 * rather than in a new module whose only job would be to hold one callback.
 */
let currentToken: string | null = null;
let authFailureHandler: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  currentToken = token;
}

export function getAuthToken(): string | null {
  return currentToken;
}

/** Register the single listener for "a request was rejected as unauthenticated". Replaces
 * any previous handler rather than stacking — `authStore.init()` is idempotent and must not
 * end up firing two token refreshes per 401 if it ever runs twice. Pass `null` to clear. */
export function setAuthFailureHandler(handler: (() => void) | null) {
  authFailureHandler = handler;
}

/** Called by `bridgeClient.fetchJson` on a 401. Swallows anything the handler throws: the
 * caller is mid-request and its own error path (a `BridgeFetchError` describing the 401) is
 * the one that must reach the caller — a store-side bug must not replace it with something
 * unrelated, or worse, mask the 401 entirely. */
export function notifyAuthFailure() {
  if (!authFailureHandler) return;
  try {
    authFailureHandler();
  } catch {
    /* see above */
  }
}
