import { useEffect, useMemo, useState } from 'react';
import { GitFork } from 'lucide-react';
import { useDeviceStore, historyFor, historyFetchedAt } from '@/stores/deviceStore';
import { getHistory } from '@/lib/bridgeClient';
import { TIMING } from '@/lib/timing';
import { useNowTick } from '@/lib/useNowTick';
import type { SyncStatus } from '@/lib/dataQuality';
import { InfoHint } from '@/components/ui/InfoHint';
import { Skeleton } from '@/components/ui/Skeleton';
import { HistoryAreaChart } from '@/components/analytics/HistoryAreaChart';
import { prepareSummedSeries } from '@/components/analytics/analyticsMath';

/**
 * Facility-wide power over time — the same chart design Analytics uses (`HistoryAreaChart`:
 * always-visible axes, gridlines revealed on hover, a tooltip reading the exact time and value).
 *
 * There is no single building-wide history endpoint — only per-device — so this self-fetches
 * each branch meter's own 24h series and sums them client-side, the same derivation
 * `_totals.total_power_w` itself uses server-side in `shared/buildLatest.mjs`. The chart's latest
 * point is the history buffer's last sample, while Live Demand reads the live feed, so the two can
 * differ by up to a sample interval.
 *
 * RM-076: THE SUM IS TAKEN MINUTE BY MINUTE. `sumHistories` added the meters' series by array
 * position, right-aligned to the shortest, which paired readings up to two minutes apart and put a
 * meter with one sample fewer a minute out for the whole day. `prepareSummedSeries` sums on the
 * shared time grid; a minute any meter cannot vouch for is a gap, drawn as what it is.
 *
 * This card's fetch also keeps the building meters' 24h history in the store, which is what
 * Overview's Energy Breakdown reads to check for a frozen meter (RM-077).
 */
const MAX_POINTS = 120;

export function EnergyFlowCard() {
  const devices = useDeviceStore((s) => s.devices);
  const historyMap = useDeviceStore((s) => s.history);
  const meterIds = useMemo(() => devices.filter((d) => d.class === 'meter').map((d) => d.id), [devices]);
  const meterKey = meterIds.join(',');
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; failures: number; lastError: string | null }>({ status: 'loading', failures: 0, lastError: null });
  const minute = Math.floor(useNowTick() / 60_000) * 60_000;

  useEffect(() => {
    if (meterIds.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const results = await Promise.all(meterIds.map((id) => getHistory(id, '24h')));
        if (cancelled) return;
        for (let i = 0; i < meterIds.length; i++) useDeviceStore.getState().setHistory(meterIds[i], results[i].points, '24h');
        setState({ status: 'ready', failures: 0, lastError: null });
      } catch (err) {
        if (!cancelled) setState((s) => ({ status: 'error', failures: s.failures + 1, lastError: err instanceof Error ? err.message : String(err) }));
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

  const fetchedAt = useDeviceStore((s) => {
    let latest: number | null = null;
    for (const id of meterIds) {
      const at = historyFetchedAt(s.history, id, '24h');
      if (at !== null && (latest === null || at > latest)) latest = at;
    }
    return latest;
  });

  // Always 24h here — this card is Overview's, and Analytics may have left a longer range in the store.
  const series = useMemo(
    () => prepareSummedSeries(meterIds.map((id) => historyFor(historyMap, id, '24h')), 'power', { range: '24h', nowMs: minute, maxPoints: MAX_POINTS }),
    [meterIds, historyMap, minute],
  );
  const sync: SyncStatus = { settled: state.status !== 'loading', fetchedAt, failures: state.failures, lastError: state.lastError, refetchMs: TIMING.HISTORY_SAMPLE_MS, source: 'bridge' };
  const loading = state.status === 'loading' && series.rows.length === 0;

  return (
    <div className="card energy-flow-card">
      <div className="card-head">
        <h3 className="card-title">
          <GitFork size={14} className="title-icon" aria-hidden="true" />
          Energy Flow
          <InfoHint label="How this series is derived">
            Total facility power over time, summed minute by minute from the branch meters' own history — the same sum `_totals.total_power_w` uses. The chart's latest point can
            lag the Live Demand card by up to a minute: history samples once a minute, Live Demand reads the live feed. A shaded band is a stretch where a meter had no reading.
          </InfoHint>
        </h3>
      </div>

      {loading ? (
        <Skeleton className="energy-flow-chart" height="100%" />
      ) : series.rows.length === 0 ? (
        <p className="section-placeholder">{state.status === 'error' ? 'History unavailable right now.' : 'No history yet — the buffer fills at 1 point/min.'}</p>
      ) : (
        <HistoryAreaChart series={series} color="var(--accent)" name="Facility" className="energy-flow-chart" sync={sync} />
      )}
    </div>
  );
}
