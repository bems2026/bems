import { useDeviceStore } from '@/stores/deviceStore';
import { Sparkline } from '@/components/ui/Sparkline';
import type { Device } from '@/lib/types';

export function SourceCard({ device, color, selected, onSelect }: { device: Device; color: string; selected: boolean; onSelect: () => void }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const history = useDeviceStore((s) => s.history[device.id]);
  const sparkValues = (history ?? []).slice(-60).map((p) => p.power_w);

  return (
    <button type="button" className={`analytics-source-card${selected ? ' analytics-source-card--selected' : ''}`} style={{ borderColor: selected ? color : undefined }} onClick={onSelect}>
      <div className="analytics-source-card__head">
        <span className="analytics-source-card__dot" style={{ background: color }} aria-hidden="true" />
        <span className="analytics-source-card__name">{device.display_name}</span>
      </div>
      <div className="analytics-source-card__stats">
        <Stat label="V" value={reading?.voltage} digits={0} />
        <Stat label="A" value={reading?.current} digits={2} />
        <Stat label="W" value={reading?.power_w} digits={0} />
        <Stat label="kWh" value={reading?.energy_kwh_today} digits={2} />
      </div>
      <Sparkline values={sparkValues} height={34} color={color} />
    </button>
  );
}

function Stat({ label, value, digits }: { label: string; value: number | undefined; digits: number }) {
  return (
    <div className="analytics-source-card__stat">
      <span className="analytics-source-card__stat-label">{label}</span>
      <span className="analytics-source-card__stat-value">{typeof value === 'number' ? value.toFixed(digits) : '—'}</span>
    </div>
  );
}
