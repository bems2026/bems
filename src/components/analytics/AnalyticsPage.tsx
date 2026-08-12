import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Gauge, Plug } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { Skeleton } from '@/components/ui/Skeleton';
import { Sparkline } from '@/components/ui/Sparkline';
import { InfoHint } from '@/components/ui/InfoHint';
import { useAnalyticsHistory } from './useAnalyticsHistory';
import { buildChartRows } from './analyticsMath';
import { SourceCard } from './SourceCard';
import { UntrackedLoadCard } from './UntrackedLoadCard';
import type { Device, Reading } from '@/lib/types';

const MAX_CHART_POINTS = 140;
/** v4's own 7-color cycle (amber, blue, green, purple, plus 3 more) — decoration only, so
 * literal hex/bright vars are fine here the same way `scene3d/tokens.ts`'s SCENE_PALETTE is. */
const PALETTE = ['var(--accent)', 'var(--blue-bright)', 'var(--green-bright)', 'var(--purple-bright)', 'var(--red-bright)', '#0ea5e9', '#db2777'];

type Scope = 'branches' | 'outlets';

/**
 * v4's Analytics tab, re-themed into the M1 glass tokens (the source design ships this
 * page as un-restyled v3 markup — see the Phase M plan §6.2) and rebuilt against real data.
 *
 * v4's own param toggle (Voltage | Current | Power | Energy) is dropped: the bridge's
 * history ring buffer stores power_w only (see `TrendChart.tsx`'s docblock) — there is no
 * real time series for the other three params, and a toggle that visibly did nothing to
 * the chart would be its own kind of dishonesty. The main chart stays Power-only; the
 * stat rail and every branch/outlet card still show real, instantaneous V/A/W/kWh — those
 * ARE real point values, just not real histories.
 */
