import { useState } from 'react';
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
import { formatWithUnit } from '@/lib/format';

const ACU_ID = 'acu_main';

/** Exactly the whole degrees the live flow's IR library holds codes for — anything outside
 * this resolves to no code at all, so offering it would be offering a no-op. Mirrors
 * ACU_MIN_C/ACU_MAX_C in shared/commands.mjs, which rejects the same values server-side. */
const SETPOINTS = Array.from({ length: 15 }, (_, i) => 16 + i);
/** What the retired dashboard switch sent, so an untouched selector behaves as before. */
const DEFAULT_SETPOINT_C = 25;

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
  // Seeded from the ACU's last known setpoint when there is one, so the control opens showing
  // where the room actually is rather than a fixed guess.
  const [setpointC, setSetpointC] = useState<number>(() =>
    typeof reading?.setpoint_c === 'number' && SETPOINTS.includes(Math.round(reading.setpoint_c))
      ? Math.round(reading.setpoint_c)
      : DEFAULT_SETPOINT_C,
  );

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
    send(ACU_ID, undefined, action, action === 'on' ? setpointC : undefined);
    log('IR', `CARE ACU → ${action === 'on' ? `on ${setpointC}°C` : 'off'}`);
  };

  const askDispatch = (action: 'on' | 'off') =>
    ask(
      {
        title: action === 'on' ? `Send AC on at ${setpointC}°C?` : 'Send AC off?',
        body:
          action === 'on'
            ? `This emits a single IR command setting the CARE ACU to ${setpointC}°C. It does not cut power to the unit.`
            : 'This emits a single IR off command to the CARE ACU. It does not cut power to the unit.',
        confirmLabel: action === 'on' ? `Yes, send ${setpointC}°C` : 'Yes, send OFF',
        tone: 'blue',
      },
      () => dispatch(action),
    );

  return (
    <div className="card control-ir-card">
      <h3 className="control-ir-card__title">
        <Snowflake size={14} className="title-icon" aria-hidden="true" />
        IR AIRCON
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
            <div className="control-ir-unit__temp">{formatWithUnit(reading?.room_temp_c, '°C', 1)}</div>
          </div>
          <div>
            <div className="metric-label">LAST SETPOINT</div>
            <div className="control-ir-unit__temp">{formatWithUnit(reading?.setpoint_c, '°', 0)}</div>
          </div>
        </div>

        <div className="control-ir-setpoint">
          <label className="metric-label" htmlFor="acu-setpoint">
            SETPOINT
          </label>
          <div className="control-ir-setpoint__row">
            <select
              id="acu-setpoint"
              className="control-ir-setpoint__select"
              value={setpointC}
              disabled={busy}
              onChange={(e) => setSetpointC(Number(e.target.value))}
            >
              {SETPOINTS.map((c) => (
                <option key={c} value={c}>
                  {c}°C
                </option>
              ))}
            </select>
            <span className="control-ir-setpoint__hint">applies to the next ON command</span>
          </div>
        </div>

        <div className="control-ir-unit__actions">
          <button type="button" className="quick-btn quick-btn--primary" disabled={busy} onClick={() => askDispatch('on')}>
            Send ON at {setpointC}°C
          </button>
          <button type="button" className="quick-btn" disabled={busy} onClick={() => askDispatch('off')}>
            Send OFF
          </button>
        </div>
        <p className="control-ir-unit__last">{lastIr ? `${lastIr.text} · ${lastIr.time}` : 'No commands sent this session'}</p>
      </div>
      <ConfirmModal {...modalProps} />
    </div>
  );
}
