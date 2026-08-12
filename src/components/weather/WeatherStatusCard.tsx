import { InfoHint } from '@/components/ui/InfoHint';
import { Skeleton } from '@/components/ui/Skeleton';
import { WEATHER_PLACE } from '@/config/weather';
import { weatherLabel } from '@/lib/weatherClient';
import { WeatherIcon } from './WeatherIcon';
import { useWeather } from './useWeather';

/**
 * The single Weather Status card the Overview bento calls for — the reference design's two
 * panels merged into one tall card: hero conditions on top, the metric list beneath, and the
 * hourly strip as a footer. Replaces the three separate weather cards, which between them
 * mounted `useWeather` three times and so ran three independent fetch loops against a public
 * API for identical data.
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
            Open-Meteo forecast for {WEATHER_PLACE}, refreshed every 10 minutes. Outdoor site weather, not a building sensor — the office's own outdoor probe and the ACU's room
            temperature are separate readings on the Climate Diagnostic card. Pressure is reported in hPa and shown in mmHg (1 hPa = 0.75006 mmHg).
          </InfoHint>
        </h3>
      </div>

      {status === 'loading' && !weather ? (
        <Skeleton height="300px" />
      ) : !weather ? (
        <p className="section-placeholder">Weather unavailable — no connection to the forecast service.</p>
      ) : (
        <>
          <div className="weather-hero">
            <WeatherIcon code={weather.code} isDay={weather.isDay} size={64} className="weather-hero__glyph" />
            <p className="weather-hero__label">{weatherLabel(weather.code)}</p>
            <p className="weather-hero__temp">
              {Math.round(weather.tempC)}
              <span className="weather-hero__deg">°</span>
            </p>
            <p className="weather-hero__feels">
              Feels like {Math.round(weather.apparentC)}° · {WEATHER_PLACE}
            </p>
          </div>

          <dl className="weather-rows">
            <Row label="Wind" value={fmt(weather.windMs, 1)} unit="m/s" />
            <Row label="Humidity" value={fmt(weather.humidityPct, 0)} unit="%" />
            <Row label="Pressure" value={fmt(weather.pressureHpa * 0.75006, 0)} unit="mmHg" />
            <Row label="Sunset" value={clock(weather.sunset)} />
          </dl>

          {weather.hourly.length > 0 && (
            <div className="weather-strip">
              {weather.hourly.slice(0, 5).map((h, i) => (
                <div className="weather-strip__slot" key={h.t}>
                  <WeatherIcon code={h.code} isDay={h.isDay} size={16} className="weather-strip__glyph" />
                  <span className="weather-strip__key">{i === 0 ? 'Now' : hourLabel(h.t)}</span>
                  <span className="weather-strip__hi mono">{Math.round(h.tempC)}°</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="weather-row">
      <dt className="weather-row__label">{label}</dt>
      <dd className="weather-row__value mono">
        {value}
        {unit && value !== '—' && <span className="weather-row__unit"> {unit}</span>}
      </dd>
    </div>
  );
}

/** NaN is what a missing API field becomes after arithmetic — it must read as "no value". */
function fmt(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function clock(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function hourLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
