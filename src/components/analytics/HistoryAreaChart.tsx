import { useId, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { CHART_PARAMS, formatParamValue, pointValue, type ChartParam } from './chartParams';
import type { HistoryPoint } from '@/lib/types';

/**
 * The single power-history area chart both the per-source cards (`SourceCard`) and the
 * selected-source panel (`AnalyticsPage`) render — same behaviour as the main "Power · 24 h"
 * chart: always-visible axes, gridlines that fade in on hover/touch (`.chart-frame` +
 * `--axes-visible`, opacity-only so nothing shifts — see index.css), and a `Tooltip` reading
 * out the exact time/power pair under the cursor.
 *
 * Extracted rather than copied into the second caller: the two would have drifted the same
 * way the three device-icon maps did before Phase O consolidated them.
 */
export function HistoryAreaChart({
  history,
  color,
  name,
  className,
  maxPoints = 60,
  param = 'power',
}: {
  history: HistoryPoint[] | undefined;
  color: string;
  name: string;
  className: string;
  maxPoints?: number;
  param?: ChartParam;
}) {
  // `v` is undefined for any point that never carried this parameter — kept undefined
  // rather than dropped, so the gap stays at its real position on the time axis.
  const data = useMemo(
    () => (history ?? []).slice(-maxPoints).map((p) => ({ t: Date.parse(p.ts), v: pointValue(p, param) })),
    [history, maxPoints, param],
  );
  const gradientId = `history-area-${useId()}`;
  const [revealed, setRevealed] = useState(false);
  const revealHandlers = { onMouseEnter: () => setRevealed(true), onMouseLeave: () => setRevealed(false), onTouchStart: () => setRevealed(true) };

  const withValue = data.filter((d) => d.v !== undefined);
  if (withValue.length === 0) return <div className={className} />;
  const latest = withValue[withValue.length - 1].v!;

  return (
    <div
      className={`${className} chart-frame chart-frame--axes-visible${revealed ? ' chart-frame--revealed' : ''}`}
      role="img"
      aria-label={`${name} ${CHART_PARAMS[param].label.toLowerCase()} over recent history, ${withValue.length} samples, currently ${formatParamValue(latest, param)}.`}
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
          <YAxis stroke="var(--muted)" fontSize={9} width={34} tickLine={false} domain={param === 'voltage' ? ['auto', 'auto'] : undefined} />
          <Tooltip
            labelFormatter={(t) => new Date(t as number).toLocaleTimeString('en-PH', { hour12: false })}
            formatter={(v) => [formatParamValue(Number(v), param), CHART_PARAMS[param].label]}
            contentStyle={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
          />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.3} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatTick(t: number): string {
  return new Date(t).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
