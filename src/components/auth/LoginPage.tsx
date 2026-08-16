import { useState, type FormEvent } from 'react';
import { LockKeyhole, WifiOff } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useAuthStore } from '@/stores/authStore';

/**
 * Gates the whole app when Supabase is configured (see `App.tsx`) — Phase 5 of the
 * architecture plan. Two paths: the normal Supabase login, and a break-glass local-login
 * that only appears after the normal path visibly fails on a network error (not a wrong
 * password) — so it reads as a fallback for "Supabase is unreachable," not a second
 * equally-weighted login option someone might reach for out of habit.
 */
export function LoginPage() {
  const signInWithPassword = useAuthStore((s) => s.signInWithPassword);
  const signInLocal = useAuthStore((s) => s.signInLocal);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [offerLocal, setOfferLocal] = useState(false);
  const [localMode, setLocalMode] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = localMode ? await signInLocal(password) : await signInWithPassword(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? 'Sign in failed.');
      if (!localMode && 'networkError' in result && result.networkError) setOfferLocal(true);
    }
  };

  return (
    <div className="login-page">
      <Card className="login-page__card">
        <div className="login-page__icon" aria-hidden="true">
          <LockKeyhole size={20} />
        </div>
        <h1 className="login-page__title">iBEMS Dashboard</h1>
        <p className="login-page__sub">
          {localMode ? 'Local session — LAN only, remote access unavailable while Supabase is unreachable.' : 'Sign in to continue.'}
        </p>

        <form onSubmit={handleSubmit} className="login-page__form">
          {!localMode && (
            <label className="login-page__field">
              <span>Email</span>
              <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} />
            </label>
          )}
          <label className="login-page__field">
            <span>Password</span>
            <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} />
          </label>

          {error && (
            <p className="login-page__error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="login-page__submit" disabled={submitting}>
            {submitting ? 'Signing in…' : localMode ? 'Sign in locally' : 'Sign in'}
          </button>
        </form>

        {offerLocal && !localMode && (
          <button
            type="button"
            className="login-page__local-toggle"
            onClick={() => {
              setLocalMode(true);
              setError(null);
            }}
          >
            <WifiOff size={13} aria-hidden="true" />
            Supabase unreachable — try local sign-in instead
          </button>
        )}
        {localMode && (
          <button
            type="button"
            className="login-page__local-toggle"
            onClick={() => {
              setLocalMode(false);
              setError(null);
            }}
          >
            Back to normal sign-in
          </button>
        )}
      </Card>
    </div>
  );
}
