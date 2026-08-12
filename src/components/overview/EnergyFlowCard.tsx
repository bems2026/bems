import { GitFork } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { InfoHint } from '@/components/ui/InfoHint';

/**
 * Where the building's power is flowing right now: the panel total, how it divides across
 * the four CHNT branch meters, and how much of the outlet branch is individually metered
 * versus hardwired.
 *
 * The tiers are a true decomposition, not an illustration. `_totals.total_power_w` is
 * defined in `buildLatest` as the sum of the four branch meters' `power_w`, so branch shares
 * are computed against that same sum by construction. The sub-metered tier is the 7 outlets'
 * own meters against the panel total; the remainder is genuinely unmetered load (hardwired
 * lighting, the ACU, anything direct-to-panel) rather than a rounding gap.
 */
export function EnergyFlowCard() {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const totals = useDeviceStore((s) => s.totals);

  const branches = devices
    .filter((d) => d.class === 'meter')
    .map((d) => ({ id: d.id, name: d.display_name, w: readings[d.id]?.power_w }))
    .filter((b): b is { id: string; name: string; w: number } => typeof b.w === 'number')
    .sort((a, b) => b.w - a.w);

  const outletW = devices
    .filter((d) => d.class === 'outlet_dual')
    .map((d) => readings[d.id]?.power_w)
    .filter((w): w is number => typeof w === 'number')
    .reduce((sum, w) => sum + w, 0);

  const panelW = totals?.total_power_w ?? null;
  const hasFlow = panelW !== null && panelW > 0 && branches.length > 0;
  const untrackedW = panelW === null ? null : Math.max(0, panelW - outletW);

  return (
    <div className="card energy-flow-card">
      <div className="card-head">
        <h3 className="card-title">
          <GitFork size={14} className="title-icon" aria-hidden="true" />
          Energy Flow
          <InfoHint label="How this flow is derived">
            The panel total is the sum of the four CHNT branch meters, so each branch's share is exact by construction. Sub-metered is the 7 outlets' own meters; the remainder is
            hardwired load — lighting, the ACU, and anything wired direct to the panel — not a measurement gap.
          </InfoHint>
        </h3>
      </div>

      {!hasFlow ? (
        <p className="section-placeholder">Waiting for the panel total…</p>
      ) : (
        <div className="flow">
          <div className="flow-node flow-node--source">
            <span className="flow-node__label">CHNT MAIN PANEL</span>
            <span className="flow-node__value mono">{(panelW / 1000).toFixed(2)} kW</span>
          </div>

          <div className="flow-arm" aria-hidden="true" />

          <div className="flow-branches">
            {branches.map((b) => {
              const share = (b.w / panelW) * 100;
              return (
                <div className="flow-branch" key={b.id}>
                  <div className="flow-branch__head">
                    <span className="flow-branch__name">{b.name}</span>
                    <span className="flow-branch__value mono">{(b.w / 1000).toFixed(2)} kW</span>
                  </div>
                  <div className="flow-branch__track" aria-hidden="true">
                    <div className="flow-branch__fill" style={{ width: `${Math.min(100, share).toFixed(1)}%` }} />
                  </div>
                  <span className="flow-branch__pct mono">{share.toFixed(0)}% of panel</span>
                </div>
              );
            })}
          </div>

          <div className="flow-arm" aria-hidden="true" />

          <div className="flow-split">
            <div className="flow-split__row">
              <span className="flow-split__swatch flow-split__swatch--metered" aria-hidden="true" />
              <span className="flow-split__label">Outlet-metered</span>
              <span className="flow-split__value mono">{(outletW / 1000).toFixed(2)} kW</span>
            </div>
            <div className="flow-split__row">
              <span className="flow-split__swatch flow-split__swatch--untracked" aria-hidden="true" />
              <span className="flow-split__label">Hardwired</span>
              <span className="flow-split__value mono">{untrackedW === null ? '—' : `${(untrackedW / 1000).toFixed(2)} kW`}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
