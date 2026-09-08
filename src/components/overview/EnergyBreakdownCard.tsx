import { AlertTriangle, ChartPie } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { InfoHint } from '@/components/ui/InfoHint';
import { CardLink } from '@/components/ui/CardLink';
import { formatKwh, shareOfTotal } from '@/lib/format';
import { energyDisagreement, branchShortfalls } from '@/lib/energyDisagreement';

/**
 * Today's consumed energy, split by branch — the "where did the kWh go" counterpart to
 * `EnergyFlowCard`'s instantaneous "where is the power going".
 *
 * Each figure is that meter's own `energy_kwh_today` counter, and shares are computed
 * against the sum of the branches shown, which is true by construction. Analytics' Energy
 * section carries the same split with week/month periods; this is the Overview-sized view of
 * it, so the "Details" link goes there rather than duplicating the toggle here.
 *
 * THE HEADLINE AND `LiveDemandCard`'S "TODAY" ARE THE SAME NUMBER — RM-057. They were not:
 * this card summed the branch meters' registers while Live Demand, one card away, showed the
 * legacy flow's separately-integrated counter, and they read 4.75 against 5.09. RM-055
 * relabelled this one "kWh today · branches" to stop the two sharing a name; RM-057 removed the
 * reason for the label instead, by making `_totals` the sum of these same meters at the bridge.
 * So the plain label is correct again, and `EnergyBreakdownCard.test.tsx` pins that the
 * qualifier does not come back while the derivation stays shared.
 *
 * The comparison did not go away with it, it moved: `_totals.energy_kwh_today_integrated` still
 * carries the legacy integration of the same circuits, and that is what this checks against.
 * Checking against the headline would now be checking a number against itself. The rule is
 * `lib/energyDisagreement.ts`, shared with Analytics' Energy section, which carries the
 * measurements its thresholds are sized from.
 */
export function EnergyBreakdownCard() {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const integratedToday = useDeviceStore((s) => s.totals?.energy_kwh_today_integrated) ?? null;

  const branches = devices
    .filter((d) => d.class === 'meter')
    .map((d) => ({
      id: d.id,
      name: d.display_name,
      kwh: readings[d.id]?.energy_kwh_today,
      integrated: readings[d.id]?.energy_kwh_today_integrated,
    }))
    .filter((b): b is { id: string; name: string; kwh: number; integrated: number | undefined } => typeof b.kwh === 'number')
    .sort((a, b) => b.kwh - a.kwh);
  const total = branches.reduce((sum, b) => sum + b.kwh, 0);
  const disagreement = energyDisagreement(total, integratedToday);
  // RM-058, and this is the direction the figure above cannot see. A branch reading below its
  // OWN power integration is energy measured and then lost; RM-056 did that to 11.4% of the
  // aircon branch while the building-wide shortfall was 6.7% and went unnoticed for hours.
  const shortfalls = branchShortfalls(branches);

  return (
    <div className="card">
      <div className="card-head">
        <h3 className="card-title">
          <ChartPie size={14} className="title-icon" aria-hidden="true" />
          Energy Breakdown
          <InfoHint label="What this splits">
            Each branch meter's own kWh-today counter. Shares are against the sum of the branches shown. Week and month splits live on the Analytics page, where the bridge's
            longer-period accumulators are reported.
            <br />
            <br />
            <strong>This total and Live Demand's "Today" are the same figure</strong> — both are these branch meters added up, so the page cannot show two answers to one
            question. The building's own flow also integrates the same circuits from power, second by second, as an independent second opinion; it is not shown here, but if the
            two ever drift further apart than they can explain, this card says so rather than leaving it to be noticed.
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
          {disagreement && (
            <p className="energy-disagreement" role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>
                <strong>Two measurements of the same circuits disagree.</strong> These branches add up to {formatKwh(disagreement.branchSum)} today,
                while the building's own power integration over those same circuits gives {formatKwh(disagreement.total)}
                {disagreement.ratio !== null && ` — ${disagreement.ratio.toFixed(1)}x less`}. They are measured differently and need not match
                exactly, but a gap this size means one of the two is wrong.
              </span>
            </p>
          )}
          {shortfalls.length > 0 && (
            <p className="energy-disagreement" role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>
                <strong>
                  {shortfalls.length === 1
                    ? `${shortfalls[0].name} is reporting less than it measured.`
                    : `${shortfalls.length} branches are reporting less than they measured.`}
                </strong>{' '}
                {shortfalls
                  .map((s) => `${s.name} shows ${formatKwh(s.reported)} against ${formatKwh(s.integrated)} of its own power integrated over the same day (${Math.round(s.fraction * 100)}% missing)`)
                  .join('; ')}
                . A branch cannot have used less than its own meter recorded.
              </span>
            </p>
          )}
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
