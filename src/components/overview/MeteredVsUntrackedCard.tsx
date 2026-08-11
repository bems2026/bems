import { useDeviceStore } from '@/stores/deviceStore';
import { meteredVsUntracked } from './overviewMath';

export function MeteredVsUntrackedCard() {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const totals = useDeviceStore((s) => s.totals);

  const split = meteredVsUntracked(devices, readings, totals?.total_power_w ?? null);

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">Metered vs untracked load</h3>
      </div>
      {split.untrackedW === null ? (
        <p className="section-placeholder">Waiting for the panel total…</p>
      ) : (
        <>
          <div className="metered-headline">
            <span className="metered-headline-value">{(split.untrackedW / 1000).toFixed(2)}</span>
            <span className="metered-headline-label">kW untracked</span>
          </div>
          <div className="metered-split-bar">
            <div className="metered-split-bar__metered" style={{ width: `${split.meteredPct}%` }} />
            <div className="metered-split-bar__untracked" />
          </div>
          <div className="metered-legend">
            <span>
              <span className="metered-legend__swatch" style={{ background: 'var(--blue-bright)' }} aria-hidden="true" />
              OUTLET-METERED {split.meteredPct?.toFixed(0)}%
            </span>
            <span>
              <span className="metered-legend__swatch" style={{ background: 'var(--faintest)' }} aria-hidden="true" />
              UNTRACKED
            </span>
          </div>
        </>
      )}
      <p className="metered-footnote">Untracked = CHNT panel total minus the 7 metered outlets: hardwired lighting and direct-to-panel equipment.</p>
    </div>
  );
}
