import { useId, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useDeviceStore } from '@/stores/deviceStore';
import { isReadingStale } from '@/lib/staleness';
import type { Device } from '@/lib/types';

const MAX_POINTS = 60;

/**
 * Branches get the same 2x2 VOLTAGE/CURRENT/POWER/ENERGY tile grid the "selected source"
 * panel above uses (`.analytics-stat-grid`/`.analytics-stat-tile`) — 4 feeders, more room
 * per card, so the bigger tiles read fine. Outlets stay a compact single-column list (7
 * cards, no room to spare) — same underlying numbers, denser layout.
 */
export function SourceCard({ device, color, scope, selected, onSelect }: { device: Device; color: string; scope: 'branches' | 'outlets'; selected: boolean; onSelect: () => void }) {
  const reading = useDeviceStore((s) => s.latestReadings[device.id]);
  const history = useDeviceStore((s) => s.history[device.id]);
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
      <SourceChart history={history} color={color} name={device.display_name} />
    </button>
  );
}

/**
 * Same chart system the "Power · 24 h" card uses — a real `AreaChart` with hover/touch-
 * revealed axes and gridlines (`.chart-frame`, opacity-only, no layout shift — see
 * index.css's Phase O comment) and a `Tooltip` reading out the exact time/power pair under
 * the cursor. Replaces the old hand-rolled `Sparkline` here specifically because a
 * sparkline has no axes or tooltip to reveal — the two chart types aren't interchangeable
 * once hover detail is a requirement.
 */
function SourceChart({ history, color, name }: { history: { ts: string; power_w: number }[] | undefined; color: string; name: string }) {
  const data = useMemo(() => (history ?? []).slice(-MAX_POINTS).map((p) => ({ t: Date.parse(p.ts), w: p.power_w })), [history]);
  const gradientId = `source-chart-${useId()}`;
  const [revealed, setRevealed] = useState(false);
  const revealHandlers = { onMouseEnter: () => setRevealed(true), onMouseLeave: () => setRevealed(false), onTouchStart: () => setRevealed(true) };

  if (data.length === 0) return <div className="analytics-source-card__chart" />;

  return (
    <div
      className={`analytics-source-card__chart chart-frame chart-frame--axes-visible${revealed ? ' chart-frame--revealed' : ''}`}
      role="img"
      aria-label={`${name} power over recent history, ${data.length} samples, currently ${data[data.length - 1].w.toFixed(0)} W.`}
      {...revealHandlers}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatTick} stroke="var(--muted)" fontSize={9} tickLine={false} />
          <YAxis stroke="var(--muted)" fontSize={9} width={30} tickLine={false} />
          <Tooltip
            labelFormatter={(t) => new Date(t as number).toLocaleTimeString('en-PH', { hour12: false })}
            formatter={(v) => [`${Number(v).toFixed(0)} W`, 'Power']}
            contentStyle={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
          />
          <Area type="monotone" dataKey="w" stroke={color} strokeWidth={1.3} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatTick(t: number): string {
  return new Date(t).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function Tile({ label, value, digits, unit }: { label: string; value: number | undefined; digits: number; unit: string }) {
  return (
    <div className="analytics-stat-tile">
      <div className="analytics-stat-tile__label">{label}</div>
      <div className="analytics-stat-tile__value-row">
        <span className="analytics-stat-tile__value">{typeof value === 'number' ? value.toFixed(digits) : '—'}</span>
        <span className="analytics-stat-tile__unit">{unit}</span>
      </div>
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
