import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface OverlayPanelProps {
  /** Rendered as the panel's `h2` and used as the dialog's accessible name. */
  title: ReactNode;
  onClose: () => void;
  /**
   * Set while a nested dialog (a save `ConfirmModal`) is open. That dialog owns the keyboard
   * for as long as it is up: this panel stands down BOTH its Escape handler and its focus
   * trap, rather than running a second, wider trap around the first.
   *
   * Without it, one Escape dismisses both — the operator loses the confirmation and the form
   * underneath it in a single keypress. `DeviceMetaEditor` carried this guard inline before
   * this primitive existed, and its docblock argued the panel therefore could not be a modal
   * at all. It can; the guard just belongs here, once, instead of in each caller.
   */
  blockEscape?: boolean;
  /** Extra classes on the panel surface — callers use this to set their own width. */
  className?: string;
  children: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A floating, focus-trapped glass panel — the Devices page's Details, Edit, Add and Remove
 * surfaces, which used to render in normal flow ABOVE the fleet table and push it off screen
 * at the moment the operator was acting on a row in it.
 *
 * WHY A PORTAL IS NOT OPTIONAL. `position: fixed` resolves against the nearest ancestor
 * carrying a `transform`, `filter` or `backdrop-filter` rather than against the viewport — and
 * this app's glass surfaces mean that ancestor almost always exists (`.card` blurs its
 * backdrop, and so does `.top-nav`). A fixed panel inside either is positioned against the
 * card, and clipped by its `overflow`. That is EX-143's finding, and `useAnchoredPopover.ts`
 * records the same reasoning for the small anchored popovers.
 *
 * WHY THE SURFACE IS `--pop-bg` AND NOT `--glass`. `--glass` is 75% opaque, and the contrast
 * ratios in this file's token comments were computed against the glass-over-PAGE composite.
 * A panel over a scrim over the page is a third composite nobody has measured, and `--muted-2`
 * sits at 4.9:1 with no margin to spend. `--pop-bg` (96%) is what every other floating panel
 * here already uses, keeps the blur and the lip, and keeps the audited numbers true.
 *
 * Modal hygiene is `ConfirmModal`'s, deliberately identical rather than re-derived: focus in
 * on open, Tab cycles inside, page scroll locks, focus returns to the trigger on close.
 */
export function OverlayPanel({ title, onClose, blockEscape = false, className, children }: OverlayPanelProps) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Mount/unmount only. Scroll lock saves and restores the PREVIOUS value rather than clearing
  // it, so a ConfirmModal opening inside this panel and closing again leaves the lock intact.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (blockEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, blockEscape]);

  return createPortal(
    <div className="overlay-panel-backdrop" data-testid="overlay-panel-backdrop" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className={`overlay-panel${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="overlay-panel__head">
          {/* `tabIndex={-1}` so focus can land here on open without adding a tab stop — the
              same pattern `DeviceMetaEditor` used before, and it keeps the dialog's accessible
              name and its initial focus target the same node. */}
          <h2 id={headingId} className="overlay-panel__title" tabIndex={-1} ref={headingRef}>
            {title}
          </h2>
          <button type="button" className="overlay-panel__close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="overlay-panel__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
