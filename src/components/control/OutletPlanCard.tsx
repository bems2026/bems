import { useMemo } from 'react';
import { Plug, Power, PowerOff } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDevicesFor } from '@/hooks/useDevicesFor';
import { useCommandStore } from '@/stores/commandStore';
import { corroborate } from '@/lib/relayCorroboration';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { useRelayState } from '@/hooks/useRelayState';
import { useControlLog } from './controlLog';
import { useControlPlan } from './useControlPlan';
import { PlanRoomPicker } from './PlanRoomPicker';
import { PlanTally } from './PlanTally';
import type { Device, SocketIndex } from '@/lib/types';

/** A module constant so `PlanTally`'s memo holds — see its note. */
const OUTLET_SOCKETS: SocketIndex[] = [1, 2];

export function OutletPlanCard() {
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const { ask, modalProps } = useConfirm();
  // Filtered through `useDevicesFor('control')`, not by class alone. Page membership is a SITE
  // decision recorded in `device_config.functions`, and only ControlPage's master actions used
  // to honour it — so a device an operator had deliberately excluded was left out of the master
  // actions while still getting a clickable puck on the plan, and being switched by this card's
  // own "all on".
  const { included } = useDevicesFor('control');
  const outlets = useMemo(() => included.filter((d) => d.class === 'outlet_dual'), [included]);
  const { plan, source, rooms, roomId, setRoomId, aspect } = useControlPlan();
  const unplaced = outlets.filter((d) => !plan?.OUTLET_POSITIONS[d.id]);

  const allOn = () => {
    for (const d of outlets) {
      send(d.id, 1, 'on');
      send(d.id, 2, 'on');
      log('RELAY', `${d.display_name} → on`);
    }
  };
  const allOff = () => {
    for (const d of outlets) {
      send(d.id, 1, 'off');
      send(d.id, 2, 'off');
      log('RELAY', `${d.display_name} → off`);
    }
  };
  const askAllOn = () =>
    ask({ title: 'Turn all outlets on?', body: `This sends an on command to both sockets on all ${outlets.length} outlets (CO1-CO7) at once.`, confirmLabel: 'Turn outlets on', tone: 'red' }, allOn);
  const askAllOff = () =>
    ask(
      { title: 'Turn all outlets off?', body: `This sends an off command to both sockets on all ${outlets.length} outlets (CO1-CO7) at once. Anything plugged in — chargers, equipment, the water dispenser — loses power immediately.`, confirmLabel: 'Turn outlets off', tone: 'red' },
      allOff,
    );

  return (
    <div className="control-plan-panel control-plan-panel--outlets">
      <div className="control-plan-panel__head">
        <div className="control-plan-panel__label">
          <Plug size={12} className="title-icon" aria-hidden="true" />
          CONVENIENCE OUTLETS · CO1-CO7
        </div>
        <PlanTally devices={outlets} sockets={OUTLET_SOCKETS} unit="sockets" />
      </div>
      <PlanRoomPicker id="outlet-plan-room" source={source} rooms={rooms} roomId={roomId} setRoomId={setRoomId} />
      {plan ? (
        <div
          className={`control-outlet-plan${source === 'data' ? ' control-outlet-plan--data' : ''}`}
          // The ROOM's proportions, not a fixed square — RM-044. A tall narrow office drawn
          // square stretches every percentage-positioned device across it.
          style={aspect === null ? undefined : { aspectRatio: String(aspect) }}
        >
          <plan.PlanShell />
          {outlets.map((device) => {
            const at = plan.OUTLET_POSITIONS[device.id];
            // An outlet the pack has no position for is NOT drawn at a guessed spot — it drops
            // to the list below, where it is still fully commandable. A pin somewhere nobody
            // surveyed looks exactly as deliberate as one that was.
            if (!at) return null;
            return <OutletPin key={device.id} device={device} left={`${at.x * 100}%`} top={`${at.y * 100}%`} />;
          })}
        </div>
      ) : null}

      {/* NO DUPLICATE CONTROLS. This page already carries `OutletsListCard`, which lists every
          outlet with the same switches — so a site without a drawn plan gets a sentence saying
          where to look, not a second copy of the controls two cards down. The first draft of
          this fallback did duplicate them, and the page's own tests caught it by finding two of
          everything. */}
      {!plan && (
        <p className="control-plan-panel__note">
          No plan is drawn for this site. Every outlet is in the list below, with the same
          controls.
        </p>
      )}
      {plan && unplaced.length > 0 && (
        <p className="control-plan-panel__note">
          {unplaced.length} outlet{unplaced.length === 1 ? '' : 's'} not placed on this plan —
          {' '}
          {unplaced.map((d) => d.display_name).join(', ')}. They are in the list below.
        </p>
      )}
      {/* Peers, styled alike — see the same pair in `LightingMatrixCard`. */}
      <div className="control-plan-panel__actions">
        <button type="button" className="control-plan-btn" onClick={askAllOn}>
          <Power size={14} aria-hidden="true" />
          All outlets on
        </button>
        <button type="button" className="control-plan-btn" onClick={askAllOff}>
          <PowerOff size={14} aria-hidden="true" />
          All outlets off
        </button>
      </div>
      <ConfirmModal {...modalProps} />
    </div>
  );
}

