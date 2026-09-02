import { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDevicesFor } from '@/hooks/useDevicesFor';
import { useCommandStore } from '@/stores/commandStore';
import { staleWindowLabel } from '@/lib/staleness';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { useRelayState } from '@/hooks/useRelayState';
import { useControlLog } from './controlLog';
import { useControlPlan } from './useControlPlan';
import { PlanRoomPicker } from './PlanRoomPicker';
import type { Device } from '@/lib/types';

/**
 * All 7 lighting circuits, in circuit order — real devices, not v4's fixed placeholder
 * count. Filters/sorts in a `useMemo` derived from the raw `devices` selector rather than
 * inside the zustand selector itself: a selector that returns a freshly-allocated array on
 * every call fails React 19's `useSyncExternalStore` cache check ("getSnapshot should be
 * cached") and can loop.
 */
function useLightSwitches(): Device[] {
  // Filtered through `useDevicesFor('control')`, not by class alone. Page membership is a SITE
  // decision recorded in `device_config.functions`, and only ControlPage's master actions used
  // to honour it — so a device an operator had deliberately excluded was left out of "Lights
  // off" while still getting a clickable fixture on the plan.
  const { included } = useDevicesFor('control');
  return useMemo(() => included.filter((d) => d.class === 'switch').sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [included]);
}

/**
 * The ceiling luminaire plan — same spatial layout as `OutletPlanCard`, positioning each
 * fixture at its real `LIGHT_PLAN` coordinate instead of a row list. All 3 fixtures on a
 * row share one relay's state (see `scene3d/geometry.ts`'s `LIGHT_FIXTURES` comment), so
 * clicking any of the 3 squares in a row toggles that row.
 */
export function LightingMatrixCard() {
  const lights = useLightSwitches();
  const { plan, source, rooms, roomId, setRoomId, aspect } = useControlPlan();
  const unplaced = useMemo(() => lights.filter((d) => !plan?.LIGHT_POSITIONS[d.id]), [lights, plan]);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const { ask, modalProps } = useConfirm();

  const allOn = () => {
    for (const d of lights) {
      send(d.id, undefined, 'on');
      log('RELAY', `${d.display_name} → on`);
    }
  };
  const allOff = () => {
    for (const d of lights) {
      send(d.id, undefined, 'off');
      log('RELAY', `${d.display_name} → off`);
    }
  };
  const askAllOn = () =>
    ask({ title: 'Turn all lighting on?', body: `This sends an on command to all ${lights.length} lighting circuits (L1-L7) at once.`, confirmLabel: 'Turn lights on', tone: 'accent' }, allOn);
  const askAllOff = () =>
    ask(
      { title: 'Turn all lighting off?', body: `This sends an off command to all ${lights.length} lighting circuits (L1-L7) at once. Anyone working under them right now loses light immediately.`, confirmLabel: 'Turn lights off', tone: 'accent' },
      allOff,
    );

  return (
    <div className="control-plan-panel">
      <div className="control-plan-panel__label">
        <Lightbulb size={12} className="title-icon" aria-hidden="true" />
        CEILING LUMINAIRES · L1-L7
      </div>
      <PlanRoomPicker id="lighting-plan-room" source={source} rooms={rooms} roomId={roomId} setRoomId={setRoomId} />
      {plan ? (
        <div
          className={`control-outlet-plan${source === 'data' ? ' control-outlet-plan--data' : ''}`}
          // The ROOM's proportions, not a fixed square — RM-044. A tall narrow office drawn
          // square stretches every percentage-positioned device across it.
          style={aspect === null ? undefined : { aspectRatio: String(aspect) }}
        >
          <plan.PlanShell />
          {lights.map((device) => {
            const cells = plan.LIGHT_POSITIONS[device.id];
            // A circuit the pack does not place drops to the list below rather than being drawn
            // at a guessed ceiling position, where it would look surveyed.
            if (!cells) return null;
            return <LightRow key={device.id} device={device} cells={cells} />;
          })}
        </div>
      ) : null}

      {/* `SwitchesListCard` on this same page already lists every circuit with the same switch,
          so a site without a plan gets a sentence rather than a second set of controls. */}
      {!plan && (
        <p className="control-plan-panel__note">
          No plan is drawn for this site. Every lighting circuit is in the list below, with the
          same controls.
        </p>
      )}
      {plan && unplaced.length > 0 && (
        <p className="control-plan-panel__note">
          {unplaced.length} circuit{unplaced.length === 1 ? '' : 's'} not placed on this plan —
          {' '}
          {unplaced.map((d) => d.display_name).join(', ')}. They are in the list below.
        </p>
      )}
      <div className="control-plan-panel__actions">
        <button type="button" className="control-plan-btn" onClick={askAllOn}>
          All rows on
        </button>
        <button type="button" className="control-plan-btn control-plan-btn--accent" onClick={askAllOff}>
          All rows off
        </button>
      </div>
      <ConfirmModal {...modalProps} />
    </div>
  );
}

