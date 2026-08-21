import { ChartPie } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { InfoHint } from '@/components/ui/InfoHint';
import { CardLink } from '@/components/ui/CardLink';
import { shareOfTotal } from '@/lib/format';

/**
 * Today's consumed energy, split by branch — the "where did the kWh go" counterpart to
 * `EnergyFlowCard`'s instantaneous "where is the power going".
 *
 * Each figure is that meter's own `energy_kwh_today` counter, and shares are computed
 * against the sum of the branches shown, which is true by construction. Analytics' Energy
 * section carries the same split with week/month periods; this is the Overview-sized view of
 * it, so the "Details" link goes there rather than duplicating the toggle here.
 */
export function EnergyBreakdownCard() {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);

  const branches = devices
    .filter((d) => d.class === 'meter')
    .map((d) => ({ id: d.id, name: d.display_name, kwh: readings[d.id]?.energy_kwh_today }))
    .filter((b): b is { id: string; name: string; kwh: number } => typeof b.kwh === 'number')
    .sort((a, b) => b.kwh - a.kwh);
  const total = branches.reduce((sum, b) => sum + b.kwh, 0);

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">
          <ChartPie size={14} className="title-icon" aria-hidden="true" />
          Energy Breakdown
          <InfoHint label="What this splits">
            Each branch meter's own kWh-today counter. Shares are against the sum of the branches shown. Week and month splits live on the Analytics page, where the bridge's
            longer-period accumulators are reported.
          </InfoHint>
        </h3>
        <CardLink to="analytics" label="View the full energy breakdown on Analytics" />
      </div>

      {branches.length === 0 ? (
        <p className="section-placeholder">Waiting for branch meter readings…</p>
      ) : (
        <>
          <div className="breakdown-total">
            <span className="breakdown-total__value mono">{total.toFixed(2)}</span>
            <span className="breakdown-total__unit">kWh today</span>
          </div>
          {branches.map((b) => {
            const share = shareOfTotal(b.kwh, total);
            return (
              <div className="breakdown-row" key={b.id}>
                <span className="breakdown-row__name">{b.name}</span>
                <span className="breakdown-row__track" aria-hidden="true">
                  <span className="breakdown-row__fill" style={{ width: `${share.toFixed(1)}%` }} />
                </span>
                <span className="breakdown-row__kwh mono">{b.kwh.toFixed(1)}</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
