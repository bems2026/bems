import { Skeleton } from '@/components/ui/Skeleton';
import type { ReportPeriod } from '@/lib/supabaseReports';
import { REPORT_CHART_ORDER, REPORT_CHART_WIDTH, reportChartHeight, type ReportChartKind } from '@/lib/reportChartSizes';

/**
 * The shape of a report that has not arrived yet — RM-082b.
 *
 * It replaces a line of "Loading the hourly charts…" that was followed, a second later, by five
 * charts pushing everything below them down the page. Each placeholder takes the SAME ASPECT RATIO
 * as the chart it stands in for (`reportChartSizes`), so nothing moves when the chart arrives; the
 * table's placeholder is a label column and right-aligned figures, like the table.
 *
 * WHEN IT IS SHOWN, AND WHEN IT IS NOT. Only while a part of the report has never been drawn for
 * this period. A Retry only ever follows a failure, which has nothing drawn to hold on to, so
 * there is no "hold the old frame" case to handle — and a period already read answers from the
 * cache without a loading state at all (RM-081).
 *
 * The shapes are hidden from assistive technology (`Skeleton` sets `aria-hidden`); what is spoken
 * is one status line saying what is loading. `announce={false}` for a second skeleton on the same
 * page, so a screen reader is not told the same thing twice.
 */

type Part = 'kpis' | 'charts' | 'table';

/**
 * One chart's place, at that chart's own aspect ratio — RM-081b. Since each chart's series loads on
 * its own, one chart can still be on its way while the others have drawn; this holds its place.
 */
export function ChartPlaceholder({ kind, dayCount }: { kind: ReportChartKind; dayCount: number }) {
  return (
    <div className="report-chart report-skeleton__chart" data-chart={kind}>
      <div className="report-skeleton__plot" style={{ aspectRatio: `${REPORT_CHART_WIDTH} / ${reportChartHeight(kind, dayCount)}` }}>
        <Skeleton height="100%" />
      </div>
    </div>
  );
}

interface Props {
  /** What is loading, as the status line names it: "August 2026", "monthly". */
  label: string;
  period: ReportPeriod;
  parts: readonly Part[];
  announce?: boolean;
}

const TILES = 5;
const TABLE_ROWS = 6;
const TABLE_FIGURES = 3;

export function ReportSkeleton({ label, period, parts, announce = true }: Props) {
  // The heatmap's height follows its day count; a placeholder uses the period's usual length.
  const days = period === 'week' ? 7 : 31;

  return (
    <div className="report-skeleton" aria-busy="true">
      {announce ? (
        <p className="sr-only" role="status">
          Loading the {label} report
        </p>
      ) : null}

      {parts.includes('kpis') ? (
        <div className="report-kpis report-skeleton__kpis">
          <div className="report-kpi--hero">
            <Skeleton height="12px" width="30%" />
            <Skeleton height="40px" width="60%" />
          </div>
          {Array.from({ length: TILES }, (_, i) => (
            <div key={i}>
              <Skeleton height="12px" width="60%" />
              <Skeleton height="24px" width="80%" />
            </div>
          ))}
        </div>
      ) : null}

      {parts.includes('charts') ? (
        <div className="report-charts">
          {REPORT_CHART_ORDER.map((kind) => (
            <ChartPlaceholder key={kind} kind={kind} dayCount={days} />
          ))}
        </div>
      ) : null}

      {parts.includes('table') ? (
        <div className="report-table-card report-skeleton__table">
          {Array.from({ length: TABLE_ROWS }, (_, row) => (
            <div key={row} className="report-skeleton__row">
              <span className="report-skeleton__label">
                <Skeleton height="12px" />
              </span>
              {Array.from({ length: TABLE_FIGURES }, (_, figure) => (
                <span key={figure} className="report-skeleton__num">
                  <Skeleton height="12px" />
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
