import { useState, useMemo } from 'react';
import { Power, PowerOff, Snowflake } from 'lucide-react';
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
import { localIrSource } from '@shared/acState.mjs';
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
  const localProtocol = useCapabilitiesStore((s) => s.acuLocalIrProtocol);
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
  const path = dispatchPathFor(draft, { cloud: cloudRoute, verified: localVerified, protocol: localProtocol });
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
  /** The chip's tone follows the page's one state rule (see `PlanLegend`): green only for on, amber
   * for the two states that warn — an old reading, a command in flight — and neutral otherwise. */
  const statusText = unknown ? 'no reading yet' : stale ? 'stale' : busy ? 'switching…' : on ? 'on' : 'off';
  const statusTone = unknown ? '' : stale || busy ? ' badge--warn' : on ? ' badge--good' : '';

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
      ? 'generated' in path
        ? 'Sent over the LAN by the IR hub, as a frame built from the remote\'s own protocol.'
        : 'Sent over the LAN by the IR hub.'
      : localIrSource({ power: 'on', ...draft }, { protocol: localProtocol }) !== null
        ? 'Sent through the vendor cloud first — local IR is not yet verified on this unit; the LAN is the fallback.'
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
          <span className={`badge control-ir-status${statusTone}`} title="The last state this system sent. An IR aircon cannot report its own.">
            <span className="badge__dot" aria-hidden="true" />
            {statusText}
          </span>
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

        {/* THE NEXT COMMAND, composed here and sent below. Every row carries a visible label now:
            Mode and Fan had only an aria-label, so a sighted operator saw two unlabelled pill rows
            beside a labelled setpoint. The visible labels are aria-hidden because each control
            already carries the same word as its accessible name. */}
        <div className="control-ir-state">
          <div className="control-ir-field">
            <span className="metric-label" aria-hidden="true">MODE</span>
            <PillGroup label="Mode" options={AC_MODE_OPTIONS} value={draft.mode} disabled={busy} onChange={(mode) => update({ mode })} />
          </div>

          <div className="control-ir-field-row">
            <div className="control-ir-setpoint">
              <label className="metric-label" htmlFor="acu-setpoint">
                SETPOINT
              </label>
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
            </div>
            {/* A real switch, like every other on/off on this page. It was a pill whose label
                flipped between "Swing on" and "Swing off" and whose fill inverted — which is the
                classic ambiguous toggle: nobody can tell whether the words are the state or what a
                click will do. The track answers that the same way the lighting switches do. */}
            <div className="control-ir-swing">
              <span className="metric-label" aria-hidden="true">SWING</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.swing}
                aria-label="Swing"
                className={`quick-toggle${draft.swing ? ' quick-toggle--on' : ''}`}
                disabled={busy}
                onClick={() => update({ swing: !draft.swing })}
              >
                <span className="quick-toggle__knob" />
              </button>
            </div>
          </div>
          {/* Below the building's room-comfort policy. Said here rather than refused: the number
              is about the room, and somebody who needs 18 °C for an hour is entitled to ask. */}
          {policyNote && (
            <p className="control-ir-setpoint__policy" role="status">
              {policyNote}
            </p>
          )}

          <div className="control-ir-field">
            <span className="metric-label" aria-hidden="true">FAN</span>
            <PillGroup label="Fan" options={AC_FAN_OPTIONS} value={draft.fan} disabled={busy} onChange={(fan) => update({ fan })} />
          </div>
        </div>

        <p className={`control-ir-unit__path${blocked ? ' control-ir-unit__path--blocked' : ''}`} role="status">
          {pathText}
        </p>

        {/* The card's one primary action, full width with its OFF beside it at the same size. They
            were 10.5px quick-row buttons, the smallest type on the card for the two commands that
            drive a compressor. Blue is "press this", not "on": the state colours stay on states. */}
        <div className="control-ir-unit__actions">
          <button type="button" className="quick-btn quick-btn--primary control-ir-send" disabled={busy || blocked !== null} onClick={() => askDispatch('on')}>
            <Power size={15} aria-hidden="true" />
            Send ON at {draft.setpoint_c}°C
          </button>
          <button type="button" className="quick-btn control-ir-send" disabled={busy} onClick={() => askDispatch('off')}>
            <PowerOff size={15} aria-hidden="true" />
            Send OFF
          </button>
        </div>
        <p className="control-ir-unit__last">{lastIr ? `${lastIr.text} · ${lastIr.time}` : 'No commands sent this session'}</p>
      </div>
      <ConfirmModal {...modalProps} />
    </div>
  );
}
