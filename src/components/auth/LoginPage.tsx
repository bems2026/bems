import { useState, type FormEvent } from 'react';
import { LockKeyhole, WifiOff } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useAuthStore } from '@/stores/authStore';

/**
 * Gates the whole app when Supabase is configured (see `App.tsx`) — Phase 5 of the
 * architecture plan. Two paths: the normal account sign-in, and a local sign-in checked by the
 * Pi itself, for when the account service cannot be reached.
 *
 * THE LOCAL SIGN-IN IS ALWAYS OFFERED (2026-10-09). It used to appear only after an account
 * sign-in visibly failed on a network error, so that it read as a fallback rather than a second
 * login. Then the office Wi-Fi lost its internet, supabase-js reported the failure in a shape the
 * page did not recognise, and the person at the kiosk saw "Failed to fetch" with no way forward. It
 * stays visually secondary — a link, not a second form — but it no longer depends on the page
 * diagnosing the outage correctly. When the store knows the account service is unreachable, the
 * page leads with it and says why.
 */
export function LoginPage() {
  const signInWithPassword = useAuthStore((s) => s.signInWithPassword);
  const signInLocal = useAuthStore((s) => s.signInLocal);
  const accountServiceUnreachable = useAuthStore((s) => s.accountServiceUnreachable);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The person's own choice wins; until they make one, the page follows what the store knows.
  const [choice, setChoice] = useState<'account' | 'local' | null>(null);
  const localMode = choice ? choice === 'local' : accountServiceUnreachable;

  const choose = (next: 'account' | 'local') => {
    setChoice(next);
    setError(null);
    // The account password is not the local one; carrying it across would only fail.
    setPassword('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = localMode ? await signInLocal(password) : await signInWithPassword(email, password);
    setSubmitting(false);
    if (result.ok) return;
    if (!localMode && 'networkError' in result && result.networkError) {
      choose('local');
    }
    setError(result.error ?? 'Sign in failed.');
  };

  return (
    <div className="login-page">
      <Card className="login-page__card">
        <div className="login-page__icon" aria-hidden="true">
          {localMode ? <WifiOff size={20} /> : <LockKeyhole size={20} />}
        </div>
        <h1 className="login-page__title">iBEMS Dashboard</h1>
        <p className="login-page__sub">
          {localMode ? 'Local sign-in — checked by this building’s own Pi, so it works without internet.' : 'Sign in to continue.'}
        </p>

        {accountServiceUnreachable && localMode && (
          <p className="login-page__notice" role="status">
            No internet connection: the account service cannot be reached. Sign in with the local password. The dashboard returns
            to the account by itself once the internet is back.
          </p>
        )}

        <form onSubmit={handleSubmit} className="login-page__form">
          {!localMode && (
            <label className="login-page__field">
              <span>Email</span>
              <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} />
            </label>
          )}
          <label className="login-page__field">
            <span>{localMode ? 'Local password' : 'Password'}</span>
            <input
              type="password"
              required
              autoComplete={localMode ? 'off' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
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

        {localMode ? (
          <button type="button" className="login-page__local-toggle" onClick={() => choose('account')} disabled={submitting}>
            Sign in with an account instead
          </button>
        ) : (
          <button type="button" className="login-page__local-toggle" onClick={() => choose('local')} disabled={submitting}>
            <WifiOff size={13} aria-hidden="true" />
            No internet? Sign in locally
          </button>
        )}
      </Card>
    </div>
  );
}
