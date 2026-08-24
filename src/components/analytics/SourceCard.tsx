import type { CSSProperties } from 'react';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import { isReadingStale, measured } from '@/lib/staleness';
import { HistoryAreaChart } from './HistoryAreaChart';
import type { ChartParam } from './chartParams';
import type { Device } from '@/lib/types';
import { formatNumber } from '@/lib/format';

/**
 * Branches get the same 2x2 VOLTAGE/CURRENT/POWER/ENERGY tile grid the "selected source"
 * panel above uses (`.analytics-stat-grid`/`.analytics-stat-tile`) — 4 feeders, more room
 * per card, so the bigger tiles read fine. Outlets stay a compact single-column list (7
 * cards, no room to spare) — same underlying numbers, denser layout.
 */
export function SourceCard({ device, color, scope, param, range, selected, onSelect }: { device: Device; color: string; scope: 'branches' | 'outlets'; param: ChartParam; range: string; selected: boolean; onSelect: () => void }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const history = useDeviceStore((s) => historyFor(s.history, device.id, range));
  const stale = isReadingStale(reading);
  // Values are withheld once the reading has expired, so an outlet that reconnected but
  // never reported cannot present a days-old voltage as a current one — see `measured`.
  const volts = measured(reading?.voltage, reading);
  const amps = measured(reading?.current, reading);
  const watts = measured(reading?.power_w, reading);
  const kwhToday = measured(reading?.energy_kwh_today, reading);

  return (
    <button
      type="button"
      className={`analytics-source-card${selected ? ' analytics-source-card--selected' : ''}`}
      // The ring colour is per-source, so it has to be inline; the *thickness* and halo that
      // make selection survive greyscale live in `.analytics-source-card--selected`, which
      // reads the colour back out of `--source-color`.
      style={{ '--source-color': color, borderColor: selected ? color : undefined } as CSSProperties}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="analytics-source-card__head">
        <span className="analytics-source-card__dot" style={{ background: color }} aria-hidden="true" />
        <span className="analytics-source-card__name">{device.display_name}</span>
        <span className="analytics-source-card__id mono">{device.id}</span>
        {/* Was aria-hidden with a `title`, which put the live/stale distinction behind both a
            colour-only cue and an attribute screen readers don't reliably announce on a
            span. The dot stays decorative; the state is now real text for assistive tech. */}
        <span className={`analytics-source-card__status${stale ? ' analytics-source-card__status--stale' : ''}`} aria-hidden="true" />
        <span className="sr-only">{stale ? 'No recent reading' : 'Reporting'}</span>
      </div>
      {scope === 'branches' ? (
        <div className="analytics-stat-grid analytics-source-card__grid">
          <Tile label="VOLTAGE" value={volts} digits={1} unit="V" />
          <Tile label="CURRENT" value={amps} digits={2} unit="A" />
          <Tile label="POWER" value={watts !== undefined ? watts / 1000 : undefined} digits={3} unit="kW" />
          <Tile label="ENERGY" value={kwhToday} digits={2} unit="kWh" />
        </div>
      ) : (
        <div className="analytics-source-card__stats">
          <Stat label="V" value={volts} digits={0} />
          <Stat label="A" value={amps} digits={2} />
          <Stat label="W" value={watts} digits={0} />
          <Stat label="kWh" value={kwhToday} digits={2} />
        </div>
      )}
      <HistoryAreaChart history={history} color={color} name={device.display_name} className="analytics-source-card__chart" param={param} />
    </button>
  );
}

function Tile({ label, value, digits, unit }: { label: string; value: number | undefined; digits: number; unit: string }) {
  return (
    <div className="analytics-stat-tile">
      <div className="analytics-stat-tile__label">{label}</div>
      <div className="analytics-stat-tile__value-row">
        <span className="analytics-stat-tile__value">{formatNumber(value, digits)}</span>
        <span className="analytics-stat-tile__unit">{unit}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, digits }: { label: string; value: number | undefined; digits: number }) {
  return (
    <div className="analytics-source-card__stat">
      <span className="analytics-source-card__stat-label">{label}</span>
      <span className="analytics-source-card__stat-value">{formatNumber(value, digits)}</span>
    </div>
  );
}
