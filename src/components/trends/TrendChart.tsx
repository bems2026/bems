import { useEffect, useId, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getHistory } from '@/lib/bridgeClient';
import { useDeviceStore } from '@/stores/deviceStore';
import { TIMING } from '@/lib/timing';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { MetricValue } from '@/components/ui/MetricValue';
import { summarizeTrend, trendStats, downsampleTrend } from './chartSummary';
import type { HistoryResponse } from '@/lib/types';

/** ~1.3px/point at a typical card width — enough resolution to read as a real curve
 * without drawing all 1440 raw samples (24h at 1/min) into a ~180px-tall card, which is
 * what made the old line chart read as noise rather than a shape. */
const MAX_CHART_POINTS = 140;

type Range = HistoryResponse['range'];

interface TrendChartProps {
  deviceId: string;
  title: string;
  range?: Range;
}

/**
 * One reusable chart, parameterized by `deviceId` — not one component per circuit.
 * Lazy-loads its own range on mount (per the Stage 1 plan) and refetches on the same
 * 60s cadence the bridge samples at, so the line keeps advancing without a manual reload.
 *
 * Single-series (power_w only): the bridge's history ring buffer stores just power_w per
 * point — see `docs/bridge-contract.md`'s `/api/readings/history` section — not the
 * multi-line volt/current/energy view the original Stage 1 plan wording described for
 * the legacy Chart.js config. There's nothing else to plot per point.
 *
 * An empty `points` array is a correct state on a freshly started bridge, not an error —
 * the ring buffer fills at 1 point/min — so it renders its own message, distinct from an
 * actual fetch failure.
 */
export function TrendChart({ deviceId, title, range = '24h' }: TrendChartProps) {
  const points = useDeviceStore((s) => s.history[deviceId]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // No reset-to-'loading' on deviceId/range change: callers key each TrendChart by
  // deviceId (see App.tsx), so a genuinely different device is a fresh mount with its
  // own initial 'loading' state, not a prop update on a reused instance.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const res = await getHistory(deviceId, range);
        if (cancelled) return;
        useDeviceStore.getState().setHistory(deviceId, res.points);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      } finally {
        if (!cancelled) timer = setTimeout(load, TIMING.HISTORY_SAMPLE_MS);
      }
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [deviceId, range]);

  const raw = points ?? [];
  const loading = status === 'loading' && raw.length === 0;
  const summary = summarizeTrend(title, range, raw);
  // Peak/average are always computed from the FULL series, never the downsampled one —
  // see trendStats' comment. Only the chart's own `data` prop uses the downsampled points.
  const stats = trendStats(raw);
  const data = downsampleTrend(raw, MAX_CHART_POINTS).map((p) => ({ t: Date.parse(p.ts), power_w: p.power_w }));
  const gradientId = `trend-gradient-${useId()}`;

  return (
    <Card title={title}>
      {loading ? (
        <Skeleton height="180px" />
      ) : data.length === 0 ? (
        <p className="trend-empty">
          {status === 'error' ? 'History unavailable right now.' : 'No history yet — the buffer fills at 1 point/min.'}
        </p>
      ) : (
        <>
          {/* A Recharts SVG conveys nothing to a screen reader on its own — role="img" plus
              this generated aria-label is the chart's only accessible name. role="img" also
              means its descendants aren't individually exposed, so nothing further is
              needed on the AreaChart itself. */}
          <div role="img" aria-label={summary}>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-hi)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--accent-hi)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeOpacity={0.5} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={formatTick}
                  stroke="var(--muted)"
                  fontSize={11}
                  tickLine={false}
                />
                <YAxis stroke="var(--muted)" fontSize={11} width={44} tickLine={false} />
                <Tooltip
                  labelFormatter={(t) => new Date(t as number).toLocaleString('en-PH', { hour12: false })}
                  formatter={(v) => [`${Number(v).toFixed(1)} W`, 'Power']}
                  contentStyle={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border)', borderRadius: 8 }}
                />
                <Area
                  type="monotone"
                  dataKey="power_w"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="trend-stats">
            <div className="trend-stat">
              <span className="metric-label">Peak</span>
              <MetricValue value={stats.peak?.power_w} unit="W" digits={0} size="sm" />
            </div>
            <div className="trend-stat">
              <span className="metric-label">Average</span>
              <MetricValue value={stats.average} unit="W" digits={0} size="sm" />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}

function formatTick(t: number): string {
  return new Date(t).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
