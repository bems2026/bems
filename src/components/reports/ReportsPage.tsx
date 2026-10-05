import { useCallback, useMemo, useRef, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { InfoHint } from '@/components/ui/InfoHint';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useDeviceStore } from '@/stores/deviceStore';
import { supabase } from '@/config/supabase';
import { downloadCsv, downloadCsvParts } from '@/lib/csv';
import { baselineCsv, dailyCsv, deviceCsv, deviceDailyCsv } from '@/lib/reportCsv';
import { SITE_BASELINE, SITE_HOLIDAYS, compareWithProjection, windowText } from '@/lib/baselineCompare';
import { fetchReadingsForExport, rawFromEdge, readingsCsvParts, type ReadingsClient } from '@/lib/readingsExport';
import { edgeRawSource } from '@/lib/edgeArchive';
import { RAW_RETENTION_DAYS } from '@shared/retention.mjs';
import { getReportWindow } from '@/lib/circuitSeries';
import { LOAD_LABELS } from '@shared/circuits.mjs';
import { reportFilename } from '@/lib/reportFiles';
import type { ReportDetail, ReportSectionId } from '@/lib/reportSections';
import { buildPdfReport } from '@/lib/reportPdf/buildReport';
import { bootedScript } from '@/lib/buildVersion';
import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { SITE } from '@shared/siteConfig.mjs';
import { coverageOf, coverageRestatement, formatPeriod, isQuotable, PERIOD_ADJECTIVE, type ReportPeriod } from '@/lib/supabaseReports';
import { siteDateTime } from '@/lib/siteTime';
import { unusualEventsCaveat } from '@/lib/anomalies';
import { withViewTransition } from '@/lib/viewTransition';
import { ChartWidthContext, useMeasuredChartWidth } from './chartWidth';
import { ReportControlBar } from './ReportControlBar';
import { TabPanel, Tabs } from '@/components/ui/Tabs';
import { ReportSkeleton } from './ReportSkeleton';
import type { ReportChartKind } from '@/lib/reportChartSizes';
import { ReportCharts, type ChartsData } from './ReportCharts';
import {
  ALL_SCOPE,
  branchOf,
  buildBreakdown,
  decodeScope,
  encodeScope,
  loadOfDevice,
  measuredDeviceIds,
  scopeLabel,
  scopeOptions,
  scopeRows,
  type ReportScope,
} from '@/lib/circuitBreakdown';
import type { TabDef } from '@/components/ui/Tabs';
import { UsagePatterns } from './UsagePatterns';
import { BaselineNotes } from './BaselineNotes';
import { CircuitDeepDive } from './CircuitDeepDive';
import { ComparisonReport } from './ComparisonReport';
import { CoverageBanner } from './CoverageBanner';
import { ExportDrawer, type ExportFormat } from './ExportDrawer';
import { ReportSectionNote } from './ReportSectionNote';
import { ReportKpis } from './ReportKpis';
import { CoverageTag, ReportFigure } from './ReportFigure';
import { useReportData, type Section } from './useReportData';
import { readySection, useBaselineReport } from './useBaselineReport';
import type { HourEnergyRow } from '@/lib/reportSeries';
import { conservedBuilding, conservedDaily, counterNote, differingDays } from '@/lib/periodEnergy';
import { carbonOf, costOf, type DayEnergy } from '@/lib/energyCost';
import { circuitDayPoints, circuitHourPoints, circuitRefs, loadShareSegments, trendChartInput } from '@/lib/circuitCharts';
import { apportionedEstimates, estimateDayPoints, estimateHourPoints } from '@/lib/apportionment';

/**
 * Energy reports, weekly or monthly — Phase 12, generalised by RM-041.
 *
 * PULL, NOT PUSH: reports are generated server-side into `monthly_reports` and read here.
 * There is no email or webhook delivery, deliberately — that would mean an SMTP credential
 * or an API key living on a deployment whose repository is public, to solve a problem a
 * download button already solves. A CSV opens in Sheets or Excel in one step.
 *
 * COVERAGE IS RENDERED BESIDE EVERY FIGURE, never on its own line to be skipped. A device
 * offline for most of a month still yields a real, small kWh number, and quoting it bare is
 * the same error as the truncated chart Phase 9 fixed. With the field devices down since
 * 2026-08-20 (RM-001), most months available today are mostly gap — the page says so rather
 * than printing a confident total.
 *
 * EVERY PART LOADS AND FAILS ON ITS OWN — RM-081. `useReportData` reads the report as six
 * independent sections, and every panel below sits in its own inline error boundary. A failed
 * tariff read costs the cost line, a hung heatmap query costs the four hourly charts, and a
 * malformed row costs one card — and each says so where it would have been, with a Retry.
 *
 * FOUR TABS, EACH ONE QUESTION — RM-096. Overview: how much, with the few figures and two charts that say
 * it. Circuits: where it went and what it was for, circuit by circuit. Usage patterns: when. Compare: what
 * changed — against an earlier period, or against the baseline. The words are the office's (RM-097): no p50
 * or p95, no "DSM ceiling".
 *
 * THE BASELINE IS A WAY OF READING A PERIOD — RM-154. Chosen in the calendar, it lays the projected baseline on
 * the period being read and shows it through the same four tabs: every section below comes through one switch
 * (recorded, from `useReportData`; or projected, from `useBaselineReport`), so no chart is written twice.
 *
 * THE HEADLINE COMES FIRST AND LARGEST — RM-082. The period is named with its coverage badge, then
 * the key figures, then the coverage in detail, then what else the period recorded, then the
 * charts and the device table. Coverage still travels with every figure it qualifies: each
 * headline carries its own "(partial …)" on the same line, and the badge sits in the heading
 * directly above them.
 */

/** RM-140: the charts each tab draws, so its skeleton holds exactly their places and nothing jumps. */
const USAGE_CHARTS: readonly ReportChartKind[] = ['hours', 'heat', 'curve'];
const CIRCUIT_CHARTS: readonly ReportChartKind[] = ['circuitDaily', 'circuitTrend'];

