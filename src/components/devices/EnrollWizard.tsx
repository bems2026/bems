import { useMemo, useState } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCloudFleet } from '@/hooks/useCloudFleet';
import { validateEnrollment, ENROLLABLE_CLASSES } from '@shared/enrollment.mjs';
import { DEVICE_CLASS_CATALOG } from '@/lib/deviceClassCatalog';
import { enrollDevice, type EnrollResult } from '@/lib/enroll';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import type { DeviceClass } from '@/lib/types';

/**
 * Adding a device, from the page instead of the Pi.
 *
 * Validation runs here through the SAME `validateEnrollment` the server calls, so the feedback
 * a person gets while typing is the answer they will get on submit rather than an approximation
 * of it. A form that accepts input the backend then rejects teaches people to ignore it.
 *
 * The flow is preview-then-confirm, and both steps hit the same endpoint with `apply` differing.
 * A separate preview route would be a second code path that could drift from the one that
 * actually writes — and the preview exists precisely to be trusted.
 */
export function EnrollWizard({ onClose }: { onClose: () => void }) {
  const devices = useDeviceStore((s) => s.devices);
  const { byId, status, claimedKnown } = useCloudFleet();
  const { ask, modalProps } = useConfirm();

  const [vendorId, setVendorId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [deviceClass, setDeviceClass] = useState<DeviceClass>('outlet_dual');
  const [displayName, setDisplayName] = useState('');
  const [room, setRoom] = useState('');
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Only devices the flow does not already poll. `claimed` is decided server-side, because
  // only it can read the flow — the browser has no way to know which vendor id backs which
  // registry device.
  const candidates = useMemo(
    () => Object.values(byId).filter((d) => !d.claimed).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [byId],
  );

  const draft = { deviceId, class: deviceClass, displayName, tuyaDeviceId: vendorId ?? '', room };
  const validation = validateEnrollment(draft, { registry: devices }) as { ok: boolean; problems: string[] };
  const canSubmit = Boolean(vendorId) && validation.ok && !busy;

  const submit = async (apply: boolean) => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await enrollDevice({ ...draft, apply }));
    } finally {
      setBusy(false);
    }
  };

  const askApply = () =>
    ask(
      {
        title: `Enrol ${displayName}?`,
        body: 'This writes the device into the registry and adds its nodes to the live Node-RED flow. Both are reversible, but the flow write restarts the affected nodes.',
        confirmLabel: 'Enrol',
        tone: 'blue',
      },
      () => void submit(true),
    );

  if (status === 'unconfigured') {
    return (
      <div className="card enroll-wizard">
        <h3 className="card-title">Add device</h3>
        <p className="enroll-wizard__note">
          Enrolment needs the vendor cloud, which is not configured on this deployment — the local key
          has to come from somewhere. Devices can still be added from the Pi with{' '}
          <code>npm run enroll:pi</code>.
        </p>
        <button type="button" className="enroll-wizard__cancel" onClick={onClose}>Close</button>
      </div>
    );
  }

  return (
    <div className="card enroll-wizard">
      <div className="card-head">
        <h3 className="card-title">Add device</h3>
        <button type="button" className="enroll-wizard__cancel" onClick={onClose}>Cancel</button>
      </div>

      <label className="enroll-wizard__field">
        <span>Vendor device</span>
        <select value={vendorId ?? ''} onChange={(e) => setVendorId(e.target.value || null)}>
          <option value="">Choose a device…</option>
          {candidates.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name ?? d.id} {d.online ? '· online' : '· offline'}
            </option>
          ))}
        </select>
        <small>
          {/* An unknown claimed set is stated, never implied. With the flow unreadable every
              device looks unenrolled, so a confident count here would be a fabrication —
              enrolment's own validation still refuses a duplicate, which is what makes
              proceeding safe rather than merely permitted. */}
          {!claimedKnown
            ? `Which devices are already enrolled could not be checked — the flow was unreadable, so this list may include devices that already have a node. Enrolling a duplicate is still refused.`
            : candidates.length === 0
              ? 'Every device in the cloud project is already enrolled.'
              : `${candidates.length} device(s) in the cloud project are not yet enrolled. Offline ones can still be added — offline now is not offline forever.`}
        </small>
      </label>

      <div className="enroll-wizard__row">
        <label className="enroll-wizard__field">
          <span>Device id</span>
          <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="co8" autoComplete="off" />
          <small>Lowercase, used as the storage key. It cannot be changed later without losing this device&apos;s history.</small>
        </label>

        <label className="enroll-wizard__field">
          <span>Class</span>
          <select value={deviceClass} onChange={(e) => setDeviceClass(e.target.value as DeviceClass)}>
            {(ENROLLABLE_CLASSES as DeviceClass[]).map((c) => (
              <option key={c} value={c}>{DEVICE_CLASS_CATALOG[c].label}</option>
            ))}
          </select>
          <small>Meters and the aircon are enrolled deliberately, not here — their wiring is an electrical decision.</small>
        </label>
      </div>

      <div className="enroll-wizard__row">
        <label className="enroll-wizard__field">
          <span>Display name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Outlet 8" />
        </label>
        <label className="enroll-wizard__field">
          <span>Room <em>(optional)</em></span>
          <input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Lab" />
        </label>
      </div>

      {/* Shown only once something has been typed, so an untouched form is not a wall of red. */}
      {(deviceId || displayName) && !validation.ok && (
        <ul className="enroll-wizard__problems">
          {validation.problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <div className="enroll-wizard__actions">
        <button type="button" className="enroll-wizard__preview" disabled={!canSubmit} onClick={() => void submit(false)}>
          {busy ? 'Checking…' : 'Preview'}
        </button>
        <button
          type="button"
          className="enroll-wizard__apply"
          // Only enabled after a preview has actually succeeded. Enrolling without seeing what
          // it would do is the thing this whole panel exists to avoid.
          disabled={!canSubmit || result?.stage !== 'dry-run'}
          onClick={askApply}
        >
          Enrol
        </button>
      </div>

      {result && <EnrollResultView result={result} />}
      <ConfirmModal {...modalProps} />
    </div>
  );
}

function EnrollResultView({ result }: { result: EnrollResult }) {
  if (!result.ok) {
    return (
      <div className="enroll-wizard__result enroll-wizard__result--bad" role="alert">
        <strong>Refused at the {result.stage} step</strong>
        <ul>{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      </div>
    );
  }
  const s = result.summary;
  return (
    <div className="enroll-wizard__result" role="status">
      <strong>{result.stage === 'applied' ? 'Enrolled.' : 'Preview — nothing written yet.'}</strong>
      {s && (
        <dl className="enroll-wizard__summary">
          <div><dt>Vendor device</dt><dd>{s.vendorName ?? '—'} {s.vendorOnline ? '· online' : '· offline'}</dd></div>
          <div><dt>Protocol</dt><dd>v{s.tuyaVersion} <em>(as the device announces it)</em></dd></div>
          {/* Length, never the value. */}
          <div><dt>Local key</dt><dd>present, {s.localKeyLength} chars</dd></div>
          <div><dt>Registry entry</dt><dd>{s.deviceId} · {s.deviceClass} · ctx {s.ctx ?? '—'}</dd></div>
          <div><dt>Flow nodes</dt><dd>{s.nodesBefore} → {s.nodesAfter}</dd></div>
        </dl>
      )}
      {result.stage === 'applied' && (
        <p className="enroll-wizard__note">
          The device is in the registry and the flow. It will not appear in charts until the bridge tab is
          regenerated on the Pi — <code>npm run build:flow &amp;&amp; npm run deploy:pi</code> — and{' '}
          <code>shared/registry.enrolled.mjs</code> is committed.
        </p>
      )}
    </div>
  );
}
