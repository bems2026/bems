import { useEffect, useState } from 'react';
import { WEATHER_CONFIGURED } from '@/config/weather';
import { getWeather, type WeatherNow } from '@/lib/weatherClient';

/** 10 minutes. Open-Meteo updates roughly hourly, so polling faster only burns a public
 * API's goodwill for data that hasn't changed. */
const REFRESH_MS = 600_000;

/** `unconfigured` is its own state, not an error: a site that has not said where it is has
 * nothing to report, which is a different thing from a forecast this app failed to fetch. */
export type WeatherStatus = 'loading' | 'ready' | 'error' | 'unconfigured';

/**
 * Self-fetching weather, same shape as `useAnalyticsHistory`: fetch on mount, refetch on an
 * interval, expose an explicit status rather than letting callers infer one from empty data.
 *
 * Unlike the bridge hooks there is no retry/backoff ladder here — a failed weather fetch
 * costs the operator nothing (it's ambient context, not a reading they act on), so the next
 * scheduled refresh is a good enough retry. `error` genuinely means "no weather right now",
 * and the cards say exactly that instead of rendering placeholder numbers.
 */
export function useWeather(): { weather: WeatherNow | null; status: WeatherStatus } {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [status, setStatus] = useState<WeatherStatus>(WEATHER_CONFIGURED ? 'loading' : 'unconfigured');

  useEffect(() => {
    // No location, no request. Polling every ten minutes for a building whose coordinates nobody
    // has entered would be a request that can only ever fail.
    if (!WEATHER_CONFIGURED) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const load = async () => {
      try {
        const next = await getWeather(controller.signal);
        if (cancelled) return;
        setWeather(next);
        setStatus('ready');
      } catch {
        // Keep the last good reading on screen if we have one — stale ambient weather is
        // more useful than blanking the card, and the timestamp isn't claimed anywhere.
        if (!cancelled) setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
      } finally {
        if (!cancelled) timer = setTimeout(load, REFRESH_MS);
      }
    };

    load();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { weather, status };
}
