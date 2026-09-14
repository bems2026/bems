import { useEffect, useMemo, useState } from 'react';
import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { useDeviceStore, historyFetchedAt } from '@/stores/deviceStore';
import { getHistory } from '@/lib/bridgeClient';
import {
  ARCHIVE_RANGES,
  ARCHIVE_REFRESH_MS,
  getArchiveHistory,
  getLongHistory,
  LONG_HISTORY_REFRESH_MS,
  type ArchiveRange,
  type LongRange,
} from '@/lib/supabaseHistory';
import { useDeviceConfigStore } from '@/stores/deviceConfigStore';
import { hasFunction } from '@/lib/deviceFunctions';
import { analyticsGroups, DEVICE_CLASS_CATALOG } from '@/lib/deviceClassCatalog';
import { supabase } from '@/config/supabase';
import { TIMING } from '@/lib/timing';
import type { SyncStatus } from '@/lib/dataQuality';
import type { HistoryPoint } from '@/lib/types';

/** '24h' is the original, bridge-backed range — unchanged. '7d' is Phase 4's Supabase-backed
 * addition; '1y' is Phase 10's, crossing the retention boundary into `readings_hourly`.
 * All four are only meaningful once `supabase` is configured. */
export type AnalyticsRange = '24h' | LongRange | ArchiveRange;

function isArchiveRange(range: AnalyticsRange): range is ArchiveRange {
  return (ARCHIVE_RANGES as readonly string[]).includes(range);
}

/**
 * The first retry after a failed fetch, doubling on each further failure and never slower than the
 * range's normal cadence — RM-076. A failed 24h fetch used to wait a full minute before trying
 * again, and a failed 7d one five, so a one-second blip left the page reporting a failure for the
 * whole cycle.
 */
export const RETRY_BASE_MS = 10_000;

