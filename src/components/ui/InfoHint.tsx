import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { useAnchoredPopover } from './useAnchoredPopover';

/** What the popover asks for when the viewport allows it. Matches the old fixed CSS width. */
const PREFERRED_WIDTH = 260;

/**
 * The ⓘ popover Phase O moves long provenance text behind — "commanded, not measured",
 * "session-only, POST /api/command", derivation notes, all the sentences that made cards
 * unscannable at their old length. The fact never disappears; it moves from always-visible
 * body text to a click-to-reveal popover, same dismiss pattern as `AlertsPopover`
 * (`mousedown` outside + `Escape`) — now literally the same, through `useAnchoredPopover`,
 * rather than a second copy of it.
 *
 * Deliberately non-modal: no focus trap — `ConfirmModal`'s is for a modal blocking an
 * irreversible action; this is a footnote.
 *
 * IT IS NO LONGER PORTAL-FREE, and the reason is worth recording. The popover was
 * `position: absolute; left: 0; width: 260px` inside a 24px button, with no awareness of the
 * viewport. Measured 2026-09-01: on a 1265px desktop the weather hint ran **81px past the right
 * edge**; at 375px **four of the five hints on Overview** ran 26–61px off, at a fixed 260px on a
 * 375px screen. A popover exists to be read, and this control appears 24 times across the app.
 *
 * The old docblock said "portal-free ... this mounts ~20 times across the app, so it has to be
 * cheap". That constraint still holds and is still met: only an OPEN hint portals anything, at
 * most one is open at a time, and a closed one renders exactly a button as before.
 */
export function InfoHint({ label = 'More info', children }: { label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const dismiss = useCallback(() => setOpen(false), []);
  const { anchorRef, popRef, style } = useAnchoredPopover({ open, onDismiss: dismiss, preferredWidth: PREFERRED_WIDTH });

  return (
    <span className="info-hint">
      <button
        ref={anchorRef as React.RefObject<HTMLButtonElement>}
        type="button"
        className="info-hint__btn"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div ref={popRef as React.RefObject<HTMLDivElement>} className="info-hint__pop" role="tooltip" style={style}>
            {children}
          </div>,
          document.body,
        )}
    </span>
  );
}
