import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleUserRound, FileText, LogOut, WifiOff } from 'lucide-react';
import { ACCOUNT_ITEMS } from './navItems';
import { useAuthStore } from '@/stores/authStore';
import { useAnchoredPopover } from '@/components/ui/useAnchoredPopover';

/**
 * The account menu in the nav's right-hand cluster, beside the alerts bell.
 *
 * Holds the things that are about the *operator* rather than about the building: who is
 * signed in, the Reports page, and signing out. Reports moved in here from the tab bar
 * because the five tabs are the building's live operational views and a monthly report is a
 * different job — see `navItems.ts`.
 *
 * TWO PROPERTIES THAT ARE NOT COSMETIC:
 *
 * 1. **The LOCAL badge stays outside the menu.** A break-glass session is LAN-only and
 *    cannot issue commands (`server/breakGlass.mjs`, `authStore.ts`). Hiding that behind a
 *    click would let a degraded session read as an ordinary one at a glance, which is
 *    exactly what the session code insists must never happen. It is rendered next to the
 *    trigger, not inside the panel.
 *
 * 2. **The menu renders with or without a session.** Reports is no longer in the tab bar, so
 *    a menu that disappeared when `supabase` is unconfigured would make the page unreachable
 *    from the UI altogether. Without a session it simply offers no sign-out.
 *
 * The email is shown INSIDE the panel, having previously been title-attribute-only on the
 * open nav. That is a deliberate relaxation, not an oversight: the original reasoning was
 * that this nav sits on a screen in a shared office and shouldn't print who is logged in to
 * anyone walking past. Behind a click that reasoning no longer applies — the panel is opened
 * on purpose, by someone already at the machine.
 */
export function AccountMenu({ activeId }: { activeId: string }) {
  const mode = useAuthStore((s) => s.mode);
  const email = useAuthStore((s) => s.email);
  const signOut = useAuthStore((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const dismiss = useCallback(() => setOpen(false), []);
  // Same dismissal contract as AlertsPopover — now literally the same code, through
  // `useAnchoredPopover`, rather than a second copy of it. That hook also keeps the menu inside
  // the viewport: `min-width: 208px` with a long email in `.account-menu__who` could grow it
  // past the left edge of a narrow screen, and `right: 0` is measured from the trigger's own
  // wrapper rather than from the window. Escape still returns focus to the trigger.
  const { anchorRef, popRef, style } = useAnchoredPopover({ open, onDismiss: dismiss, preferredWidth: 208, align: 'end', fallbackHeight: 240 });

  const signedIn = mode !== null;
  const onAccountPage = ACCOUNT_ITEMS.some((item) => item.id === activeId);

  return (
    <span className="nav-account">
      {mode === 'local' && (
        <span className="nav-session__label nav-session__label--local" title="Local session — LAN only, remote access unavailable">
          <WifiOff size={12} aria-hidden="true" />
          LOCAL
        </span>
      )}
      <div style={{ position: 'relative' }}>
        <button
          ref={anchorRef as React.RefObject<HTMLButtonElement>}
          type="button"
          className={`nav-icon-btn${onAccountPage ? ' nav-icon-btn--current' : ''}`}
          aria-label="Account"
          aria-haspopup="menu"
          aria-expanded={open}
          // Reports has no tab any more, so without this nothing on screen says which page
          // you are on while you are looking at it.
          aria-current={onAccountPage ? 'page' : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <CircleUserRound size={16} aria-hidden="true" />
        </button>

        {open &&
          createPortal(
          <div ref={popRef as React.RefObject<HTMLDivElement>} className="account-menu" role="menu" aria-label="Account" style={style}>
            {signedIn && (
              <div className="account-menu__who">
                {mode === 'local' ? (
                  <>
                    <span className="account-menu__mode">Local session</span>
                    <span className="account-menu__note">LAN only — cannot issue commands</span>
                  </>
                ) : (
                  <>
                    <span className="account-menu__mode">Signed in</span>
                    <span className="account-menu__note">{email ?? 'account'}</span>
                  </>
                )}
              </div>
            )}

            {ACCOUNT_ITEMS.map((item) => (
              <a
                key={item.id}
                role="menuitem"
                href={`#${item.id}`}
                className={`account-menu__item${item.id === activeId ? ' account-menu__item--active' : ''}`}
                aria-current={item.id === activeId ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                <FileText size={14} aria-hidden="true" />
                {item.label}
              </a>
            ))}

            {signedIn && (
              <button
                type="button"
                role="menuitem"
                className="account-menu__item account-menu__item--danger"
                onClick={() => {
                  setOpen(false);
                  signOut();
                }}
              >
                <LogOut size={14} aria-hidden="true" />
                Sign out
              </button>
            )}
          </div>,
            document.body,
          )}
      </div>
    </span>
  );
}
