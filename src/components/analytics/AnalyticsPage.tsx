import { useMemo, useState } from 'react';
import { siteDate, siteTimeShort } from '@/lib/siteTime';
import { PageHeader } from '@/components/layout/PageHeader';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts';
import { Activity, Gauge, Plug } from 'lucide-react';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { HistoryAreaChart } from './HistoryAreaChart';
import { InfoHint } from '@/components/ui/InfoHint';
import { useAnalyticsHistory, type AnalyticsRange } from './useAnalyticsHistory';
import { supabase } from '@/config/supabase';
import { buildChartRows, liveSampleOf, prepareSeries, seriesKey, type TooltipSeries } from './analyticsMath';
import { CHART_PARAMS, CHART_PARAM_ORDER, type ChartParam } from './chartParams';
import { SourceCard } from './SourceCard';
import { EnergySection } from './EnergySection';
import { UntrackedLoadCard } from './UntrackedLoadCard';
import { SpaceTotalsCard } from './SpaceTotalsCard';
import { ChartTooltip } from './ChartTooltip';
import { DataQualityBadge } from './DataQualityBadge';
import type { Device, Reading } from '@/lib/types';
import type { SyncStatus } from '@/lib/dataQuality';
import { GRID_STEP_MS, summarizeQuality, type SlotQuality } from '@/lib/timeseries';
import { formatNumber } from '@/lib/format';
import { measured } from '@/lib/staleness';
import { useNowTick } from '@/lib/useNowTick';

const MAX_CHART_POINTS = 140;
const SELECTED_POINTS = 140;
/** v4's own 7-color cycle (amber, blue, green, purple, plus 3 more) — decoration only, so
 * literal hex/bright vars are fine here the same way `scene3d/tokens.ts`'s SCENE_PALETTE is. */
const PALETTE = ['var(--accent)', 'var(--blue-bright)', 'var(--green-bright)', 'var(--purple-bright)', 'var(--red-bright)', '#0ea5e9', '#db2777'];

/** A scope is an Analytics group id from the catalog, no longer a closed union. */
type Scope = string;

/**
 * Per-group presentation. Deliberately a lookup WITH a fallback rather than a
 * `Record<Scope, …>`: a group that nobody has styled yet must still render — appearing plain
 * is recoverable, disappearing silently is the failure this whole change exists to remove.
 */
const GROUP_PRESENTATION: Record<string, { title: string; tag: string; icon: typeof Gauge; gridClass: string }> = {
  branches: { title: 'Branches', tag: 'CHNT CT · 4 FEEDERS', icon: Gauge, gridClass: 'analytics-branch-grid' },
  outlets: { title: 'Outlets', tag: 'EACH SOCKET METERED', icon: Plug, gridClass: 'analytics-outlet-grid' },
};
const presentationFor = (scope: Scope) =>
  GROUP_PRESENTATION[scope] ?? { title: scope, tag: '', icon: Gauge, gridClass: 'analytics-outlet-grid' };

// '1 y' crosses the retention boundary into `readings_hourly` — see
// `readings_archive` in supabase/phase10_history_archive.sql. Both Records are keyed by
// `AnalyticsRange`, so adding a range without a label is a type error, not a blank button.
const RANGE_LABEL: Record<AnalyticsRange, string> = { '24h': '24 h', '7d': '7 d', '30d': '30 d', '1y': '1 y' };
const RANGE_WORDS: Record<AnalyticsRange, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days', '1y': 'year' };

/**
 * v4's Analytics tab, re-themed into the M1 glass tokens and rebuilt against real data.
 *
 * The Power | Voltage | Current toggle is real: the ring buffer records voltage and current
 * alongside power on every poll, so each is an actual measured series. v4's fourth param — Energy —
 * is still absent, because `energy_kwh_today` is a cumulative counter that resets at midnight, not
 * an instantaneous signal to plot beside the other three.
 *
 * RM-076 — WHAT EACH CHART NOW SAYS ABOUT ITSELF. Every series is put on one time grid before it is
 * drawn (`lib/timeseries.ts`), devices are joined minute to minute rather than by array position,
 * and each stretch is drawn as what it is: measured solid, a bridged flicker dashed, a frozen meter
 * dotted, an outage as a labelled band. The badge above the chart says whether the history is
 * current and how much of it was bridged or missing; the tooltip gives the exact time, the raw
 * value and the source. Each card sits in its own error boundary, so one malformed reading takes
 * down one card, not the page.
 */
