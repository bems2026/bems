import { useDeviceStore } from '@/stores/deviceStore';
import { MetricValue } from '@/components/ui/MetricValue';
import { Badge } from '@/components/ui/Badge';

/** `acu_main` + `sens_outside_temp` — the only comfort-related readings the bridge serves. */
export function ComfortCard() {
  const acu = useDeviceStore((s) => s.latestReadings['acu_main']);
  const outside = useDeviceStore((s) => s.latestReadings['sens_outside_temp']);

  // Flat, not glass — nested inside .hero-card's own glass; see EnergyRing's comment.
  return (
    <div className="card card--flat comfort-card">
      <div className="card-head">
        <h3 className="card-title">Comfort</h3>
        <Badge tone={acu?.state === 'on' ? 'good' : 'neutral'}>{acu?.state ?? 'unknown'}</Badge>
      </div>
      <div className="comfort-grid">
        <div>
          <span className="metric-label">Room Temp</span>
          <MetricValue value={acu?.room_temp_c} unit="°C" digits={1} size="sm" />
        </div>
        <div>
          <span className="metric-label">Humidity</span>
          <MetricValue value={acu?.humidity_pct} unit="%" digits={0} size="sm" />
        </div>
        <div>
          <span className="metric-label">Outside</span>
          <MetricValue value={outside?.temp_c} unit="°C" digits={1} size="sm" />
        </div>
        <div>
          <span className="metric-label">Setpoint</span>
          <MetricValue value={acu?.setpoint_c} unit="°C" digits={0} size="sm" />
        </div>
      </div>
    </div>
  );
}
