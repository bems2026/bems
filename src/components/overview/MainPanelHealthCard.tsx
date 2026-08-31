import { useDeviceStore } from '@/stores/deviceStore';
import { Activity } from 'lucide-react';
import { MetricValue } from '@/components/ui/MetricValue';
import { phaseBalance } from './mainPanelHealth';
import { measured } from '@/lib/staleness';

const PHASE_MAX_A = 30; // bar full-scale, matching v4's own 30A reference

/**
 * v4's "Main Panel Health" — the design compares 3 live phases; this installation only has
 * two (Red, Yellow). Blue renders "Not metered", the same treatment the app has used for
 * that phase since Phase G — no Phase C bar with no Phase C CT.
 */
export function MainPanelHealthCard() {
  const totals = useDeviceStore((s) => s.totals);
  const phase = totals?.phase_current;

  /**
   * Past five minutes a reading is a memory, not a measurement — `staleness.ts`'s rule, applied
   * here because this card says more than a number. `BALANCED` and "Red and Yellow are within a
   * comfortable range of each other" are claims about the building's electrical state *now*, and
   * a ten-minute-old row cannot support either. Expiring the inputs retires the sentence with
   * them, rather than leaving a confident conclusion drawn from data the card would not print.
   */
  const volts = measured(totals?.avg_voltage ?? null, totals);
  const red = measured(phase?.red ?? null, totals) ?? null;
  const yellow = measured(phase?.yellow ?? null, totals) ?? null;
  const health = phaseBalance(red, yellow);

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">
          <Activity size={14} className="title-icon" aria-hidden="true" />
          Electrical Parameters
        </h3>
        {health.spread !== null && (
          <span className={`panel-health-pill panel-health-pill--${health.balanced ? 'balanced' : 'imbalance'}`}>
            {health.balanced ? 'BALANCED' : 'IMBALANCE'}
          </span>
        )}
      </div>
      <div className="panel-health-body">
        <div className="voltage-ring">
          <span className="voltage-ring__value">
            <MetricValue value={volts} digits={0} size="sm" />
          </span>
          <span className="voltage-ring__label">VOLTS</span>
        </div>
        <div className="phase-bars">
          <PhaseRow label="Red" amps={red} color="var(--red-bright)" />
          <PhaseRow label="Yellow" amps={yellow} color="var(--accent)" />
          <div className="phase-bar-row">
            <span className="phase-bar-name">Blue</span>
            <span className="phase-bar-notmetered">Not metered</span>
          </div>
        </div>
      </div>
      {health.spread !== null && (
        <p className="panel-health-note">
          Spread is {health.spread.toFixed(1)} A.{' '}
          {health.balanced ? 'Red and Yellow are within a comfortable range of each other.' : `${health.heavier === 'red' ? 'Red' : 'Yellow'} is carrying the most load.`}
        </p>
      )}
    </div>
  );
}

function PhaseRow({ label, amps, color }: { label: string; amps: number | null; color: string }) {
  const pct = amps === null ? 0 : Math.min(100, (amps / PHASE_MAX_A) * 100);
  return (
    <div className="phase-bar-row">
      <span className="phase-bar-name">{label}</span>
      <div className="phase-bar-track">
        <div className="phase-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="phase-bar-value">
        <MetricValue value={amps} unit="A" digits={1} size="sm" />
      </span>
    </div>
  );
}