function OutletPin({ device, left, top }: { device: Device; left?: string; top?: string }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const corroboration = corroborate(device, reading);

  // Shared derivation, bespoke markup: these are half-pucks positioned on a floor plan, not
  // list rows. `useRelayState` subscribes per socket, where this used to take the whole
  // `pending` map and so re-rendered every pin on any command anywhere in the building.
  const s1 = useRelayState(device.id, 1);
  const s2 = useRelayState(device.id, 2);
  const stale = s1.stale;

  // S1/S2 — the list's, the log's and the Automation page's name for a socket. This used to log and
  // label "DP1", the vendor's datapoint number, so one socket had two names on one page.
  const toggle = (socket: SocketIndex, on: boolean) => {
    const next = on ? 'off' : 'on';
    send(device.id, socket, next);
    log('RELAY', `${device.display_name} S${socket} → ${next}`);
  };

  /** One half's classes and tooltip. Refused for any reason but a command in flight means
   * unavailable — drawn hatched, never as an off socket that merely will not respond. */
  const half = (socket: SocketIndex, s: typeof s1, side: 'left' | 'right') => {
    const unavailable = s.disabled && !s.busy;
    const state = s.busy ? 'switching…' : unavailable ? 'unavailable — no reading, or offline' : s.on ? 'on' : 'off';
    return {
      className: `control-outlet-pin__half control-outlet-pin__half--${side}${s.on ? ' control-outlet-pin__half--on' : ''}${s.busy ? ' control-outlet-pin__half--busy' : ''}${unavailable ? ' control-outlet-pin__half--unavailable' : ''}`,
      title: `${device.display_name} S${socket}: ${state}${stale && !unavailable ? ' (reading is stale)' : ''}${unavailable || s.busy ? '' : ` — click to switch ${s.on ? 'off' : 'on'}`}`,
    };
  };
  const h1 = half(1, s1, 'left');
  const h2 = half(2, s2, 'right');

  return (
    <div className={left ? 'control-outlet-pin' : 'control-outlet-pin control-outlet-pin--inline'} style={left ? { left, top } : undefined}>
      {/* `dot`, not the word — RM-045. On the plan this wraps a ~24px pin, and the "STALE"
          pill is wider than the pin it describes: four stale outlets hid most of the plan on
          the office kiosk. The dimming and the marker are the sighted signal here; the live
          region still announces the same full sentence. */}
      <StaleDataBadge deviceId={device.id} label={device.display_name} variant="dot">
        <div className="control-outlet-pin__id">{device.id.toUpperCase()}</div>
        <div className="control-outlet-pin__puck" role="group" aria-label={`${device.display_name} sockets`}>
          <button
            type="button"
            className={h1.className}
            disabled={s1.disabled}
            aria-pressed={s1.on}
            aria-busy={s1.busy}
            aria-label={`${device.display_name} S1`}
            title={h1.title}
            onClick={() => toggle(1, s1.on)}
          />
          <button
            type="button"
            className={h2.className}
            disabled={s2.disabled}
            aria-pressed={s2.on}
            aria-busy={s2.busy}
            aria-label={`${device.display_name} S2`}
            title={h2.title}
            onClick={() => toggle(2, s2.on)}
          />
        </div>
        {corroboration === 'contradicted' && <div className="control-outlet-pin__warn">⚠ drawing power</div>}
      </StaleDataBadge>
    </div>
  );
}
