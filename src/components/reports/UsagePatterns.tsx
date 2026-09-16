import { ReportCaveats } from './ReportCaveats';
import { ReportCharts, type ChartsData } from './ReportCharts';
import { ReportFindings } from './ReportFindings';
import { BASELINE_MIN_DAYS, BASELINE_MIN_SAMPLES, NOT_SAID_TITLE, PLAIN_NOT_SAID, TOO_LITTLE_TITLE, tooLittleRecorded } from '@shared/reportProse.mjs';
import { formatPeriod, type ReportPeriod } from '@/lib/supabaseReports';
import type { ReportChartKind } from '@/lib/reportChartSizes';

/**
 * When the building uses its energy — RM-096. What the Baseline tab held, in the office's words.
 *
 * The same gate first: a period with too little recorded is a sample, and it says so before the numbers.
 * Then three demand tiles instead of p50 / p95 / p99 — usual, high and highest — then the findings, then
 * the three charts that answer "when": a typical day, the busy hours, and the time spent at each level.
 */

interface Props {
  period: ReportPeriod;
  start: string;
  charts: ChartsData;
  hoursLoading: boolean;
  loading: Partial<Record<ReportChartKind, boolean>>;
}

/** Headline demand in kilowatts, as every headline tile on the page is. */
const kw = (w: number | null | undefined) => (w === null || w === undefined || !Number.isFinite(w) ? null : `${(w / 1000).toFixed(2)} kW`);

function DemandTile({ term, value, sub }: { term: string; value: string | null; sub: string }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>
        {value === null ? <span className="reports-figure reports-figure--missing">—</span> : <span className="reports-figure">{value}</span>}
        <span className="reports-figure__caveat report-kpi__sub">{sub}</span>
      </dd>
    </div>
  );
}

export function UsagePatterns({ period, start, charts, hoursLoading, loading }: Props) {
  const label = formatPeriod(period, start);
  const summary = charts.summary ?? null;
  const recordedDays = charts.daily.filter((d) => d.usable_sample_count > 0).length;
  // Real readings and days that held one — never rows, which a meter writes while reading nothing.
  const thin = summary === null || summary.usable_minutes < BASELINE_MIN_SAMPLES || recordedDays < BASELINE_MIN_DAYS;

  return (
    <>
      {thin ? (
        <section className="reports-summary devices-table-card report-thin" role="note" aria-label={TOO_LITTLE_TITLE}>
          <h2 className="card-title">{TOO_LITTLE_TITLE}</h2>
          {tooLittleRecorded(summary?.usable_minutes ?? 0, recordedDays).map((line) => (
            <p key={line} className="reports-note">
              {line}
            </p>
          ))}
        </section>
      ) : null}

      <section className="report-patterns" aria-label={`Demand for ${label}`}>
        <dl className="report-kpis">
          <DemandTile term="Usual demand" value={kw(summary?.p50_w)} sub="Half the time above, half below" />
          <DemandTile term="High demand" value={kw(summary?.p95_w)} sub="Above this only 1 minute in 20" />
          <DemandTile term="Highest demand" value={kw(summary?.max_w)} sub="The most drawn in any minute" />
        </dl>
      </section>

      <ReportFindings label={label} daily={charts.daily} hours={charts.hours} hoursLoading={hoursLoading} summary={summary} />

      <ReportCharts period={period} start={start} {...charts} only={['hours', 'heat', 'curve']} loading={loading} />

      <ReportCaveats title={NOT_SAID_TITLE} items={PLAIN_NOT_SAID} />
    </>
  );
}
