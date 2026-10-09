import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore, isNetworkAuthError, ACCOUNT_RETRY_MS } from './authStore';
import { supabase } from '@/config/supabase';
import { getAuthToken, setAuthToken, notifyAuthFailure } from '@/lib/authToken';

vi.mock('@/config/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      refreshSession: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

const auth = supabase!.auth as unknown as {
  getSession: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
  refreshSession: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
};

const session = (accessToken: string) => ({ access_token: accessToken, user: { email: 'ops@care.test' } });

// The refresh guard in authStore is module-level (same shape as capabilitiesStore's retry
// state) and so survives between tests in this file. Rather than reach into it, each test
// starts an hour further along the clock, which puts it unambiguously outside the guard
// window regardless of what the previous test did.
let clock = new Date('2026-08-20T00:00:00Z').getTime();

beforeEach(() => {
  clock += 60 * 60 * 1000;
  vi.useFakeTimers();
  vi.setSystemTime(clock);
  auth.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  auth.refreshSession.mockReset();
  auth.signOut.mockReset().mockResolvedValue({});
  setAuthToken(null);
  useAuthStore.setState({ status: 'checking', mode: null, email: null });
});

afterEach(() => {
  vi.useRealTimers();
});

/** init() registers the auth-failure handler; these tests then fire it the way a real 401
 * from bridgeClient.fetchJson would. */
async function initAsSupabaseSession() {
  auth.getSession.mockResolvedValue({ data: { session: session('old-token') } });
  useAuthStore.getState().init();
  await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
}

describe('auth-failure handling (the kiosk 401 death-loop)', () => {
  it('refreshes the session and keeps the operator signed in when the refresh token is still good', async () => {
    await initAsSupabaseSession();
    auth.refreshSession.mockResolvedValue({ data: { session: session('fresh-token') }, error: null });

    notifyAuthFailure();
    await vi.waitFor(() => expect(getAuthToken()).toBe('fresh-token'));

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('signs out when the refresh token is genuinely dead, so the kiosk shows a login screen instead of a frozen dashboard', async () => {
    await initAsSupabaseSession();
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: 'refresh_token_not_found' } });

    notifyAuthFailure();
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('unauthenticated'));

    expect(getAuthToken()).toBeNull();
    expect(useAuthStore.getState().mode).toBeNull();
  });

  it('signs out when refreshSession throws outright (Supabase unreachable)', async () => {
    await initAsSupabaseSession();
    auth.refreshSession.mockRejectedValue(new TypeError('Failed to fetch'));

    notifyAuthFailure();
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('unauthenticated'));
    expect(getAuthToken()).toBeNull();
  });

  it('collapses a burst of 401s into exactly one refresh — the kiosk fired ~3 per minute against the live proxy', async () => {
    await initAsSupabaseSession();
    let release: (v: unknown) => void = () => {};
    auth.refreshSession.mockReturnValue(new Promise((resolve) => { release = resolve; }));

    notifyAuthFailure();
    notifyAuthFailure();
    notifyAuthFailure();
    release({ data: { session: session('fresh-token') }, error: null });
    await vi.waitFor(() => expect(getAuthToken()).toBe('fresh-token'));

    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('does not immediately re-refresh if a 401 arrives right after a successful refresh, so a still-rejected token cannot become a refresh storm', async () => {
    await initAsSupabaseSession();
    auth.refreshSession.mockResolvedValue({ data: { session: session('fresh-token') }, error: null });

    notifyAuthFailure();
    await vi.waitFor(() => expect(auth.refreshSession).toHaveBeenCalledTimes(1));

    vi.setSystemTime(clock + 1000);
    notifyAuthFailure();
    await Promise.resolve();
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('does refresh again once the guard window has passed — a 401 an hour later is a real event, not part of the same burst', async () => {
    await initAsSupabaseSession();
    auth.refreshSession.mockResolvedValue({ data: { session: session('fresh-token') }, error: null });

    notifyAuthFailure();
    await vi.waitFor(() => expect(auth.refreshSession).toHaveBeenCalledTimes(1));

    vi.setSystemTime(clock + 60 * 60 * 1000);
    auth.refreshSession.mockResolvedValue({ data: { session: session('fresher-token') }, error: null });
    notifyAuthFailure();
    await vi.waitFor(() => expect(getAuthToken()).toBe('fresher-token'));
    expect(auth.refreshSession).toHaveBeenCalledTimes(2);
  });

  it('never attempts a Supabase refresh for a break-glass session — there is no refresh token to use, so it signs out directly', async () => {
    useAuthStore.getState().init();
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('unauthenticated'));

    setAuthToken('local-session-token');
    useAuthStore.setState({ status: 'authenticated', mode: 'local', email: null });

    notifyAuthFailure();
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('unauthenticated'));

    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(getAuthToken()).toBeNull();
  });

  it('ignores a 401 that arrives while already signed out, rather than firing a pointless refresh', async () => {
    useAuthStore.getState().init();
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('unauthenticated'));

    notifyAuthFailure();
    await Promise.resolve();
    expect(auth.refreshSession).not.toHaveBeenCalled();
  });
});

