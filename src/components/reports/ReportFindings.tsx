import { loadFactor, overnightBaseLoad, weekdayWeekend } from '@/lib/reportFindings';
import type { DailyRow, DemandSummary, HourRow } from '@/lib/reportSeries';

/**
 * Three findings under the headline figures — RM-084. What the arithmetic is and when it refuses
 * lives in `src/lib/reportFindings.ts`; this only lays the answers out.
 *
 * A finding the data cannot support is an em dash with its reason beside it, in the same slot the
 * figure would have taken — never a zero, and never a quietly missing tile, which a reader cannot
 * tell apart from a finding nobody thought to compute.
 *
 * Page only for now: the PDF's sections are unchanged, so a document already sent keeps its shape.
 */

interface Props {
  label: string;
  daily: readonly DailyRow[];
  hours: readonly HourRow[] | null;
  /** The hour profile is still on its way: say so rather than refusing. */
  hoursLoading?: boolean;
  summary: DemandSummary | null;
}

const watts = (w: number) => `${Math.round(w).toLocaleString(undefined)} W`;

function Missing({ reason }: { reason: string }) {
  return (
    <>
      <span className="reports-figure reports-figure--missing">—</span>
      <span className="reports-figure__caveat report-kpi__sub">{reason}</span>
    </>
  );
}

export function ReportFindings({ label, daily, hours, hoursLoading = false, summary }: Props) {
  const week = weekdayWeekend(daily);
  const factor = loadFactor(daily, summary);
  const base = overnightBaseLoad(hours);

  return (
    <section className="devices-table-card reports-summary report-findings" aria-label={`Findings for ${label}`}>
      <h2 className="card-title">Findings</h2>
      <dl className="reports-summary__grid">
        <div>
          <dt>Weekday and weekend</dt>
          <dd>
            {week.weekday.kwh === null || week.weekend.kwh === null ? (
              <Missing reason={week.reason ?? 'There are not enough complete days to compare.'} />
            ) : (
              <>
                <span className="reports-figure report-finding__value">{week.weekday.kwh.toFixed(1)} kWh a weekday</span>
                <span className="reports-figure report-finding__value">{week.weekend.kwh.toFixed(1)} kWh a weekend day</span>
                <span className="reports-figure__caveat report-kpi__sub">
                  Averaged over {week.weekday.days} complete weekdays and {week.weekend.days} complete weekend days
                  {week.weekday.kwh > 0 ? `; a weekend day uses ${Math.round((week.weekend.kwh / week.weekday.kwh) * 100)}% of a weekday’s energy.` : '.'}
                </span>
              </>
            )}
            <span className="reports-figure__caveat report-kpi__sub">Saturday and Sunday count as the weekend.</span>
          </dd>
        </div>
        <div>
          <dt>Load factor</dt>
          <dd>
            {factor.ratio === null || factor.averageW === null || factor.peakW === null ? (
              <Missing reason={factor.reason ?? 'The load factor cannot be stated.'} />
            ) : (
              <>
                <span className="reports-figure report-finding__value">{Math.round(factor.ratio * 100)}%</span>
                <span className="reports-figure__caveat report-kpi__sub">
                  Average {watts(factor.averageW)} against a peak of {watts(factor.peakW)}. Nearer 100% is a steadier load.
                </span>
                {factor.qualified ? (
                  <span className="reports-figure__caveat report-kpi__sub">
                    {factor.coverage === null
                      ? 'From a partial period whose coverage could not be stated.'
                      : `From a partial period: ${Math.round(factor.coverage * 100)}% of its minutes held a reading.`}
                  </span>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Overnight base load</dt>
          <dd>
            {hoursLoading ? (
              <span className="reports-figure reports-figure--missing">Loading…</span>
            ) : base.w === null ? (
              <Missing reason={base.reason ?? 'The overnight load cannot be stated.'} />
            ) : (
              <>
                <span className="reports-figure report-finding__value">{watts(base.w)}</span>
                <span className="reports-figure__caveat report-kpi__sub">
                  Typical demand between 00:00 and 06:00, from {base.hours} of those 6 hours — what stays on overnight.
                </span>
              </>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
