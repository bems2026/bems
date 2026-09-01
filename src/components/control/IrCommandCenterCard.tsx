import { useState, useMemo } from 'react';
import { Snowflake } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { primaryOfClass } from '@/lib/siteDevices';
import { useCommandStore, targetKey } from '@/stores/commandStore';
import { controlView } from '@/lib/socketView';
import { isReadingStale } from '@/lib/staleness';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { InfoHint } from '@/components/ui/InfoHint';
import { SimulatedBadge } from './SimulatedBadge';
import { useControlLog } from './controlLog';
import { formatWithUnit } from '@/lib/format';
import { setpointOptions, seedSetpoint } from './setpointOptions';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { SITE } from '@shared/registry.mjs';

/** The site's aircon, found by capability rather than by this building's name for it — FI-016.
 * `null` at a site with no IR-commandable unit, which the card renders as "no aircon" rather
 * than offering a control that would send to nothing. */
const useAcu = () => useDeviceStore((s) => primaryOfClass(s.devices, 'acu_ir'));

/**
 * The floor in force, preferring what the proxy says over what this bundle was built with.
 *
 * RM-038: the floor is a university policy and policies change, so it is editable at runtime and
 * lives in the database. The build value is the fallback for a proxy that predates the field, or
 * one that has not answered yet — the same direction of fallback `server/livePolicy.mjs` uses,
 * and for the same reason.
 *
 * `undefined` from the store means "not answered"; `null` means "answered, and this site has no
 * policy floor". Only the first should fall back to the build.
 */
function useSetpointFloor(): number | null | undefined {
  const live = useCapabilitiesStore((s) => s.acuMinSetpointC);
  const source = useCapabilitiesStore((s) => s.policySource);
  return source === null ? SITE.policy.acu_min_setpoint_c : live;
}

/**
 * The site's IR-commandable air conditioner. v4's mockup shows two, but a branch *meter* on an
 * ACU circuit is not a second commandable unit — only devices of class `acu_ir` are. Send-only,
 * never a toggle: an IR blast is a one-shot command, and the compressor is never power-cut from
 * here (§0.3 of the design's own spec).
 *
 * FI-016: this used to name one building's aircon by id, so at any other site the card would
 * have rendered dashes and sent commands into nothing.
 */
export function IrCommandCenterCard({ simulated = false }: { simulated?: boolean }) {
  const device = useAcu();
  const acuId = device?.id ?? '';
  const reading = useDeviceStore((s) => (acuId ? s.latestReadings[acuId] : undefined));
  const pending = useCommandStore((s) => (acuId ? s.pending[targetKey(acuId)] : undefined));
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const lastIr = useControlLog((s) => s.entries.find((e) => e.tag === 'IR'));
  const { ask, modalProps } = useConfirm();
  // Seeded from the ACU's last known setpoint when there is one, so the control opens showing
  // where the room actually is rather than a fixed guess.
  const floorC = useSetpointFloor();
  /** The degrees this SITE may command: the IR library's range, narrowed by the building's own
   * policy floor. Derived in `setpointOptions.ts`, which is where the reasoning lives and which
   * is tested separately — `validateCommand` refuses the same values server-side, and that is
   * the enforcement; this only stops the selector offering a guaranteed 400. */
  const setpoints = useMemo(() => setpointOptions(floorC), [floorC]);
  const [chosen, setSetpointC] = useState<number>(() => seedSetpoint(reading?.setpoint_c, floorC));

  /**
   * A floor raised while this card is open leaves the selector on a degree that is no longer
   * permitted, and the next send would come back a 400 — which reads as a bug rather than as a
   * policy. So the value in force is DERIVED: if what was chosen is still offered it stands,
   * and otherwise the nearest degree that is.
   *
   * Derived rather than corrected in an effect, so there is no render where the selector shows
   * a value the send would refuse.
   */
  const setpointC = setpoints.includes(chosen) ? chosen : seedSetpoint(chosen, floorC);

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
    if (!acuId) return; // no aircon at this site; the control is not rendered, but the guard is cheap
    send(acuId, undefined, action, action === 'on' ? setpointC : undefined);
    log('IR', `${device?.display_name ?? 'Aircon'} → ${action === 'on' ? `on ${setpointC}°C` : 'off'}`);
  };

  /** What to call it on screen. The registry's own display name, never this building's. */
  const name = device?.display_name ?? 'Aircon';

  const askDispatch = (action: 'on' | 'off') =>
    ask(
      {
        title: action === 'on' ? `Send AC on at ${setpointC}°C?` : 'Send AC off?',
        body:
          action === 'on'
            ? `This emits a single IR command setting ${name} to ${setpointC}°C. It does not cut power to the unit.`
            : `This emits a single IR off command to ${name}. It does not cut power to the unit.`,
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
            <b className="control-ir-unit__name">{name}</b>
            <div className="control-ir-unit__meta">{device?.id ?? '—'}</div>
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
              {setpoints.map((c) => (
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
