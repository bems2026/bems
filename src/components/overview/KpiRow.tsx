import { useDeviceStore } from '@/stores/deviceStore';
import { StatTile } from '@/components/ui/StatTile';
import { countOnline } from './overviewMath';

/** The top-of-Overview KPI strip. Absorbs what SystemGauges/EnergyTotals used to show. */
export function KpiRow() {
  const totals = useDeviceStore((s) => s.totals);
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const { online, total } = countOnline(devices, readings);

  return (
    <div className="kpi-row">
      <StatTile icon="⚡" label="Total Power" value={totals?.total_power_w} unit="W" digits={0} />
      <StatTile icon="◈" label="Energy Today" value={totals?.energy_kwh_today} unit="kWh" digits={2} />
      <StatTile icon="∿" label="System Voltage" value={totals?.avg_voltage} unit="V" digits={1} />
      <StatTile icon="●" label="Devices Online" value={total > 0 ? `${online}/${total}` : null} />
    </div>
  );
}
