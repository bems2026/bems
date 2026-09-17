import { useMemo, useRef, useState } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCloudFleet } from '@/hooks/useCloudFleet';
import { validateEnrollment, ENROLLABLE_CLASSES, classifyVendorDevice } from '@shared/enrollment.mjs';
import { DEVICE_CLASS_CATALOG } from '@/lib/deviceClassCatalog';
import { enrollDevice, type EnrollResult } from '@/lib/enroll';
import { rebindDevice, type RebindResult } from '@/lib/rebind';
import type { CloudDevice } from '@/lib/tuyaFleet';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { OverlayPanel } from '@/components/ui/OverlayPanel';
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
  const { byId, status, claimedKnown, orphanNodes } = useCloudFleet();
  const { ask, modalProps } = useConfirm();

  const [vendorId, setVendorId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [deviceClass, setDeviceClass] = useState<DeviceClass>('outlet_dual');
  const [displayName, setDisplayName] = useState('');
  const [room, setRoom] = useState('');
  const [result, setResult] = useState<EnrollResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Every cloud device, with what it is here and what may be done with it — decided by the same
  // `classifyVendorDevice` the server's rebind checks agree with. `claimed_by` and the orphan list are
  // decided server-side, because only it can read the flow.
  const detected = useMemo(
    () =>
      Object.values(byId)
        .map((d) => ({ d, c: classifyVendorDevice(d, { registry: devices, claimedBy: d.claimed ? (d.claimed_by ?? 'an existing node') : null, orphanNodes: orphanNodes ?? [] }) }))
        .sort((a, b) => a.c.label.localeCompare(b.c.label) || String(a.d.name).localeCompare(String(b.d.name))),
    [byId, devices, orphanNodes],
  );

  // Only devices this form can actually enrol: unclaimed, of a class it offers. Until 2026-09-17 this
  // was every unclaimed device, which offered the IR hub's virtual aircon remote as an outlet.
  const candidates = useMemo(() => detected.filter(({ c }) => c.enrollable).map(({ d }) => d), [detected]);
  const rebind = useRebind();

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
      <OverlayPanel className="enroll-wizard" title="Add device" onClose={onClose}>
        <p className="enroll-wizard__note">
          Enrolment needs the vendor cloud, which is not configured on this deployment — the local key
          has to come from somewhere. Devices can still be added from the Pi with{' '}
          <code>npm run enroll:pi</code>.
        </p>
      </OverlayPanel>
    );
  }

  return (
    <OverlayPanel className="enroll-wizard" title="Add device" onClose={onClose}>
      <DetectedDevices detected={detected} onRebind={(t) => void rebind.run(t, false)} />
      {rebind.state && (
        <RebindPanel state={rebind.state} onApply={() => void rebind.run(rebind.state!.target, true)} onDone={rebind.close} />
      )}

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
    </OverlayPanel>
  );
}

type Classified = { d: CloudDevice; c: ReturnType<typeof classifyVendorDevice> };

const ACTION_LABEL: Record<string, string> = { enroll: 'Can enrol', rebind: 'Rebind available', linked: 'Linked', none: 'Not enrolled here' };

/**
 * Everything in the cloud project, and what each device is to this site. Open by default when a
 * rebind is waiting, because that is the case where somebody arrived here to fix something.
 */
