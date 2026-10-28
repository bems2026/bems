import { ChartPie } from 'lucide-react';
import { InfoHint } from '@/components/ui/InfoHint';
import { CardLink } from '@/components/ui/CardLink';
import { formatNumber } from '@/lib/format';
import { describeDisagreement, describeShortfalls, holdFor } from '@/lib/branchEnergy';
import { AlertMark } from '@/components/common/AlertMark';
import { HeldTag } from '@/components/common/HeldTag';
import { useBranchEnergy } from '@/lib/useBranchEnergy';

/**
 * Today's consumed energy, split by branch — the "where did the kWh go" counterpart to
 * `EnergyFlowCard`'s instantaneous "where is the power going".
 *
 * THE SAME SPLIT ANALYTICS SHOWS, FROM THE SAME CALCULATION — RM-078. The operator reported L.O Red
 * reading differently here and on Analytics. This card took every device of class `meter` and
 * rounded to one decimal; Analytics took the `branches` group filtered by `monitoring` and rounded
 * to two. Both now read `useBranchEnergy`, whose membership is the bridge's own
 * `BUILDING_METER_IDS` and whose rows, total, rounding and notices are one derivation
 * (`lib/branchEnergy.ts`). `branchEnergyCards.test.tsx` renders both cards against one store and
 * pins that they agree.
 *
 * THE HEADLINE AND `LiveDemandCard`'S "TODAY" ARE THE SAME NUMBER — RM-057: `_totals` is the sum of
 * these same meters, rounded the same way, so the plain label is correct.
 *
 * The comparison against `_totals.energy_kwh_today_integrated`, the legacy integration of the same
 * circuits, is still made. RM-077 removes from it whatever the integrator counted from a meter that
 * had frozen, and names the freeze instead — L.O Red was accused of "100 % missing" energy on
 * 2026-09-12 when its meter had simply repeated one reading for fifteen hours. Since RM-165 the freeze is
 * named in the alerts bell, and the row carries a `HeldTag` that opens it.
 */
export function EnergyBreakdownCard() {
  const { rows, totalKwh, disagreement, shortfalls, frozen } = useBranchEnergy('today');
  const shortfall = shortfalls.length > 0 ? describeShortfalls(shortfalls, frozen) : null;

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
            <strong>This total, Live Demand's "Today" and Analytics' split are the same figure</strong> — all three are these branch meters added up, by one calculation. The
            building's own flow also integrates the same circuits from power as an independent second opinion; if the two drift further apart than they can explain, or a meter
            stops updating, this card says so rather than leaving it to be noticed.
          </InfoHint>
        </h3>
        <CardLink to="analytics" label="View the full energy breakdown on Analytics" />
      </div>

      {rows.length === 0 || totalKwh === null ? (
        <p className="section-placeholder">Waiting for branch meter readings…</p>
      ) : (
        <>
          <div className="breakdown-total">
            <span className="breakdown-total__value mono">{formatNumber(totalKwh, 2)}</span>
            <span className="breakdown-total__unit">kWh today</span>
            {/* RM-165: the energy checks are notices in the alerts bell; the card keeps a mark that opens it. */}
            {disagreement && <AlertMark {...describeDisagreement(disagreement, 'today')} />}
            {shortfall && <AlertMark headline={shortfall.headline} detail={shortfall.detail} />}
          </div>
          {rows.map((b) => (
            <div className={`breakdown-row${b.stale ? ' breakdown-row--stale' : ''}`} key={b.id}>
              <span className="breakdown-row__name">
                <span className="row-name-text">{b.name}</span>
                {holdFor(frozen, b.id) && <HeldTag hold={holdFor(frozen, b.id)!} />}
                {b.stale && <span className="sr-only"> (last reading expired; this is its last reported count)</span>}
              </span>
              <span className="breakdown-row__track" aria-hidden="true">
                <span className="breakdown-row__fill" style={{ width: `${b.share.toFixed(1)}%` }} />
              </span>
              <span className="breakdown-row__kwh mono">{formatNumber(b.kwh, 2)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
