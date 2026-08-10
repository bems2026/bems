import { useDeviceStore } from '@/stores/deviceStore';
import { MetricValue } from '@/components/ui/MetricValue';
import { todayVsWeeklyAveragePace } from './overviewMath';

const SIZE = 116;
const STROKE = 9;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Today's energy as a ring against the week's implied daily average — see
 * `todayVsWeeklyAveragePace`'s comment for why that's the honest comparison to draw (a
 * real derivable pace, not an invented target the bridge never reported). The ring fill
 * caps visually at 100%; the caption text keeps showing the real percentage past that.
 */
export function EnergyRing() {
  const totals = useDeviceStore((s) => s.totals);
  const pace = todayVsWeeklyAveragePace(totals?.energy_kwh_today ?? null, totals?.energy_kwh_week ?? null);
  const fraction = pace === null ? 0 : Math.min(pace, 1);
  const dashoffset = CIRCUMFERENCE * (1 - fraction);

  return (
    <div className="card energy-ring-card">
      <div className="card-head">
        <h3 className="card-title">Energy Today</h3>
      </div>
      <div className="energy-ring">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} className="energy-ring__track" strokeWidth={STROKE} fill="none" />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            className="energy-ring__fill"
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>
        <div className="energy-ring__center">
          <MetricValue value={totals?.energy_kwh_today} unit="kWh" digits={2} size="sm" />
        </div>
      </div>
      <p className="energy-ring__caption">{pace === null ? 'No weekly baseline yet' : `${(pace * 100).toFixed(0)}% of weekly daily average`}</p>
      <div className="energy-ring__secondary">
        <div>
          <span className="metric-label">This Week</span>
          <MetricValue value={totals?.energy_kwh_week} unit="kWh" digits={1} size="sm" />
        </div>
        <div>
          <span className="metric-label">This Month</span>
          <MetricValue value={totals?.energy_kwh_month} unit="kWh" digits={1} size="sm" />
        </div>
      </div>
    </div>
  );
}
