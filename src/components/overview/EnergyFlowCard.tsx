import { useEffect, useMemo, useState } from 'react';
import { GitFork } from 'lucide-react';
import { useDeviceStore, historyFor } from '@/stores/deviceStore';
import { getHistory } from '@/lib/bridgeClient';
import { TIMING } from '@/lib/timing';
import { InfoHint } from '@/components/ui/InfoHint';
import { Skeleton } from '@/components/ui/Skeleton';
import { HistoryAreaChart } from '@/components/analytics/HistoryAreaChart';
import { sumHistories } from './totalPowerSeries';

/**
 * Facility-wide power over time — the same chart design Analytics uses (`HistoryAreaChart`:
 * always-visible axes, gridlines revealed on hover, a tooltip reading the exact time/power
 * pair), rather than the previous tier-diagram treatment. Per explicit direction: a graph
 * with axes for total power and time, not a decomposition.
 *
 * There is no single building-wide history endpoint — only per-device — so this self-fetches
 * each branch meter's own 24h series and sums them client-side (`sumHistories`), the same
 * derivation `_totals.total_power_w` itself uses server-side in `shared/buildLatest.mjs`.
 * That makes the two the SAME quantity, not necessarily the same NUMBER at a given instant:
 * this chart's latest point is the history buffer's last sample (once per
 * `TIMING.HISTORY_SAMPLE_MS`, 60s), while Live Demand reads the live WebSocket feed
 * (~2s) — the two can differ by up to a sample interval's worth of drift, same relationship
 * Analytics' own "Power · 24 h" chart has to any live reading elsewhere on that page.
 * Fetch/refetch pattern matches every other self-fetching Overview card
 * (`useAnalyticsHistory`, the former `EdgeBufferCard`).
 */
const MAX_POINTS = 120;

export function EnergyFlowCard() {
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
        for (let i = 0; i < meterIds.length; i++) useDeviceStore.getState().setHistory(meterIds[i], results[i].points, '24h');
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

  // Always 24h here — this card is Overview's, and Analytics may have left 7d/30d
  // points in the shared map.
  const total = useMemo(() => sumHistories(meterIds.map((id) => historyFor(historyMap, id, '24h'))), [meterIds, historyMap]);
  const loading = status === 'loading' && total.length === 0;

  return (
    <div className="card energy-flow-card">
      <div className="card-head">
        <h3 className="card-title">
          <GitFork size={14} className="title-icon" aria-hidden="true" />
          Energy Flow
          <InfoHint label="How this series is derived">
            Total facility power over time, summed client-side from the 4 CHNT branch meters' own history — the same sum `_totals.total_power_w` uses. The chart's latest point can lag
            the Live Demand card by up to a minute: history samples once a minute, Live Demand reads the live feed.
          </InfoHint>
        </h3>
      </div>

      {loading ? (
        <Skeleton className="energy-flow-chart" height="100%" />
      ) : total.length === 0 ? (
        <p className="section-placeholder">{status === 'error' ? 'History unavailable right now.' : 'No history yet — the buffer fills at 1 point/min.'}</p>
      ) : (
        <HistoryAreaChart history={total} color="var(--accent)" name="Facility" className="energy-flow-chart" maxPoints={MAX_POINTS} />
      )}
    </div>
  );
}
