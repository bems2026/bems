import { useMemo, useState } from 'react';
import { siteDate, siteDateTime, siteTimeShort } from '@/lib/siteTime';
import { PageHeader } from '@/components/layout/PageHeader';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Activity, Gauge, Plug } from 'lucide-react';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import { Skeleton } from '@/components/ui/Skeleton';
import { HistoryAreaChart } from './HistoryAreaChart';
import { InfoHint } from '@/components/ui/InfoHint';
import { useAnalyticsHistory, type AnalyticsRange } from './useAnalyticsHistory';
import { supabase } from '@/config/supabase';
import { buildChartRows } from './analyticsMath';
import { CHART_PARAMS, CHART_PARAM_ORDER, formatParamValue, type ChartParam } from './chartParams';
import { SourceCard } from './SourceCard';
import { EnergySection } from './EnergySection';
import { UntrackedLoadCard } from './UntrackedLoadCard';
import { SpaceTotalsCard } from './SpaceTotalsCard';
import type { Device, Reading } from '@/lib/types';
import { formatNumber } from '@/lib/format';
import { measured } from '@/lib/staleness';

const MAX_CHART_POINTS = 140;
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
 * v4's Analytics tab, re-themed into the M1 glass tokens (the source design ships this
 * page as un-restyled v3 markup — see the Phase M plan §6.2) and rebuilt against real data.
 *
 * The Power | Voltage | Current toggle is real: the ring buffer now records voltage and
 * current alongside power on every poll (`build-flow.mjs`'s APPEND_HISTORY and the mock's
 * `sampleHistory`), so each is an actual measured series. It was previously dropped
 * precisely because that data wasn't stored — a toggle that changed nothing would have
 * been its own kind of dishonesty.
 *
 * Two consequences worth keeping in mind: V/A only accrue from the moment a bridge starts
 * recording them, so a long-running bridge shows a gap over the older part of the window
 * (`HistoryPoint`'s optional fields carry that honestly, never a 0), and v4's fourth param
 * — Energy — is still absent, because `energy_kwh_today` is a cumulative counter that
 * resets at midnight, not an instantaneous signal to plot beside the other three.
 */
export function AnalyticsPage() {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const historyMap = useDeviceStore((s) => s.history);
  const [range, setRange] = useState<AnalyticsRange>('24h');
  const { byGroup, branchIds, outletIds, status } = useAnalyticsHistory(range);
  // Long-range history is Supabase-backed — only offer those options
  // when it's actually configured, rather than showing buttons that would just error.
  const longRangeAvailable = supabase !== null;

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
  const branchDevices = devicesFor.branches ?? [];
  const scopeDevices = devicesFor[scope] ?? [];
  const scopeIds = scopeDevices.map((d) => d.id);

  const selectedId = selectedByScope[scope] && scopeIds.includes(selectedByScope[scope]!) ? selectedByScope[scope]! : (scopeIds[0] ?? null);
  const selectDevice = (id: string) => setSelectedByScope((s) => ({ ...s, [scope]: id }));

  // Filter to the active range BEFORE charting. buildChartRows stays a pure function over a
  // plain map; deciding what counts as this range's data is this component's job.
  const scopedHistory = useMemo(
    () => Object.fromEntries(scopeIds.map((id) => [id, historyFor(historyMap, id, range)])),
    [scopeIds, historyMap, range],
  );
  const rows = useMemo(() => buildChartRows(scopeIds, scopedHistory, MAX_CHART_POINTS, param), [scopeIds, scopedHistory, param]);
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
      <PageHeader
        title="Power & Energy Analytics"
        sub={
          <>
            {RANGE_LABEL[range]} trends · consumption totals
            <InfoHint label="What this page covers">
              Power, voltage, and current over the last {RANGE_WORDS[range]} for the 4 CHNT branch meters and the 7 individually-metered outlets, plus the building's energy consumed
              today, this week, and this month.{' '}
              {longRangeAvailable
                ? 'Anything past 24 h reads from Supabase — the bridge itself only keeps a 24 h buffer.'
                : ''}
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
                  // documented in index.css as decoration-only (under 3:1 on every surface
                  // here). Same retarget the stylesheet's own 29 sites got.
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
              aria-label={`${CHART_PARAMS[param].label} over the last ${RANGE_WORDS[range]} across ${scopeDevices.length} ${scope}, ${rows.length} samples.`}
              {...revealHandlers}
            >
              <ResponsiveContainer width="100%" height={440}>
                <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(t) => formatTick(t, range)} stroke="var(--muted)" fontSize={11} tickLine={false} />
                  {/* Voltage sits in a narrow band well above zero (~220-230 V), so a
                      0-based axis would flatten every real variation into one straight
                      line — it gets an auto domain; power/current keep the 0-based default
                      where zero is a meaningful floor. */}
                  <YAxis stroke="var(--muted)" fontSize={11} width={44} tickLine={false} domain={param === 'voltage' ? ['auto', 'auto'] : undefined} />
                  <Tooltip
                    labelFormatter={(t) => siteDateTime(t as number)}
                    formatter={(v, name) => [formatParamValue(Number(v), param), scopeDevices.find((d) => d.id === name)?.display_name ?? String(name)]}
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
                      connectNulls={false}
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
          <div className="analytics-stat-card__spark-label">{CHART_PARAMS[param].label.toUpperCase()} · 24 H</div>
          <HistoryAreaChart
            history={selectedId ? historyFor(historyMap, selectedId, range) : undefined}
            color="var(--blue-bright)"
            name={selectedDevice?.display_name ?? 'Selected source'}
            className="analytics-stat-card__chart"
            maxPoints={140}
            param={param}
          />
        </div>
      </div>

      <EnergySection branchDevices={branchDevices} />

      {scopes.map((g) => (
        <SourceSection
          key={g}
          scope={g}
          devices={devicesFor[g] ?? []}
          activeScope={scope}
          param={param}
          range={range}
          selectedId={selectedByScope[g] ?? null}
          onSelect={(id) => { setScope(g); selectDevice(id); }}
        />
      ))}

      <UntrackedLoadCard branchIds={branchIds} outletIds={outletIds} range={range} />

      {/* RM-030. Follows the page's range but asks a different question of a different
          source — spaces rather than device groups — so it owns its own selection. */}
      <SpaceTotalsCard range={range} />
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
 * section rather than not at all.
 */
function SourceSection({
  devices,
  scope,
  activeScope,
  param,
  range,
  selectedId,
  onSelect,
}: {
  devices: Device[];
  scope: Scope;
  activeScope: Scope;
  param: ChartParam;
  range: string;
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
          <SourceCard key={d.id} device={d} color={PALETTE[i % PALETTE.length]} scope={scope} param={param} range={range} selected={activeScope === scope && selectedId === d.id} onSelect={() => onSelect(d.id)} />
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
