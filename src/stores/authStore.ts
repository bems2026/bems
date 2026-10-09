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
  /**
   * The account service could not be reached the last time it was asked (2026-10-09). Set by a
   * network failure, cleared by any answer from it. The sign-in page leads with the local sign-in
   * while this is true, and a retry resumes the account session when the internet returns.
   */
  accountServiceUnreachable: boolean;
  /**
   * Whether this local sign-in may send commands — the proxy's `BREAK_GLASS_USER_ID` names the
   * account it acts for. `null` outside a local session, or before the proxy has said.
   */
  localControl: boolean | null;
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

/** How often an account session that could not refresh offline is tried again. Offline, the
 * attempt never leaves the building; online, the first one succeeds and the retry stops. */
export const ACCOUNT_RETRY_MS = 60_000;
let accountRetryTimer: ReturnType<typeof setTimeout> | null = null;
let accountRetryDueMs = 0;

/** How long an account sign-in may take before the page treats the service as unreachable. A
 * network that has lost its internet can swallow a connection rather than refuse it, and the
 * sign-in button then spins with no answer at all. */
const SIGN_IN_TIMEOUT_MS = 15_000;

/** Where a local sign-in is kept across a kiosk reload. Expires with the token itself; a proxy
 * restart forgets the token sooner, and the first 401 then clears this too. */
const LOCAL_SESSION_KEY = 'ibems.localSession';

/**
 * Whether an auth error means the account service could not be REACHED, as opposed to having
 * answered no. supabase-js returns a network failure as an `AuthRetryableFetchError` (status 0, or a
 * 502/503/504 from a gateway) and only some paths throw the browser's own `TypeError` — so this
 * checks for both, and for the message when neither shape survived.
 */
export function isNetworkAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (error instanceof TypeError) return true;
  const e = error as { name?: unknown; message?: unknown };
  if (e.name === 'AuthRetryableFetchError') return true;
  return typeof e.message === 'string' && /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(e.message);
}

function saveLocalSession(token: string, expiresInS: number, localControl: boolean | null) {
  try {
    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ token, expiresAtMs: Date.now() + expiresInS * 1000, localControl }));
  } catch {
    // Private mode or storage blocked: the session still works, it just will not survive a reload.
  }
}

function loadLocalSession(): { token: string; localControl: boolean | null } | null {
  try {
    const raw = localStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { token?: unknown; expiresAtMs?: unknown; localControl?: unknown };
    if (typeof stored.token !== 'string' || typeof stored.expiresAtMs !== 'number' || stored.expiresAtMs <= Date.now()) {
      localStorage.removeItem(LOCAL_SESSION_KEY);
      return null;
    }
    return { token: stored.token, localControl: typeof stored.localControl === 'boolean' ? stored.localControl : null };
  } catch {
    return null;
  }
}

function clearLocalSession() {
  try {
    localStorage.removeItem(LOCAL_SESSION_KEY);
  } catch {
    // Nothing stored, or storage blocked — either way there is nothing to clear.
  }
}

type SetAuth = (partial: Partial<AuthState>) => void;

/** Signs in with a local session the kiosk already holds. True when there was one. */
function resumeLocalSession(set: SetAuth): boolean {
  const local = loadLocalSession();
  if (!local) return false;
  setAuthToken(local.token);
  set({ status: 'authenticated', mode: 'local', email: null, localControl: local.localControl });
  return true;
}

function cancelAccountRetry() {
  if (accountRetryTimer) clearTimeout(accountRetryTimer);
  accountRetryTimer = null;
}

/**
 * Tries the account session again in a minute, and keeps trying while the service stays out of
 * reach. When it answers with a session, the kiosk is back on its account — from the sign-in page,
 * or from a local sign-in made meanwhile. When it answers anything else, there is nothing to resume.
 */
function scheduleAccountRetry(set: SetAuth, get: () => AuthState) {
  if (!supabase) return;
  // A timer that should have fired long ago (a suspended tab) is replaced rather than trusted.
  if (accountRetryTimer && Date.now() < accountRetryDueMs + ACCOUNT_RETRY_MS) return;
  cancelAccountRetry();
  accountRetryDueMs = Date.now() + ACCOUNT_RETRY_MS;
  accountRetryTimer = setTimeout(() => {
    accountRetryTimer = null;
    void retryAccountSession(set, get);
  }, ACCOUNT_RETRY_MS);
}

