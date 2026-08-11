import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore, targetKey } from '@/stores/commandStore';
import { controlView } from '@/lib/socketView';

/** The two "quick toggle" light circuits shown here — L1 and L2, real commandable devices,
 * not the design's unlabelled sample rows. Any two would do; these are simply the first
 * two of the seven lighting circuits. */
const QUICK_TOGGLE_IDS = ['l1', 'l2'];

/**
 * v4's "Master Quick Actions" — same control path Control (M3) uses: `commandStore.send`,
 * resolved server-side by `shared/commands.mjs`. The ACU row sends an IR command (never a
 * toggle — §0.3 of the spec: IR blasts don't cut power, so "Send ON"/"Send OFF" are two
 * distinct one-shot actions, not two states of one switch).
 */
export function MasterQuickActionsCard() {
  const send = useCommandStore((s) => s.send);
  const acuReading = useDeviceStore((s) => s.latestReadings['acu_main']);
  const acuPending = useCommandStore((s) => s.pending[targetKey('acu_main')]);
  const acuView = controlView(acuReading, acuPending);
  const acuBusy = acuView.kind === 'pending';

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Master Quick Actions</h3>
        <span className="card-sub">Same control path as Control</span>
      </div>

      <div className="quick-row">
        <span className="quick-icon-tile" aria-hidden="true">
          ❄️
        </span>
        <div className="quick-row__body">
          <p className="quick-row__name">CARE ACU</p>
          <p className="quick-row__sub">IR · {acuView.kind === 'unknown' ? 'no reading yet' : `commanded ${acuView.value === 'on' ? 'on' : 'off'}`}</p>
        </div>
        <div className="quick-row__actions">
          <button type="button" className="quick-btn quick-btn--primary" disabled={acuBusy} onClick={() => send('acu_main', undefined, 'on')}>
            Send ON
          </button>
          <button type="button" className="quick-btn" disabled={acuBusy} onClick={() => send('acu_main', undefined, 'off')}>
            Send OFF
          </button>
        </div>
      </div>

      {QUICK_TOGGLE_IDS.map((id) => (
        <QuickToggleRow key={id} deviceId={id} />
      ))}
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
        💡
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
