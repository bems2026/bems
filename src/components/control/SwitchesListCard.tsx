import { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';
import { useDevicesFor } from '@/hooks/useDevicesFor';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';
import { InfoHint } from '@/components/ui/InfoHint';
import { RelayToggle } from '@/components/devices/RelayToggle';
import { useRelayState } from '@/hooks/useRelayState';
import { SimulatedBadge } from './SimulatedBadge';

/**
 * The 7 lighting circuits as a scannable list — same devices the matrix above controls,
 * same `commandStore.send`, just a denser row format for a quick individual toggle. Derives
 * the sorted list via `useMemo` from the raw `devices` selector — see
 * `LightingMatrixCard.tsx`'s `useLightSwitches` comment for why a selector can't allocate
 * a fresh array itself.
 */
export function SwitchesListCard({ simulated = false }: { simulated?: boolean }) {
// Filtered through `useDevicesFor('control')`, not by class alone. Page membership is a SITE
// decision recorded in `device_config.functions`, and only ControlPage's master actions used to
// honour it — so a device an operator had deliberately excluded was left out of "Lights off"
// while still getting its own toggle in the list below it.
  const { included } = useDevicesFor('control');
  const lights = useMemo(() => included.filter((d) => d.class === 'switch').sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [included]);

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
  // The toggle, its refusal rule and this wording all come from one place now. They used to be
  // derived separately here, which is how EX-017's staleness fix ended up applied to the
  // `disabled=` attribute but not to the click handler — a button that looked operable and did
  // nothing. See `RelayToggle`.
  const { label } = useRelayState(deviceId);

  return (
    <StaleDataBadge deviceId={deviceId} label={name} className="control-list-row">
      <div className="control-list-row__body">
        <p className="control-list-row__name">{name}</p>
        <p className="control-list-row__meta">{label}</p>
      </div>
      <RelayToggle deviceId={deviceId} name={name} />
    </StaleDataBadge>
  );
}
