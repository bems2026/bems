import { LogOut, ShieldAlert, UserRound, WifiOff } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { InfoHint } from '@/components/ui/InfoHint';
import { useAuthStore } from '@/stores/authStore';

/**
 * Who is signed in, and what that session is allowed to do.
 *
 * THE SESSION TYPE IS THE POINT, not the email. This app has two ways in: a real Supabase
 * session, and a break-glass local one issued by `server/proxy.mjs` for when Supabase Auth is
 * unreachable. **A break-glass session is view-only** — `handleCommand` refuses it outright,
 * because there is no real user id to attribute an audit row to. Someone who does not know which
 * kind they hold will read a refused command as a broken system.
 *
 * NO PASSWORD FORM, deliberately. Supabase's own hosted flow already handles a reset by email,
 * and this dashboard runs unattended on a screen in a shared office — a credential field there is
 * a surface with no matching benefit. The capability is not lost; it just does not live on the
 * wall.
 *
 * NO PROFILE FIELDS EITHER. There is no profile table in this schema and no display name to
 * edit: the only identity this system has is the Supabase account. A settings page offering a
 * name field that saved nowhere would be worse than one that says what is actually here.
 */
export function AccountSection() {
  const mode = useAuthStore((s) => s.mode);
  const email = useAuthStore((s) => s.email);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <Card className="settings-card">
      <h2 className="card-title">
        <UserRound size={16} className="title-icon" aria-hidden="true" />
        Account
      </h2>

      {mode === null && (
        <p className="space-plan__note">
          No session. Supabase is not configured for this deployment, so the app is running without sign-in.
        </p>
      )}

      {mode === 'supabase' && (
        <dl className="settings-facts">
          <div className="settings-facts__row">
            <dt>Signed in as</dt>
            <dd>{email ?? 'this account'}</dd>
          </div>
          <div className="settings-facts__row">
            <dt>Session</dt>
            <dd>
              Full access — commands are attributed to this account
              <InfoHint label="What full access means">
                Every command you send is recorded in the audit trail against this account before it reaches any hardware. That
                record is the reason this session type can switch things at all.
              </InfoHint>
            </dd>
          </div>
        </dl>
      )}

      {mode === 'local' && (
        <>
          <p className="settings-warn" role="status">
            <ShieldAlert size={15} aria-hidden="true" />
            <span>
              <strong>Break-glass session — view only.</strong> This sign-in exists for when the account service cannot be reached.
              It can read everything and switch nothing: there is no account to record a command against, and this system will not
              move a relay it cannot attribute. Sign in normally once the connection is back.
            </span>
          </p>
          <dl className="settings-facts">
            <div className="settings-facts__row">
              <dt>Session</dt>
              <dd>
                <WifiOff size={13} aria-hidden="true" /> Local, LAN only
              </dd>
            </div>
          </dl>
        </>
      )}

      {mode !== null && (
        <div className="settings-card__actions">
          <button type="button" className="devices-add-btn" onClick={() => void signOut()}>
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </Card>
  );
}
