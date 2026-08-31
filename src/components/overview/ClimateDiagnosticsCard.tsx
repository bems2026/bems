import { useDeviceStore } from '@/stores/deviceStore';
import { primaryOfClass } from '@/lib/siteDevices';
import { Thermometer } from 'lucide-react';
import { MetricValue } from '@/components/ui/MetricValue';

/**
 * v4's "Climate Diagnostics" ships a dashed "Outdoor (external API) — Not wired" row,
 * because its 2-sensor mockup has no real outdoor reading. This installation does:
 * the outdoor probe is a real Tuya sensor, not an external API — so it renders as a
 * normal tile like the indoor one, and the dashed "not wired" placeholder is dropped
 * entirely rather than shown next to a reading that actually exists.
 *
 * BOTH DEVICES ARE FOUND BY CLASS, NOT BY ID — FI-016. This read `latestReadings['acu_main']`
 * and `['sens_outside_temp']`, which are this building's names for "the aircon" and "the
 * outdoor probe". At another site both tiles would have read `—` forever, and nothing on the
 * screen would have said why.
 */
export function ClimateDiagnosticsCard() {
  const devices = useDeviceStore((s) => s.devices);
  const acuId = primaryOfClass(devices, 'acu_ir')?.id;
  const outsideId = primaryOfClass(devices, 'sensor_temp_humidity')?.id;
  const acu = useDeviceStore((s) => (acuId ? s.latestReadings[acuId] : undefined));
  const outside = useDeviceStore((s) => (outsideId ? s.latestReadings[outsideId] : undefined));

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">
          <Thermometer size={14} className="title-icon" aria-hidden="true" />
          Climate Diagnostic
        </h3>
        <span className="climate-caps-label">2 SENSORS</span>
      </div>
      <div className="climate-grid">
        {/* "Indoor", not a room name. This reading comes from the aircon's own sensor, so the
            only thing it can honestly claim is that it was taken inside — which building, and
            which room, is the space tree's business (RM-028). */}
        <ClimateTile name="Indoor" temp={acu?.room_temp_c} rh={acu?.humidity_pct} />
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
