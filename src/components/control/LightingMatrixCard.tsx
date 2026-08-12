import { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore, targetKey } from '@/stores/commandStore';
import { controlView } from '@/lib/socketView';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/components/ui/useConfirm';
import { useControlLog } from './controlLog';
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
 * The ceiling luminaire matrix — one row per relay (L1-L7), 3 lamp swatches per row purely
 * decorative (the real wiring is one relay per row, all 3 fixtures sharing that single
 * circuit's state — see `scene3d/geometry.ts`'s `LIGHT_FIXTURES` comment). `column-reverse`
 * puts L1 at the bottom of the stack, matching the as-built numbering v4's own layout uses.
 */
export function LightingMatrixCard() {
  const lights = useLightSwitches();
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const pendingMap = useCommandStore((s) => s.pending);
  const readings = useDeviceStore((s) => s.latestReadings);
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
      <div className="control-light-rows">
        {lights.map((d) => {
          const view = controlView(readings[d.id], pendingMap[targetKey(d.id)]);
          const busy = view.kind === 'pending';
          const on = (view.kind === 'idle' || view.kind === 'pending') && view.value === 'on';
          const toggle = () => {
            if (busy) return;
            const next = on ? 'off' : 'on';
            send(d.id, undefined, next);
            log('RELAY', `${d.display_name} → ${next}`);
          };
          return (
            <div className={`control-light-row${on ? ' control-light-row--on' : ''}`} key={d.id}>
              {[0, 1, 2].map((i) => (
                <button
                  key={i}
                  type="button"
                  className={`control-lamp${on ? ' control-lamp--on' : ''}`}
                  disabled={busy}
                  onClick={toggle}
                  aria-hidden="true"
                  tabIndex={-1}
                />
              ))}
              <div className="control-light-row__tail">
                <span className="control-light-row__label">{d.id.toUpperCase()}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={d.display_name}
                  className={`quick-toggle${on ? ' quick-toggle--on' : ''}`}
                  disabled={busy}
                  onClick={toggle}
                >
                  <span className="quick-toggle__knob" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
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
