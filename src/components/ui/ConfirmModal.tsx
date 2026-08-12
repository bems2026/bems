import { useEffect, useRef } from 'react';

export type ConfirmTone = 'accent' | 'red' | 'blue';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: ConfirmTone;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The gate every hazardous action passes through — Control's three fleet-wide masters,
 * "All rows/outlets on/off", every ACU IR send, and Automation's "Write to Node-RED
 * context" (Phase N §4). Not fleet-wide-only, despite this docblock once saying so: an IR
 * send touches one device, but it's the one command with no readback path at all and it
 * drives a compressor — that risk earns the same gate a 7-device fan-out gets.
 *
 * Real modal hygiene, not just show/hide: focus moves to the confirm button on open, Tab
 * cycles inside the dialog rather than escaping to the page behind it, the page scroll
 * locks while open, and focus returns to whatever triggered the modal once it closes —
 * this component gates 6x the traffic it used to (see `useConfirm.ts`), so gaps here are
 * no longer a single-button edge case.
 */
export function ConfirmModal({ open, title, body, confirmLabel, tone = 'accent', onConfirm, onCancel }: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
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

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-modal-backdrop" onMouseDown={onCancel}>
      <div
        ref={dialogRef}
        className="confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-body"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="confirm-modal__title">
          {title}
        </h2>
        <p id="confirm-modal-body" className="confirm-modal__body">
          {body}
        </p>
        <div className="confirm-modal__actions">
          <button type="button" className="confirm-modal__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={`confirm-modal__confirm confirm-modal__confirm--${tone}`} onClick={onConfirm} ref={confirmRef}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
