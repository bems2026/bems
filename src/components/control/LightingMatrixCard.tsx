import { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore, targetKey } from '@/stores/commandStore';
import { controlView, isCommandable } from '@/lib/socketView';
import { isReadingStale } from '@/lib/staleness';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { useControlLog } from './controlLog';
import { useControlPlan } from './useControlPlan';
import type { Device } from '@/lib/types';

/**
 * All 7 lighting circuits, in circuit order — real devices, not v4's fixed placeholder
 * count. Filters/sorts in a `useMemo` derived from the raw `devices` selector rather than
 * inside the zustand selector itself: a selector that returns a freshly-allocated array on
 * every call fails React 19's `useSyncExternalStore` cache check ("getSnapshot should be
 * cached") and can loop.
 */
function useLightSwitches(): Device[] {
  const devices = useDeviceStore((s) => s.devices);
  return useMemo(() => devices.filter((d) => d.class === 'switch').sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [devices]);
}

/**
 * The ceiling luminaire plan — same spatial layout as `OutletPlanCard`, positioning each
 * fixture at its real `LIGHT_PLAN` coordinate instead of a row list. All 3 fixtures on a
 * row share one relay's state (see `scene3d/geometry.ts`'s `LIGHT_FIXTURES` comment), so
 * clicking any of the 3 squares in a row toggles that row.
 */
export function LightingMatrixCard() {
  const lights = useLightSwitches();
  const plan = useControlPlan();
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
      {plan ? (
        <div className="control-outlet-plan">
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
  const pending = useCommandStore((s) => s.pending[targetKey(device.id)]);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);

  const view = controlView(reading, pending);
  const busy = view.kind === 'pending';
  // Absolutely positioned within a shared plan container (see `pct(px, VB_W)` below), so
  // it can't be wrapped in StaleDataBadge's own div without breaking that positioning —
  // dimming comes for free from the existing `.control-lamp:disabled` rule instead.
  const stale = isReadingStale(reading);
  const on = (view.kind === 'idle' || view.kind === 'pending') && view.value === 'on';

  const toggle = () => {
    if (busy || stale) return;
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
            disabled={busy || !isCommandable(reading)}
            title={isPrimary && stale ? `${device.display_name}: stale — no reading in the last 30 seconds` : undefined}
            onClick={toggle}
          />
        );
      })}
      {/* The row's own label sits beside its rightmost fixture. With no plan there is no
          rightmost fixture, and the list already carries the device's name. */}
      {cells && cells.length > 0 && (
        <span
          className="control-light-plan__label"
          style={{ left: `${cells[cells.length - 1].x * 100 + 8}%`, top: `${cells[0].y * 100}%` }}
        >
          {device.id.toUpperCase()}
        </span>
      )}
    </>
  );
}
