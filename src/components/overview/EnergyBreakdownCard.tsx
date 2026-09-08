import { AlertTriangle, ChartPie } from 'lucide-react';
import { useDeviceStore } from '@/stores/deviceStore';
import { InfoHint } from '@/components/ui/InfoHint';
import { CardLink } from '@/components/ui/CardLink';
import { formatKwh, shareOfTotal } from '@/lib/format';
import { energyDisagreement } from '@/lib/energyDisagreement';

/**
 * Today's consumed energy, split by branch — the "where did the kWh go" counterpart to
 * `EnergyFlowCard`'s instantaneous "where is the power going".
 *
 * Each figure is that meter's own `energy_kwh_today` counter, and shares are computed
 * against the sum of the branches shown, which is true by construction. Analytics' Energy
 * section carries the same split with week/month periods; this is the Overview-sized view of
 * it, so the "Details" link goes there rather than duplicating the toggle here.
 *
 * THE HEADLINE IS THE BRANCH SUM, AND IT SAYS SO — RM-055. `LiveDemandCard`, one card away on
 * this same page, shows `_totals.energy_kwh_today`: the building's own counter, integrated from
 * power by the legacy flow rather than summed from the meters' registers. The two are different
 * quantities and they do not match — 4.75 against 5.09 when this was written — and both used to
 * be labelled only "today", which is exactly what the operator read as the page contradicting
 * itself. Relabelling was the fix rather than changing either number: the sum of the rows shown
 * is the only figure this card can honestly headline, and the building's own counter is the only
 * figure Live Demand can. What was wrong was the naming, not the arithmetic.
 *
 * And when the branches sum to more than the building they are part of by more than the two
 * derivations can explain, this says so — the same one-sided check Analytics' Energy section
 * runs, from `lib/energyDisagreement.ts`, which carries the measurements its thresholds are
 * sized from.
 */
export function EnergyBreakdownCard() {
  const devices = useDeviceStore((s) => s.devices);
  const readings = useDeviceStore((s) => s.latestReadings);
  const buildingToday = useDeviceStore((s) => s.totals?.energy_kwh_today) ?? null;

  const branches = devices
    .filter((d) => d.class === 'meter')
    .map((d) => ({ id: d.id, name: d.display_name, kwh: readings[d.id]?.energy_kwh_today }))
    .filter((b): b is { id: string; name: string; kwh: number } => typeof b.kwh === 'number')
    .sort((a, b) => b.kwh - a.kwh);
  const total = branches.reduce((sum, b) => sum + b.kwh, 0);
  const disagreement = energyDisagreement(total, buildingToday);

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
            <strong>Why this differs from Live Demand's "Today".</strong> That figure is the building's own running counter, which the flow integrates from power every two
            seconds. This one is the meters' own energy registers added up. They measure the same four circuits by two different routes, so they run a few percent apart; if the
            branches ever sum to well above the building's figure, this card says so rather than leaving both numbers on screen without comment.
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
            {/* "· branches" is what stops this reading as the building's own figure. Not "four
                branches": how many a site has is that site's business, not this card's. */}
            <span className="breakdown-total__unit">kWh today · branches</span>
          </div>
          {disagreement && (
            <p className="energy-disagreement" role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>
                <strong>These branches outrun the building.</strong> They add up to {formatKwh(disagreement.branchSum)} against the building's own
                counter for today, {formatKwh(disagreement.total)}
                {disagreement.ratio !== null && ` — ${disagreement.ratio.toFixed(1)}x it`}. The branches are part of that same load, so a sum this
                far above it means one of the two is wrong.
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