export function retryDelayMs(failures: number, refetchMs: number): number {
  return Math.min(refetchMs, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
}

/**
 * Which source answers a range, and how often to re-ask it. Cadence follows the source
 * rather than the UI: the bridge samples every 60s, a week/month chart does not need
 * per-minute freshness, and a year-wide chart whose every point but the last is immutable
 * history needs it even less.
 */
function sourceFor(range: AnalyticsRange): { fetch: (id: string) => Promise<HistoryPoint[]>; refetchMs: number } {
  if (range === '24h') {
    return { fetch: (id) => getHistory(id, '24h').then((r) => r.points), refetchMs: TIMING.HISTORY_SAMPLE_MS };
  }
  if (isArchiveRange(range)) {
    return { fetch: (id) => getArchiveHistory(id, range), refetchMs: ARCHIVE_REFRESH_MS };
  }
  return { fetch: (id) => getLongHistory(id, range), refetchMs: LONG_HISTORY_REFRESH_MS };
}

const reasonText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

/**
 * Self-fetches history for every branch meter AND every outlet — Analytics' scope toggle needs both
 * sets available regardless of which scope is currently selected, so switching scope never shows a
 * loading flicker.
 *
 * `range` picks the data source, not just a query parameter: '24h' stays on the bridge (the
 * bridge's own ring buffer is capped at 24h), '7d'/'30d' read Supabase, and '1y' reads through the
 * archive RPC so it spans the retention boundary.
 *
 * SYNCHRONISATION — RM-076. The hook also reports `sync`: whether this range has answered, when its
 * history last arrived, and how many fetches in a row have failed since. The page used to know only
 * loading/ready/error, so history that stopped arriving an hour ago read exactly as current as
 * history fetched a second ago. A failure is retried on a short backoff rather than after a full
 * cycle.
 *
 * AND TODAY, WHATEVER THE RANGE — RM-077. The Energy section checks each branch for a meter that
 * froze, against that meter's own samples today. On a long range the building meters' 24h history is
 * fetched alongside, so switching the chart to a week does not leave that check blind.
 */
export function useAnalyticsHistory(range: AnalyticsRange = '24h') {
  const devices = useDeviceStore((s) => s.devices);
  // Two independent gates, and they answer different questions. `monitoring` is the operator's
  // declaration that a device is worth watching; `metered` is whether it physically reports
  // power at all. A temperature sensor is monitored and has no wattage — charting it here
  // would be inventing a series. A metered outlet nobody cares about can be configured off
  // this page without touching code.
  const configs = useDeviceConfigStore((s) => s.saved);
  /**
   * Grouped by the catalog's `analyticsGroup` rather than by two hardcoded class checks, so a
   * newly-metered class is fetched and charted without editing this hook.
   */
  const byGroup = useMemo(() => {
    const out: Record<string, string[]> = Object.fromEntries(analyticsGroups().map((g) => [g, [] as string[]]));
    for (const d of devices) {
      if (!hasFunction(d, configs[d.id], 'monitoring')) continue;
      const group = DEVICE_CLASS_CATALOG[d.class]?.analyticsGroup;
      if (group !== null && group !== undefined && out[group]) out[group].push(d.id);
    }
    return out;
  }, [devices, configs]);
  // `UntrackedLoadCard` compares branches against outlets specifically — that two-ness is
  // intrinsic to the comparison (untracked load *is* branches minus outlets).
  const branchIds = useMemo(() => byGroup.branches ?? [], [byGroup]);
  const outletIds = useMemo(() => byGroup.outlets ?? [], [byGroup]);
  const allIds = useMemo(() => Object.values(byGroup).flat(), [byGroup]);
  const idsKey = allIds.join(',');
  const meterIds = useMemo(() => devices.filter((d) => (BUILDING_METER_IDS as readonly string[]).includes(d.id)).map((d) => d.id), [devices]);
  const meterKey = meterIds.join(',');

  /**
   * The last settled result, TAGGED with the range it settled for — so `status` can be derived
   * rather than stored. A result for a different range simply isn't a result for this one, which is
   * what makes the page show its skeleton instead of a false "no history yet" on a range switch.
   */
  const [settled, setSettled] = useState<{ range: AnalyticsRange; status: 'ready' | 'error' } | null>(null);
  const [failure, setFailure] = useState<{ range: AnalyticsRange; count: number; lastError: string | null }>({ range, count: 0, lastError: null });
  // Long-range history requested but Supabase isn't configured (e.g. local dev against the mock
  // bridge only) — fail visibly rather than silently showing stale or empty data.
  const longRangeUnavailable = range !== '24h' && !supabase;

  // When this range last arrived for any of its devices. A primitive, so the selector is stable.
  const fetchedAt = useDeviceStore((s) => {
    let latest: number | null = null;
    for (const id of allIds) {
      const at = historyFetchedAt(s.history, id, range);
      if (at !== null && (latest === null || at > latest)) latest = at;
    }
    return latest;
  });

  useEffect(() => {
    if (allIds.length === 0 || longRangeUnavailable) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    const { fetch: fetchOne, refetchMs } = sourceFor(range);
    const todayMeters = range === '24h' ? [] : meterIds;

    // Promise.allSettled, not Promise.all: one device's fetch failing must not blank every OTHER
    // device's already-successful chart data. Partial data beats no data.
    const load = async () => {
      const [results, meterResults] = await Promise.all([
        Promise.allSettled(allIds.map(fetchOne)),
        Promise.allSettled(todayMeters.map((id) => getHistory(id, '24h').then((r) => r.points))),
      ]);
      if (cancelled) return;
      const store = useDeviceStore.getState();
      let anySucceeded = false;
      let firstError: string | null = null;
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          anySucceeded = true;
          store.setHistory(allIds[i], result.value, range);
        } else if (firstError === null) {
          firstError = reasonText(result.reason);
        }
      });
      meterResults.forEach((result, i) => {
        if (result.status === 'fulfilled') store.setHistory(todayMeters[i], result.value, '24h');
      });
      failures = anySucceeded ? 0 : failures + 1;
      setSettled({ range, status: anySucceeded ? 'ready' : 'error' });
      setFailure({ range, count: failures, lastError: anySucceeded ? null : firstError });
      timer = setTimeout(load, anySucceeded ? refetchMs : retryDelayMs(failures, refetchMs));
    };

    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey and meterKey are the stable proxies for allIds' and meterIds' contents
  }, [idsKey, meterKey, range]);

  // A result for another range is not a result for this one — until this range settles, we
  // are loading, which is what makes the page show its skeleton instead of a false claim.
  const status = settled && settled.range === range ? settled.status : 'loading';
  const current = failure.range === range ? failure : { count: 0, lastError: null };

  const sync: SyncStatus = {
    settled: longRangeUnavailable || (settled !== null && settled.range === range),
    fetchedAt,
    failures: current.count,
    lastError: longRangeUnavailable ? 'stored history is not configured' : current.lastError,
    refetchMs: sourceFor(range).refetchMs,
    source: range === '24h' ? 'bridge' : 'stored',
  };

  return { byGroup, branchIds, outletIds, status: longRangeUnavailable ? 'error' : status, sync };
}
