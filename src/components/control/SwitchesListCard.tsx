import { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore, targetKey } from '@/stores/commandStore';
import { controlView, isCommandable } from '@/lib/socketView';
import { isReadingStale } from '@/lib/staleness';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';
import { InfoHint } from '@/components/ui/InfoHint';
import { SimulatedBadge } from './SimulatedBadge';
import { useControlLog } from './controlLog';

/**
 * The 7 lighting circuits as a scannable list — same devices the matrix above controls,
 * same `commandStore.send`, just a denser row format for a quick individual toggle. Derives
 * the sorted list via `useMemo` from the raw `devices` selector — see
 * `LightingMatrixCard.tsx`'s `useLightSwitches` comment for why a selector can't allocate
 * a fresh array itself.
 */
export function SwitchesListCard({ simulated = false }: { simulated?: boolean }) {
  const devices = useDeviceStore((s) => s.devices);
  const lights = useMemo(() => devices.filter((d) => d.class === 'switch').sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [devices]);

  return (
    <div className="card control-list-card">
      <h3 className="control-list-card__title">
        <Lightbulb size={16} className="title-icon" aria-hidden="true" />
        Lighting switches
        <InfoHint label="Hardware">7x Tuya 16A mini relays.</InfoHint>
        {simulated && <SimulatedBadge />}
      </h3>
      {lights.map((d) => (
        <SwitchRow key={d.id} deviceId={d.id} name={d.display_name} />
      ))}
    </div>
  );
}

function SwitchRow({ deviceId, name }: { deviceId: string; name: string }) {
  const reading = useDeviceStore((s) => s.latestReadings[deviceId]);
  const pending = useCommandStore((s) => s.pending[targetKey(deviceId)]);
  const send = useCommandStore((s) => s.send);
  const log = useControlLog((s) => s.log);
  const view = controlView(reading, pending);

  const busy = view.kind === 'pending';
  const unknown = view.kind === 'unknown';
  const stale = isReadingStale(reading);
  const on = !unknown && view.value === 'on';

  const toggle = () => {
    if (busy || unknown || stale) return;
    const next = on ? 'off' : 'on';
    send(deviceId, undefined, next);
    log('RELAY', `${name} → ${next}`);
  };

  return (
    <StaleDataBadge deviceId={deviceId} label={name} className="control-list-row">
      <div className="control-list-row__body">
        <p className="control-list-row__name">{name}</p>
        <p className="control-list-row__meta">{unknown ? 'no reading yet' : busy ? 'switching…' : on ? 'on' : 'off'}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={name}
        className={`quick-toggle${on ? ' quick-toggle--on' : ''}`}
        disabled={busy || unknown || !isCommandable(reading)}
        onClick={toggle}
      >
        <span className="quick-toggle__knob" />
      </button>
    </StaleDataBadge>
  );
}
