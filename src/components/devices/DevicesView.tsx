import { useMemo } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { hasSwitchableState } from '@/lib/deviceClass';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { MetricValue } from '@/components/ui/MetricValue';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';
import type { Device, DeviceClass, Reading, SwitchState } from '@/lib/types';

const CLASS_ORDER: DeviceClass[] = ['outlet_dual', 'switch', 'meter', 'acu_ir', 'sensor_temp_humidity'];

const CLASS_LABEL: Record<DeviceClass, string> = {
  outlet_dual: 'Outlets',
  switch: 'Lighting Switches',
  meter: 'Branch Meters',
  acu_ir: 'Air Conditioning',
  sensor_temp_humidity: 'Sensors',
};

/**
 * The full device catalogue — every device, every field the bridge reports for it, grouped
 * by class. The compact `DeviceStatusList` on Overview is a summary of the same data; this
 * is the detail view it doesn't have room for.
 *
 * Every field renders conditionally on `typeof reading?.field === 'number'` — a class that
 * doesn't report a given metric (a switch has no `voltage`) simply shows nothing for that
 * row rather than a fabricated 0 or `—`. That's a different rule from `MetricValue`'s
 * "missing renders —": here, an entire row is omitted only when the *class* never reports
 * that field at all, not merely when this particular reading hasn't arrived yet — for a
 * field the class does support, the row stays and `MetricValue` shows `—` as usual.
 */
export function DevicesView() {
  const devices = useDeviceStore((s) => s.devices);

  const grouped = useMemo(() => {
    const map = new Map<DeviceClass, Device[]>();
    for (const cls of CLASS_ORDER) map.set(cls, []);
    for (const d of devices) map.get(d.class)?.push(d);
    return map;
  }, [devices]);

  if (devices.length === 0) {
    return <p className="section-placeholder">Waiting for the device catalogue…</p>;
  }

  return (
    <div className="devices-view">
      {CLASS_ORDER.map((cls) => {
        const list = grouped.get(cls) ?? [];
        if (list.length === 0) return null;
        return (
          <div className="devices-group" key={cls}>
            <h3 className="devices-group__title">
              {CLASS_LABEL[cls]} <span className="devices-group__count">{list.length}</span>
            </h3>
            <div className="devices-grid">
              {list.map((d) => (
                <DeviceCard key={d.id} device={d} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DeviceCard({ device }: { device: Device }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const switchable = hasSwitchableState(device.class);
  const tone: BadgeTone = reading?.state === 'on' ? 'good' : reading?.state === 'off' ? 'neutral' : 'warn';

  return (
    <StaleDataBadge deviceId={device.id} className="device-card-wrap">
      <Card
        title={device.display_name}
        subtitle={device.branch_circuit ?? device.description}
        action={switchable ? <Badge tone={tone}>{reading?.state ?? 'unknown'}</Badge> : <Badge tone="neutral">metering</Badge>}
        headingLevel="h4"
      >
        <DeviceMetrics reading={reading} />
        {device.sockets && reading?.socket_states && (
          <div className="device-card-sockets">
            <SocketPill label="Socket 1" state={reading.socket_states[1]} />
            <SocketPill label="Socket 2" state={reading.socket_states[2]} />
          </div>
        )}
      </Card>
    </StaleDataBadge>
  );
}

function DeviceMetrics({ reading }: { reading: Reading | undefined }) {
  const rows: { label: string; value: number | undefined; unit: string; digits: number }[] = [
    { label: 'Voltage', value: reading?.voltage, unit: 'V', digits: 1 },
    { label: 'Current', value: reading?.current, unit: 'A', digits: 2 },
    { label: 'Power', value: reading?.power_w, unit: 'W', digits: 0 },
    { label: 'Energy Today', value: reading?.energy_kwh_today, unit: 'kWh', digits: 2 },
    { label: 'Room Temp', value: reading?.room_temp_c, unit: '°C', digits: 1 },
    { label: 'Setpoint', value: reading?.setpoint_c, unit: '°C', digits: 0 },
    { label: 'Temperature', value: reading?.temp_c, unit: '°C', digits: 1 },
    { label: 'Humidity', value: reading?.humidity_pct, unit: '%', digits: 0 },
  ].filter((r) => r.value !== undefined);

  if (rows.length === 0) return null;

  return (
    <div className="device-card-metrics">
      {rows.map((r) => (
        <div className="device-metric-row" key={r.label}>
          <span className="metric-label">{r.label}</span>
          <MetricValue value={r.value} unit={r.unit} digits={r.digits} size="sm" />
        </div>
      ))}
    </div>
  );
}

function SocketPill({ label, state }: { label: string; state: SwitchState | undefined }) {
  return (
    <div className="device-socket-pill">
      <span>{label}</span>
      <Badge tone={state === 'on' ? 'good' : 'neutral'}>{state ?? 'unknown'}</Badge>
    </div>
  );
}
