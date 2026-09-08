import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface OverlayPanelProps {
  /** Rendered as the panel's `h2` and used as the dialog's accessible name. */
  title: ReactNode;
  onClose: () => void;
  /**
   * Chrome pinned between the heading and the scrolling body — a tablist, a filter row. It sits
   * OUTSIDE `__body` on purpose: `__body` is the scroll container, so anything rendered inside it
   * scrolls away, and a set of tabs that scrolls out of reach is the one piece of chrome that
   * must not.
   */
  toolbar?: ReactNode;
  /** Extra classes on the panel surface — callers use this to set their own width. */
  className?: string;
  children: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';

/**
 * A nested modal owns the keyboard for as long as it is up — Escape belongs to it, and it runs
 * its own focus trap, so this panel must not run a second wider one around it.
 *
 * READ FROM THE DOM RATHER THAN DECLARED BY A PROP. This started as a `blockEscape` prop every
 * caller had to remember to pass, which is a rule three components re-implemented and a fourth
 * (`DevicePanel`) would have had to plumb up through three children to satisfy. The panel can
 * simply see the dialog: `ConfirmModal` renders in normal flow inside `children`, so it is a
 * descendant. It also cannot fall out of sync the way a prop can, because it is evaluated at
 * keypress time rather than at render time.
 */
const hasNestedDialog = (panel: HTMLElement | null): boolean =>
  panel?.querySelector('[role="alertdialog"], [role="dialog"], [aria-modal="true"]') != null;

/** Real tab stops only. A roving-tabindex tablist parks its inactive tabs at `tabindex="-1"`
 * and a disabled button is not focusable either; counting those put the trap's boundary on an
 * element Tab can never reach. */
const tabStops = (panel: HTMLElement): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.hasAttribute('disabled') && !(el as HTMLInputElement).disabled,
  );

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
 * on open, Tab cycles inside, page scroll locks, focus returns to the trigger on close. When a
 * dialog opens INSIDE it, this panel stands down entirely — see `hasNestedDialog`.
 */
export function OverlayPanel({ title, onClose, toolbar, className, children }: OverlayPanelProps) {
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
    const onKey = (e: KeyboardEvent) => {
      // Checked per keypress, not per render: the nested dialog opens and closes underneath
      // this listener without it needing to be torn down and rebuilt.
      if (hasNestedDialog(panelRef.current)) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = tabStops(panelRef.current);
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
  }, [onClose]);

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
        {toolbar && <div className="overlay-panel__toolbar">{toolbar}</div>}
        <div className="overlay-panel__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
