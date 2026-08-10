import { useDeviceStore } from '@/stores/deviceStore';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';
import type { DeviceClass } from '@/lib/types';

const SWITCHABLE: DeviceClass[] = ['outlet_dual', 'switch', 'acu_ir'];

/** Compact, scrollable read-only device list — image 1's pattern, not image 5's toggles. */
export function DeviceStatusList() {
  const devices = useDeviceStore((s) => s.devices);

  return (
    <div className="card device-status-card">
      <div className="card-head">
        <h3 className="card-title">Device Status</h3>
      </div>
      <div className="device-status-list">
        {devices.length === 0 && <p className="section-placeholder">Waiting for the device catalogue…</p>}
        {devices.map((d) => (
          <DeviceStatusRow key={d.id} deviceId={d.id} label={d.display_name} deviceClass={d.class} />
        ))}
      </div>
    </div>
  );
}

function DeviceStatusRow({ deviceId, label, deviceClass }: { deviceId: string; label: string; deviceClass: DeviceClass }) {
  const reading = useDeviceStore((s) => s.latestReadings[deviceId]);
  const hasSwitchableState = SWITCHABLE.includes(deviceClass);
  const state = reading?.state;
  const tone: BadgeTone = state === 'on' ? 'good' : state === 'off' ? 'neutral' : 'warn';

  return (
    <StaleDataBadge deviceId={deviceId} className="device-status-row">
      <span className="device-status-row__name">{label}</span>
      <span className="device-status-row__meta">
        {typeof reading?.power_w === 'number' && <span className="device-status-row__power">{reading.power_w.toFixed(0)}W</span>}
        {/* Meters and sensors have no switchable state at all — that's a real fact about
            them, not missing data, so they get a neutral "metering" pill rather than an
            "unknown" state badge that implies a state concept exists but wasn't reported. */}
        {hasSwitchableState ? <Badge tone={tone}>{state ?? 'unknown'}</Badge> : <Badge tone="neutral">metering</Badge>}
      </span>
    </StaleDataBadge>
  );
}
