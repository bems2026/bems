import { InfoHint } from '@/components/ui/InfoHint';
import { isSiteToday, siteDate } from '@/lib/siteTime';
import { Skeleton } from '@/components/ui/Skeleton';
import { WEATHER_PLACE } from '@/config/weather';
import { weatherLabel } from '@/lib/weatherClient';
import { WeatherIcon } from './WeatherIcon';
import { useWeather } from './useWeather';

/**
 * The single Weather Status card the Overview bento calls for — hero conditions (condition
 * label, glyph beside the temperature, feels-like) on top, a short daily forecast strip
 * beneath. Replaces the earlier wind/humidity/pressure metric list: that list's fixed row
 * heights were taller than this card's actual budget (it's stretched to match Energy Flow,
 * half the right column), so the content overflowed past the card's own border at real
 * viewport heights — a genuine bug, not a styling choice. The forecast strip is a
 * `display: grid` row that takes exactly the height its own content needs and no more, so
 * it can't repeat that; the glyph sits beside the temperature rather than stacked above it
 * for the same reason — one fewer stacked line to fit into a fixed-height half-column.
 *
 * Still explicitly attributed. The office has its own outdoor probe and the ACU reports room
 * temperature (both on the Climate Diagnostic card), so forecast air temperature sitting
 * unlabelled beside them would invite reading it as an instrument value.
 */
export function WeatherStatusCard() {
  const { weather, status } = useWeather();

  return (
    <div className="card weather-card weather-status-card">
      <div className="card-head">
        <h3 className="card-title">
          <WeatherIcon code={weather?.code ?? 3} isDay={weather?.isDay ?? true} size={14} className="title-icon" />
          Weather Status
          <InfoHint label="Where this weather comes from">
            {WEATHER_PLACE ? `Open-Meteo forecast for ${WEATHER_PLACE}` : 'Open-Meteo forecast'}, refreshed every 10 minutes. Outdoor site weather, not a
            building sensor — this building's own outdoor probe and the ACU's room temperature are
            separate readings on the Climate Diagnostic card.
          </InfoHint>
        </h3>
      </div>

      {status === 'unconfigured' ? (
        // Its own state, not an error. "We could not reach the forecast service" and "nobody has
        // said where this building is" are different facts, and only one of them is fixable by
        // waiting. This used to be unreachable because the module fell back to the CARE office's
        // coordinates, so an unlocated deployment showed that city's weather as its own.
        <p className="section-placeholder">
          No location set for this site, so there is no local forecast. Add one to
          <code> shared/sites/&lt;slug&gt;/site.mjs</code>, or set <code>VITE_WEATHER_LAT</code>
          and <code>VITE_WEATHER_LON</code>.
        </p>
      ) : status === 'loading' && !weather ? (
        <Skeleton height="100%" />
      ) : !weather ? (
        <p className="section-placeholder">Weather unavailable — no connection to the forecast service.</p>
      ) : (
        <>
          <div className="weather-hero">
            <p className="weather-hero__label">{weatherLabel(weather.code)}</p>
            <div className="weather-hero__row">
              <WeatherIcon code={weather.code} isDay={weather.isDay} size={40} className="weather-hero__glyph" />
              <p className="weather-hero__temp">
                {Math.round(weather.tempC)}
                <span className="weather-hero__deg">°</span>
              </p>
            </div>
            <p className="weather-hero__feels">
              Feels like {Math.round(weather.apparentC)}°{WEATHER_PLACE ? ` · ${WEATHER_PLACE}` : ''}
            </p>
          </div>

          {weather.daily.length > 0 && (
            <div className="weather-forecast">
              {weather.daily.slice(0, 4).map((d) => (
                <div className="weather-forecast__day" key={d.t}>
                  <span className="weather-forecast__key">{dayLabel(d.t)}</span>
                  <WeatherIcon code={d.code} isDay size={16} className="weather-forecast__glyph" />
                  <span className="weather-forecast__hi mono">{Math.round(d.maxC)}°</span>
                  <span className="weather-forecast__lo mono">{Math.round(d.minC)}°</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  // `toDateString()` compares in the READER's zone, so the building's tomorrow could be
  // labelled "Today" for anyone a few hours ahead of it.
  return isSiteToday(d) ? 'Today' : siteDate(d, { weekday: 'short' });
}
