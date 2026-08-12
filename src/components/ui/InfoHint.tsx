import { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/**
 * The ⓘ popover Phase O moves long provenance text behind — "commanded, not measured",
 * "session-only, POST /api/command", derivation notes, all the sentences that made cards
 * unscannable at their old length. The fact never disappears; it moves from always-visible
 * body text to a click-to-reveal popover, same dismiss pattern as `AlertsPopover`
 * (`mousedown` outside + `Escape`), not a second one invented for this.
 *
 * Deliberately non-modal and portal-free: this mounts ~20 times across the app, so it has
 * to be cheap. No focus trap — `ConfirmModal`'s is for a modal blocking an irreversible
 * action; this is a footnote.
 */
export function InfoHint({ label = 'More info', children }: { label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="info-hint" ref={ref}>
      <button type="button" className="info-hint__btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Info size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="info-hint__pop" role="tooltip">
          {children}
        </div>
      )}
    </span>
  );
}
