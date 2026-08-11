import { useDeviceStore } from '@/stores/deviceStore';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { StaleDataBadge } from '@/components/common/StaleDataBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { hasSwitchableState } from '@/lib/deviceClass';
import type { DeviceClass } from '@/lib/types';

const PREVIEW_LIMIT = 8;

/**
 * Compact, read-only device preview — image 1's pattern, not image 5's toggles.
 *
 * Shows the first `PREVIEW_LIMIT` devices in catalogue order, not top-by-power: this list's
 * job is *status* across every device class, and sorting it by power (as `EnergyByDevice`
 * does, reusing `topByPower`) would silently drop every light switch — they have no
 * `power_w` at all — out of what's meant to be a representative glance at the building.
 * `topByPower` stays reserved for the card whose actual subject is power ranking.
 *
 * No nested scroll region (was `max-height:260px; overflow-y:auto`, trapping wheel/keyboard
 * interaction inside a small card): the full catalogue is one click away at `#devices`.
 */
export function DeviceStatusList() {
  const devices = useDeviceStore((s) => s.devices);
  const preview = devices.slice(0, PREVIEW_LIMIT);
  const remaining = devices.length - preview.length;

  // Flat, not glass — nested inside .hero-card's own glass; see EnergyRing's comment.
  return (
    <div className="card card--flat device-status-card">
      <div className="card-head">
        <h3 className="card-title">Device Status</h3>
      </div>
      <div className="device-status-list">
        {devices.length === 0 ? (
          <div aria-busy="true" aria-label="Loading devices">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} height="20px" className="device-status-row-skeleton" />
            ))}
          </div>
        ) : (
          preview.map((d) => <DeviceStatusRow key={d.id} deviceId={d.id} label={d.display_name} deviceClass={d.class} />)
        )}
      </div>
      {remaining > 0 && (
        <a href="#devices" className="device-status-view-all">
          View all {devices.length} devices →
        </a>
      )}
    </div>
  );
}

function DeviceStatusRow({ deviceId, label, deviceClass }: { deviceId: string; label: string; deviceClass: DeviceClass }) {
  const reading = useDeviceStore((s) => s.latestReadings[deviceId]);
  const state = reading?.state;
  const tone: BadgeTone = state === 'on' ? 'good' : state === 'off' ? 'neutral' : 'warn';

  return (
    <StaleDataBadge deviceId={deviceId} label={label} className="device-status-row">
      <span className="device-status-row__name">{label}</span>
      <span className="device-status-row__meta">
        {typeof reading?.power_w === 'number' && <span className="device-status-row__power">{reading.power_w.toFixed(0)}W</span>}
        {/* Meters and sensors have no switchable state at all — that's a real fact about
            them, not missing data, so they get a neutral "metering" pill rather than an
            "unknown" state badge that implies a state concept exists but wasn't reported. */}
        {hasSwitchableState(deviceClass) ? <Badge tone={tone}>{state ?? 'unknown'}</Badge> : <Badge tone="neutral">metering</Badge>}
      </span>
    </StaleDataBadge>
  );
}
