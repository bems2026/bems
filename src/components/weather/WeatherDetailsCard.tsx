import { Wind } from 'lucide-react';
import { InfoHint } from '@/components/ui/InfoHint';
import { Skeleton } from '@/components/ui/Skeleton';
import { WEATHER_PLACE } from '@/config/weather';
import { useWeather } from './useWeather';

/**
 * Design option B — the reference's right panel: a plain label/value list, no hero.
 *
 * Pressure is converted hPa → mmHg to match the reference, since that's the unit the
 * original design showed; both are printed in the hint so the conversion isn't a hidden
 * assumption. A field the API didn't return renders "—", never 0.
 */
export function WeatherDetailsCard() {
  const { weather, status } = useWeather();

  return (
    <div className="card weather-card">
      <div className="card-head">
        <h3 className="card-title">
          <Wind size={14} className="title-icon" aria-hidden="true" />
          Outdoor conditions
          <InfoHint label="Where these figures come from">
            Open-Meteo forecast for {WEATHER_PLACE}, refreshed every 10 minutes — outdoor site weather, not a building sensor. Pressure is reported by the API in hPa and shown here in
            mmHg (1 hPa = 0.75006 mmHg).
          </InfoHint>
        </h3>
      </div>

      {status === 'loading' && !weather ? (
        <Skeleton height="150px" />
      ) : !weather ? (
        <p className="section-placeholder">Conditions unavailable — no connection to the forecast service.</p>
      ) : (
        <dl className="weather-rows">
          <Row label="Wind" value={fmt(weather.windMs, 1)} unit="m/s" />
          <Row label="Humidity" value={fmt(weather.humidityPct, 0)} unit="%" />
          <Row label="Atm pressure" value={fmt(weather.pressureHpa * 0.75006, 0)} unit="mmHg" />
          <Row label="Feels like" value={fmt(weather.apparentC, 1)} unit="°C" />
          <Row label="Sunrise" value={clock(weather.sunrise)} />
          <Row label="Sunset" value={clock(weather.sunset)} />
        </dl>
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

/** NaN is what a missing API field becomes after arithmetic — it must read as "no value",
 * not as a number. */
function fmt(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function clock(ms: number | null): string {
  return ms === null ? '—' : new Date(ms).toLocaleTimeString('en-PH', { hour12: false, hour: '2-digit', minute: '2-digit' });
}
