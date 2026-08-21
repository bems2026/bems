import { useEffect, useMemo, useState } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { getHistory } from '@/lib/bridgeClient';
import { getLongHistory, LONG_HISTORY_REFRESH_MS, type LongRange } from '@/lib/supabaseHistory';
import { supabase } from '@/config/supabase';
import { TIMING } from '@/lib/timing';

/** '24h' is the original, bridge-backed range — unchanged. '7d'/'30d' are Phase 4's
 * Supabase-backed addition, only meaningful once `supabase` is configured. */
export type AnalyticsRange = '24h' | LongRange;

/**
 * Self-fetches history for every branch meter AND every outlet — Overview's cards only
 * need the 4 meters, but Analytics' scope toggle needs both sets available regardless of
 * which scope is currently selected, so switching scope never shows a loading flicker.
 *
 * `range` picks the data source, not just a query parameter: '24h' stays on the bridge
 * (the original path, untouched), '7d'/'30d' read from Supabase instead — the bridge's own
 * ring buffer is capped at 24h and has nothing further back to give. Refetch cadence
 * follows the source: the bridge's own 60s sample rate for '24h', a much slower
 * `LONG_HISTORY_REFRESH_MS` for the long ranges (a week/month-wide chart doesn't need
 * per-minute freshness, and polling Supabase that often would be pure waste).
 */
export function useAnalyticsHistory(range: AnalyticsRange = '24h') {
  const devices = useDeviceStore((s) => s.devices);
  const branchIds = useMemo(() => devices.filter((d) => d.class === 'meter').map((d) => d.id), [devices]);
  const outletIds = useMemo(() => devices.filter((d) => d.class === 'outlet_dual').map((d) => d.id), [devices]);
  const allIds = useMemo(() => [...branchIds, ...outletIds], [branchIds, outletIds]);
  const idsKey = allIds.join(',');
  /**
   * The last settled result, TAGGED with the range it settled for — so `status` can be
   * derived rather than stored.
   *
   * It used to be a plain `status` state assigned only inside `load()`, which meant
   * switching 24h -> 7d left it reading 'ready' from the range just navigated away from.
   * The page skipped its skeleton branch and flashed "No 7d history yet — data accumulates
   * going forward from when ingestion started" for the second the fetch took. That sentence
   * is a claim about the data, and it was false: the history existed, it just hadn't
   * arrived.
   *
   * Deriving it fixes that without a setState in the effect body (which would cost a
   * cascading render, and which `react-hooks/set-state-in-effect` rightly rejects): a
   * result for a different range simply isn't a result for this one.
   */
  const [settled, setSettled] = useState<{ range: AnalyticsRange; status: 'ready' | 'error' } | null>(null);
  // Long-range history requested but Supabase isn't configured (e.g. local dev against
  // the mock bridge only) — a derived value, not a setState call, so there's nothing to
  // fetch and nothing to synchronize; fail visibly rather than silently showing stale or
  // empty data as if it were a real answer.
  const longRangeUnavailable = range !== '24h' && !supabase;

  useEffect(() => {
    if (allIds.length === 0 || longRangeUnavailable) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetchMs = range === '24h' ? TIMING.HISTORY_SAMPLE_MS : LONG_HISTORY_REFRESH_MS;

    // Promise.allSettled, not Promise.all: one device's fetch failing (a timeout, a
    // transient network blip) used to reject the whole batch and blank every OTHER
    // device's already-successful chart data too. Partial data beats no data — every
    // existing chart-rendering path in this codebase already treats a missing series as a
    // gap, not an error, so a device that failed this tick just keeps whatever it last
    // had (or stays empty) while everything else updates normally.
    const load = async () => {
      const results =
        range === '24h'
          ? await Promise.allSettled(allIds.map((id) => getHistory(id, '24h').then((r) => r.points)))
          : await Promise.allSettled(allIds.map((id) => getLongHistory(id, range)));
      if (cancelled) return;
      let anySucceeded = false;
      for (let i = 0; i < allIds.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
          anySucceeded = true;
          useDeviceStore.getState().setHistory(allIds[i], result.value, range);
        }
      }
      setSettled({ range, status: anySucceeded ? 'ready' : 'error' });
      if (!cancelled) timer = setTimeout(load, refetchMs);
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey is the stable proxy for allIds' contents
  }, [idsKey, range]);

  // A result for another range is not a result for this one — until this range settles, we
  // are loading, which is what makes the page show its skeleton instead of a false claim.
  const status = settled && settled.range === range ? settled.status : 'loading';

  return { branchIds, outletIds, status: longRangeUnavailable ? 'error' : status };
}
