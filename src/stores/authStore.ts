import { create } from 'zustand';
import { supabase } from '@/config/supabase';
import { BRIDGE_HTTP_URL } from '@/config/bridge';
import { setAuthToken } from '@/lib/authToken';

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

export const useAuthStore = create<AuthState>((set) => ({
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
    if (supabase) await supabase.auth.signOut().catch(() => {});
    setAuthToken(null);
    set({ status: 'unauthenticated', mode: null, email: null });
  },
}));
