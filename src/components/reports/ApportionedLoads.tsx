import { useId } from 'react';
import { apportionedEstimates, shareWords, type ApportionedEstimate } from '@/lib/apportionment';
import { energyFlagText } from '@/lib/boundedEnergy';
import { LOAD_LABELS } from '@shared/circuits.mjs';
import type { PeriodDeviceReport, ReportPeriod } from '@/lib/supabaseReports';
import { ReportFigure } from './ReportFigure';

/**
 * Loads nobody metered, shown as the estimates they are — RM-130 / FI-035.
 *
 * The director's office aircon is on C.O Yellow with the CARE office's outlets, at about two thirds of
 * the branch by the operator's word. Its figure is the branch's measured energy split by that share,
 * and this section is the one place on the page that number appears — with "≈" before it, the share
 * in words, its basis, what it leaves for the outlets, and the branch's own caveats. The measured
 * charts are untouched: "Energy by use" still counts all of C.O Yellow as Others, and this section
 * says how much the estimate would move, rather than moving it.
 *
 * Renders nothing when the site declares no apportionment, and nothing for a branch the page is not
 * showing — an estimate for a circuit the reader has narrowed away from would be an answer to a
 * question they did not ask.
 */

interface Props {
  rows: readonly PeriodDeviceReport[];
  period: ReportPeriod;
  /** The branch meters on the page; an estimate is shown only when its branch is among them. */
  meterIds: readonly string[];
}

function Estimate({ e, period }: { e: ApportionedEstimate; period: ReportPeriod }) {
  const refused = e.flag?.kind === 'impossible';
  return (
    <div className="report-apportioned__item">
      <dl className="report-glance">
        <div>
          <dt>{e.label}</dt>
          <dd>
            {refused ? (
              <span className="reports-figure__caveat">{energyFlagText(e.flag!)}</span>
            ) : (
              <>
                ≈ <ReportFigure value={e.estimatedKwh} unit="kWh" digits={2} coverage={e.coverage} period={period} />
              </>
            )}{' '}
            <span className="reports-figure__caveat">
              {shareWords(e.share)} of {e.branchLabel} — {e.basis}
            </span>
          </dd>
        </div>
        <div>
          <dt>{e.branchLabel}, the rest</dt>
          <dd>
            {refused ? (
              <span className="reports-figure__caveat">Not possible, as above</span>
            ) : (
              <>
                ≈ <ReportFigure value={e.remainderKwh} unit="kWh" digits={2} coverage={e.coverage} period={period} />
              </>
            )}{' '}
            <span className="reports-figure__caveat">{shareWords(1 - e.share)}, the outlets</span>
          </dd>
        </div>
        <div>
          <dt>{e.branchLabel}, measured</dt>
          <dd>
            {refused ? (
              <span className="reports-figure__caveat">Not possible</span>
            ) : (
              <ReportFigure value={e.branchKwh} unit="kWh" digits={2} coverage={e.coverage} period={period} />
            )}
          </dd>
        </div>
      </dl>
      <p className="reports-note">
        “Energy by use” counts all of {e.branchLabel} as {LOAD_LABELS[e.branchLoad]}; this estimate would move{' '}
        {refused || e.estimatedKwh === null ? 'its share' : `≈ ${e.estimatedKwh.toFixed(2)} kWh`} of it to {LOAD_LABELS[e.load]}. It is not
        moved, because a chart of measurements should not carry an estimate.
      </p>
    </div>
  );
}

export function ApportionedLoads({ rows, period, meterIds }: Props) {
  const headingId = useId();
  const shown = new Set(meterIds);
  const estimates = apportionedEstimates(rows).filter((e) => shown.has(e.meterId));
  if (estimates.length === 0) return null;
  return (
    <section className="report-table-card report-apportioned" aria-labelledby={headingId}>
      <h3 id={headingId} className="report-apportioned__title">
        Estimated, not metered
      </h3>
      <p className="reports-note">
        These loads share a branch meter with something else. Each figure below is the branch’s measured energy split by a share
        the operator declared — an estimate, not a measurement.
      </p>
      {estimates.map((e) => (
        <Estimate key={e.id} e={e} period={period} />
      ))}
    </section>
  );
}
