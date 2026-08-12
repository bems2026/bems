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
 * The one gate every hazardous, fleet-wide action passes through — Control's three master
 * buttons (Lights off / Outlets off / Send AC off), each of which fans out a real command
 * to every device of a class at once. A single accidental click here is a genuinely
 * different mistake from a single accidental click on one socket's toggle, so it gets a
 * confirmation step the per-device controls don't need.
 */
export function ConfirmModal({ open, title, body, confirmLabel, tone = 'accent', onConfirm, onCancel }: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-modal-backdrop" onMouseDown={onCancel}>
      <div
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
