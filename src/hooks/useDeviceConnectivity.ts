import { useEffect, useState } from 'react';
import { supabase } from '@/config/supabase';
import { fetchDeviceConnectivity, type ConnectivityRow } from '@/lib/deviceConnectivity';

/** Uptime is a slow-moving figure over a 24h window; polling it often would be pure waste. */
const REFRESH_MS = 5 * 60_000;

/**
 * Fleet connectivity over the last `windowHours`. Returns an empty map — not an error — when
 * Supabase is not configured, so the Devices page degrades to exactly what it showed before
 * rather than surfacing a failure for a feature that simply is not available in that setup.
 */
export function useDeviceConnectivity(windowHours = 24) {
  const [rows, setRows] = useState<Record<string, ConnectivityRow>>({});
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(supabase ? 'loading' : 'idle');

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const next = await fetchDeviceConnectivity(windowHours);
        if (cancelled) return;
        setRows(next);
        setStatus('ready');
      } catch {
        // Deliberately not clearing `rows`: a failed refresh should leave the last good answer
        // on screen rather than blanking figures that were correct a few minutes ago.
        if (!cancelled) setStatus('error');
      }
      if (!cancelled) timer = setTimeout(load, REFRESH_MS);
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [windowHours]);

  return { rows, status };
}
