import { Zap, Gauge, Waves, CircleDot } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { StatTile } from '@/components/ui/StatTile';
import { Skeleton } from '@/components/ui/Skeleton';
import { countOnline } from './overviewMath';

const ICON_SIZE = 14;

/** The top-of-Overview KPI strip. Absorbs what SystemGauges/EnergyTotals used to show. */
export function KpiRow() {
  const totals = useDeviceStore((s) => s.totals);
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const { online, total } = countOnline(devices, readings);

  // Skeleton only for the genuine pre-catalogue state — a loaded device with no reading
  // yet still renders through StatTile/MetricValue as "—", which is a real, meaningful
  // fact, not a loading state.
  if (devices.length === 0) {
    return (
      <div className="kpi-row" aria-busy="true" aria-label="Loading KPIs">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="stat-tile" key={i}>
            <Skeleton height="11px" width="60%" />
            <Skeleton height="26px" width="80%" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="kpi-row">
      <StatTile
        icon={<Zap size={ICON_SIZE} aria-hidden="true" />}
        label="Total Power"
        value={totals?.total_power_w}
        unit="W"
        digits={0}
      />
      <StatTile
        icon={<Gauge size={ICON_SIZE} aria-hidden="true" />}
        label="Energy Today"
        value={totals?.energy_kwh_today}
        unit="kWh"
        digits={2}
      />
      <StatTile
        icon={<Waves size={ICON_SIZE} aria-hidden="true" />}
        label="System Voltage"
        value={totals?.avg_voltage}
        unit="V"
        digits={1}
      />
      <StatTile
        icon={<CircleDot size={ICON_SIZE} aria-hidden="true" />}
        label="Devices Online"
        value={total > 0 ? `${online}/${total}` : null}
      />
    </div>
  );
}
