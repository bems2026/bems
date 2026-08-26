import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { AuditBacklogNote } from './AuditBacklogNote';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';

const setPending = (auditBufferPending: number | null) =>
  useCapabilitiesStore.setState({ auditBufferPending });

beforeEach(() => setPending(null));

describe('AuditBacklogNote', () => {
  it('says how far behind the audit trail is', () => {
    setPending(3);
    const { container } = render(<AuditBacklogNote />);
    expect(container.textContent).toContain('3 commands recorded locally');
  });

  it('counts one command in the singular', () => {
    // Small, but "1 commands" is the kind of thing that makes an operator distrust the rest of
    // the sentence at the exact moment they are being asked to believe an unusual claim.
    setPending(1);
    const { container } = render(<AuditBacklogNote />);
    expect(container.textContent).toContain('1 command recorded locally');
    expect(container.textContent).not.toContain('1 commands');
  });

  it('stays silent when nothing is buffered', () => {
    setPending(0);
    const { container } = render(<AuditBacklogNote />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('stays silent when the proxy never reported the field', () => {
    // An older proxy answers `undefined`, which the store keeps as null. Rendering "0 pending"
    // from that would be inventing an all-clear out of an absent answer — the same distinction
    // dispatchClasses already draws between "told nothing" and "told nothing dispatches".
    setPending(null);
    const { container } = render(<AuditBacklogNote />);
    expect(container.querySelector('p')).toBeNull();
  });
});
