import { useMemo } from 'react';
import { Plug } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useDevicesFor } from '@/hooks/useDevicesFor';
import { corroborate } from '@/lib/relayCorroboration';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';
import { InfoHint } from '@/components/ui/InfoHint';
import { RelayToggle } from '@/components/devices/RelayToggle';
import { SimulatedBadge } from './SimulatedBadge';
import type { Device } from '@/lib/types';

/**
 * The 7 dual-socket outlets as a scannable list — same control path the plan's pucks use
 * (`commandStore`, `socketView.controlView`, `relayCorroboration`), one row per outlet.
 * See `LightingMatrixCard.tsx`'s `useLightSwitches` comment for why the sort is a
 * `useMemo` over the raw selector rather than inline in the selector itself.
 */
export function OutletsListCard({ simulated = false }: { simulated?: boolean }) {
// Filtered through `useDevicesFor('control')`, not by class alone. Page membership is a SITE
// decision recorded in `device_config.functions`, and only ControlPage's master actions used to
// honour it — so a device an operator had deliberately excluded was left out of "Lights off"
// while still getting its own toggle in the list below it.
  const { included } = useDevicesFor('control');
  const outlets = useMemo(() => included.filter((d) => d.class === 'outlet_dual').sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [included]);

  return (
    <div className="card control-list-card">
      <h3 className="control-list-card__title">
        <Plug size={16} className="title-icon" aria-hidden="true" />
        Outlets
        <InfoHint label="Hardware">7x Tuya 20A dual-socket, S1/S2.</InfoHint>
        {simulated && <SimulatedBadge />}
      </h3>
      {outlets.map((d) => (
        <OutletRow key={d.id} device={d} />
      ))}
    </div>
  );
}

function OutletRow({ device }: { device: Device }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const corroboration = corroborate(device, reading);

  return (
    <StaleDataBadge deviceId={device.id} label={device.display_name} className="control-list-row">
      <div className="control-list-row__body">
        <p className="control-list-row__name">{device.display_name}</p>
        <p className="control-list-row__meta">
          {device.branch_circuit}
          {corroboration === 'contradicted' ? ' — commanded off, meter reads real power' : ''}
        </p>
      </div>
      <div className="control-list-row__sockets">
        {/* Each toggle subscribes to its OWN pending entry. This row used to select the whole
            `pending` map and thread it down, so any command anywhere in the building re-rendered
            both sockets of every outlet. */}
        <RelayToggle deviceId={device.id} name={device.display_name} socket={1} variant="socket" />
        <RelayToggle deviceId={device.id} name={device.display_name} socket={2} variant="socket" />
      </div>
    </StaleDataBadge>
  );
}
