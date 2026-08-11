import { Power } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { useCommandStore, targetKey } from '@/stores/commandStore';
import { controlView } from '@/lib/socketView';
import { corroborate } from '@/lib/relayCorroboration';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { MetricValue } from '@/components/ui/MetricValue';
import { Skeleton } from '@/components/ui/Skeleton';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';
import type { Device, Reading, SocketIndex } from '@/lib/types';

/**
 * The outlet control surface — the old Node-RED dashboard's Master Control / per-outlet
 * panel, rebuilt against the Stage 2 command path (`shared/commands.mjs`, mock-only — see
 * that file's header). `DevicesView` stays the full read-only catalogue across every
 * device class; this view is `outlet_dual` only, and it's the one place in the app that
 * writes.
 *
 * Every socket pill here is commanded state, not measured state — nothing in this system
 * reads a relay's position back from hardware (§5.1 of the Phase L plan). That's said once
 * per card (`.outlet-provenance`), not once per pill, and corroborated where a real
 * measurement can actually speak to it — see `relayCorroboration.ts`.
 */
export function OutletsView() {
  const devices = useDeviceStore((s) => s.devices);
  const send = useCommandStore((s) => s.send);
  const outlets = devices.filter((d) => d.class === 'outlet_dual');

  if (devices.length === 0) {
    return (
      <div className="outlets-grid" aria-busy="true" aria-label="Loading outlets">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="card card--flat" key={i}>
            <Skeleton height="14px" width="60%" className="devices-skeleton-title" />
            <Skeleton height="12px" width="40%" className="devices-skeleton-sub" />
          </div>
        ))}
      </div>
    );
  }

  const allOff = () => {
    for (const d of outlets) {
      send(d.id, 1, 'off');
      send(d.id, 2, 'off');
    }
  };

  return (
    <div className="outlets-view">
      <div className="outlets-master-row">
        <button type="button" className="outlets-master-off" onClick={allOff}>
          <Power size={14} aria-hidden="true" />
          All Outlets Off
        </button>
        <p className="outlets-provenance">
          Relay state below is <strong>commanded by this dashboard</strong>, not measured — no hardware in this system reports a relay's actual
          position back.
        </p>
      </div>
      <div className="outlets-grid">
        {outlets.map((d) => (
          <OutletCard key={d.id} device={d} />
        ))}
      </div>
    </div>
  );
}

function OutletCard({ device }: { device: Device }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const corroboration = corroborate(device, reading);

  return (
    <StaleDataBadge deviceId={device.id} label={device.display_name} className="device-card-wrap">
      <Card
        title={device.display_name}
        subtitle={device.branch_circuit}
        action={<Badge tone={reading?.online ? 'good' : 'bad'}>{reading?.online ? 'connected' : 'disconnected'}</Badge>}
        className="card--flat"
      >
        <OutletMetrics reading={reading} />
        <div className="outlet-sockets">
          <SocketToggle deviceId={device.id} socket={1} />
          <SocketToggle deviceId={device.id} socket={2} />
        </div>
        {corroboration === 'contradicted' && (
          <p className="outlet-warning">Commanded off, but the meter reads real power — check the physical relay.</p>
        )}
        <p className="outlet-card-footnote">
          Relay state: commanded, not measured{corroboration === 'no-load' ? ' — no load detected' : ''}
        </p>
      </Card>
    </StaleDataBadge>
  );
}

function OutletMetrics({ reading }: { reading: Reading | undefined }) {
  return (
    <div className="device-card-metrics">
      <div className="device-metric-row">
        <span className="metric-label">Voltage</span>
        <MetricValue value={reading?.voltage} unit="V" digits={1} size="sm" />
      </div>
      <div className="device-metric-row">
        <span className="metric-label">Current</span>
        <MetricValue value={reading?.current} unit="A" digits={2} size="sm" />
      </div>
      <div className="device-metric-row">
        <span className="metric-label">Power</span>
        <MetricValue value={reading?.power_w} unit="W" digits={0} size="sm" />
      </div>
      <div className="device-metric-row">
        <span className="metric-label">Energy Today</span>
        <MetricValue value={reading?.energy_kwh_today} unit="kWh" digits={2} size="sm" />
      </div>
    </div>
  );
}

function SocketToggle({ deviceId, socket }: { deviceId: string; socket: SocketIndex }) {
  const reading = useDeviceStore((s) => s.latestReadings[deviceId]);
  const pending = useCommandStore((s) => s.pending[targetKey(deviceId, socket)]);
  const send = useCommandStore((s) => s.send);
  const view = controlView(reading, pending, socket);

  const busy = view.kind === 'pending';
  const failed = view.kind === 'failed';
  const unknown = view.kind === 'unknown';
  const on = !unknown && view.value === 'on';

  const handleClick = () => {
    if (busy || unknown) return;
    send(deviceId, socket, on ? 'off' : 'on');
  };

  const title = failed
    ? view.error
    : unknown
      ? 'No reading yet'
      : `Commanded ${on ? 'on' : 'off'} — this device does not report relay state back, so this is the last command sent, not a measurement.`;

  return (
    <button
      type="button"
      className={`outlet-socket-toggle${on ? ' outlet-socket-toggle--on' : ''}${busy ? ' outlet-socket-toggle--busy' : ''}${failed ? ' outlet-socket-toggle--failed' : ''}`}
      aria-pressed={on}
      aria-busy={busy}
      disabled={busy || unknown}
      onClick={handleClick}
      title={title}
      aria-description={title}
    >
      <span className="outlet-socket-toggle__label">S{socket}</span>
      <span className="outlet-socket-toggle__state">{unknown ? 'unknown' : busy ? 'switching…' : on ? 'on' : 'off'}</span>
    </button>
  );
}
