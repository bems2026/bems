import { useCallback, useState } from 'react';
import type { ConfirmTone } from './ConfirmModal';

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: ConfirmTone;
}

/**
 * Gates an action behind `ConfirmModal` in two lines instead of hand-rolling open/pending
 * state per call site. Phase N adds a confirmation gate to 5 more places (Control's "All
 * rows/outlets on/off", every ACU IR send, Automation's context write — see the plan's
 * §4 table); each one hand-rolling its own modal state is exactly the kind of copy-paste
 * that drifts — a missed Cancel handler, a modal that doesn't clear itself after firing.
 *
 * Usage: `const { ask, modalProps } = useConfirm();` then
 * `onClick={() => ask({title, body, confirmLabel}, () => actuallyDoIt())}`, and render
 * `<ConfirmModal {...modalProps} />` once per component.
 */
export function useConfirm() {
  const [pending, setPending] = useState<{ options: ConfirmOptions; action: () => void } | null>(null);

  const ask = useCallback((options: ConfirmOptions, action: () => void) => {
    setPending({ options, action });
  }, []);

  const confirm = useCallback(() => {
    pending?.action();
    setPending(null);
  }, [pending]);

  const cancel = useCallback(() => setPending(null), []);

  return {
    ask,
    modalProps: {
      open: pending !== null,
      title: pending?.options.title ?? '',
      body: pending?.options.body ?? '',
      confirmLabel: pending?.options.confirmLabel ?? '',
      tone: pending?.options.tone,
      onConfirm: confirm,
      onCancel: cancel,
    },
  };
}
