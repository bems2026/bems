import { useDeviceStore } from '@/stores/deviceStore';
import { Sparkline } from '@/components/ui/Sparkline';
import { isReadingStale } from '@/lib/staleness';
import type { Device } from '@/lib/types';

/**
 * Branches get the same 2x2 VOLTAGE/CURRENT/POWER/ENERGY tile grid the "selected source"
 * panel above uses (`.analytics-stat-grid`/`.analytics-stat-tile`) — 4 feeders, more room
 * per card, so the bigger tiles read fine. Outlets stay a compact single-column list (7
 * cards, no room to spare) — same underlying numbers, denser layout.
 */
export function SourceCard({ device, color, scope, selected, onSelect }: { device: Device; color: string; scope: 'branches' | 'outlets'; selected: boolean; onSelect: () => void }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const history = useDeviceStore((s) => s.history[device.id]);
  const sparkValues = (history ?? []).slice(-60).map((p) => p.power_w);
  const stale = isReadingStale(reading);

  return (
    <button type="button" className={`analytics-source-card${selected ? ' analytics-source-card--selected' : ''}`} style={{ borderColor: selected ? color : undefined }} onClick={onSelect}>
      <div className="analytics-source-card__head">
        <span className="analytics-source-card__dot" style={{ background: color }} aria-hidden="true" />
        <span className="analytics-source-card__name">{device.display_name}</span>
        <span className="analytics-source-card__id mono">{device.id}</span>
        <span className={`analytics-source-card__status${stale ? ' analytics-source-card__status--stale' : ''}`} aria-hidden="true" title={stale ? 'No recent reading' : 'Reporting'} />
      </div>
      {scope === 'branches' ? (
        <div className="analytics-stat-grid analytics-source-card__grid">
          <Tile label="VOLTAGE" value={reading?.voltage} digits={1} unit="V" />
          <Tile label="CURRENT" value={reading?.current} digits={2} unit="A" />
          <Tile label="POWER" value={reading?.power_w !== undefined ? reading.power_w / 1000 : undefined} digits={3} unit="kW" />
          <Tile label="ENERGY" value={reading?.energy_kwh_today} digits={2} unit="kWh" />
        </div>
      ) : (
        <div className="analytics-source-card__stats">
          <Stat label="V" value={reading?.voltage} digits={0} />
          <Stat label="A" value={reading?.current} digits={2} />
          <Stat label="W" value={reading?.power_w} digits={0} />
          <Stat label="kWh" value={reading?.energy_kwh_today} digits={2} />
        </div>
      )}
      <div className="analytics-source-card__chart">
        <Sparkline values={sparkValues} color={color} strokeWidth={1.3} fill />
      </div>
    </button>
  );
}

function Tile({ label, value, digits, unit }: { label: string; value: number | undefined; digits: number; unit: string }) {
  return (
    <div className="analytics-stat-tile">
      <div className="analytics-stat-tile__label">{label}</div>
      <div className="analytics-stat-tile__value">{typeof value === 'number' ? value.toFixed(digits) : '—'}</div>
      <div className="analytics-stat-tile__unit">{unit}</div>
    </div>
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
