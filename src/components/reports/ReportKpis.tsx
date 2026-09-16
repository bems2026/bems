import { compare } from '@/lib/ipmvp';
import { coverageOf, formatPeriod, type Coverage, type PeriodBuildingReport, type ReportPeriod } from '@/lib/supabaseReports';
import type { DemandSummary } from '@/lib/reportSeries';
import type { Carboned, Costed } from '@/lib/energyCost';
import { CostCarbonLine } from './CostCarbonLine';
import { ReportFigure } from './ReportFigure';
import type { Section } from './useReportData';

/**
 * The report's headline figures, first and largest — RM-082.
 *
 * They were eight equal cells of a `<dl>`, the period's energy at the same 14px as its command
 * count. Now energy leads in the headline slot, then peak demand, then what it cost and emitted,
 * then how much of the period was actually watched, then — only when it would mean something — how
 * it compares with the period before.
 *
 * ENERGY LEADS, NOT COST. RM-072q settled that the headline of this report is a measurement; a
 * currency figure is derived from it and inherits its qualifier, so it comes after.
 *
 * EVERY RULE A FIGURE KEPT IN THE TABLE, IT KEEPS HERE. Making a number prominent is exactly when
 * a missing qualifier does the most damage: a partial period says so in its own word on the same
 * line, a zero nobody measured says "not observed", and a missing peak is an em dash — `null / 1000`
 * is 0 in JavaScript, which is how a missing peak would otherwise have become "0.00 kW".
 */

interface Props {
  period: ReportPeriod;
  building: PeriodBuildingReport;
  /** `undefined` while the summary is still loading; `null` when there is none. */
  summary: DemandSummary | null | undefined;
  notObserved: boolean;
  cost: Costed;
  carbon: Carboned;
  pricing: Pick<Section<unknown>, 'status' | 'error' | 'retry'>;
  /** The stored period immediately before this one in the list, if any. */
  previous: PeriodBuildingReport | null;
}

const pct = (part: number, whole: number) => Math.round((part / whole) * 100);

function CoverageTile({ summary }: { summary: DemandSummary | null | undefined }) {
  return (
    <div>
      <dt>Recorded</dt>
      <dd>
        {summary === undefined ? (
          <span className="reports-figure reports-figure--missing">Loading…</span>
        ) : summary === null || summary.expected_minutes <= 0 ? (
          <span className="reports-figure reports-figure--missing">—</span>
        ) : (
          <>
            {/* Real readings, not rows. August 2026 is 48% as rows and 27% as readings — RM-072g. */}
            <span className="reports-figure">{pct(summary.usable_minutes, summary.expected_minutes)}%</span>
            <span className="reports-figure__caveat report-kpi__sub">
              {summary.usable_minutes.toLocaleString(undefined)} of {summary.expected_minutes.toLocaleString(undefined)} minutes
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

const observedShare = (c: Coverage | null) => (c ? `${Math.round(c.ratio * 100)}%` : 'unknown');

function ComparisonTile({ period, building, previous }: { period: ReportPeriod; building: PeriodBuildingReport; previous: PeriodBuildingReport }) {
  const previousLabel = formatPeriod(period, previous.period_start);
  const result = compare({ baseline: previous, reporting: building });

  return (
    <div>
      <dt>vs {previousLabel}</dt>
      {result.comparable ? (
        // Still a difference, not a saving — the Compare tab carries the full list of what it was not
        // adjusted for; the tooltip points there rather than repeating it.
        <dd title="A difference, not a saving: not adjusted for weather, occupancy or operating hours. See Compare.">
          <span className="reports-figure">
            {result.differenceKwh > 0 ? '+' : ''}
            {result.differenceKwh.toFixed(2)} kWh
          </span>
          <span className="reports-figure__caveat report-kpi__sub">
            {result.differenceKwh === 0
              ? `the same as ${previousLabel}`
              : `${result.differencePct === null ? '' : `(${Math.abs(result.differencePct).toFixed(1)}%) `}${result.differenceKwh < 0 ? 'less' : 'more'} than ${previousLabel}`}
          </span>
        </dd>
      ) : (
        <dd title={result.reason}>
          <span className="reports-figure reports-figure--missing">— not comparable</span>
          <span className="reports-figure__caveat report-kpi__sub">
            {'baselineCoverage' in result
              ? [
                  { label: previousLabel, c: result.baselineCoverage },
                  { label: formatPeriod(period, building.period_start), c: result.reportingCoverage },
                ]
                  .filter((x) => x.c?.band !== 'complete')
                  .map((x) => `${x.label} ${observedShare(x.c)} recorded`)
                  .join(', ') || result.reason
              : result.reason}
          </span>
        </dd>
      )}
    </div>
  );
}

export function ReportKpis({ period, building, summary, notObserved, cost, carbon, pricing, previous }: Props) {
  const coverage = coverageOf(building.online_sample_count, building.expected_sample_count);
  const peakKw = building.peak_total_power_w === null ? null : building.peak_total_power_w / 1000;

  return (
    <dl className="report-kpis">
      <div className="report-kpi--hero">
        <dt>Energy</dt>
        <dd className="report-kpi__hero-value">
          <ReportFigure value={building.energy_kwh} unit="kWh" digits={2} coverage={coverage} period={period} notObserved={notObserved} />
        </dd>
      </div>
      <div>
        <dt>Highest demand</dt>
        <dd>
          <ReportFigure value={peakKw} unit="kW" digits={2} coverage={coverage} period={period} notObserved={notObserved} />
        </dd>
      </div>
      <CostCarbonLine cost={cost} carbon={carbon} coverage={coverage} pricing={pricing} />
      <CoverageTile summary={summary} />
      {previous ? <ComparisonTile period={period} building={building} previous={previous} /> : null}
    </dl>
  );
}
