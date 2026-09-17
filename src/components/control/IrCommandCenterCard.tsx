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
import { PillGroup } from '@/components/ui/PillGroup';
import { SimulatedBadge } from './SimulatedBadge';
import { useControlLog } from './controlLog';
import { formatWithUnit } from '@/lib/format';
import { siteTimeShort } from '@/lib/siteTime';
import { setpointOptions, seedSetpoint, setpointWarning } from './setpointOptions';
import { AC_MODE_OPTIONS, AC_FAN_OPTIONS, seedDraft, draftSummary, commandedSummary, dispatchPathFor, type AcDraft } from './acControl';
import { localIrKey } from '@shared/acState.mjs';
import { useCapabilitiesStore } from '@/stores/capabilitiesStore';
import { SITE } from '@shared/registry.mjs';
import { roomTargetFloorC } from '@shared/sitePolicy.mjs';

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
 * policy at all". Only the first should fall back to the build.
 *
 * Since RM-068 this number does NOT narrow the selector — it is the coldest ROOM TEMPERATURE the
 * building permits an automatic rule to aim for, and a manual setpoint below it is warned about
 * rather than refused. It is read here only to write that warning.
 */
function useRoomTargetFloor(): number | null | undefined {
  const live = useCapabilitiesStore((s) => s.acuMinRoomTargetC);
  const source = useCapabilitiesStore((s) => s.policySource);
  return source === null ? roomTargetFloorC(SITE.policy) : live;
}

