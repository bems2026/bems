import { useDeviceStore } from '@/stores/deviceStore';
import { MetricValue } from '@/components/ui/MetricValue';

const PHASES: { key: 'red' | 'yellow' | 'blue'; label: string; color: string }[] = [
  { key: 'red', label: 'Red', color: 'var(--bad)' },
  { key: 'yellow', label: 'Yellow', color: 'var(--accent)' },
  { key: 'blue', label: 'Blue', color: 'var(--info)' },
];

/**
 * Mirrors `Calculate 3-Phase Totals` in the live flow: Red = L.O Red + AREC ACU, Yellow =
 * C.O Yellow + L.O Yellow. Blue always renders "Not metered" instead of a bar — no
 * Blue-phase meter is installed, and `phase_current.blue` is typed `null` for exactly that
 * reason. Red/Yellow being null (no reading yet) is a different, distinguishable state:
 * they'd show "—" via `MetricValue`, never "Not metered".
 */
export function PhaseBalance() {
  const phase = useDeviceStore((s) => s.totals?.phase_current);
  const max = Math.max(phase?.red ?? 0, phase?.yellow ?? 0, 1);

  return (
    <div className="card phase-balance-card">
      <div className="card-head">
        <h3 className="card-title">Phase Balance</h3>
      </div>
      <div className="phase-balance">
        {PHASES.map(({ key, label, color }) => {
          const value = phase ? phase[key] : null;
          const isBlue = key === 'blue';
          const pct = typeof value === 'number' ? Math.min(100, (value / max) * 100) : 0;
          return (
            <div className="phase-balance__row" key={key}>
              <span className="phase-balance__label">{label}</span>
              <div className="phase-balance__bar-track">
                {!isBlue && <div className="phase-balance__bar-fill" style={{ width: `${pct}%`, background: color }} />}
              </div>
              <span className="phase-balance__value">
                {isBlue ? (
                  <span className="phase-balance__not-metered">Not metered</span>
                ) : (
                  <MetricValue value={value} unit="A" digits={1} size="sm" />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
