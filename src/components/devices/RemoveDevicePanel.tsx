import { useEffect, useState } from 'react';
import { removeDevice, type RemoveResult } from '@/lib/removeDevice';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import type { Device } from '@/lib/types';

/**
 * Removing a device, from the page instead of the Pi — the mirror of `EnrollWizard`.
 *
 * IT PREVIEWS ON OPEN rather than behind a button. Enrolment asks for five fields first, so a
 * preview there is a deliberate step. Removal has one input — the row you clicked — so there is
 * nothing to fill in and no reason to make someone ask twice. Opening the panel *is* the
 * request to see what would happen, and the destructive step stays behind its own confirm.
 *
 * The panel names the flow nodes that would go, not just how many. A count answers "is this
 * plausible"; the names answer "is this the right device", which is the question that matters
 * when the thing on the other side is real hardware.
 */
export function RemoveDevicePanel({
  device,
  onClose,
  onRemoved,
}: {
  device: Device;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { ask, modalProps } = useConfirm();
  const [result, setResult] = useState<RemoveResult | null>(null);
  // Starts true because the preview below fires on mount — setting it inside the effect would
  // be a synchronous setState in an effect body, i.e. a cascading render. The panel is keyed
  // by device id at the call site, so a different device remounts rather than re-running here.
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let live = true;
    void removeDevice(device.id, false)
      .then((r) => { if (live) setResult(r); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [device.id]);

  const apply = async () => {
    setBusy(true);
    try {
      const r = await removeDevice(device.id, true);
      setResult(r);
      if (r.ok) onRemoved();
    } finally {
      setBusy(false);
    }
  };

  const askApply = () =>
    ask(
      {
        title: `Remove ${device.display_name}?`,
        body:
          'This deletes the registry entry and takes its nodes out of the live Node-RED flow. The readings it already recorded are kept — they are keyed by device id, not by the registry. Re-adding it later means enrolling it again.',
        confirmLabel: 'Remove device',
        tone: 'red',
      },
      () => void apply(),
    );

  const previewed = result?.ok === true && result.stage === 'dry-run';
  const applied = result?.stage === 'applied';

  return (
    <div className="card enroll-wizard">
      <div className="card-head">
        <h3 className="card-title">Remove {device.display_name}</h3>
        <button type="button" className="enroll-wizard__cancel" onClick={onClose}>Close</button>
      </div>

      {busy && !result && <p className="enroll-wizard__note">Checking what this would remove…</p>}

      {result && !result.ok && (
        <div className="enroll-wizard__result enroll-wizard__result--bad" role="alert">
          <strong>Refused at the {result.stage} step</strong>
          <ul>{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      {result?.ok && result.summary && (
        <div className="enroll-wizard__result" role="status">
          <strong>{applied ? 'Removed.' : 'Preview — nothing removed yet.'}</strong>
          <dl className="enroll-wizard__summary">
            <div><dt>Device</dt><dd>{result.summary.deviceId} · {result.summary.deviceClass ?? '—'}</dd></div>
            <div>
              <dt>Flow nodes</dt>
              <dd>{result.summary.nodesBefore} → {result.summary.nodesAfter}</dd>
            </div>
            <div>
              {/* Named, not counted: the names are what confirm it is the right device. */}
              <dt>Would remove</dt>
              <dd>{result.summary.removedNodes.join(', ')}</dd>
            </div>
            <div>
              <dt>History</dt>
              <dd>kept — readings are keyed by device id, so nothing measured is deleted</dd>
            </div>
          </dl>
          {applied && (
            <p className="enroll-wizard__note">
              Gone from the registry and the flow. It will disappear from charts once the bridge tab is
              regenerated on the Pi — <code>npm run build:flow &amp;&amp; npm run deploy:pi</code> — and{' '}
              <code>shared/registry.enrolled.mjs</code> is committed.
            </p>
          )}
        </div>
      )}

      {!applied && (
        <div className="enroll-wizard__actions">
          <button
            type="button"
            className="enroll-wizard__apply enroll-wizard__apply--danger"
            // Only after a preview has succeeded. Removing without seeing what goes is the
            // thing this panel exists to prevent.
            disabled={!previewed || busy}
            onClick={askApply}
          >
            Remove
          </button>
        </div>
      )}

      <ConfirmModal {...modalProps} />
    </div>
  );
}