async function retryAccountSession(set: SetAuth, get: () => AuthState) {
  if (!supabase) return;
  const { status, mode } = get();
  if (status === 'authenticated' && mode === 'supabase') {
    set({ accountServiceUnreachable: false });
    return;
  }
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (data?.session) {
      clearLocalSession();
      setAuthToken(data.session.access_token);
      set({ status: 'authenticated', mode: 'supabase', email: data.session.user.email ?? null, accountServiceUnreachable: false, localControl: null });
      return;
    }
    if (isNetworkAuthError(error)) return scheduleAccountRetry(set, get);
    set({ accountServiceUnreachable: false });
  } catch (err) {
    if (isNetworkAuthError(err)) return scheduleAccountRetry(set, get);
    set({ accountServiceUnreachable: false });
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'checking',
  mode: null,
  email: null,
  accountServiceUnreachable: false,
  localControl: null,

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

    supabase.auth.getSession().then(({ data, error }) => {
      if (data.session) {
        setAuthToken(data.session.access_token);
        set({ status: 'authenticated', mode: 'supabase', email: data.session.user.email ?? null });
        return;
      }
      // No account session — but a local sign-in made before the kiosk reloaded still stands.
      if (!resumeLocalSession(set)) set({ status: 'unauthenticated' });
      if (isNetworkAuthError(error)) {
        set({ accountServiceUnreachable: true });
        scheduleAccountRetry(set, get);
      }
    });

    // Keeps the token current across Supabase's own background refresh, and reacts to a
    // sign-out triggered from another tab.
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        cancelAccountRetry();
        clearLocalSession();
        setAuthToken(session.access_token);
        set({ status: 'authenticated', mode: 'supabase', email: session.user.email ?? null, accountServiceUnreachable: false, localControl: null });
      } else if (get().mode !== 'local') {
        // "No account session" says nothing about a local one: the initial event on subscribe
        // reports exactly that, and would otherwise throw out a local sign-in the moment the
        // kiosk reloads.
        setAuthToken(null);
        set({ status: 'unauthenticated', mode: null, email: null });
      }
    });
  },

  signInWithPassword: async (email, password) => {
    if (!supabase) return { ok: false, error: 'No account service is configured for this deployment.' };
    const unreachable = () => {
      set({ accountServiceUnreachable: true });
      scheduleAccountRetry(set, get);
      return {
        ok: false,
        error: 'Cannot reach the account service — the internet connection may be down. Use local sign-in instead.',
        networkError: true,
      };
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), SIGN_IN_TIMEOUT_MS);
      });
      const outcome = await Promise.race([supabase.auth.signInWithPassword({ email, password }), timedOut]);
      if (outcome === 'timeout') return unreachable();
      const { data, error } = outcome;
      // supabase-js RETURNS a network failure rather than throwing it, so the `catch` below never
      // saw one and the page reported "Failed to fetch" with no way forward (2026-10-09).
      if (error) return isNetworkAuthError(error) ? unreachable() : { ok: false, error: error.message };
      cancelAccountRetry();
      clearLocalSession();
      setAuthToken(data.session.access_token);
      set({ status: 'authenticated', mode: 'supabase', email: data.session.user.email ?? null, accountServiceUnreachable: false, localControl: null });
      return { ok: true };
    } catch (err) {
      // Some failures do throw (the browser's own TypeError). Anything else is not a wrong
      // password either, so it gets the same way forward.
      if (isNetworkAuthError(err)) return unreachable();
      return { ok: false, error: 'Sign in failed — try again, or use local sign-in.', networkError: true };
    } finally {
      clearTimeout(timer);
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
        const body = (await res.json().catch(() => ({}))) as { error?: string; retry_after_s?: number };
        if (body.error === 'break_glass_not_configured') return { ok: false, error: 'Local login is not set up on this Pi.' };
        if (body.error === 'too_many_attempts') {
          const minutes = Math.max(1, Math.ceil((body.retry_after_s ?? 600) / 60));
          return { ok: false, error: `Too many wrong passwords — local sign-in is locked for ${minutes} min.` };
        }
        return { ok: false, error: 'Incorrect password.' };
      }
      const body = (await res.json()) as { token: string; expires_in?: number; local_control?: boolean };
      const localControl = typeof body.local_control === 'boolean' ? body.local_control : null;
      saveLocalSession(body.token, body.expires_in ?? 12 * 3600, localControl);
      setAuthToken(body.token);
      set({ status: 'authenticated', mode: 'local', email: null, localControl });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Cannot reach the dashboard server.' };
    }
  },

  signOut: async () => {
    refreshInFlight = null;
    cancelAccountRetry();
    clearLocalSession();
    if (supabase) await supabase.auth.signOut().catch(() => {});
    setAuthToken(null);
    set({ status: 'unauthenticated', mode: null, email: null, localControl: null });
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
async function handleAuthFailure(set: SetAuth, get: () => AuthState): Promise<void> {
  const { status, mode } = get();

  // Already signed out — the login screen is showing and a stray in-flight request just
  // landed. Nothing to recover.
  if (status !== 'authenticated') return;

  // A break-glass session is an opaque token issued by server/proxy.mjs with no refresh
  // counterpart anywhere; asking Supabase to refresh it is meaningless. It expiring (12h,
  // or a proxy restart) is exactly this path, and re-entering the local password is the
  // only way back.
  if (mode === 'local') {
    clearLocalSession();
    setAuthToken(null);
    set({ status: 'unauthenticated', mode: null, email: null, localControl: null });
    return;
  }

  if (refreshInFlight) return await refreshInFlight;
  if (Date.now() - lastRefreshAttempt < MIN_REFRESH_INTERVAL_MS) return;
  lastRefreshAttempt = Date.now();

  // The token the bridge rejected is dead either way. What differs is what comes next: an account
  // service that ANSWERED no means sign in again; one that could not be reached (2026-10-09, the
  // office lost its internet) means the session is probably fine and will resume by itself — and
  // meanwhile a local sign-in the kiosk already holds takes over, rather than a sign-in page.
  const signedOut = (unreachable: boolean) => {
    setAuthToken(null);
    set({ status: 'unauthenticated', mode: null, email: null, accountServiceUnreachable: unreachable });
    if (!unreachable) return;
    resumeLocalSession(set);
    scheduleAccountRetry(set, get);
  };

  refreshInFlight = (async () => {
    try {
      if (!supabase) return;
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        signedOut(isNetworkAuthError(error));
        return;
      }
      // `onAuthStateChange` normally fires for this too, but setting it here means recovery
      // doesn't depend on that listener having been wired — and it's idempotent either way.
      setAuthToken(data.session.access_token);
      set({ status: 'authenticated', mode: 'supabase', email: data.session.user.email ?? null, accountServiceUnreachable: false });
    } catch (err) {
      // Some network failures throw rather than return. Holding a token the bridge already
      // rejected helps nobody, so this fails closed to the sign-in page either way.
      signedOut(isNetworkAuthError(err));
    } finally {
      refreshInFlight = null;
    }
  })();

  return await refreshInFlight;
}
