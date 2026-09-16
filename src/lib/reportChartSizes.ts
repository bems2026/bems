/**
 * The report charts' drawing sizes, in one place — RM-082b.
 *
 * The charts draw into a fixed viewBox and scale to their column, so what a placeholder must match
 * is not a pixel height but an ASPECT RATIO. `ReportCharts` draws at these sizes and
 * `ReportSkeleton` holds each chart's place at the same ratio, so nothing below a chart moves when
 * the chart arrives. Two copies of these numbers would drift, and the drift would be a layout jump
 * nobody could find.
 */

/** Plot width. The kiosk is 1024 wide; the PDF asks for 515pt and sets its own. */
export const REPORT_CHART_WIDTH = 640;

export type ReportChartKind = 'daily' | 'hours' | 'breakdown' | 'heat' | 'curve' | 'useShare' | 'circuitDaily' | 'circuitTrend';

/** The order the report reads in — see `ReportCharts` for why shape comes before totals. */
export const REPORT_CHART_ORDER: readonly ReportChartKind[] = ['daily', 'hours', 'breakdown', 'heat', 'curve'];

/** The heatmap is the only chart whose height follows its data: one row per day it draws. */
export function reportChartHeight(kind: ReportChartKind, dayCount: number): number {
  switch (kind) {
    case 'daily':
      return 230;
    case 'hours':
      return 220;
    case 'breakdown':
    case 'useShare':
      return 100;
    // RM-095: the circuit charts carry a legend row under their day labels.
    case 'circuitDaily':
    case 'circuitTrend':
      return 250;
    case 'heat':
      return dayCount > 10 ? 320 : 200;
    case 'curve':
      return 220;
  }
}
