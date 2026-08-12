import { useEffect, useMemo, useState } from 'react';
import { useDeviceStore } from '@/stores/deviceStore';
import { getHistory } from '@/lib/bridgeClient';
import { TIMING } from '@/lib/timing';

/**
 * Self-fetches 24h history for every branch meter AND every outlet — Overview's
 * `EdgeBufferCard` only needs the 4 meters, but Analytics' scope toggle needs both sets
 * available regardless of which scope is currently selected, so switching scope never
 * shows a loading flicker. Same fetch/refetch pattern as `EdgeBufferCard`/`TrendChart`.
 */
export function useAnalyticsHistory() {
  const devices = useDeviceStore((s) => s.devices);
  const branchIds = useMemo(() => devices.filter((d) => d.class === 'meter').map((d) => d.id), [devices]);
  const outletIds = useMemo(() => devices.filter((d) => d.class === 'outlet_dual').map((d) => d.id), [devices]);
  const allIds = useMemo(() => [...branchIds, ...outletIds], [branchIds, outletIds]);
  const idsKey = allIds.join(',');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (allIds.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const results = await Promise.all(allIds.map((id) => getHistory(id, '24h')));
        if (cancelled) return;
        for (let i = 0; i < allIds.length; i++) useDeviceStore.getState().setHistory(allIds[i], results[i].points);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey is the stable proxy for allIds' contents
  }, [idsKey]);

  return { branchIds, outletIds, status };
}
