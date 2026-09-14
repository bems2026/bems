import { useId, useMemo, useState } from 'react';
import { siteDate, siteTimeShort } from '@/lib/siteTime';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from 'recharts';
import type { SyncStatus } from '@/lib/dataQuality';
import { CHART_PARAMS, type ChartParam } from './chartParams';
import { SINGLE, seriesKey, type ChartRow, type PreparedSeries } from './analyticsMath';
import { ChartTooltip } from './ChartTooltip';

const NO_ROWS: ChartRow[] = [];
const LONG_SPAN_MS = 36 * 3_600_000;

/**
 * The single-series area chart the per-source cards (`SourceCard`), the selected-source panel
 * (`AnalyticsPage`) and Overview's Energy Flow render — always-visible axes, gridlines revealed on
 * hover/touch (`.chart-frame` + `--axes-visible`, opacity-only so nothing shifts).
 *
 * RM-076: IT DRAWS WHAT EACH STRETCH IS. It takes a series already put on the time grid
 * (`analyticsMath.prepareSeries`) rather than raw points, and draws:
 *
 *   - measured and live readings as the solid line and fill;
 *   - a bridged gap of at most two minutes as a dashed segment joined to the line either side —
 *     this is what used to be a blank strip every time a device's health flag flickered;
 *   - a frozen stretch as a dotted muted line, never as a measurement;
 *   - a longer gap as a shaded band labelled Offline or No data — the 09-07 Node-RED restart used
 *     to render as the same unexplained blank as the flicker.
 */
export function HistoryAreaChart({
  series,
  color,
  name,
  className,
  param = 'power',
  sync,
  compact = false,
}: {
  series: PreparedSeries | undefined;
  color: string;
  name: string;
  className: string;
  param?: ChartParam;
  sync: SyncStatus;
  /** Too small a card to label its gap bands. */
  compact?: boolean;
}) {
  const gradientId = `history-area-${useId()}`;
  const [revealed, setRevealed] = useState(false);
  const revealHandlers = { onMouseEnter: () => setRevealed(true), onMouseLeave: () => setRevealed(false), onTouchStart: () => setRevealed(true) };
  const rows = series?.rows ?? NO_ROWS;
  const tooltipMeta = useMemo(() => (series?.meta ?? []).map((m) => ({ [SINGLE]: m })), [series]);
  const tooltipSeries = useMemo(() => [{ key: SINGLE, name, color }], [name, color]);

  const drawable = rows.some((r) => r[SINGLE] !== undefined || r[seriesKey(SINGLE, 'interpolated')] !== undefined || r[seriesKey(SINGLE, 'frozen')] !== undefined);
  if (!series || !drawable) return <div className={className} />;

  const first = rows[0].t as number;
  const last = rows[rows.length - 1].t as number;
  const formatTick = (t: number) => (last - first > LONG_SPAN_MS ? siteDate(t, { month: 'short', day: 'numeric' }) : siteTimeShort(t));
  const latest = [...rows].reverse().find((r) => r[SINGLE] !== undefined)?.[SINGLE];
  const q = series.quality;
  const { label: paramLabel, unit } = CHART_PARAMS[param];
  const description = [
    `${name} ${paramLabel.toLowerCase()}: ${q.measured + q.live} measured samples`,
    q.interpolated > 0 ? `${q.interpolated} interpolated` : '',
    q.frozen > 0 ? `${q.frozen} frozen` : '',
    series.gaps.length > 0 ? `${series.gaps.length} ${series.gaps.length === 1 ? 'gap' : 'gaps'}` : '',
    latest !== undefined ? `currently ${Number(latest.toFixed(2))} ${unit}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className={`${className} chart-frame chart-frame--axes-visible${revealed ? ' chart-frame--revealed' : ''}`} role="img" aria-label={`${description}.`} {...revealHandlers}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 2, right: 2, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.35} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={formatTick} stroke="var(--muted)" fontSize={9} tickLine={false} />
          <YAxis stroke="var(--muted)" fontSize={9} width={34} tickLine={false} domain={param === 'voltage' ? ['auto', 'auto'] : undefined} />
          {series.gaps.map((g) => (
            <ReferenceArea
              key={g.fromMs}
              x1={g.fromMs}
              x2={g.toMs}
              ifOverflow="hidden"
              fill="var(--muted)"
              fillOpacity={0.14}
              stroke="none"
              label={compact ? undefined : { value: g.kind === 'offline' ? 'Offline' : 'No data', position: 'insideTop', fill: 'var(--muted-2)', fontSize: 9 }}
            />
          ))}
          <Tooltip content={<ChartTooltip rows={rows} meta={tooltipMeta} series={tooltipSeries} param={param} sync={sync} stepMs={series.stepMs} />} />
          <Area type="monotone" dataKey={SINGLE} stroke={color} strokeWidth={1.3} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} connectNulls={false} />
          <Area
            type="linear"
            dataKey={seriesKey(SINGLE, 'interpolated')}
            stroke={color}
            strokeWidth={1.3}
            strokeDasharray="3 3"
            fill={`url(#${gradientId})`}
            fillOpacity={0.5}
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Area type="linear" dataKey={seriesKey(SINGLE, 'frozen')} stroke="var(--muted)" strokeWidth={1.2} strokeDasharray="1 3" fill="none" dot={false} isAnimationActive={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
