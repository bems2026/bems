/**
 * The current session token (Supabase access token, or a break-glass local-session
 * token), if any. A plain module-level accessor — not Zustand — so `bridgeClient.ts`
 * stays framework/store-agnostic per its own header comment. `authStore.ts` calls
 * `setAuthToken` on login/logout/refresh; `bridgeClient.ts` calls `getAuthToken` on every
 * request and WS (re)connect.
 */
let currentToken: string | null = null;

export function setAuthToken(token: string | null) {
  currentToken = token;
}

export function getAuthToken(): string | null {
  return currentToken;
}