function DetectedDevices({ detected, onRebind }: { detected: Classified[]; onRebind: (t: RebindTarget) => void }) {
  if (detected.length === 0) return null;
  const needsAction = detected.some(({ c }) => c.action === 'rebind');
  return (
    <details className="enroll-wizard__detected" open={needsAction || undefined}>
      <summary>Detected in the cloud project ({detected.length})</summary>
      <ul className="enroll-wizard__detected-list">
        {detected.map(({ d, c }) => (
          <li key={d.id} className="enroll-wizard__detected-row">
            <div className="enroll-wizard__detected-head">
              <span className="enroll-wizard__detected-name">{d.name ?? d.id}</span>
              <span className="enroll-wizard__detected-kind">{c.label}</span>
              <span className={`badge${d.online ? ' badge--good' : ''}`}>{d.online ? 'online' : 'offline'}</span>
              <span className="badge">{ACTION_LABEL[c.action] ?? c.action}</span>
            </div>
            {c.reason && <small className="enroll-wizard__detected-reason">{c.reason}</small>}
            {c.action === 'rebind' && c.rebindNode && (
              <button
                type="button"
                className="enroll-wizard__preview"
                onClick={() => onRebind({ nodeName: c.rebindNode as string, tuyaDeviceId: d.id, vendorName: d.name ?? d.id })}
              >
                Rebind {c.rebindNode} to this device
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Preview, then confirm, then write — the same three steps as enrolment, against `POST /api/rebind`.
 * The preview runs as soon as the panel opens: choosing Rebind is already the request to see it.
 */
type RebindTarget = { nodeName: string; tuyaDeviceId: string; vendorName: string };
type RebindState = { target: RebindTarget; result: RebindResult | null; busy: boolean };

/**
 * The rebind conversation's state, and the one function that talks to the proxy. The preview starts
 * from the click that chose the target — an event, not an effect — so nothing fetches on render.
 * A response for a target that has since been replaced is dropped rather than shown under the new one.
 */
function useRebind() {
  const [state, setState] = useState<RebindState | null>(null);
  const latest = useRef<RebindTarget | null>(null);

  const run = async (target: RebindTarget, apply: boolean) => {
    latest.current = target;
    setState((cur) => ({ target, result: cur?.target === target ? cur.result : null, busy: true }));
    const result = await rebindDevice({ nodeName: target.nodeName, tuyaDeviceId: target.tuyaDeviceId, apply });
    if (latest.current !== target) return;
    setState({ target, result, busy: false });
  };
  const close = () => {
    latest.current = null;
    setState(null);
  };
  return { state, run, close };
}

function RebindPanel({ state, onApply, onDone }: { state: RebindState; onApply: () => void; onDone: () => void }) {
  const { target, result, busy } = state;
  const { ask, modalProps } = useConfirm();
  const s = result?.summary;
  return (
    <section className="enroll-wizard__rebind" aria-label={`Rebind ${target.nodeName}`}>
      <strong>Rebind {target.nodeName} → {target.vendorName}</strong>
      {busy && !result && <p className="enroll-wizard__note">Checking — listening for the device on the network can take up to 12 s…</p>}
      {result && !result.ok && (
        <div className="enroll-wizard__result enroll-wizard__result--bad" role="alert">
          <strong>Refused at the {result.stage} step</strong>
          <ul>{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {result?.ok && s && (
        <div className="enroll-wizard__result" role="status">
          <strong>{result.stage === 'applied' ? 'Rebound.' : 'Preview — nothing written yet.'}</strong>
          <dl className="enroll-wizard__summary">
            <div><dt>Node</dt><dd>{s.nodeName}</dd></div>
            <div><dt>New device</dt><dd>{s.vendorName ?? '—'} · {s.kind} {s.vendorOnline ? '· online' : '· offline'}</dd></div>
            <div><dt>Protocol</dt><dd>v{s.tuyaVersion} <em>(as the device announces it{s.declaredVersion ? `; declared v${s.declaredVersion}` : ''})</em></dd></div>
            {/* Length, never the value. */}
            <div><dt>Local key</dt><dd>present, {s.localKeyLength} chars</dd></div>
          </dl>
          {s.notes.map((n) => <p key={n} className="enroll-wizard__note">{n}</p>)}
        </div>
      )}
      <div className="enroll-wizard__actions">
        <button type="button" className="enroll-wizard__preview" onClick={onDone}>Close</button>
        <button
          type="button"
          className="enroll-wizard__apply"
          disabled={busy || result?.stage !== 'dry-run' || !result.ok}
          onClick={() =>
            ask(
              {
                title: `Rebind ${target.nodeName}?`,
                body: `This writes ${target.vendorName}'s id, local key and protocol version into the "${target.nodeName}" node on the live flow and restarts that node. Its wiring, parsers and history stay.`,
                confirmLabel: 'Yes, rebind',
                tone: 'blue',
              },
              onApply,
            )
          }
        >
          Rebind
        </button>
      </div>
      <ConfirmModal {...modalProps} />
    </section>
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
