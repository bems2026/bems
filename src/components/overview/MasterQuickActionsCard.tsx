import { useMemo } from 'react';
import { SlidersHorizontal, Snowflake, Lightbulb } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { primaryOfClass, devicesOfClass } from '@/lib/siteDevices';
import { useCommandStore, targetKey } from '@/stores/commandStore';
import { controlView } from '@/lib/socketView';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { CardLink } from '@/components/ui/CardLink';

/** How many lighting circuits get a quick-toggle row here. Was `['l1']` — one building's name
 * for "the first lighting circuit", which is what this always meant (the old comment said so:
 * "any one would do"). Now it takes the first by class, so a site whose circuits are called
 * something else still gets a row, and a site with none gets none. FI-016.
 *
 * One rather than seven so this card (and the bottom bento row it is stretched to match, per
 * `.overview-trio` in index.css) reads shorter; the full list is one click away via the header
 * link regardless. */
const QUICK_TOGGLE_COUNT = 1;

/**
 * v4's "Master Quick Actions" — same control path Control (M3) uses: `commandStore.send`,
 * resolved server-side by `shared/commands.mjs`. The ACU row sends an IR command (never a
 * toggle — §0.3 of the spec: IR blasts don't cut power, so "Send ON"/"Send OFF" are two
 * distinct one-shot actions, not two states of one switch).
 *
 * This card's header link is the ONLY route to the Control page anywhere in the Overview bento —
 * the 3D hero card's own "Switch a row"/"Open controls" buttons were removed so there's one
 * place to look for it, not three saying the same thing.
 */
export function MasterQuickActionsCard() {
  const send = useCommandStore((s) => s.send);
  const acu = useDeviceStore((s) => primaryOfClass(s.devices, 'acu_ir'));
  const acuId = acu?.id ?? '';
  const acuReading = useDeviceStore((s) => (acuId ? s.latestReadings[acuId] : undefined));
  const acuPending = useCommandStore((s) => (acuId ? s.pending[targetKey(acuId)] : undefined));
  const acuView = controlView(acuReading, acuPending);
  const acuBusy = acuView.kind === 'pending';
  // Selected raw, then narrowed in a memo — NOT filtered inside the zustand selector. A
  // selector returning a freshly-allocated array on every call fails React 19's
  // `useSyncExternalStore` cache check ("getSnapshot should be cached") and can loop.
  // `LightingMatrixCard` carries the same note; the first draft of this change ignored it.
  const allDevices = useDeviceStore((s) => s.devices);
  const quickToggles = useMemo(() => devicesOfClass(allDevices, 'switch').slice(0, QUICK_TOGGLE_COUNT), [allDevices]);
  const { ask, modalProps } = useConfirm();

  // Gated like Control's own IR sends (`IrCommandCenterCard`) — this is the same command,
  // same unverifiable-blaster risk, just reachable from a second surface.
  const askSend = (action: 'on' | 'off') =>
    ask(
      {
        title: `Send AC ${action === 'on' ? 'ON' : 'OFF'}?`,
        body: `This sends a single IR ${action} command to ${acu?.display_name ?? 'the aircon'}. Nothing reads the blaster back, so there is no way to confirm it was received — only that this app sent it.`,
        confirmLabel: `Yes, send ${action.toUpperCase()}`,
        tone: action === 'on' ? 'blue' : 'accent',
      },
      () => { if (acuId) send(acuId, undefined, action); },
    );

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">
          <SlidersHorizontal size={14} className="title-icon" aria-hidden="true" />
          Quick Control
        </h3>
        <CardLink to="control" label="Open the full controls on Control" />
      </div>

      <div className="quick-row">
        <span className="quick-icon-tile" aria-hidden="true">
          <Snowflake size={16} />
        </span>
        <div className="quick-row__body">
          <p className="quick-row__name">{acu?.display_name ?? "Aircon"}</p>
          <p className="quick-row__sub">IR · {acuView.kind === 'unknown' ? 'no reading yet' : `commanded ${acuView.value === 'on' ? 'on' : 'off'}`}</p>
        </div>
        <div className="quick-row__actions">
          <button type="button" className="quick-btn quick-btn--primary" disabled={acuBusy} onClick={() => askSend('on')}>
            Send ON
          </button>
          <button type="button" className="quick-btn" disabled={acuBusy} onClick={() => askSend('off')}>
            Send OFF
          </button>
        </div>
      </div>

      {quickToggles.map((d) => (
        <QuickToggleRow key={d.id} deviceId={d.id} />
      ))}
      <ConfirmModal {...modalProps} />
    </div>
  );
}

function QuickToggleRow({ deviceId }: { deviceId: string }) {
  const device = useDeviceStore((s) => s.devices.find((d) => d.id === deviceId));
  const reading = useDeviceStore((s) => s.latestReadings[deviceId]);
  const pending = useCommandStore((s) => s.pending[targetKey(deviceId)]);
  const send = useCommandStore((s) => s.send);
  const view = controlView(reading, pending);

  const busy = view.kind === 'pending';
  const unknown = view.kind === 'unknown';
  const on = !unknown && view.value === 'on';

  return (
    <div className="quick-row">
      <span className="quick-icon-tile" aria-hidden="true">
        <Lightbulb size={16} />
      </span>
      <div className="quick-row__body">
        <p className="quick-row__name">{device?.display_name ?? deviceId}</p>
        <p className="quick-row__sub">{unknown ? 'no reading yet' : busy ? 'switching…' : on ? 'on' : 'off'}</p>
      </div>
      <button
        type="button"
        className={`quick-toggle${on ? ' quick-toggle--on' : ''}`}
        role="switch"
        aria-checked={on}
        aria-label={device?.display_name ?? deviceId}
        disabled={busy || unknown}
        onClick={() => send(deviceId, undefined, on ? 'off' : 'on')}
      >
        <span className="quick-toggle__knob" />
      </button>
    </div>
  );
}
