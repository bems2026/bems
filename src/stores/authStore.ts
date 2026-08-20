import { create } from 'zustand';
import { supabase } from '@/config/supabase';
import { BRIDGE_HTTP_URL } from '@/config/bridge';
import { setAuthToken, setAuthFailureHandler } from '@/lib/authToken';

export type AuthMode = 'supabase' | 'local';
export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

/**
 * Two ways in: a real Supabase session (`mode: 'supabase'`), or a break-glass local
 * session issued by `server/proxy.mjs`'s `/api/local-login` (`mode: 'local'`) — for
 * on-site access when Supabase Auth itself is unreachable. The two are deliberately
 * distinguishable in state, not merged into one generic "authenticated" — components
 * (see `AppShell`'s session badge) must render a local session visibly differently
 * ("local session — LAN only, remote access unavailable"), never as an equivalent to a
 * normal login. See the architecture plan's Phase 5 access-model decision.
 */
export interface AuthState {
  status: AuthStatus;
  mode: AuthMode | null;
  email: string | null; // only ever set for mode: 'supabase'
  init: () => void;
  signInWithPassword: (email: string, password: string) => Promise<{ ok: boolean; error?: string; networkError?: boolean }>;
  signInLocal: (password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

/**
 * Refresh-storm guard for `handleAuthFailure` below. Module-level rather than store state
 * for the same reason `capabilitiesStore.ts` keeps its retry bookkeeping outside the store:
 * it's transient plumbing, not something any component renders.
 *
 * `refreshInFlight` collapses a burst of concurrent 401s into one refresh — the live Pi's
 * kiosk was firing roughly three rejected requests a minute across a poll loop and a WS
 * reconnect timer, and each one calling `refreshSession()` would trade one hot loop for a
 * worse one aimed at Supabase.
 *
 * `lastRefreshAttempt` covers the case the in-flight guard can't: a refresh that SUCCEEDS
 * but whose new token is also rejected. That can't be distinguished from a real recovery
 * without another 401, so the window simply rate-limits how often we're willing to try.
 * A genuinely dead refresh token still lands on sign-out, because `refreshSession()` itself
 * fails in that case.
 */
let refreshInFlight: Promise<void> | null = null;
let lastRefreshAttempt = 0;
const MIN_REFRESH_INTERVAL_MS = 10_000;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'checking',
  mode: null,
  email: null,

  init: () => {
    if (!supabase) {
      // No Supabase project configured — Phase 5 auth isn't active at all; behave exactly
      // as every phase before it did. See src/config/bridge.ts's matching fallback.
      set({ status: 'authenticated', mode: null, email: null });
      return;
    }

    // Registered before the first request can possibly be made, so a 401 on the very first
    // poll after a cold start is handled the same as one an hour in. Replaces rather than
    // stacks (see authToken.ts), so a second init() can't double-fire a refresh.
    setAuthFailureHandler(() => {
      void handleAuthFailure(set, get);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setAuthToken(data.session.access_token);
        set({ status: 'authenticated', mode: 'supabase', email: data.session.user.email ?? null });
      } else {
        set({ status: 'unauthenticated' });
      }
    });

    // Keeps the token current across Supabase's own background refresh, and reacts to a
    // sign-out triggered from another tab.
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setAuthToken(session.access_token);
        set({ status: 'authenticated', mode: 'supabase', email: session.user.email ?? null });
      } else {
        setAuthToken(null);
        set({ status: 'unauthenticated', mode: null, email: null });
      }
    });
  },

  signInWithPassword: async (email, password) => {
    if (!supabase) return { ok: false, error: 'Supabase is not configured.' };
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: error.message };
      setAuthToken(data.session.access_token);
      set({ status: 'authenticated', mode: 'supabase', email: data.session.user.email ?? null });
      return { ok: true };
    } catch {
      // supabase-js throws (rather than returning {error}) on a network-level failure —
      // this is the caller's signal to offer the break-glass local-login path instead of
      // just "wrong password."
      return { ok: false, error: 'Cannot reach Supabase — check your internet connection.', networkError: true };
    }
  },

  signInLocal: async (password) => {
    try {
      const res = await fetch(`${BRIDGE_HTTP_URL}/local-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, error: body.error === 'break_glass_not_configured' ? 'Local login is not set up on this Pi.' : 'Incorrect password.' };
      }
      const { token } = (await res.json()) as { token: string };
      setAuthToken(token);
      set({ status: 'authenticated', mode: 'local', email: null });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Cannot reach the dashboard server.' };
    }
  },

  signOut: async () => {
    refreshInFlight = null;
    if (supabase) await supabase.auth.signOut().catch(() => {});
    setAuthToken(null);
    set({ status: 'unauthenticated', mode: null, email: null });
  },
}));

/**
 * What to do when the bridge rejects our token with a 401 (see `lib/authToken.ts` for the
 * seam, and `lib/bridgeClient.ts`'s `fetchJson` for the caller).
 *
 * Before this existed, nothing listened: `bridgeClient`'s poll loop and WS reconnect timer
 * retried the same dead token indefinitely while this store still reported
 * `status: 'authenticated'`. The office kiosk therefore displayed a normal-looking
 * dashboard whose data had silently stopped updating — the worst possible failure mode for
 * a screen whose entire job is to be trusted at a glance. 4383 such 401s were logged by the
 * live proxy in 24 hours.
 *
 * A browser cannot observe a 401 on a WebSocket upgrade (it surfaces as a generic close
 * 1006), so the HTTP poll is the only reliable detector — which is why this is driven from
 * `fetchJson` and not from `connectLive`.
 */
async function handleAuthFailure(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): Promise<void> {
  const { status, mode } = get();

  // Already signed out — the login screen is showing and a stray in-flight request just
  // landed. Nothing to recover.
  if (status !== 'authenticated') return;

  // A break-glass session is an opaque token issued by server/proxy.mjs with no refresh
  // counterpart anywhere; asking Supabase to refresh it is meaningless. It expiring (12h,
  // or a proxy restart) is exactly this path, and re-entering the local password is the
  // only way back.
  if (mode === 'local') {
    setAuthToken(null);
    set({ status: 'unauthenticated', mode: null, email: null });
    return;
  }

  if (refreshInFlight) return await refreshInFlight;
  if (Date.now() - lastRefreshAttempt < MIN_REFRESH_INTERVAL_MS) return;
  lastRefreshAttempt = Date.now();

  refreshInFlight = (async () => {
    try {
      if (!supabase) return;
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        setAuthToken(null);
        set({ status: 'unauthenticated', mode: null, email: null });
        return;
      }
      // `onAuthStateChange` normally fires for this too, but setting it here means recovery
      // doesn't depend on that listener having been wired — and it's idempotent either way.
      setAuthToken(data.session.access_token);
      set({ status: 'authenticated', mode: 'supabase', email: data.session.user.email ?? null });
    } catch {
      // supabase-js throws rather than returning {error} on a network-level failure. We
      // can't tell "your session is dead" from "Supabase is unreachable" here, and holding
      // a token the bridge already rejected helps nobody: fail closed to the login screen,
      // which also surfaces the break-glass path for exactly this situation.
      setAuthToken(null);
      set({ status: 'unauthenticated', mode: null, email: null });
    } finally {
      refreshInFlight = null;
    }
  })();

  return await refreshInFlight;
}
