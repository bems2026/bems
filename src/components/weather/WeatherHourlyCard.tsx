import { Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { WEATHER_PLACE } from '@/config/weather';
import { WeatherIcon } from './WeatherIcon';
import { useWeather } from './useWeather';

/** The reference's hourly row, as the bottom card of the bento. Same forecast source as the
 * two cards flanking the 3D model — `useWeather` is one shared fetch loop per mount, and all
 * three mounts read the same 10-minute cadence rather than each hammering the API. */
export function WeatherHourlyCard() {
  const { weather, status } = useWeather();

  return (
    <div className="card weather-card">
      <div className="card-head">
        <h3 className="card-title">
          <Clock size={14} className="title-icon" aria-hidden="true" />
          Next hours
        </h3>
        <span className="card-sub">{WEATHER_PLACE}</span>
      </div>

      {status === 'loading' && !weather ? (
        <Skeleton height="72px" />
      ) : !weather || weather.hourly.length === 0 ? (
        <p className="section-placeholder">Hourly forecast unavailable.</p>
      ) : (
        <div className="weather-strip weather-strip--hourly">
          {weather.hourly.map((h, i) => (
            <div className="weather-strip__slot" key={h.t}>
              <WeatherIcon code={h.code} isDay={h.isDay} size={17} className="weather-strip__glyph" />
              <span className="weather-strip__key">{i === 0 ? 'Now' : hourLabel(h.t)}</span>
              <span className="weather-strip__hi mono">{Math.round(h.tempC)}°</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function hourLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