/**
 * Four readings of the same period, not four pages.
 *
 * The overview answers how much, the circuits answer where it went and what for, the usage patterns
 * answer when, and the comparison answers what changed — and every one of them is about the period the
 * picker above them selects. Tabs rather than routes for that reason: the
 * period is the page's subject, and a tab that reset it would be a different page pretending.
 *
 * NO PANEL FETCHES ON MOUNT, which is `Tabs`' own stated requirement — selection follows focus,
 * so arrowing across the strip would otherwise fire four loads. Everything is fetched once at
 * this level, keyed on the period, and handed down.
 */
const REPORT_TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'circuits', label: 'Circuits' },
  { id: 'patterns', label: 'Usage patterns' },
  { id: 'compare', label: 'Compare' },
];

/**
 * What a reader can narrow the per-device figures to — one branch circuit (RM-082c), or every branch
 * that carries one kind of load (RM-093). Read from the circuit tree once: it is this deployment's
 * wiring, which does not change while the page is open.
 */
const SCOPES = scopeOptions();

/** When the stored report was generated, in the building's own time; nothing when unreadable. */
function generatedLabel(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? siteDateTime(t) : null;
}

export function ReportsPage() {
  const [tab, setTab] = useState('overview');
  const devices = useDeviceStore((s) => s.devices);
  /**
   * Week or month — RM-041. The operator asked for both, and they answer different questions: a
   * month is what gets reported upward, a week is how you notice something changed.
   *
   * Changing it lands on that kind's newest report rather than trying to map one period onto the
   * other. The week containing 1 July is not "July", and a mapping that picked one would be
   * inventing a correspondence that does not exist.
   */
  const [period, setPeriod] = useState<ReportPeriod>('month');
  /** RM-154: the period's projected baseline instead of its recorded report — chosen in the calendar. */
  const [baselineMode, setBaselineMode] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const chartWidth = useMeasuredChartWidth(panelRef);
  // RM-094: the circuit series load only while something shows them — the Circuits tab, or an export.
  // RM-151: likewise Usage patterns' three charts, which the Overview used to fire on every visit.
  /** RM-154: whether the page shows the period's projected baseline — decided before the reads it saves. */
  const hasBaseline = SITE_BASELINE !== null;
  const showBaseline = baselineMode && hasBaseline;
  const report = useReportData(period, undefined, {
    // RM-154: a baseline draws its circuits and patterns from the projection, so the recorded ones wait.
    circuits: !showBaseline && (tab === 'circuits' || exportOpen),
    patterns: !showBaseline && (tab === 'patterns' || exportOpen),
    // RM-154: every tab that prints energy per day prints the circuits' sum — and Compare sets them day by day
    // against the baseline — so the circuits' days are always read.
    daily: true,
  });
  const { periods, selected, select, pricing, ceiling } = report;

  /**
   * RM-154: the baseline for the period being read. `projection` is what the four tabs show in Baseline mode;
   * `compareProjection` is the same period's baseline with its holidays as closed days, which Compare and the
   * exports set the recorded period against. Both are arithmetic over committed files — no request.
   */
  const projection = useBaselineReport(period, selected, showBaseline);
  const compareProjection = useBaselineReport(period, selected, hasBaseline && (tab === 'compare' || exportOpen), SITE_HOLIDAYS);
  const projected = projection.projected;
  const fromProjection = <T,>(data: T | null): Section<T> =>
    readySection(data, projection.status === 'ready' ? (data === null ? 'loading' : 'ready') : projection.status, projection.error);
  const dailySeries = showBaseline ? fromProjection(projected?.daily ?? null) : report.daily;
  const summary = showBaseline ? fromProjection(projected?.summary ?? null) : report.summary;
  const hours = showBaseline ? fromProjection(projected?.hours ?? null) : report.hours;
  const hourEnergy: Section<HourEnergyRow[]> = showBaseline
    ? period === 'day'
      ? fromProjection(projected?.hourEnergy ?? null)
      : readySection<HourEnergyRow[]>(null, 'idle')
    : report.hourEnergy;
  const matrix = showBaseline ? fromProjection(projected?.matrix ?? null) : report.matrix;
  const curve = showBaseline ? fromProjection(projected?.curve ?? null) : report.curve;
  const devicesSection = showBaseline ? fromProjection(projected?.devices ?? null) : report.devices;
  const deviceDailySection = showBaseline ? fromProjection(projected?.deviceDaily ?? null) : report.deviceDaily;
  const trendSection = showBaseline ? fromProjection(projected?.trend ?? null) : report.trend;
  /** Per day, which recorded day a projected one is — said on hover in the charts. */
  const dayNotes = showBaseline ? projected?.notes : undefined;
  /**
   * RM-154, ADR-0013: each day's energy is the sum of its circuits, so the bars, the cost and the findings
   * add up to the period's figure and to the Circuits tab. Held back while the circuits' days are on their
   * way, rather than drawn from the counter and redrawn a moment later; a failed read keeps the counter's
   * days, and its note says so.
   */
  const circuitDays = report.deviceDaily.data?.available ? report.deviceDaily.data.rows : null;
  const recordedDaily = useMemo(
    () => (report.daily.data && report.deviceDaily.status !== 'loading' ? conservedDaily(report.daily.data, circuitDays) : null),
    [report.daily.data, report.deviceDaily.status, circuitDays]
  );
  // A projection's days are its circuits' already (`projectPeriod` builds both from the same hours).
  const dailyShown = showBaseline ? (projected?.daily ?? null) : recordedDaily;
  /** The summary as `ReportKpis` reads it: `undefined` while it loads, `null` when there is none or it failed. */
  const summaryShown = summary.status === 'ready' ? (summary.data ?? null) : summary.status === 'error' ? null : undefined;
  const months = periods.data;
  const rows = devicesSection.data;

  /**
   * The whole building, one category of load, or one branch circuit — RM-082c and RM-093. It narrows the
   * Circuits tab, its charts and the per-device exports. The Overview and Usage patterns are the whole
   * building's series, and they say so in one line when a narrower part is chosen.
   * Kept across periods and tabs: which part of the building a reader is looking at is not a property
   * of the month.
   */
  const [scope, setScope] = useState<ReportScope>(ALL_SCOPE);
  /** The part of the building the page is narrowed to, by name — `null` for the whole of it. */
  const narrowed = scopeLabel(scope);
  const scopedRows = useMemo(() => (rows ? scopeRows(rows, scope) : null), [rows, scope]);

  const nameOf = useCallback(
    (id: string) => devices.find((d) => d.id === id)?.display_name ?? id,
    [devices]
  );

  /**
   * The breakdown, derived from the circuit tree rather than from device names. Which meters
   * make the whole is `BUILDING_METER_IDS` — the same derived constant `shared/buildLatest.mjs`
   * sums to produce the building total — so the chart and the figure printed above it cannot
   * disagree. See `src/lib/circuitBreakdown.ts` for why none of it is written here.
   */
  const { segments, untracked } = useMemo(() => buildBreakdown(rows ?? [], nameOf), [rows, nameOf]);
  /** RM-096: the building by what each circuit carries — Lighting, Aircon, Others. */
  const useSegments = useMemo(() => loadShareSegments(rows ?? []), [rows]);

  /** The charts need the daily series; each of the other three draws when its own series arrives
   *  (RM-081b). The ceiling is optional: a failed read draws the curve without its line.
   *  RM-151: the summary rides along when it has arrived, and is not a condition for drawing. */
  const charts: ChartsData | null = useMemo(
    () =>
      dailyShown
        ? {
            daily: dailyShown,
            hours: hours.data,
            hourEnergy: hourEnergy.data,
            matrix: matrix.data,
            curve: curve.data,
            segments,
            useSegments,
            untracked: showBaseline ? undefined : untracked,
            ceilingW: ceiling.data ?? null,
            dayNotes,
            summary: summary.data ?? null,
          }
        : null,
    [dailyShown, summary.data, hours.data, hourEnergy.data, matrix.data, curve.data, segments, useSegments, untracked, ceiling.data, showBaseline, dayNotes]
  );
  /**
   * RM-151: when the daily series itself failed, what does not depend on it still draws — "Energy by
   * use" from the stored rows, and Usage patterns' three charts from their own series. With no days
   * to size them by, they take their month-sized defaults.
   */
  const withoutDaily: ChartsData | null = useMemo(
    () =>
      dailySeries.status === 'error'
        ? {
            daily: [],
            hours: hours.data,
            hourEnergy: hourEnergy.data,
            matrix: matrix.data,
            curve: curve.data,
            segments,
            useSegments,
            untracked: showBaseline ? undefined : untracked,
            ceilingW: ceiling.data ?? null,
            dayNotes,
            summary: summary.data ?? null,
          }
        : null,
    [dailySeries.status, summary.data, hours.data, hourEnergy.data, matrix.data, curve.data, segments, useSegments, untracked, ceiling.data, showBaseline, dayNotes]
  );

  /**
   * Cost and carbon, from the SAME per-day series the charts are drawn from — so the figure in
   * the summary and the bars above it cannot describe different days.
   */
  const priced = useMemo(() => {
    const days: DayEnergy[] = (dailyShown ?? []).map((d) => ({
      day: d.local_day.slice(0, 10),
      // A day whose rows carried no reading has no energy to price. Passing its 0 through would
      // price it at zero, which says the building spent nothing rather than that nobody watched.
      kwh: d.usable_sample_count > 0 ? d.energy_kwh : null,
    }));
    return { cost: costOf(days, pricing.data?.tariffs ?? []), carbon: carbonOf(days, pricing.data?.factors ?? []) };
  }, [dailyShown, pricing.data]);

  const selectedIndex = months && selected ? months.findIndex((m) => m.period_start.slice(0, 10) === selected) : -1;
  const recordedBuilding = months && selectedIndex >= 0 ? months[selectedIndex] : null;
  const building = showBaseline ? (projected?.building ?? null) : recordedBuilding;
  /** The list is newest first, so the period before this one is the next entry — named by its own
   *  label wherever it is shown, because a missing week in between makes it not the calendar's. */
  const previous = !showBaseline && months && selectedIndex >= 0 ? (months[selectedIndex + 1] ?? null) : null;
  const buildingCoverage = building ? coverageOf(building.online_sample_count, building.expected_sample_count) : null;
  /**
   * RM-154, ADR-0013: the period's energy is the sum of its circuits — the same figure on the Overview, the
   * Circuits tab, the comparisons and the exports. The building's own counter rides along as `counter_kwh`,
   * the stated check. "vs the previous period" reads the previous period's own circuits the same way.
   */
  const conserved = useMemo(() => (building ? conservedBuilding(building, rows) : null), [building, rows]);
  const previousConserved = useMemo(
    () => (previous ? conservedBuilding(previous, report.previousDevices.data) : null),
    [previous, report.previousDevices.data]
  );
  const energyPending = devicesSection.status === 'loading' || (previous !== null && report.previousDevices.status === 'loading');

  /**
   * RM-154: the recorded period against its baseline — on Compare, in the Baseline CSV and in the PDF. Always the
   * RECORDED period's figures (the sum of its circuits), whichever mode the page is in.
   */
  const recordedConserved = useMemo(
    () => (recordedBuilding ? conservedBuilding(recordedBuilding, report.devices.data) : null),
    [recordedBuilding, report.devices.data]
  );
  const againstBaseline = useMemo(() => {
    if (!hasBaseline) return null;
    const comparison =
      compareProjection.projected && recordedConserved && recordedBuilding
        ? compareWithProjection({
            baseline: SITE_BASELINE,
            projected: compareProjection.projected,
            period,
            recordedKwh: recordedConserved.energy_kwh,
            recordedByLoad: Object.fromEntries(loadShareSegments(report.devices.data ?? []).map((x) => [x.id, x.kwh])),
            recordedDaily: (recordedDaily ?? []).map((d) => ({ date: d.local_day.slice(0, 10), kwh: d.usable_sample_count > 0 ? d.energy_kwh : null })),
            coverage: coverageOf(recordedBuilding.online_sample_count, recordedBuilding.expected_sample_count),
          })
        : null;
    return { status: compareProjection.status, error: compareProjection.error, comparison };
  }, [hasBaseline, compareProjection.projected, compareProjection.status, compareProjection.error, recordedConserved, recordedBuilding, period, report.devices.data, recordedDaily]);
  /** How many recorded days the baseline is made of, and from when — said where "Recorded" would be. */
  const builtFrom = SITE_BASELINE
    ? { days: Object.values(SITE_BASELINE.day_types).reduce((a, t) => a + t.days.length, 0), window: windowText(SITE_BASELINE) }
    : null;
  const counterCheck = useMemo(
    () => (conserved ? counterNote(conserved, dailySeries.data && dailyShown ? differingDays(dailySeries.data, dailyShown) : []) : null),
    [conserved, dailySeries.data, dailyShown]
  );

  /**
   * Whether the period's headline figures were ever measured. Once the summary has arrived this
   * is exact — not one minute of the period carried a real reading. Before it arrives, a stored
   * zero from a period that was not fully observed is held back rather than printed: it is either
   * "not observed" or a floor of nothing, and neither reads correctly as "0.00 kWh".
   */
  const notObserved =
    summary.status === 'ready'
      ? summary.data?.usable_minutes === 0
      : building !== null && building.energy_kwh === 0 && !isQuotable(buildingCoverage);

  /**
   * Which exports cannot run for this period right now, each with the reason — RM-083b. A cost the
   * page could not read must not become a PDF saying "no rate has been entered" or a CSV with no cost
   * column, both of which are claims about the database that a failed read has not established.
   */
  const pricingReason =
    pricing.status === 'error'
      ? 'The rates could not be loaded, so the cost could not be stated. Retry them on the page first.'
      : pricing.status === 'loading'
        ? 'Still loading the rates.'
        : null;
  const failedPart = dailySeries.status === 'error' || summary.status === 'error' || devicesSection.status === 'error';
  /**
   * RM-140: the Circuits series load when the drawer opens (RM-094's `want`), and this gate did not wait for
   * them — a PDF made at once printed the circuit charts as "could not be loaded" when they were only still
   * loading. They are waited for like the other charts, and named beside their sections when they fail.
   */
  const circuitsStillLoading = deviceDailySection.status === 'loading' || trendSection.status === 'loading';
  const chartsStillLoading = hours.status === 'loading' || matrix.status === 'loading' || curve.status === 'loading' || circuitsStillLoading;
  const exportUnavailable: Partial<Record<ExportFormat, string>> = {};
  // The PDF prints the demand summary beside the charts, so it waits for that as well (RM-151 split it out).
  if (!charts || !rows || summary.status !== 'ready') {
    exportUnavailable.pdf = failedPart ? 'Part of this report could not be loaded. Retry it on the page first.' : 'The report is still loading.';
  } else if (chartsStillLoading || (period === 'day' && hourEnergy.status === 'loading')) {
    exportUnavailable.pdf = 'The charts are still loading.';
  } else if (pricingReason) {
    exportUnavailable.pdf = pricingReason;
  }
  /**
   * A chart whose series failed no longer blocks the PDF — RM-081b. It is left out, the document says
   * so, and the drawer says so beside the section before anyone generates it.
   */
  const leftOut = 'Could not be loaded, so it will be left out of the PDF. Retry it on the page to include it.';
  const exportSectionNotes: Partial<Record<ReportSectionId, string>> = {};
  if (hours.status === 'error') exportSectionNotes.hourProfile = leftOut;
  if (hourEnergy.status === 'error') {
    exportSectionNotes.hourlyEnergy = leftOut;
    exportSectionNotes.circuitHourly = leftOut;
  }
  if (matrix.status === 'error') exportSectionNotes.heatmap = leftOut;
  if (curve.status === 'error') exportSectionNotes.durationCurve = leftOut;
  if (deviceDailySection.status === 'error') {
    exportSectionNotes.circuitEnergy = leftOut;
    exportSectionNotes.apportioned = leftOut;
  }
  if (trendSection.status === 'error') exportSectionNotes.circuitTrend = leftOut;
  if (!dailySeries.data) {
    exportUnavailable['daily-csv'] =
      dailySeries.status === 'error' ? 'The daily figures could not be loaded. Retry them on the page first.' : 'The daily figures are still loading.';
  } else if (pricingReason) {
    exportUnavailable['daily-csv'] = pricingReason;
  }
  if (!rows) {
    exportUnavailable['device-csv'] =
      devicesSection.status === 'error'
        ? 'The per-device figures could not be loaded. Retry them on the page first.'
        : 'The per-device figures are still loading.';
  } else if (rows.length === 0) {
    exportUnavailable['device-csv'] = 'No per-device rows were stored for this period.';
  } else if (narrowed && scopedRows?.length === 0) {
    exportUnavailable['device-csv'] = `No device on ${narrowed} reported for this period. Choose All circuits to export every device.`;
  }
  // RM-098: the per-day file is phase42's bounded daily energy, so it waits for that and says so.
  const daily = deviceDailySection;
  if (daily.status === 'error') {
    exportUnavailable['device-daily-csv'] = 'The daily figures per circuit could not be loaded. Retry them on the Circuits tab first.';
  } else if (daily.status !== 'ready' || !daily.data) {
    exportUnavailable['device-daily-csv'] = 'The daily figures per circuit are still loading.';
  } else if (!daily.data.available) {
    exportUnavailable['device-daily-csv'] = 'Needs the database update (phase42) — until it is applied, per-device days are not available.';
  }

  if (!SITE_BASELINE) exportUnavailable['baseline-csv'] = 'This site has no baseline yet — it is built once four weeks have been recorded.';
  if (showBaseline) {
    exportUnavailable['readings-csv'] = 'A baseline is projected from recorded days, so it has no readings of its own. Choose Recorded in the calendar to export them.';
  }
  /** RM-154: a baseline's files say so in their names, so they cannot overwrite the recorded period's. */
  const fileScope = (part: string | null) => [part, showBaseline ? 'baseline' : null].filter(Boolean).join(' ') || null;

  if (!supabase) {
    return (
      <>
        <PageHeader title="Reports" sub="Weekly and monthly energy reports" />
        <p className="reports-note">
          Reports come from stored history, which is not configured in this build. Nothing to show — rather than an
          empty table that would look like a month with no consumption.
        </p>
      </>
    );
  }

  const periodLabel = selected ? formatPeriod(period, selected) : '';
  const scopeKey = `${period}:${selected ?? ''}`;
  /** Placeholders only while nothing has failed: a failure shows its Retry note instead, and a
   *  skeleton beside an error would say the part is still coming when it is not. */
  const chartsLoading = charts === null && dailySeries.status === 'loading';
  // RM-124: a day is read hour by hour; its "energy per day" would be one bar.
  const overviewCharts: readonly ReportChartKind[] = period === 'day' ? ['hourly', 'useShare'] : ['daily', 'useShare'];
  const tabCharts = tab === 'patterns' ? USAGE_CHARTS : tab === 'circuits' ? CIRCUIT_CHARTS : tab === 'compare' ? [] : overviewCharts;
  /**
   * Performs one export and says, in words, what was saved. Throws with the reason when it cannot —
   * `ExportDrawer` shows that beside its button. Names come from `reportFilename`, never from the
   * on-screen label, so they cannot vary with the reader's locale.
   */
  const loadLabelOf = (id: string) => {
    const load = loadOfDevice(id);
    return load ? (LOAD_LABELS[load] as string) : null;
  };
  const runExport = async (
    format: ExportFormat,
    sections: ReportSectionId[],
    progress: (text: string) => void,
    signal: AbortSignal,
    detail: ReportDetail = 'detailed'
  ): Promise<string> => {
    if (!selected) throw new Error('No report period is selected.');

    if (format === 'device-daily-csv') {
      const data = deviceDailySection.data;
      if (!data || !data.available) throw new Error('The daily figures per circuit are not available.');
      const dayRows = scopeRows(data.rows, scope);
      if (dayRows.length === 0) throw new Error(narrowed ? `No device on ${narrowed} has daily figures for this period.` : 'No device has daily figures for this period.');
      const name = reportFilename(period, selected, 'devices-daily', 'csv', fileScope(narrowed));
      downloadCsv(name, deviceDailyCsv({ rows: dayRows, nameOf, circuitOf: branchOf, useOf: loadLabelOf }));
      return `Saved ${name} · ${dayRows.length} device-days${narrowed ? ` on ${narrowed}` : ''}`;
    }

    if (format === 'readings-csv') {
      if (!supabase) throw new Error('Stored readings are not configured in this build.');
      const ids = scopeRows(
        measuredDeviceIds().map((device_id) => ({ device_id })),
        scope
      ).map((r) => r.device_id);
      if (ids.length === 0) throw new Error(`No device on ${narrowed ?? 'this building'} takes readings.`);
      progress('Finding the period…');
      const win = await getReportWindow(period, selected, { signal });
      const exportWindow = { startIso: win.win_start, endIso: win.win_end };
      // RM-148: minutes older than the cloud's raw window come from the edge's archive; if the edge
      // cannot answer, the cloud's hourly averages stand in, labelled as such, as they always have.
      const fromEdge = rawFromEdge(exportWindow, Date.now(), RAW_RETENTION_DAYS);
      const readings = await fetchReadingsForExport(supabase as unknown as ReadingsClient, ids, exportWindow, {
        signal,
        onProgress: (p) => progress(`${p.fetched.toLocaleString(undefined)} readings so far · ${nameOf(p.deviceId)}`),
        ...(fromEdge ? { rawFrom: edgeRawSource } : {}),
      });
      const parts = readingsCsvParts({
        devices: ids.map((id) => ({ id, name: nameOf(id), circuit: branchOf(id), use: loadLabelOf(id) })),
        readings,
        utcOffsetMinutes: SITE.utc_offset_minutes,
        timezone: SITE.timezone,
      });
      const name = reportFilename(period, selected, 'readings', 'csv', narrowed);
      downloadCsvParts(name, parts);
      const count = readings.reduce((a, d) => a + d.raw.length + d.hourly.length, 0);
      const edge = readings.filter((d) => d.source === 'edge').length;
      const tier = !fromEdge ? '' : edge === readings.length ? ' · minutes from the on-site archive' : edge > 0 ? ` · minutes from the on-site archive for ${edge} of ${readings.length}` : ' · the on-site archive did not answer, so older hours are hourly averages';
      return `Saved ${name} · ${count.toLocaleString(undefined)} rows from ${ids.length} devices${tier}`;
    }

    if (format === 'device-csv') {
      if (!rows || !scopedRows || scopedRows.length === 0) throw new Error('No per-device rows were stored for this period.');
      // RM-082c: the narrowed rows, with the whole period's beside them so each share is still of the building.
      const name = reportFilename(period, selected, 'devices', 'csv', fileScope(narrowed));
      downloadCsv(
        name,
        deviceCsv({ period, start: selected, rows: scopedRows, buildingRows: rows, nameOf, branchOf, meterIds: BUILDING_METER_IDS as readonly string[] })
      );
      return `Saved ${name} · ${scopedRows.length} devices${narrowed ? ` on ${narrowed}` : ''}`;
    }

    if (format === 'baseline-csv') {
      // RM-153: the committed baseline and this period against it, from the rows the page already holds.
      if (!SITE_BASELINE) throw new Error('This site has no baseline yet.');
      // RM-154: the recorded period against its projection on the same dates — what Compare shows.
      const comparison = againstBaseline?.comparison ?? null;
      const name = reportFilename(period, selected, 'baseline', 'csv');
      downloadCsv(name, baselineCsv({ baseline: SITE_BASELINE, comparison, periodLabel }));
      return `Saved ${name} · the baseline, its ${SITE_BASELINE.recorded.days.length} recorded days, and ${periodLabel} against it`;
    }

    if (format === 'daily-csv') {
      const days = dailyShown;
      if (!days) throw new Error('The daily figures have not loaded.');
      const name = reportFilename(period, selected, 'daily', 'csv', fileScope(null));
      downloadCsv(name, dailyCsv({ daily: days, tariffs: pricing.data?.tariffs ?? [], factors: pricing.data?.factors ?? [], projected: showBaseline }));
      return `Saved ${name} · ${days.length} days`;
    }

    if (!charts || !rows) throw new Error('The report has not finished loading.');
    const started = performance.now();
    // RM-099: the circuit charts for the part of the building chosen, when their series are here. One that
    // is not is named in the document as left out, never drawn empty.
    const refs = circuitRefs(scope);
    const dailyData = deviceDailySection.data;
    // RM-130: each estimate's own bars, from the same rows the Circuits tab scales them from.
    const apportionedSeries = apportionedEstimates(rows).map((e) => ({
      id: e.id,
      days: period !== 'day' && dailyData && dailyData.available ? estimateDayPoints(dailyData.rows, e) : null,
      hours: period === 'day' && hourEnergy.data ? estimateHourPoints(hourEnergy.data, e) : null,
    }));
    const circuitInput = {
      series: refs,
      days: dailyData && dailyData.available ? circuitDayPoints(dailyData.rows, refs) : null,
      // RM-124: a day's circuits, hour by hour, from the same rows the Circuits tab draws.
      hours: period === 'day' && hourEnergy.data ? circuitHourPoints(hourEnergy.data, refs) : null,
      trend: trendSection.data ? trendChartInput(trendSection.data, refs, SITE.utc_offset_minutes) : null,
    };
    const pdf = buildPdfReport({
      period,
      periodLabel,
      siteName: SITE.display_name,
      timezone: SITE.timezone,
      generatedAt: siteDateTime(Date.now()),
      buildId: bootedScript(),
      building: conserved,
      previous: previousConserved,
      rows,
      scopedRows: scopedRows ?? rows,
      charts,
      cost: priced.cost,
      carbon: priced.carbon,
      nameOf,
      meterIds: BUILDING_METER_IDS as readonly string[],
      sections,
      detail,
      scopeLabel: narrowed,
      circuits: circuitInput,
      apportionedSeries,
      baseline: SITE_BASELINE,
      holidays: SITE_HOLIDAYS,
      baselineComparison: againstBaseline?.comparison ?? null,
      projectedFrom:
        showBaseline && builtFrom
          ? `Projected from ${builtFrom.days} recorded days, ${builtFrom.window}: each date is one recorded day of its kind, scaled once per kind so the kind averages the baseline. Nothing in it was recorded on these dates.`
          : null,
    });
    const assembled = performance.now();
    const name = reportFilename(period, selected, 'report', 'pdf', fileScope([narrowed, detail === 'simple' ? 'simple' : null].filter(Boolean).join(' ') || null));
    // pdfmake is still loaded only here, on the first export — never on a page load.
    const { downloadReportPdf } = await import('@/lib/reportPdf/download');
    await downloadReportPdf(pdf, name);
    // Measured, not assumed: generation on the kiosk's Pi has never been timed (RM-072a), and RM-083c
    // moves it to a worker only if this says it is slow there.
    console.info(`[ibems] pdf: assembled in ${Math.round(assembled - started)} ms, rendered in ${Math.round(performance.now() - assembled)} ms`);
    return `Saved ${name} · ${detail === 'simple' ? 'Simple' : 'Detailed'}, ${pdf.sections?.length ?? 0} sections`;
  };

  return (
    // RM-142: every chart below is drawn at the width of the tab panel, measured once it is on the page.
    <ChartWidthContext value={chartWidth}>
      <PageHeader
        title="Reports"
        sub={
          <>
            {PERIOD_ADJECTIVE[period]} energy, where it went, and when{' '}
            <InfoHint>
              Made from stored readings {period === 'day' ? 'an hour' : 'a couple of days'} after each {period} ends. Every figure says how
              much of the {period} was recorded — a partly recorded {period} gives a real number that is lower than what was used.
            </InfoHint>
          </>
        }
      />

      {/* RM-082b: every control in one sticky bar — what kind of period, which one, which part of the
          building, which reading of it, and what to take away. */}
      <ReportControlBar
        period={period}
        // RM-140: a change the reader asked for crossfades where the browser can; the bar holds still.
        onPeriodChange={(p) => withViewTransition(() => setPeriod(p))}
        starts={months ? months.map((m) => m.period_start.slice(0, 10)) : []}
        selected={selected}
        onSelect={(start) => withViewTransition(() => select(start))}
        pending={report.pending}
        periodsLoading={periods.status === 'loading'}
        baseline={showBaseline}
        onBaselineChange={hasBaseline ? (on) => withViewTransition(() => setBaselineMode(on)) : undefined}
        scopes={SCOPES}
        scope={encodeScope(scope)}
        onScopeChange={(value) => withViewTransition(() => setScope(decodeScope(value)))}
        actions={
          <button type="button" className="report-primary-btn" onClick={() => setExportOpen(true)} disabled={!selected} aria-haspopup="dialog">
            <Download size={16} aria-hidden="true" /> Export
          </button>
        }
      />

      {/* RM-101: the tabs decide the reading of the report, not the report — a strip of their own, so
          the bar above stays one line on the kiosk. */}
      <Tabs tabs={REPORT_TABS} activeId={tab} onChange={(id) => withViewTransition(() => setTab(id))} label="Report type" className="report-tabs-strip" />

      {narrowed && tab !== 'circuits' && tab !== 'compare' ? (
        // RM-096: the Overview and Usage patterns are the whole building's series; the chosen part of it
        // lives on Circuits. Said in one line with the way there, instead of a paragraph.
        <p className="reports-note report-scope-note" role="note">
          This tab shows the whole building. <strong>{narrowed}</strong> is on the Circuits tab.{' '}
          <button type="button" className="report-retry-btn" onClick={() => withViewTransition(() => setTab('circuits'))}>
            Open Circuits
          </button>
        </p>
      ) : null}

      {periods.status === 'loading' ? (
        <ReportSkeleton label={PERIOD_ADJECTIVE[period].toLowerCase()} period={period} parts={['kpis', 'charts']} kinds={tabCharts} />
      ) : null}
      <ReportSectionNote section={periods} what="the list of reports" quietWhileLoading />

      {/* RM-138: what comes next, in words — the calendar's dashed cell carries it too, but its title never
          shows on the kiosk. A report the quiet re-read found is offered; the page does not move under the reader. */}
      {showBaseline ? null : report.arrived ? (
        <p className="reports-note" role="note">
          <FileText size={16} aria-hidden="true" /> The {formatPeriod(period, report.arrived)} report is ready.{' '}
          <button type="button" className="report-retry-btn" onClick={() => report.arrived && withViewTransition(() => select(report.arrived as string))}>
            Open it
          </button>
        </p>
      ) : selected !== null && months?.[0]?.period_start.slice(0, 10) === selected && report.pending[0] ? (
        <p className="reports-note" role="note">
          Next {PERIOD_ADJECTIVE[period].toLowerCase()} report: {report.pending[0].label}.
        </p>
      ) : null}

      {months?.length === 0 ? (
        <p className="reports-note">
          <FileText size={16} aria-hidden="true" /> No {period} has completed since reporting was switched on. The first report appears
          {period === 'day' ? ' an hour' : ' a couple of days'} after the end of the first full {period}.
        </p>
      ) : null}

      {/* FI-041: the panel the tab strip's aria-controls names. The page renders only the selected tab's body,
          as TabPanel does on Automation, so that body is the panel, labelled by its tab. */}
      <TabPanel ref={panelRef} tabId={tab} activeId={tab}>
        {/* ---- Overview ---------------------------------------------------------------------- */}
        {tab === 'overview' && building ? (
          <ErrorBoundary scope="The headline figures" variant="inline" resetKey={building}>
            <header className="report-heading">
              <h2 className="report-heading__title">
                {formatPeriod(period, building.period_start)} · {PERIOD_ADJECTIVE[period]} {showBaseline ? 'baseline' : 'report'}
              </h2>
              {showBaseline ? (
                <>
                  {/* RM-154: a projection carries no coverage to badge; it says what it is, and the way back. */}
                  <span className="badge badge--accent">Projected</span>
                  <p className="report-heading__meta">
                    What this office would use with nothing managing it, laid on this {period}&apos;s own days.{' '}
                    <button type="button" className="report-retry-btn" onClick={() => withViewTransition(() => setBaselineMode(false))}>
                      Back to recorded
                    </button>
                  </p>
                </>
              ) : (
                <>
                  <CoverageTag coverage={buildingCoverage} period={period} />
                  {generatedLabel(building.generated_at) ? <p className="report-heading__meta">Made {generatedLabel(building.generated_at)}</p> : null}
                  {/* RM-073: a restated share says so beside the badge it changed, never silently. */}
                  {coverageRestatement(building) ? <p className="report-heading__meta">{coverageRestatement(building)?.text}</p> : null}
                </>
              )}
            </header>
            <ReportKpis
              period={period}
              building={conserved ?? building}
              summary={summaryShown}
              notObserved={notObserved}
              cost={priced.cost}
              carbon={priced.carbon}
              pricing={pricing}
              previous={previousConserved}
              energyPending={energyPending}
              uncounted={(conserved?.uncounted ?? []).map(nameOf)}
              projected={showBaseline ? builtFrom : null}
            />
            {/* RM-154: the building counter, as the stated check beside the one figure — the same words the Circuits tab says. */}
            {counterCheck ? (
              <p className="reports-note report-counter-check" role="note">
                {counterCheck}
              </p>
            ) : null}
            {/* What else the period recorded, as one line of small figures rather than a card. */}
            <dl className="report-glance" aria-label={`Also ${showBaseline ? 'in the baseline' : 'recorded'} for ${formatPeriod(period, building.period_start)}`}>
              {showBaseline ? null : (
              <>
              <div>
                <dt>Commands</dt>
                <dd>
                  {building.command_count}{' '}
                  <span className="reports-figure__caveat">
                    ({building.command_count_manual} by hand · {building.command_count_schedule} scheduled · {building.command_count_autoshed} auto-shed)
                  </span>
                </dd>
              </div>
              <div>
                <dt>Unusual events</dt>
                <dd>
                  {building.anomaly_count}
                  {/* RM-160: before the change every switch of a cycling load was counted. */}
                  {unusualEventsCaveat(building.period_start) ? (
                    <>
                      {' '}
                      <span className="reports-figure__caveat">({unusualEventsCaveat(building.period_start)})</span>
                    </>
                  ) : null}
                </dd>
              </div>
              </>
              )}
              <div>
                <dt>Average voltage</dt>
                <dd>
                  <ReportFigure value={building.avg_voltage} unit="V" period={period} />
                </dd>
              </div>
              <div>
                <dt>Current R / Y / B</dt>
                <dd>
                  <ReportFigure value={building.phase_current_red_avg} unit="" digits={2} period={period} />
                  {' / '}
                  <ReportFigure value={building.phase_current_yellow_avg} unit="" digits={2} period={period} />
                  {' / '}
                  {/* Blue is NULL by design — no Blue-phase meter is installed. */}
                  <ReportFigure value={building.phase_current_blue_avg} unit="A" digits={2} period={period} />
                </dd>
              </div>
            </dl>
          </ErrorBoundary>
        ) : null}

        {tab === 'overview' && selected ? (
          <>
            <ReportSectionNote section={dailySeries} what="the daily figures" quietWhileLoading />
            <ReportSectionNote section={summary} what="the demand summary" quietWhileLoading />
            <ReportSectionNote section={devicesSection} what="the per-device figures" quietWhileLoading />
            <ReportSectionNote section={deviceDailySection} what="the daily figures per circuit" quietWhileLoading />
            {period === 'day' ? <ReportSectionNote section={hourEnergy} what="the hour by hour chart" quietWhileLoading /> : null}
            {charts ? (
              <ReportCharts
                period={period}
                start={selected}
                {...charts}
                only={overviewCharts}
                loading={{ useShare: devicesSection.status === 'loading', hourly: hourEnergy.status === 'loading' }}
              />
            ) : chartsLoading ? (
              <ReportSkeleton label={periodLabel} period={period} parts={['charts']} kinds={overviewCharts} />
            ) : withoutDaily ? (
              // RM-151: the daily chart's own note says why it is missing; "Energy by use" needs only the stored rows.
              <ReportCharts
                period={period}
                start={selected}
                {...withoutDaily}
                only={overviewCharts.filter((k) => k === 'useShare')}
                loading={{ useShare: devicesSection.status === 'loading' }}
              />
            ) : null}
            {showBaseline && SITE_BASELINE ? (
              <ErrorBoundary scope="How this baseline was made" variant="inline" resetKey={scopeKey}>
                <BaselineNotes
                  baseline={SITE_BASELINE}
                  scales={Object.fromEntries(Object.entries(projection.days?.types ?? {}).map(([t, x]) => [t, x.scale]))}
                />
              </ErrorBoundary>
            ) : dailySeries.data && summary.status === 'ready' ? (
              <ErrorBoundary scope="How much was recorded" variant="inline" resetKey={dailySeries.data}>
                <CoverageBanner
                  summary={summary.data ?? null}
                  observedDays={dailySeries.data.filter((d) => d.usable_sample_count > 0).length}
                  completeDays={dailySeries.data.filter((d) => d.expected_samples > 0 && d.usable_sample_count / d.expected_samples >= 0.95).length}
                  label={periodLabel}
                  collapsible
                />
              </ErrorBoundary>
            ) : null}
          </>
        ) : null}

        {/* ---- Circuits ------------------------------------------------------------------------ */}
        {tab === 'circuits' && selected ? (
          <>
            <ReportSectionNote section={devicesSection} what="the per-device figures" />
            {devicesSection.status === 'loading' ? <ReportSkeleton label={periodLabel} period={period} parts={['kpis', 'table']} /> : null}
            {rows && rows.length > 0 ? (
              <ErrorBoundary scope="The circuit report" variant="inline" resetKey={rows}>
                <CircuitDeepDive
                  period={period}
                  start={selected}
                  rows={rows}
                  scope={scope}
                  nameOf={nameOf}
                  conserved={conserved}
                  counterCheck={counterCheck}
                  projected={showBaseline}
                  dayNotes={dayNotes}
                  deviceDaily={deviceDailySection}
                  hourEnergy={hourEnergy}
                  trend={trendSection}
                />
              </ErrorBoundary>
            ) : null}
            {rows?.length === 0 ? <p className="reports-note">No per-device rows for {periodLabel}.</p> : null}
          </>
        ) : null}

        {/* ---- Usage patterns ------------------------------------------------------------------- */}
        {tab === 'patterns' && selected ? (
          <>
            <ReportSectionNote section={dailySeries} what="the daily figures" />
            <ReportSectionNote section={summary} what="the demand summary" />
            <ReportSectionNote section={hours} what="the typical day chart" quietWhileLoading />
            <ReportSectionNote section={matrix} what="the busy hours chart" quietWhileLoading />
            <ReportSectionNote section={curve} what="the demand levels chart" quietWhileLoading />
            <ReportSectionNote section={ceiling} what="the max total draw" quietWhileLoading />
            {charts ?? withoutDaily ? (
              <ErrorBoundary scope="The usage patterns" variant="inline" resetKey={charts ?? withoutDaily}>
                <UsagePatterns
                  period={period}
                  start={selected}
                  charts={(charts ?? withoutDaily) as ChartsData}
                  basis={dailySeries.status === 'ready' && summary.status === 'ready' ? 'ready' : dailySeries.status === 'error' || summary.status === 'error' ? 'error' : 'loading'}
                  hoursLoading={hours.status === 'loading'}
                  loading={{ hours: hours.status === 'loading', heat: matrix.status === 'loading', curve: curve.status === 'loading' }}
                />
              </ErrorBoundary>
            ) : chartsLoading ? (
              <ReportSkeleton label={periodLabel} period={period} parts={['kpis', 'charts']} kinds={USAGE_CHARTS} />
            ) : null}
          </>
        ) : null}

        {/* ---- Compare ---------------------------------------------------------------------------- */}
        {tab === 'compare' && months ? (
          <ErrorBoundary scope="The comparison" variant="inline" resetKey={scopeKey}>
            <ComparisonReport
              key={showBaseline ? 'baseline' : 'recorded'}
              period={period}
              periods={months}
              selected={selected}
              reporting={recordedConserved}
              againstBaseline={againstBaseline}
              startOnBaseline={showBaseline}
            />
          </ErrorBoundary>
        ) : null}
      </TabPanel>

      {exportOpen && selected ? (
        <ExportDrawer
          periodLabel={periodLabel}
          period={period}
          onClose={() => setExportOpen(false)}
          onExport={runExport}
          unavailable={exportUnavailable}
          sectionNotes={exportSectionNotes}
          scopeLabel={narrowed}
        />
      ) : null}
    </ChartWidthContext>
  );
}
