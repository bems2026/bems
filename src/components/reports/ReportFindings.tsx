import { loadFactor, overnightBaseLoad, weekdayWeekend } from '@/lib/reportFindings';
import type { DailyRow, DemandSummary, HourRow } from '@/lib/reportSeries';

/**
 * Three things the period's own series can say that its total cannot — RM-084, as tiles by RM-097.
 *
 * Each is a figure first and one short line under it, and each is an em dash with its reason when the
 * period cannot carry it. The words are the office's, not a statistician's: "how steady" rather than
 * "load factor", "left on overnight" rather than "base load".
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
    <section className="report-findings" aria-label={`Findings for ${label}`}>
      <dl className="report-kpis">
        <div>
          <dt>Weekday vs weekend</dt>
          <dd>
            {week.weekday.kwh === null || week.weekend.kwh === null ? (
              <Missing reason={week.reason ?? 'There are not enough full days to compare.'} />
            ) : (
              <>
                <span className="reports-figure report-finding__value">{week.weekday.kwh.toFixed(1)} kWh a weekday</span>
                <span className="reports-figure report-finding__value">{week.weekend.kwh.toFixed(1)} kWh a weekend day</span>
                <span className="reports-figure__caveat report-kpi__sub">
                  From {week.weekday.days} full weekdays and {week.weekend.days} full weekend days (Saturday and Sunday)
                  {week.weekday.kwh > 0 ? ` — a weekend day uses ${Math.round((week.weekend.kwh / week.weekday.kwh) * 100)}% of a weekday.` : '.'}
                </span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>How steady</dt>
          <dd>
            {factor.ratio === null || factor.averageW === null || factor.peakW === null ? (
              <Missing reason={factor.reason ?? 'This cannot be stated for this period.'} />
            ) : (
              <>
                <span className="reports-figure report-finding__value">{Math.round(factor.ratio * 100)}%</span>
                <span className="reports-figure__caveat report-kpi__sub">
                  Average {watts(factor.averageW)} against a highest of {watts(factor.peakW)}. Nearer 100% is steadier.
                </span>
                {factor.qualified ? (
                  <span className="reports-figure__caveat report-kpi__sub">
                    {factor.coverage === null
                      ? 'From a partial period whose recording could not be stated.'
                      : `From a partial period: ${Math.round(factor.coverage * 100)}% of its minutes were recorded.`}
                  </span>
                ) : null}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Left on overnight</dt>
          <dd>
            {hoursLoading ? (
              <span className="reports-figure reports-figure--missing">Loading…</span>
            ) : base.w === null ? (
              <Missing reason={base.reason ?? 'This cannot be stated for this period.'} />
            ) : (
              <>
                <span className="reports-figure report-finding__value">{watts(base.w)}</span>
                <span className="reports-figure__caveat report-kpi__sub">
                  Usual demand between midnight and 6am, from {base.hours} of those 6 hours.
                </span>
              </>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
