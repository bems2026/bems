import { Router } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { CardLink } from '@/components/ui/CardLink';
import { countOnline } from './overviewMath';

/**
 * v4's "Device Status" card — aggregate counts only (the per-device list lives on the
 * Devices page, rebuilt in M3). Rows are grounded in this app's real classes: v4's mockup
 * shows generic "Online/Offline/Lights on"; this shows the two switchable classes that
 * actually exist here (7 lighting circuits, 7 dual-socket outlets) so the counts mean
 * something specific rather than a vague "lights on" over an undifferentiated fleet.
 */
export function DeviceStatusCountsCard() {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);

  const { online, total } = countOnline(devices, readings);
  const lights = devices.filter((d) => d.class === 'switch');
  const outlets = devices.filter((d) => d.class === 'outlet_dual');
  const lightsOn = lights.filter((d) => readings[d.id]?.state === 'on').length;
  const outletsOn = outlets.filter((d) => readings[d.id]?.state === 'on').length;

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">
          <Router size={14} className="title-icon" aria-hidden="true" />
          Device Status
        </h3>
        <CardLink to="devices" label="Open the device fleet status" />
      </div>
      <CountRow label="Reporting" value={`${online}/${total}`} color="var(--green-bright)" />
      <CountRow label="Lights on" value={`${lightsOn}/${lights.length}`} color="var(--accent)" />
      <CountRow label="Outlets on" value={`${outletsOn}/${outlets.length}`} color="var(--blue-bright)" />
      <p className="status-counts-footnote">Stale threshold: no reading in the last 30 seconds.</p>
    </div>
  );
}

function CountRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="status-counts-row">
      <span className="status-counts-row__label">
        <span className="status-counts-row__dot" style={{ background: color }} aria-hidden="true" />
        {label}
      </span>
      <span className="status-counts-row__value">{value}</span>
    </div>
  );
}