function LightRow({ device, cells }: { device: Device; cells?: { x: number; y: number }[] }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);

  // The derivation is shared with every other relay control (`useRelayState`); only the markup
  // is special here, because these lamps are absolutely positioned within a plan container (see
  // `pct(px, VB_W)` below) and cannot be wrapped in StaleDataBadge's own div without breaking
  // that positioning — dimming comes from the existing `.control-lamp:disabled` rule instead.
  //
  // Sharing it also aligned the refusal rule: this lamp used to omit `unknown`, so a light that
  // had never reported offered a toggle with no state to toggle *from*.
  const { on, disabled, stale } = useRelayState(device.id);

  // Not gated on `stale` — see `RelayToggle`. Gating the handler but not the control is what
  // made a click on an enabled button do nothing silently.
  const toggle = () => {
    if (disabled) return;
    const next = on ? 'off' : 'on';
    send(device.id, undefined, next);
    log('RELAY', `${device.display_name} → ${next}`);
  };

  // Without a plan this is one inline switch, not three ceiling cells: the three exist to show
  // where the fixtures are, and there is nowhere to show.
  const positions = cells ?? [null];

  return (
    <>
      {positions.map((at, col) => {
        // Only the first fixture in the row is a real, keyboard-reachable switch — the
        // other two are the same relay, so a second/third Tab stop for one action would
        // just be redundant. All 3 stay independently clickable for the mouse/touch case
        // the user asked for ("clicking any of the lights ... must turn on and off").
        const isPrimary = col === 0;
        return (
          <button
            key={col}
            type="button"
            role={isPrimary ? 'switch' : undefined}
            aria-checked={isPrimary ? on : undefined}
            aria-label={isPrimary ? device.display_name : undefined}
            aria-hidden={isPrimary ? undefined : true}
            tabIndex={isPrimary ? 0 : -1}
            className={`control-lamp${on ? ' control-lamp--on' : ''}${at ? '' : ' control-lamp--inline'}`}
            style={at ? { left: `${at.x * 100}%`, top: `${at.y * 100}%` } : undefined}
            disabled={disabled}
            title={isPrimary && stale ? `${device.display_name}: stale — no reading in the last ${staleWindowLabel(reading)}` : undefined}
            onClick={toggle}
          />
        );
      })}
      {/* The row's own label sits beside its rightmost fixture. With no plan there is no
          rightmost fixture, and the list already carries the device's name. */}
      {cells && cells.length > 0 && (
        <span
          className="control-light-plan__label"
          // 8.125, not 8. The old code offset this label by 26 units of a 320-wide viewBox, and
          // 26/320 is 8.125 percentage points. Rounding it shifted the label by 0.125% of the
          // plan — half a pixel, invisible, and a number that had quietly stopped meaning what
          // it meant. Exact costs nothing more to write than approximately right.
          style={{ left: `${cells[cells.length - 1].x * 100 + 8.125}%`, top: `${cells[0].y * 100}%` }}
        >
          {device.id.toUpperCase()}
        </span>
      )}
    </>
  );
}
