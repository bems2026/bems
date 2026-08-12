import { InfoHint } from '@/components/ui/InfoHint';
import { Skeleton } from '@/components/ui/Skeleton';
import { WEATHER_PLACE } from '@/config/weather';
import { weatherLabel } from '@/lib/weatherClient';
import { WeatherIcon } from './WeatherIcon';
import { useWeather } from './useWeather';

/**
 * Design option A — the reference's left panel: one large glyph, the condition, a hero
 * temperature, and a multi-day strip beneath.
 *
 * Every number here is site weather from Open-Meteo, NOT one of the building's own sensors.
 * That distinction is load-bearing: the office already has a real outdoor probe
 * (`sens_outside_temp`) and the ACU reports room temperature, and an operator must never
 * read forecast air temperature as an instrument value. Hence the explicit "Forecast ·
 * <place>" attribution rather than a bare number.
 */
export function WeatherNowCard() {
  const { weather, status } = useWeather();

  return (
    <div className="card weather-card">
      <div className="card-head">
        <h3 className="card-title">
          <WeatherIcon code={weather?.code ?? 3} isDay={weather?.isDay ?? true} size={14} className="title-icon" />
          Weather
          <InfoHint label="Where this weather comes from">
            Open-Meteo forecast for {WEATHER_PLACE}, refreshed every 10 minutes. This is outdoor site weather, not a building sensor — the office's own outdoor probe and the ACU's room
            temperature are separate readings, shown on the climate card.
          </InfoHint>
        </h3>
        <span className="card-sub">Forecast · {WEATHER_PLACE}</span>
      </div>

      {status === 'loading' && !weather ? (
        <Skeleton height="190px" />
      ) : !weather ? (
        <p className="section-placeholder">Weather unavailable — no connection to the forecast service.</p>
      ) : (
        <>
          <div className="weather-hero">
            <WeatherIcon code={weather.code} isDay={weather.isDay} size={72} className="weather-hero__glyph" />
            <p className="weather-hero__label">{weatherLabel(weather.code)}</p>
            <p className="weather-hero__temp">
              {Math.round(weather.tempC)}
              <span className="weather-hero__deg">°</span>
            </p>
            <p className="weather-hero__feels">Feels like {Math.round(weather.apparentC)}°</p>
          </div>

          {weather.daily.length > 0 && (
            <div className="weather-strip">
              {weather.daily.map((d) => (
                <div className="weather-strip__slot" key={d.t}>
                  <WeatherIcon code={d.code} isDay size={17} className="weather-strip__glyph" />
                  <span className="weather-strip__key">{dayLabel(d.t)}</span>
                  <span className="weather-strip__hi mono">{Math.round(d.maxC)}°</span>
                  <span className="weather-strip__lo mono">{Math.round(d.minC)}°</span>
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
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  return d.toLocaleDateString('en-PH', { weekday: 'short' });
}
