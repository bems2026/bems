import { WEATHER_API_URL, WEATHER_CONFIGURED, WEATHER_LAT, WEATHER_LON, WEATHER_TZ } from '@/config/weather';
import { SITE } from '@shared/siteConfig.mjs';

/**
 * Open-Meteo forecast fetch. Deliberately narrow: this returns exactly the fields the two
 * Overview cards render, already normalised, so no component has to know the wire shape.
 *
 * Everything is non-optional in `WeatherNow` because Open-Meteo always returns the `current`
 * block it was asked for — but the *whole response* is treated as optional by callers, since
 * the internet is a dependency this app otherwise doesn't have. A failed fetch surfaces as
 * an error state, never as zeroed-out weather.
 */

export interface WeatherSlot {
  /** Epoch ms, already in the site's timezone per the API's `timezone` param. */
  t: number;
  tempC: number;
  code: number;
  isDay: boolean;
}

export interface WeatherDay {
  t: number;
  code: number;
  maxC: number;
  minC: number;
}

export interface WeatherNow {
  tempC: number;
  apparentC: number;
  humidityPct: number;
  windMs: number;
  pressureHpa: number;
  code: number;
  isDay: boolean;
  sunrise: number | null;
  sunset: number | null;
  hourly: WeatherSlot[];
  daily: WeatherDay[];
}

const CURRENT_FIELDS = ['temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day', 'weather_code', 'surface_pressure', 'wind_speed_10m'].join(',');

interface RawResponse {
  current?: Record<string, number>;
  hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[]; is_day?: number[] };
  daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; sunrise?: string[]; sunset?: string[] };
}

/**
 * Open-Meteo returns times in the requested timezone — this SITE's — with no offset suffix
 * (`2026-08-12T22:15`), and dates bare (`2026-08-12`). `Date.parse` treats the first as LOCAL
 * and the second as UTC, a spec quirk that alone would shift every daily label.
 *
 * THE ASSUMPTION THIS RESTED ON IS NOW GONE, and to its credit the old comment stated it rather
 * than hiding it: "the display device runs in the site's own timezone". True of the kiosk in the
 * room, false of everybody else. Measured 2026-08-31: a reader in New York produced hour labels
 * **twelve hours out** — a forecast about the building, timestamped in the reader's day. The
 * kiosk was correct by coincidence, which is why this survived.
 *
 * The site's own offset is appended instead, so the instant is absolute and identical for every
 * reader. `SITE.utc_offset_minutes` exists for exactly this kind of place — somewhere a zone
 * NAME cannot be used — and `npm run site:check` rejects a DST zone, which no fixed offset can
 * describe honestly.
 */
function siteOffsetSuffix(): string {
  const total = SITE.utc_offset_minutes as number;
  const sign = total < 0 ? '-' : '+';
  const abs = Math.abs(total);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function parseSiteTime(raw: string): number {
  const withTime = raw.length === 10 ? `${raw}T00:00` : raw;
  return Date.parse(`${withTime}${siteOffsetSuffix()}`);
}

/**
 * No response within this window counts as a failure, same as a non-2xx status. Without it,
 * a request that neither succeeds nor errors — a captive portal, a firewall that silently
 * drops the packet instead of refusing the connection, a DNS lookup that hangs — leaves
 * `useWeather` parked in `status: 'loading'` indefinitely, since nothing ever calls its
 * `catch`. That's the Weather Status card's skeleton with no way out short of a reload.
 * 10s comfortably covers a slow real response (Open-Meteo is typically sub-second) while
 * still resolving well inside one polling interval.
 */
const FETCH_TIMEOUT_MS = 10_000;

export async function getWeather(signal?: AbortSignal): Promise<WeatherNow> {
  // Refused before the URL is built, not after. `WEATHER_LAT` is `number | null` since the
  // location became a site fact, and a null interpolates into a template literal as the STRING
  // "null" — TypeScript is perfectly happy with that, and Open-Meteo would answer something.
  // An unlocated deployment must make no request at all rather than a plausible wrong one.
  if (!WEATHER_CONFIGURED) throw new Error('weather is not configured: this site declares no location');

  const url =
    `${WEATHER_API_URL}?latitude=${WEATHER_LAT}&longitude=${WEATHER_LON}` +
    `&current=${CURRENT_FIELDS}` +
    `&hourly=temperature_2m,weather_code,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset` +
    `&timezone=${encodeURIComponent(WEATHER_TZ)}&forecast_days=6&wind_speed_unit=ms`;

  // AbortSignal.any (not yet available in every runtime this targets) would replace this,
  // but a manual timer + combined listener works everywhere `useWeather`'s own
  // AbortController does. Whichever aborts first wins; the timer is always cleared, so it
  // can't outlive this call and fire on some later, unrelated fetch.
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT_MS);
  signal?.addEventListener('abort', () => timeoutController.abort(), { once: true });

  let res: Response;
  try {
    res = await fetch(url, { signal: timeoutController.signal });
  } catch (err) {
    if (timeoutController.signal.aborted && !signal?.aborted) throw new Error('weather request timed out', { cause: err });
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const body = (await res.json()) as RawResponse;

  const c = body.current;
  if (!c || typeof c.temperature_2m !== 'number') throw new Error('weather response missing current conditions');

  // Only future hours are useful on a "next hours" strip; the API returns the whole day.
  const nowMs = Date.now();
  const hourly: WeatherSlot[] = (body.hourly?.time ?? [])
    .map((iso, i) => ({
      t: parseSiteTime(iso),
      tempC: body.hourly?.temperature_2m?.[i] ?? NaN,
      code: body.hourly?.weather_code?.[i] ?? 0,
      isDay: (body.hourly?.is_day?.[i] ?? 1) === 1,
    }))
    .filter((s) => Number.isFinite(s.tempC) && s.t >= nowMs - 3600_000)
    .slice(0, 6);

  const daily: WeatherDay[] = (body.daily?.time ?? [])
    .map((iso, i) => ({
      t: parseSiteTime(iso),
      code: body.daily?.weather_code?.[i] ?? 0,
      maxC: body.daily?.temperature_2m_max?.[i] ?? NaN,
      minC: body.daily?.temperature_2m_min?.[i] ?? NaN,
    }))
    .filter((d) => Number.isFinite(d.maxC) && Number.isFinite(d.minC));

  return {
    tempC: c.temperature_2m,
    apparentC: c.apparent_temperature ?? c.temperature_2m,
    humidityPct: c.relative_humidity_2m ?? NaN,
    windMs: c.wind_speed_10m ?? NaN,
    pressureHpa: c.surface_pressure ?? NaN,
    code: c.weather_code ?? 0,
    isDay: (c.is_day ?? 1) === 1,
    sunrise: body.daily?.sunrise?.[0] ? parseSiteTime(body.daily.sunrise[0]) : null,
    sunset: body.daily?.sunset?.[0] ? parseSiteTime(body.daily.sunset[0]) : null,
    hourly,
    daily,
  };
}

/**
 * WMO weather codes → a short label. Grouped rather than exhaustive: the distinction
 * between "slight" and "moderate" drizzle is not something a building operator acts on, and
 * a 4-word label in a small card is worse than an accurate 2-word one.
 */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 65) return 'Rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm, hail';
  return 'Unknown';
}

export type WeatherGlyph = 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

/** The icon family a code maps to — kept separate from the label so the two can't drift. */
export function weatherGlyph(code: number): WeatherGlyph {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloud';
}