export function AnalyticsPage() {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const historyMap = useDeviceStore((s) => s.history);
  const { branchIds, outletIds, status } = useAnalyticsHistory();

  const [scope, setScope] = useState<Scope>('branches');
  const [selectedByScope, setSelectedByScope] = useState<Record<Scope, string | null>>({ branches: null, outlets: null });
  // Phase O: axes/gridlines stay hidden (opacity 0, still occupying their reserved space —
  // see `.chart-frame` in index.css) until the chart is hovered or touched.
  const [chartRevealed, setChartRevealed] = useState(false);
  const revealHandlers = {
    onMouseEnter: () => setChartRevealed(true),
    onMouseLeave: () => setChartRevealed(false),
    onTouchStart: () => setChartRevealed(true),
  };

  const branchDevices = useMemo(() => branchIds.map((id) => devices.find((d) => d.id === id)).filter((d): d is Device => !!d), [branchIds, devices]);
  const outletDevices = useMemo(() => outletIds.map((id) => devices.find((d) => d.id === id)).filter((d): d is Device => !!d), [outletIds, devices]);
  const scopeDevices = scope === 'branches' ? branchDevices : outletDevices;
  const scopeIds = scopeDevices.map((d) => d.id);

  const selectedId = selectedByScope[scope] && scopeIds.includes(selectedByScope[scope]!) ? selectedByScope[scope]! : (scopeIds[0] ?? null);
  const selectDevice = (id: string) => setSelectedByScope((s) => ({ ...s, [scope]: id }));

  const rows = useMemo(() => buildChartRows(scopeIds, historyMap, MAX_CHART_POINTS), [scopeIds, historyMap]);
  const selectedDevice = scopeDevices.find((d) => d.id === selectedId);
  const selectedReading = selectedId ? readings[selectedId] : undefined;

  if (devices.length === 0) {
    return (
      <div className="analytics-page" aria-busy="true" aria-label="Loading analytics">
        <Skeleton height="400px" />
      </div>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Power Analytics</h1>
          <p className="page-sub">
            24h power draw
            <InfoHint label="What this covers">The 4 CHNT branch meters and the 7 individually-metered outlets.</InfoHint>
          </p>
        </div>
        <div className="analytics-scope-toggle" role="group" aria-label="Scope">
          <button type="button" className={`analytics-scope-btn${scope === 'branches' ? ' analytics-scope-btn--active' : ''}`} onClick={() => setScope('branches')}>
            Branches
          </button>
          <button type="button" className={`analytics-scope-btn${scope === 'outlets' ? ' analytics-scope-btn--active' : ''}`} onClick={() => setScope('outlets')}>
            Outlets
          </button>
        </div>
      </header>

      <div className="analytics-main-grid">
        <div className="card analytics-chart-card">
          <div className="card-head">
            <h3 className="card-title">
              <Activity size={14} className="title-icon" aria-hidden="true" />
              Power · 24 h
            </h3>
            <div className="analytics-legend">
              {scopeDevices.map((d, i) => (
                <button
                  key={d.id}
                  type="button"
                  className="analytics-legend__item"
                  style={{ color: d.id === selectedId ? 'var(--txt)' : 'var(--faint)' }}
                  onClick={() => selectDevice(d.id)}
                >
                  <span className="analytics-legend__swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
                  {d.display_name}
                </button>
              ))}
            </div>
          </div>
          {status === 'loading' && rows.length === 0 ? (
            <Skeleton height="440px" />
          ) : rows.length === 0 ? (
            <p className="section-placeholder">{status === 'error' ? 'History unavailable right now.' : 'No history yet — the buffer fills at 1 point/min.'}</p>
          ) : (
            <div
              className={`chart-frame${chartRevealed ? ' chart-frame--revealed' : ''}`}
              role="img"
              aria-label={`Power over the last 24 hours across ${scopeDevices.length} ${scope}, ${rows.length} samples.`}
              {...revealHandlers}
            >
              <ResponsiveContainer width="100%" height={440}>
                <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatTick} stroke="var(--muted)" fontSize={11} tickLine={false} />
                  <YAxis stroke="var(--muted)" fontSize={11} width={44} tickLine={false} />
                  <Tooltip
                    labelFormatter={(t) => new Date(t as number).toLocaleString('en-PH', { hour12: false })}
                    formatter={(v, name) => [`${Number(v).toFixed(0)} W`, scopeDevices.find((d) => d.id === name)?.display_name ?? String(name)]}
                    contentStyle={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}
                  />
                  {scopeDevices.map((d, i) => (
                    <Line
                      key={d.id}
                      type="monotone"
                      dataKey={d.id}
                      name={d.id}
                      stroke={PALETTE[i % PALETTE.length]}
                      strokeWidth={d.id === selectedId ? 1.8 : 1.1}
                      strokeOpacity={d.id === selectedId ? 1 : 0.35}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card analytics-stat-card">
          <h3 className="card-title">{selectedDevice?.display_name ?? 'No source selected'}</h3>
          {selectedDevice && <SelectedStatPanel reading={selectedReading} />}
          <div className="analytics-stat-card__spark-label">24 H</div>
          <Sparkline values={(selectedId ? (historyMap[selectedId] ?? []) : []).slice(-140).map((p) => p.power_w)} height={150} color="var(--blue-bright)" />
          <p className="analytics-stat-card__note">{scope === 'branches' ? 'Feeder measured at the main CHNT panel CT.' : 'Socket-level meter inside the outlet module.'}</p>
        </div>
      </div>

      <SourceSection title="Branches" tag="CHNT CT · 4 FEEDERS" devices={branchDevices} scope="branches" activeScope={scope} selectedId={selectedByScope.branches} onSelect={(id) => { setScope('branches'); selectDevice(id); }} className="analytics-branch-grid" />
      <SourceSection title="Outlets" tag="EACH SOCKET METERED" devices={outletDevices} scope="outlets" activeScope={scope} selectedId={selectedByScope.outlets} onSelect={(id) => { setScope('outlets'); selectDevice(id); }} className="analytics-outlet-grid" />

      <UntrackedLoadCard branchIds={branchIds} outletIds={outletIds} />
    </>
  );
}

function SelectedStatPanel({ reading }: { reading: Reading | undefined }) {
  const stats = [
    { label: 'VOLTAGE', value: reading?.voltage, digits: 1, unit: 'V' },
    { label: 'CURRENT', value: reading?.current, digits: 2, unit: 'A' },
    { label: 'POWER', value: reading?.power_w !== undefined ? reading.power_w / 1000 : undefined, digits: 3, unit: 'kW' },
    { label: 'ENERGY', value: reading?.energy_kwh_today, digits: 2, unit: 'kWh today' },
  ];
  return (
    <div className="analytics-stat-grid">
      {stats.map((s) => (
        <div className="analytics-stat-tile" key={s.label}>
          <div className="analytics-stat-tile__label">{s.label}</div>
          <div className="analytics-stat-tile__value">{typeof s.value === 'number' ? s.value.toFixed(s.digits) : '—'}</div>
          <div className="analytics-stat-tile__unit">{s.unit}</div>
        </div>
      ))}
    </div>
  );
}

function SourceSection({
  title,
  tag,
  devices,
  scope,
  activeScope,
  selectedId,
  onSelect,
  className,
}: {
  title: string;
  tag: string;
  devices: Device[];
  scope: Scope;
  activeScope: Scope;
  selectedId: string | null;
  onSelect: (id: string) => void;
  className: string;
}) {
  if (devices.length === 0) return null;
  const SectionIcon = scope === 'branches' ? Gauge : Plug;
  return (
    <div className="analytics-cards-section">
      <div className="analytics-cards-section__head">
        <span className="analytics-cards-section__title">
          <SectionIcon size={14} className="title-icon" aria-hidden="true" />
          {title}
        </span>
        <span className="analytics-cards-section__tag">{tag}</span>
      </div>
      <div className={className}>
        {devices.map((d, i) => (
          <SourceCard key={d.id} device={d} color={PALETTE[i % PALETTE.length]} selected={activeScope === scope && selectedId === d.id} onSelect={() => onSelect(d.id)} />
        ))}
      </div>
    </div>
  );
}

function formatTick(t: number): string {
  return new Date(t).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
