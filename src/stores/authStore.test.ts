import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from './authStore';
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
