/**
 * Weather config, in the same single-source spirit as `config/bridge.ts`.
 *
 * Open-Meteo is used because it needs no API key: a kiosk build that shipped a key in its
 * bundle would be publishing that key to anyone who opened devtools. The trade-off is that
 * this is the one part of the app talking to the public internet rather than the bridge, so
 * every consumer has to handle "unreachable" as a normal state — see `useWeather`.
 *
 * The default coordinates are the MMSU CARE office's own site (Batac City, Ilocos Norte),
 * matching the location the Overview header already names. Override per-deployment if the
 * hardware ever moves.
 */

import { SITE } from '@shared/siteConfig.mjs';

const num = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw?.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const WEATHER_LAT = num(import.meta.env.VITE_WEATHER_LAT, 18.0553);
export const WEATHER_LON = num(import.meta.env.VITE_WEATHER_LON, 120.5646);
/** Named in the UI so the reading is never mistaken for one of the building's own sensors. */
export const WEATHER_PLACE = import.meta.env.VITE_WEATHER_PLACE?.trim() || 'Batac City';
/** The site's own declared zone, not a second copy of it. A literal here would drift from
 * `SITE.timezone` silently: the clock would be right and the forecast an hour out. */
export const WEATHER_TZ = SITE.timezone;
export const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast';
