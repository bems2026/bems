import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getHistory } from '@/lib/bridgeClient';
import { useDeviceStore } from '@/stores/deviceStore';
import { TIMING } from '@/lib/timing';
import { Card } from '@/components/ui/Card';
import type { HistoryResponse } from '@/lib/types';

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

  const data = (points ?? []).map((p) => ({ t: Date.parse(p.ts), power_w: p.power_w }));
  const loading = status === 'loading' && data.length === 0;

  return (
    <Card title={title} action={loading ? <span className="trend-status">Loading…</span> : undefined}>
      {data.length === 0 ? (
        <p className="trend-empty">
          {status === 'error' ? 'History unavailable right now.' : 'No history yet — the buffer fills at 1 point/min.'}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
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
            <Line type="monotone" dataKey="power_w" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function formatTick(t: number): string {
  return new Date(t).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