/**
 * The site's IR-commandable air conditioner. Send-only, never a toggle: an IR blast is a one-shot
 * command, and the compressor is never power-cut from here.
 *
 * ONE ABSOLUTE STATE PER COMMAND — 2026-09-17. The IR hub was re-paired with a vendor remote that can
 * express mode, fan and swing, and an IR frame always carries all of them together. So the controls
 * compose a whole state and Send sends it; nothing here sends "fan high" on its own. What the server
 * does with it is `shared/acState.mjs` and `dispatchAircon`, and where it will go is said below the
 * controls BEFORE Send — including when it cannot go anywhere, which disables the button with the
 * reason rather than letting it fail after somebody has walked to the unit.
 *
 * TWO KINDS OF NUMBER, KEPT APART. Room temperature and humidity are the hub's own sensors; the "last
 * sent" line is what this system COMMANDED. An IR aircon cannot report its mode, so nothing here
 * presents the command as the unit's state.
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
  const cloudRoute = useCapabilitiesStore((s) => s.acuCloudRoute);
  const localVerified = useCapabilitiesStore((s) => s.acuLocalIrVerified);
  const { ask, modalProps } = useConfirm();
  const roomFloorC = useRoomTargetFloor();

  /** Every whole degree the remote accepts. The comfort policy no longer narrows this (RM-068). */
  const setpoints = useMemo(() => setpointOptions(), []);
  // Seeded once from the last COMMANDED state, so the controls open where the unit was last told to be.
  const [chosen, setChosen] = useState<AcDraft>(() => seedDraft(reading));
  /** Derived rather than corrected in an effect, so there is never a render with a degree the
   * remote cannot take. */
  const draft: AcDraft = { ...chosen, setpoint_c: setpoints.includes(chosen.setpoint_c) ? chosen.setpoint_c : seedSetpoint(chosen.setpoint_c) };
  const update = (patch: Partial<AcDraft>) => setChosen((d) => ({ ...d, ...patch }));

  const policyNote = setpointWarning(draft.setpoint_c, roomFloorC);
  const path = dispatchPathFor(draft, { cloud: cloudRoute, verified: localVerified });
  const blocked = 'blocked' in path ? path.blocked : null;
  const summary = draftSummary(draft);

  const view = controlView(reading, pending);
  const busy = view.kind === 'pending';
  const unknown = view.kind === 'unknown';
  // Doesn't gate Send, unlike the relay controls — an IR blast has no confirmation path either way,
  // so staleness here means "the room readout may be out of date", not "sending would silently fail".
  const stale = isReadingStale(reading);
  const on = !unknown && view.value === 'on';
  const lastSent = commandedSummary(reading);

  /** What to call it on screen. The registry's own display name, never this building's. */
  const name = device?.display_name ?? 'Aircon';

  const dispatch = (action: 'on' | 'off') => {
    if (!acuId) return; // no aircon at this site; the control is not rendered, but the guard is cheap
    if (action === 'on') {
      send(acuId, undefined, 'on', draft.setpoint_c, { mode: draft.mode, fan: draft.fan, swing: draft.swing });
      log('IR', `${name} → on ${summary}`);
    } else {
      send(acuId, undefined, 'off');
      log('IR', `${name} → off`);
    }
  };

  const pathText = blocked
    ? blocked
    : 'via' in path && path.via === 'local'
      ? 'Sent over the LAN by the IR hub.'
      : localIrKey({ power: 'on', ...draft }) !== null
        ? 'Sent through the vendor cloud first — the local IR library is not yet verified on this unit.'
        : 'Sent through the vendor cloud — the local IR library has no code for this state.';

  const askDispatch = (action: 'on' | 'off') =>
    ask(
      {
        title: action === 'on' ? `Send AC on at ${draft.setpoint_c}°C?` : 'Send AC off?',
        body:
          action === 'on'
            ? `This sends ${name} one complete state: ${summary}. It does not cut power to the unit.`
            : `This sends an IR off command to ${name}. It does not cut power to the unit.`,
        confirmLabel: action === 'on' ? `Yes, send ${draft.setpoint_c}°C` : 'Yes, send OFF',
        tone: 'blue',
      },
      () => dispatch(action),
    );

  return (
    <div className="card control-ir-card">
      <h3 className="control-ir-card__title">
        <Snowflake size={14} className="title-icon" aria-hidden="true" />
        IR AIRCON
        <InfoHint label="How aircon commands work">
          Each command is one whole state — mode, setpoint, fan and swing — sent over the LAN by the IR hub, or through the
          vendor cloud when the hub&apos;s code library cannot express it. The unit cannot report its state back, so
          &ldquo;last sent&rdquo; is what was commanded. Power is never cut — the compressor stays protected.
        </InfoHint>
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
            <div className="metric-label">HUMIDITY</div>
            <div className="control-ir-unit__temp">{formatWithUnit(reading?.humidity_pct, '%', 0)}</div>
          </div>
        </div>
        <p className="control-ir-unit__sent">
          <span className="metric-label">LAST SENT</span>{' '}
          {lastSent ?? '—'}
          {reading?.commanded_at && (
            <span className="control-ir-unit__sent-meta">
              {' '}· {siteTimeShort(reading.commanded_at)}{reading.command_via ? ` · via ${reading.command_via}` : ''}
            </span>
          )}
        </p>

        <div className="control-ir-state">
          <PillGroup label="Mode" options={AC_MODE_OPTIONS} value={draft.mode} disabled={busy} onChange={(mode) => update({ mode })} />

          <div className="control-ir-setpoint">
            <label className="metric-label" htmlFor="acu-setpoint">
              SETPOINT
            </label>
            <div className="control-ir-setpoint__row">
              <select
                id="acu-setpoint"
                className="control-ir-setpoint__select"
                value={draft.setpoint_c}
                disabled={busy}
                onChange={(e) => update({ setpoint_c: Number(e.target.value) })}
              >
                {setpoints.map((c) => (
                  <option key={c} value={c}>
                    {c}°C
                  </option>
                ))}
              </select>
              <button
                type="button"
                role="switch"
                aria-checked={draft.swing}
                aria-label="Swing"
                className={`control-ir-swing${draft.swing ? ' control-ir-swing--on' : ''}`}
                disabled={busy}
                onClick={() => update({ swing: !draft.swing })}
              >
                Swing {draft.swing ? 'on' : 'off'}
              </button>
            </div>
            {/* Below the building's room-comfort policy. Said here rather than refused: the number
                is about the room, and somebody who needs 18 °C for an hour is entitled to ask. */}
            {policyNote && (
              <p className="control-ir-setpoint__policy" role="status">
                {policyNote}
              </p>
            )}
          </div>

          <PillGroup label="Fan" options={AC_FAN_OPTIONS} value={draft.fan} disabled={busy} onChange={(fan) => update({ fan })} />
        </div>

        <p className={`control-ir-unit__path${blocked ? ' control-ir-unit__path--blocked' : ''}`} role="status">
          {pathText}
        </p>

        <div className="control-ir-unit__actions">
          <button type="button" className="quick-btn quick-btn--primary" disabled={busy || blocked !== null} onClick={() => askDispatch('on')}>
            Send ON at {draft.setpoint_c}°C
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
