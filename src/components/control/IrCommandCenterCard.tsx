import { Snowflake } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore, targetKey } from '@/stores/commandStore';
import { controlView } from '@/lib/socketView';
import { isReadingStale } from '@/lib/staleness';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { InfoHint } from '@/components/ui/InfoHint';
import { SimulatedBadge } from './SimulatedBadge';
import { useControlLog } from './controlLog';

const ACU_ID = 'acu_main';

/**
 * The one real air conditioner in the registry — v4's mockup shows two (CARE + AREC), but
 * the registry only has `acu_main`; `mtr_arec_acu` is a branch *meter* for the ACU circuit,
 * not a second IR-commandable unit (see the Phase M plan's data-model table). Send-only,
 * never a toggle: an IR blast is a one-shot command, and the compressor is never power-cut
 * from here (§0.3 of the design's own spec).
 */
export function IrCommandCenterCard({ simulated = false }: { simulated?: boolean }) {
  const device = useDeviceStore((s) => s.devices.find((d) => d.id === ACU_ID));
  const reading = useDeviceStore((s) => s.latestReadings[ACU_ID]);
  const pending = useCommandStore((s) => s.pending[targetKey(ACU_ID)]);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const lastIr = useControlLog((s) => s.entries.find((e) => e.tag === 'IR'));
  const { ask, modalProps } = useConfirm();

  const view = controlView(reading, pending);
  const busy = view.kind === 'pending';
  const unknown = view.kind === 'unknown';
  // Doesn't gate the send buttons below, unlike the relay controls — an IR blast has no
  // confirmation path either way (see this card's own header), so staleness here means
  // "the last-known mode/room-temp readout may be out of date," not "sending would
  // silently fail," the way it does for a relay whose feed just went quiet.
  const stale = isReadingStale(reading);
  const on = !unknown && view.value === 'on';

  const dispatch = (action: 'on' | 'off') => {
    send(ACU_ID, undefined, action);
    log('IR', `${device?.display_name ?? 'CARE ACU'} → ${action}`);
  };

  // Gated despite being a single device: an IR blast is the one command in this app with
  // no readback path at all (nothing confirms the blaster was received), driving a
  // compressor — the same risk profile a 7-device fan-out gets, just concentrated on one
  // unverifiable send.
  const askDispatch = (action: 'on' | 'off') =>
    ask(
      {
        title: `Send AC ${action === 'on' ? 'ON' : 'OFF'}?`,
        body: `This sends a single IR ${action} command to the CARE ACU. Nothing reads the blaster back, so there is no way to confirm it was received — only that this app sent it.`,
        confirmLabel: `Yes, send ${action.toUpperCase()}`,
        tone: action === 'on' ? 'blue' : 'accent',
      },
      () => dispatch(action),
    );

  return (
    <div className="card control-ir-card">
      <h3 className="control-ir-card__title">
        <Snowflake size={14} className="title-icon" aria-hidden="true" />
        IR HVAC
        <InfoHint label="How IR commands work">Commands are emitted by the IR blaster. Power is never cut — the compressor stays protected.</InfoHint>
        {simulated && <SimulatedBadge />}
      </h3>

      <div className="control-ir-unit">
        <div className="control-ir-unit__head">
          <div>
            <b className="control-ir-unit__name">CARE ACU</b>
            <div className="control-ir-unit__meta">{device?.id ?? ACU_ID}</div>
          </div>
          <span className={`badge${on ? ' badge--good' : ''}`}>{unknown ? 'no reading yet' : stale ? 'stale' : busy ? 'switching…' : on ? 'on' : 'off'}</span>
        </div>

        <div className="control-ir-unit__readouts" style={stale ? { opacity: 0.6 } : undefined}>
          <div>
            <div className="metric-label">ROOM NOW</div>
            <div className="control-ir-unit__temp">{typeof reading?.room_temp_c === 'number' ? `${reading.room_temp_c.toFixed(1)}°C` : '—'}</div>
          </div>
          <div>
            <div className="metric-label">LAST SETPOINT</div>
            <div className="control-ir-unit__temp">{typeof reading?.setpoint_c === 'number' ? `${reading.setpoint_c.toFixed(0)}°` : '—'}</div>
          </div>
        </div>

        <div className="control-ir-unit__actions">
          <button type="button" className="quick-btn quick-btn--primary" disabled={busy} onClick={() => askDispatch('on')}>
            Send ON command
          </button>
          <button type="button" className="quick-btn" disabled={busy} onClick={() => askDispatch('off')}>
            Send OFF command
          </button>
        </div>
        <p className="control-ir-unit__last">{lastIr ? `${lastIr.text} · ${lastIr.time}` : 'No commands sent this session'}</p>
      </div>
      <ConfirmModal {...modalProps} />
    </div>
  );
}
