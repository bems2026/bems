/**
 * Weather config, in the same single-source spirit as `config/bridge.ts`.
 *
 * Open-Meteo is used because it needs no API key: a kiosk build that shipped a key in its
 * bundle would be publishing that key to anyone who opened devtools. The trade-off is that
 * this is the one part of the app talking to the public internet rather than the bridge, so
 * every consumer has to handle "unreachable" as a normal state — see `useWeather`.
 *
 * WHERE THE LOCATION COMES FROM, and it used to come from the wrong place. These were this
 * module's own defaults — the CARE office's coordinates and city — so any deployment that had
 * not set `VITE_WEATHER_*` showed **that** office's weather labelled as its own. A forecast for
 * somewhere else, presented as being about the reader's building, is the same class of thing as
 * a power reading nobody took.
 *
 * The building declares where it is (`SITE.location`); the environment may override, for a
 * deployment whose weather station is sensibly somewhere other than the building. When neither
 * says, this is **unconfigured** — and the card says so rather than borrowing a city.
 */

import { SITE } from '@shared/siteConfig.mjs';

const num = (raw: string | undefined, fallback: number | null): number | null => {
  const parsed = Number(raw?.trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const declared = SITE.location as { place: string; lat: number; lon: number } | null;

export const WEATHER_LAT = num(import.meta.env.VITE_WEATHER_LAT, declared?.lat ?? null);
export const WEATHER_LON = num(import.meta.env.VITE_WEATHER_LON, declared?.lon ?? null);
/** Named in the UI so the reading is never mistaken for one of the building's own sensors.
 * `null` when nobody has said where this building is — the card renders that as its own state. */
export const WEATHER_PLACE: string | null = import.meta.env.VITE_WEATHER_PLACE?.trim() || declared?.place || null;

/** Whether a forecast can be asked for at all. Checked before fetching rather than after, so an
 * unlocated deployment makes no request instead of one for latitude `null`. */
export const WEATHER_CONFIGURED = WEATHER_LAT !== null && WEATHER_LON !== null;
/** The site's own declared zone, not a second copy of it. A literal here would drift from
 * `SITE.timezone` silently: the clock would be right and the forecast an hour out. */
export const WEATHER_TZ = SITE.timezone;
export const WEATHER_API_URL = 'https://api.open-meteo.com/v1/forecast';
