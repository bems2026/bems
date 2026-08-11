import { useEffect, useId, useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useDeviceStore } from '@/stores/deviceStore';
import { getHistory } from '@/lib/bridgeClient';
import { TIMING } from '@/lib/timing';
import { Skeleton } from '@/components/ui/Skeleton';
import { sumHistories } from './totalPowerSeries';
import { downsampleTrend } from '@/components/trends/chartSummary';

const MAX_POINTS = 120;

/**
 * v4's "Edge buffer · 24 h" — total facility power, summed client-side from the 4 branch
 * meters' own history (see `totalPowerSeries.ts`; there's no single building-wide history
 * endpoint). Self-fetches each meter's 24h series on mount and refetches on the bridge's
 * own sample cadence, the same pattern `TrendChart` uses per-device.
 */
export function EdgeBufferCard() {
  const devices = useDeviceStore((s) => s.devices);
  const historyMap = useDeviceStore((s) => s.history);
  const meterIds = useMemo(() => devices.filter((d) => d.class === 'meter').map((d) => d.id), [devices]);
  const meterKey = meterIds.join(',');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (meterIds.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const results = await Promise.all(meterIds.map((id) => getHistory(id, '24h')));
        if (cancelled) return;
        for (let i = 0; i < meterIds.length; i++) useDeviceStore.getState().setHistory(meterIds[i], results[i].points);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- meterKey is the stable proxy for meterIds' contents
  }, [meterKey]);

  const total = useMemo(() => sumHistories(meterIds.map((id) => historyMap[id] ?? [])), [meterIds, historyMap]);
  const loading = status === 'loading' && total.length === 0;
  const data = downsampleTrend(total, MAX_POINTS).map((p) => ({ t: Date.parse(p.ts), kw: p.power_w / 1000 }));
  const gradientId = `edge-buffer-gradient-${useId()}`;

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Edge buffer · 24 h</h3>
        <span className="edge-buffer-head-unit">kW</span>
      </div>
      {loading ? (
        <Skeleton height="120px" />
      ) : data.length === 0 ? (
        <p className="section-placeholder">{status === 'error' ? 'History unavailable right now.' : 'No history yet — the buffer fills at 1 point/min.'}</p>
      ) : (
        <>
          <div role="img" aria-label={`Total facility power over the last 24 hours, ${data.length} samples, currently ${data[data.length - 1].kw.toFixed(2)} kW.`}>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border-faint)" vertical={false} />
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} hide />
                <YAxis hide domain={[0, 'dataMax']} />
                <Tooltip
                  labelFormatter={(t) => new Date(t as number).toLocaleTimeString('en-PH', { hour12: false })}
                  formatter={(v) => [`${Number(v).toFixed(2)} kW`, 'Power']}
                  contentStyle={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                />
                <Area type="monotone" dataKey="kw" stroke="var(--accent)" strokeWidth={2.2} fill={`url(#${gradientId})`} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="edge-buffer-axis">
            <span>{new Date(data[0].t).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
            <span>{new Date(data[data.length - 1].t).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </>
      )}
      <p className="edge-buffer-footnote">Baseline overlay: No data — no baseline defined yet.</p>
    </div>
  );
}
