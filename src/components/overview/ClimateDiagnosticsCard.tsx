import { useDeviceStore } from '@/stores/deviceStore';
import { MetricValue } from '@/components/ui/MetricValue';

/**
 * v4's "Climate Diagnostics" ships a dashed "Outdoor (external API) — Not wired" row,
 * because its 2-sensor mockup has no real outdoor reading. This installation does:
 * `sens_outside_temp` is a real Tuya sensor, not an external API — so it renders as a
 * normal tile like the room sensor, and the dashed "not wired" placeholder is dropped
 * entirely rather than shown next to a reading that actually exists.
 */
export function ClimateDiagnosticsCard() {
  const acu = useDeviceStore((s) => s.latestReadings['acu_main']);
  const outside = useDeviceStore((s) => s.latestReadings['sens_outside_temp']);

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Climate Diagnostics</h3>
        <span className="climate-caps-label">2 SENSORS</span>
      </div>
      <div className="climate-grid">
        <ClimateTile name="Room · CARE office" temp={acu?.room_temp_c} rh={acu?.humidity_pct} />
        <ClimateTile name="Outside" temp={outside?.temp_c} rh={outside?.humidity_pct} />
      </div>
    </div>
  );
}

function ClimateTile({ name, temp, rh }: { name: string; temp: number | undefined; rh: number | undefined }) {
  return (
    <div className="climate-tile">
      <p className="climate-tile__name">{name}</p>
      <div className="climate-tile__row">
        <span className="climate-tile__row-label">Temp</span>
        <span className="climate-tile__row-value">
          <MetricValue value={temp} unit="°C" digits={1} size="sm" />
        </span>
      </div>
      <div className="climate-tile__row">
        <span className="climate-tile__row-label">RH</span>
        <span className="climate-tile__row-value">
          <MetricValue value={rh} unit="%" digits={0} size="sm" />
        </span>
      </div>
    </div>
  );
}