export function AnalyticsPage() {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const historyMap = useDeviceStore((s) => s.history);
  const [range, setRange] = useState<AnalyticsRange>('24h');
  const { byGroup, branchIds, outletIds, status, sync } = useAnalyticsHistory(range);
  // Long-range history is Supabase-backed — only offer those options
  // when it's actually configured, rather than showing buttons that would just error.
  const longRangeAvailable = supabase !== null;
  const minute = Math.floor(useNowTick() / 60_000) * 60_000;

  const scopes = useMemo(() => Object.keys(byGroup), [byGroup]);
  const [scopeState, setScope] = useState<Scope>('branches');
  // A scope that no longer exists (a class removed from the registry) falls back to the first
  // real one rather than rendering an empty page under a live-looking heading.
  const scope = scopes.includes(scopeState) ? scopeState : (scopes[0] ?? 'branches');
  const [param, setParam] = useState<ChartParam>('power');
  const [selectedByScope, setSelectedByScope] = useState<Record<Scope, string | null>>({});
  // Phase O: axes/gridlines stay hidden (opacity 0, still occupying their reserved space —
  // see `.chart-frame` in index.css) until the chart is hovered or touched.
  const [chartRevealed, setChartRevealed] = useState(false);
  const revealHandlers = {
    onMouseEnter: () => setChartRevealed(true),
    onMouseLeave: () => setChartRevealed(false),
    onTouchStart: () => setChartRevealed(true),
  };

  const devicesFor = useMemo(() => {
    const byId = new Map(devices.map((d) => [d.id, d]));
    const out: Record<string, Device[]> = {};
    for (const [group, ids] of Object.entries(byGroup)) {
      out[group] = ids.map((id) => byId.get(id)).filter((d): d is Device => !!d);
    }
    return out;
  }, [byGroup, devices]);
  const scopeDevices = useMemo(() => devicesFor[scope] ?? [], [devicesFor, scope]);
  const scopeIds = useMemo(() => scopeDevices.map((d) => d.id), [scopeDevices]);

  const selectedId = selectedByScope[scope] && scopeIds.includes(selectedByScope[scope]!) ? selectedByScope[scope]! : (scopeIds[0] ?? null);
  const selectDevice = (id: string) => setSelectedByScope((s) => ({ ...s, [scope]: id }));

  const scopedHistory = useMemo(() => Object.fromEntries(scopeIds.map((id) => [id, historyFor(historyMap, id, range)])), [scopeIds, historyMap, range]);
  // The live tail only means something on the bridge's own minute grid; a stored bucket is an average.
  const liveById = useMemo(
    () => (range === '24h' ? Object.fromEntries(scopeIds.map((id) => [id, liveSampleOf(readings[id], param, minute)])) : undefined),
    [range, scopeIds, readings, param, minute],
  );
  const model = useMemo(
    () => buildChartRows(scopeIds, scopedHistory, MAX_CHART_POINTS, param, { range, nowMs: minute, live: liveById }),
    [scopeIds, scopedHistory, param, range, minute, liveById],
  );
  const rows = model.rows;
  const tooltipSeries: TooltipSeries[] = useMemo(() => scopeDevices.map((d, i) => ({ key: d.id, name: d.display_name, color: PALETTE[i % PALETTE.length] })), [scopeDevices]);
  const chartQuality = useMemo(() => {
    const total = summarizeQuality([]);
    for (const id of scopeIds) {
      const q = model.quality[id];
      if (q) for (const k of Object.keys(total) as SlotQuality[]) total[k] += q[k];
    }
    return total;
  }, [model, scopeIds]);
  const gapCount = scopeIds.reduce((n, id) => n + (model.gaps[id]?.length ?? 0), 0);
  const frozenNames = scopeDevices.filter((d) => (model.frozen[d.id]?.length ?? 0) > 0).map((d) => d.display_name);

  const selectedDevice = scopeDevices.find((d) => d.id === selectedId);
  const selectedReading = selectedId ? readings[selectedId] : undefined;
  const selectedSeries = useMemo(
    () =>
      selectedId
        ? prepareSeries(historyFor(historyMap, selectedId, range), param, { range, nowMs: minute, maxPoints: SELECTED_POINTS, live: liveById?.[selectedId] })
        : undefined,
    [selectedId, historyMap, range, param, minute, liveById],
  );

  if (devices.length === 0) {
    return (
      <div className="analytics-page" aria-busy="true" aria-label="Loading analytics">
        <Skeleton height="400px" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Power & Energy Analytics"
        sub={
          <>
            {RANGE_LABEL[range]} trends · consumption totals
            <InfoHint label="What this page covers">
              Power, voltage, and current over the last {RANGE_WORDS[range]} for the branch meters and the individually-metered outlets, plus the building's energy consumed
              today, this week, and this month. {longRangeAvailable ? 'Anything past 24 h reads from stored history — the bridge itself only keeps a 24 h buffer. ' : ''}
              Solid lines are measurements. A dashed segment bridges a gap of two minutes or less between two real readings; a dotted grey line is a meter that repeated one
              reading unchanged for an hour or more; a shaded band is a stretch with no readings at all. Hover a chart for the exact time, the raw value and where it came from.
            </InfoHint>
          </>
        }
        actions={
          <div className="analytics-toggles">
            {longRangeAvailable && (
              <div className="analytics-scope-toggle" role="group" aria-label="Time range">
                {(['24h', '7d', '30d', '1y'] as const).map((r) => (
                  <button key={r} type="button" className={`analytics-scope-btn${range === r ? ' analytics-scope-btn--active' : ''}`} aria-pressed={range === r} onClick={() => setRange(r)}>
                    {RANGE_LABEL[r]}
                  </button>
                ))}
              </div>
            )}
            <div className="analytics-scope-toggle" role="group" aria-label="Parameter">
              {CHART_PARAM_ORDER.map((p) => (
                <button key={p} type="button" className={`analytics-scope-btn${param === p ? ' analytics-scope-btn--active' : ''}`} aria-pressed={param === p} onClick={() => setParam(p)}>
                  {CHART_PARAMS[p].label}
                </button>
              ))}
            </div>
            <div className="analytics-scope-toggle" role="group" aria-label="Scope">
              {scopes.map((g) => (
                <button key={g} type="button" className={`analytics-scope-btn${scope === g ? ' analytics-scope-btn--active' : ''}`} aria-pressed={scope === g} onClick={() => setScope(g)}>
                  {presentationFor(g).title}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="analytics-main-grid">
        <div className="card analytics-chart-card">
          <div className="card-head">
            <h3 className="card-title">
              <Activity size={14} className="title-icon" aria-hidden="true" />
              {CHART_PARAMS[param].label} · {RANGE_LABEL[range]}
            </h3>
            <div className="analytics-legend">
              {scopeDevices.map((d, i) => (
                <button
                  key={d.id}
                  type="button"
                  className="analytics-legend__item"
                  // --muted-2, not --faint: this is a 10px interactive label, and --faint is
                  // documented in index.css as decoration-only (under 3:1 on every surface here).
                  style={{ color: d.id === selectedId ? 'var(--txt)' : 'var(--muted-2)' }}
                  aria-pressed={d.id === selectedId}
                  onClick={() => selectDevice(d.id)}
                >
                  <span className="analytics-legend__swatch" style={{ background: PALETTE[i % PALETTE.length] }} />
                  {d.display_name}
                </button>
              ))}
            </div>
          </div>
          <div className="analytics-chart-card__quality">
            <DataQualityBadge sync={sync} quality={chartQuality} gapCount={gapCount} frozenNames={frozenNames} stepMs={GRID_STEP_MS[range]} />
          </div>
          <ErrorBoundary scope="This chart" variant="inline" resetKey={model}>
            {status === 'loading' && rows.length === 0 ? (
              <Skeleton height="440px" />
            ) : rows.length === 0 ? (
              <p className="section-placeholder">
                {status === 'error'
                  ? 'History unavailable right now.'
                  : range === '24h'
                    ? 'No history yet — the buffer fills at 1 point/min.'
                    : `No ${RANGE_LABEL[range]} history yet — data accumulates going forward from when ingestion started.`}
              </p>
            ) : (
              <div
                className={`chart-frame chart-frame--axes-visible${chartRevealed ? ' chart-frame--revealed' : ''}`}
                role="img"
                aria-label={`${CHART_PARAMS[param].label} over the last ${RANGE_WORDS[range]} across ${scopeDevices.length} ${scope}, ${rows.length} points${chartQuality.interpolated > 0 ? `, ${chartQuality.interpolated} interpolated samples` : ''}${gapCount > 0 ? `, ${gapCount} gaps` : ''}${frozenNames.length > 0 ? `, frozen readings on ${frozenNames.join(' and ')}` : ''}.`}
                {...revealHandlers}
              >
                <ResponsiveContainer width="100%" height={440}>
                  <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => formatTick(t, range)} stroke="var(--muted)" fontSize={11} tickLine={false} />
                    {/* Voltage sits in a narrow band well above zero (~220-230 V), so a 0-based axis would
                        flatten every real variation into one straight line — it gets an auto domain. */}
                    <YAxis stroke="var(--muted)" fontSize={11} width={44} tickLine={false} domain={param === 'voltage' ? ['auto', 'auto'] : undefined} />
                    {selectedId &&
                      (model.gaps[selectedId] ?? []).map((g) => (
                        <ReferenceArea
                          key={g.fromMs}
                          x1={g.fromMs}
                          x2={g.toMs}
                          ifOverflow="hidden"
                          fill="var(--muted)"
                          fillOpacity={0.14}
                          stroke="none"
                          label={{ value: g.kind === 'offline' ? 'Offline' : 'No data', position: 'insideTop', fill: 'var(--muted-2)', fontSize: 10 }}
                        />
                      ))}
                    <Tooltip content={<ChartTooltip rows={rows} meta={model.meta} series={tooltipSeries} param={param} sync={sync} stepMs={model.stepMs} />} />
                    {scopeDevices.flatMap((d, i) => {
                      const color = PALETTE[i % PALETTE.length];
                      const isSelected = d.id === selectedId;
                      const width = isSelected ? 1.8 : 1.1;
                      const opacity = isSelected ? 1 : 0.35;
                      return [
                        <Line key={d.id} type="monotone" dataKey={d.id} name={d.id} stroke={color} strokeWidth={width} strokeOpacity={opacity} dot={false} isAnimationActive={false} connectNulls={false} />,
                        <Line
                          key={`${d.id}:interpolated`}
                          type="linear"
                          dataKey={seriesKey(d.id, 'interpolated')}
                          stroke={color}
                          strokeWidth={width}
                          strokeOpacity={opacity}
                          strokeDasharray="4 3"
                          dot={false}
                          isAnimationActive={false}
                          connectNulls={false}
                          legendType="none"
                        />,
                        <Line
                          key={`${d.id}:frozen`}
                          type="linear"
                          dataKey={seriesKey(d.id, 'frozen')}
                          stroke="var(--muted)"
                          strokeWidth={width}
                          strokeOpacity={isSelected ? 0.9 : 0.35}
                          strokeDasharray="1 3"
                          dot={false}
                          isAnimationActive={false}
                          connectNulls={false}
                          legendType="none"
                        />,
                      ];
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </ErrorBoundary>
        </div>

        <div className="card analytics-stat-card">
          <h3 className="card-title">{selectedDevice?.display_name ?? 'No source selected'}</h3>
          {selectedDevice && <SelectedStatPanel reading={selectedReading} />}
          <div className="analytics-stat-card__spark-label">
            {CHART_PARAMS[param].label.toUpperCase()} · {RANGE_LABEL[range].toUpperCase()}
          </div>
          <ErrorBoundary scope="This chart" variant="inline" resetKey={selectedSeries}>
            <HistoryAreaChart
              series={selectedSeries}
              color="var(--blue-bright)"
              name={selectedDevice?.display_name ?? 'Selected source'}
              className="analytics-stat-card__chart"
              param={param}
              sync={sync}
            />
          </ErrorBoundary>
        </div>
      </div>

      <ErrorBoundary scope="The energy section" variant="inline" resetKey={historyMap}>
        <EnergySection />
      </ErrorBoundary>

      {scopes.map((g) => (
        <SourceSection
          key={g}
          scope={g}
          devices={devicesFor[g] ?? []}
          activeScope={scope}
          param={param}
          range={range}
          sync={sync}
          resetKey={historyMap}
          selectedId={selectedByScope[g] ?? null}
          onSelect={(id) => {
            setScope(g);
            selectDevice(id);
          }}
        />
      ))}

      <ErrorBoundary scope="Metered vs total" variant="inline" resetKey={historyMap}>
        <UntrackedLoadCard branchIds={branchIds} outletIds={outletIds} range={range} sync={sync} />
      </ErrorBoundary>

      {/* RM-030. Follows the page's range but asks a different question of a different
          source — spaces rather than device groups — so it owns its own selection. */}
      <ErrorBoundary scope="Space totals" variant="inline" resetKey={historyMap}>
        <SpaceTotalsCard range={range} />
      </ErrorBoundary>
    </>
  );
}

function SelectedStatPanel({ reading }: { reading: Reading | undefined }) {
  // Withheld once the reading has expired: this is the largest, most authoritative rendering
  // of a single source's numbers on the page, so a days-old voltage shown here at full size is
  // the most convincing wrong answer the dashboard can give.
  const watts = measured(reading?.power_w, reading);
  const stats = [
    { label: 'VOLTAGE', value: measured(reading?.voltage, reading), digits: 1, unit: 'V' },
    { label: 'CURRENT', value: measured(reading?.current, reading), digits: 2, unit: 'A' },
    { label: 'POWER', value: watts !== undefined ? watts / 1000 : undefined, digits: 3, unit: 'kW' },
    { label: 'ENERGY TODAY', value: measured(reading?.energy_kwh_today, reading), digits: 2, unit: 'kWh' },
  ];
  return (
    <div className="analytics-stat-grid">
      {stats.map((s) => (
        <div className="analytics-stat-tile" key={s.label}>
          <div className="analytics-stat-tile__label">{s.label}</div>
          <div className="analytics-stat-tile__value-row">
            <span className="analytics-stat-tile__value">{formatNumber(s.value, s.digits)}</span>
            <span className="analytics-stat-tile__unit">{s.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One per Analytics group. Title, tag, icon and grid class come from `presentationFor`, which
 * falls back for a group nobody has styled — so a new metered class shows up as a plain
 * section rather than not at all. Each card has its own error boundary, outside the card's own
 * button so the fallback's "Try again" is never a button inside a button.
 */
function SourceSection({
  devices,
  scope,
  activeScope,
  param,
  range,
  sync,
  resetKey,
  selectedId,
  onSelect,
}: {
  devices: Device[];
  scope: Scope;
  activeScope: Scope;
  param: ChartParam;
  range: AnalyticsRange;
  sync: SyncStatus;
  resetKey: unknown;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (devices.length === 0) return null;
  const { title, tag, icon: SectionIcon, gridClass } = presentationFor(scope);
  return (
    <div className="analytics-cards-section">
      <div className="analytics-cards-section__head">
        <span className="analytics-cards-section__title">
          <SectionIcon size={14} className="title-icon" aria-hidden="true" />
          {title}
        </span>
        <span className="analytics-cards-section__tag">{tag}</span>
      </div>
      <div className={gridClass}>
        {devices.map((d, i) => (
          <ErrorBoundary key={d.id} scope={`${d.display_name}'s card`} variant="inline" resetKey={resetKey}>
            <SourceCard device={d} color={PALETTE[i % PALETTE.length]} scope={scope} param={param} range={range} sync={sync} selected={activeScope === scope && selectedId === d.id} onSelect={() => onSelect(d.id)} />
          </ErrorBoundary>
        ))}
      </div>
    </div>
  );
}

/** Time-only ticks read fine across 24h, but the same format across the longer ranges would show
 * indistinguishable repeating times with no way to tell which day a point falls on — those
 * ranges get a date instead. */
function formatTick(t: number, range: AnalyticsRange): string {
  if (range === '24h') {
    return siteTimeShort(t);
  }
  // Over a year, a day-level tick repeats the same handful of visible labels with no way to
  // tell which month a point falls in — the same failure the day-level tick fixed for 7d.
  if (range === '1y') {
    return siteDate(t, { month: 'short', year: '2-digit' });
  }
  return siteDate(t, { month: 'short', day: 'numeric' });
}