/**
 * 2026-10-09. The office Wi-Fi lost its internet: the kiosk's account session could not refresh, it
 * was signed out, and the sign-in page then answered every attempt with "Failed to fetch" and never
 * offered the local sign-in. supabase-js RETURNS a network failure as `error` (an
 * AuthRetryableFetchError) rather than throwing it, so the `catch` that was meant to notice it never
 * ran. These hold the offline path to what it must do: say what is wrong, offer the local sign-in,
 * keep it across a kiosk reload, and resume the account session by itself when the internet returns.
 */
describe('without internet', () => {
  const networkError = () => Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 });

  beforeEach(() => {
    localStorage.clear();
    (auth as unknown as { signInWithPassword: ReturnType<typeof vi.fn> }).signInWithPassword = vi.fn();
  });

  it('recognises the account service being unreachable however supabase-js reports it', () => {
    expect(isNetworkAuthError(networkError())).toBe(true);
    expect(isNetworkAuthError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkAuthError({ name: 'AuthApiError', status: 400, message: 'Invalid login credentials' })).toBe(false);
    expect(isNetworkAuthError(null)).toBe(false);
  });

  it('a sign-in that cannot reach the account service says so and offers the local sign-in, rather than "Failed to fetch"', async () => {
    const signIn = (auth as unknown as { signInWithPassword: ReturnType<typeof vi.fn> }).signInWithPassword;
    signIn.mockResolvedValue({ data: { session: null, user: null }, error: networkError() });

    const result = await useAuthStore.getState().signInWithPassword('ops@care.test', 'pw');

    expect(result.ok).toBe(false);
    expect(result.networkError).toBe(true);
    expect(result.error).not.toMatch(/failed to fetch/i);
    expect(useAuthStore.getState().accountServiceUnreachable).toBe(true);
  });

  it('a wrong account password is still just a wrong password', async () => {
    const signIn = (auth as unknown as { signInWithPassword: ReturnType<typeof vi.fn> }).signInWithPassword;
    signIn.mockResolvedValue({ data: { session: null, user: null }, error: { name: 'AuthApiError', status: 400, message: 'Invalid login credentials' } });

    const result = await useAuthStore.getState().signInWithPassword('ops@care.test', 'wrong');

    expect(result).toEqual({ ok: false, error: 'Invalid login credentials' });
  });

  it('a local sign-in survives a kiosk reload until it expires, and says whether it may command', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'local-1', expires_in: 43200, mode: 'local', local_control: true }), { status: 200 })));
    const ok = await useAuthStore.getState().signInLocal('pw');
    expect(ok.ok).toBe(true);
    expect(useAuthStore.getState().localControl).toBe(true);

    // The kiosk's browser restarts: a fresh store, no account session to load.
    setAuthToken(null);
    useAuthStore.setState({ status: 'checking', mode: null, email: null, localControl: null });
    useAuthStore.getState().init();
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(useAuthStore.getState().mode).toBe('local');
    expect(getAuthToken()).toBe('local-1');
    expect(useAuthStore.getState().localControl).toBe(true);

    // ...but not past its expiry.
    setAuthToken(null);
    useAuthStore.setState({ status: 'checking', mode: null, email: null });
    vi.setSystemTime(clock + 43200 * 1000 + 1);
    useAuthStore.getState().init();
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('unauthenticated'));
    vi.unstubAllGlobals();
  });

  it('the account service announcing "no session" does not throw out a local sign-in', async () => {
    let listener: (event: string, s: unknown) => void = () => {};
    auth.onAuthStateChange.mockImplementation((cb: typeof listener) => {
      listener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    useAuthStore.getState().init();
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('unauthenticated'));
    setAuthToken('local-2');
    useAuthStore.setState({ status: 'authenticated', mode: 'local', email: null });

    listener('INITIAL_SESSION', null);

    expect(useAuthStore.getState().mode).toBe('local');
    expect(getAuthToken()).toBe('local-2');
  });

  it('too many wrong local passwords says how long to wait, not "Incorrect password"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'too_many_attempts', retry_after_s: 540 }), { status: 429 })));
    const result = await useAuthStore.getState().signInLocal('pw');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too many/i);
    expect(result.error).toMatch(/9 min/);
    vi.unstubAllGlobals();
  });

  it('an account session that cannot refresh offline is not thrown away: it resumes by itself once the internet is back', async () => {
    await initAsSupabaseSession();
    auth.refreshSession.mockResolvedValue({ data: { session: null, user: null }, error: networkError() });

    notifyAuthFailure();
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('unauthenticated'));
    expect(useAuthStore.getState().accountServiceUnreachable).toBe(true);
    expect(auth.signOut).not.toHaveBeenCalled();

    // Still offline at the next try: keeps waiting.
    await vi.advanceTimersByTimeAsync(ACCOUNT_RETRY_MS);
    expect(auth.refreshSession).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().status).toBe('unauthenticated');

    // The internet returns.
    auth.refreshSession.mockResolvedValue({ data: { session: session('after-outage') }, error: null });
    await vi.advanceTimersByTimeAsync(ACCOUNT_RETRY_MS);
    await vi.waitFor(() => expect(useAuthStore.getState().status).toBe('authenticated'));
    expect(useAuthStore.getState().mode).toBe('supabase');
    expect(getAuthToken()).toBe('after-outage');
    expect(useAuthStore.getState().accountServiceUnreachable).toBe(false);
  });

  it('an offline refresh falls back to a local sign-in the kiosk already holds', async () => {
    localStorage.setItem('ibems.localSession', JSON.stringify({ token: 'local-3', expiresAtMs: clock + 3_600_000, localControl: false }));
    await initAsSupabaseSession();
    auth.refreshSession.mockResolvedValue({ data: { session: null, user: null }, error: networkError() });

    notifyAuthFailure();
    await vi.waitFor(() => expect(useAuthStore.getState().mode).toBe('local'));
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(getAuthToken()).toBe('local-3');
  });

  it('stops retrying once the account service answers that there is nothing to resume', async () => {
    await initAsSupabaseSession();
    auth.refreshSession.mockResolvedValue({ data: { session: null, user: null }, error: networkError() });
    notifyAuthFailure();
    await vi.waitFor(() => expect(useAuthStore.getState().accountServiceUnreachable).toBe(true));

    auth.refreshSession.mockResolvedValue({ data: { session: null, user: null }, error: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' } });
    await vi.advanceTimersByTimeAsync(ACCOUNT_RETRY_MS);
    await vi.waitFor(() => expect(useAuthStore.getState().accountServiceUnreachable).toBe(false));
    const calls = auth.refreshSession.mock.calls.length;
    await vi.advanceTimersByTimeAsync(ACCOUNT_RETRY_MS * 3);
    expect(auth.refreshSession.mock.calls.length).toBe(calls);
  });
});
