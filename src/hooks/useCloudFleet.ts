import { useCallback, useEffect, useState } from 'react';
import { fetchCloudFleet, EMPTY_FLEET, type CloudFleet } from '@/lib/tuyaFleet';

/** Cloud state moves on the order of minutes; polling faster would be waste. */
const REFRESH_MS = 3 * 60_000;

/**
 * The detected-device list, polled. `refresh()` fetches now — after a key import, say, whose whole
 * point is that the devices it named become enrollable, which should not wait three minutes.
 */
export function useCloudFleet(): CloudFleet & { refresh: () => void } {
  const [fleet, setFleet] = useState<CloudFleet>(EMPTY_FLEET);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const next = await fetchCloudFleet();
      if (cancelled) return;
      // A failed refresh keeps the last good answer rather than blanking it: a stale cloud
      // reading is still more useful than nothing while a request is retrying.
      setFleet((prev) => (next.status === 'error' && prev.status === 'ready' ? { ...prev, status: 'error' } : next));
      if (!cancelled) timer = setTimeout(load, REFRESH_MS);
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { ...fleet, refresh };
}
