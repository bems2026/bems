import { useCallback, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { InfoHint } from '@/components/ui/InfoHint';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useDeviceStore } from '@/stores/deviceStore';
import { supabase } from '@/config/supabase';
import { downloadCsv, downloadCsvParts } from '@/lib/csv';
import { dailyCsv, deviceCsv, deviceDailyCsv } from '@/lib/reportCsv';
import { fetchReadingsForExport, readingsCsvParts, type ReadingsClient } from '@/lib/readingsExport';
import { getReportWindow } from '@/lib/circuitSeries';
import { LOAD_LABELS } from '@shared/circuits.mjs';
import { reportFilename } from '@/lib/reportFiles';
import type { ReportDetail, ReportSectionId } from '@/lib/reportSections';
import { buildPdfReport } from '@/lib/reportPdf/buildReport';
import { bootedScript } from '@/lib/buildVersion';
import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { SITE } from '@shared/siteConfig.mjs';
import { coverageOf, coverageRestatement, formatPeriod, isQuotable, type ReportPeriod } from '@/lib/supabaseReports';
import { siteDateTime } from '@/lib/siteTime';
import { ReportControlBar } from './ReportControlBar';
import { Tabs } from '@/components/ui/Tabs';
import { ReportSkeleton } from './ReportSkeleton';
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
import { CircuitDeepDive } from './CircuitDeepDive';
import { ComparisonReport } from './ComparisonReport';
import { CoverageBanner } from './CoverageBanner';
import { ExportDrawer, type ExportFormat } from './ExportDrawer';
import { ReportSectionNote } from './ReportSectionNote';
import { ReportKpis } from './ReportKpis';
import { CoverageTag, ReportFigure } from './ReportFigure';
import { useReportData } from './useReportData';
import { carbonOf, costOf, type DayEnergy } from '@/lib/energyCost';
import { circuitDayPoints, circuitRefs, loadShareSegments, trendChartInput } from '@/lib/circuitCharts';

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
 * changed. The words are the office's (RM-097): no p50 or p95, no "baseline", no "DSM ceiling".
 *
 * THE HEADLINE COMES FIRST AND LARGEST — RM-082. The period is named with its coverage badge, then
 * the key figures, then the coverage in detail, then what else the period recorded, then the
 * charts and the device table. Coverage still travels with every figure it qualifies: each
 * headline carries its own "(partial …)" on the same line, and the badge sits in the heading
 * directly above them.
 */

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
  const [exportOpen, setExportOpen] = useState(false);
  // RM-094: the circuit series load only while something shows them — the Circuits tab, or an export.
  const report = useReportData(period, undefined, { circuits: tab === 'circuits' || exportOpen });
  const { periods, selected, select, core, hours, matrix, curve, pricing, ceiling } = report;
  const months = periods.data;
  const rows = report.devices.data;

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
   *  (RM-081b). The ceiling is optional: a failed read draws the curve without its line. */
  const charts: ChartsData | null = useMemo(
    () =>
      core.data
        ? {
            daily: core.data.daily,
            hours: hours.data,
            matrix: matrix.data,
            curve: curve.data,
            segments,
            useSegments,
            untracked,
            ceilingW: ceiling.data ?? null,
            summary: core.data.summary,
          }
        : null,
    [core.data, hours.data, matrix.data, curve.data, segments, useSegments, untracked, ceiling.data]
  );

  /**
   * Cost and carbon, from the SAME per-day series the charts are drawn from — so the figure in
   * the summary and the bars above it cannot describe different days.
   */
  const priced = useMemo(() => {
    const days: DayEnergy[] = (core.data?.daily ?? []).map((d) => ({
      day: d.local_day.slice(0, 10),
      // A day whose rows carried no reading has no energy to price. Passing its 0 through would
      // price it at zero, which says the building spent nothing rather than that nobody watched.
      kwh: d.usable_sample_count > 0 ? d.energy_kwh : null,
    }));
    return { cost: costOf(days, pricing.data?.tariffs ?? []), carbon: carbonOf(days, pricing.data?.factors ?? []) };
  }, [core.data, pricing.data]);

  const selectedIndex = months && selected ? months.findIndex((m) => m.period_start.slice(0, 10) === selected) : -1;
  const building = months && selectedIndex >= 0 ? months[selectedIndex] : null;
  /** The list is newest first, so the period before this one is the next entry — named by its own
   *  label wherever it is shown, because a missing week in between makes it not the calendar's. */
  const previous = months && selectedIndex >= 0 ? (months[selectedIndex + 1] ?? null) : null;
  const buildingCoverage = building ? coverageOf(building.online_sample_count, building.expected_sample_count) : null;

  /**
   * Whether the period's headline figures were ever measured. Once the summary has arrived this
   * is exact — not one minute of the period carried a real reading. Before it arrives, a stored
   * zero from a period that was not fully observed is held back rather than printed: it is either
   * "not observed" or a floor of nothing, and neither reads correctly as "0.00 kWh".
   */
  const notObserved = core.data
    ? core.data.summary?.usable_minutes === 0
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
  const failedPart = core.status === 'error' || report.devices.status === 'error';
  const chartsStillLoading = hours.status === 'loading' || matrix.status === 'loading' || curve.status === 'loading';
  const exportUnavailable: Partial<Record<ExportFormat, string>> = {};
  if (!charts || !rows) {
    exportUnavailable.pdf = failedPart ? 'Part of this report could not be loaded. Retry it on the page first.' : 'The report is still loading.';
  } else if (chartsStillLoading) {
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
  if (matrix.status === 'error') exportSectionNotes.heatmap = leftOut;
  if (curve.status === 'error') exportSectionNotes.durationCurve = leftOut;
  if (!core.data) {
    exportUnavailable['daily-csv'] =
      core.status === 'error' ? 'The daily figures could not be loaded. Retry them on the page first.' : 'The daily figures are still loading.';
  } else if (pricingReason) {
    exportUnavailable['daily-csv'] = pricingReason;
  }
  if (!rows) {
    exportUnavailable['device-csv'] =
      report.devices.status === 'error'
        ? 'The per-device figures could not be loaded. Retry them on the page first.'
        : 'The per-device figures are still loading.';
  } else if (rows.length === 0) {
    exportUnavailable['device-csv'] = 'No per-device rows were stored for this period.';
  } else if (narrowed && scopedRows?.length === 0) {
    exportUnavailable['device-csv'] = `No device on ${narrowed} reported for this period. Choose All circuits to export every device.`;
  }
  // RM-098: the per-day file is phase42's bounded daily energy, so it waits for that and says so.
  const daily = report.deviceDaily;
  if (daily.status === 'error') {
    exportUnavailable['device-daily-csv'] = 'The daily figures per circuit could not be loaded. Retry them on the Circuits tab first.';
  } else if (daily.status !== 'ready' || !daily.data) {
    exportUnavailable['device-daily-csv'] = 'The daily figures per circuit are still loading.';
  } else if (!daily.data.available) {
    exportUnavailable['device-daily-csv'] = 'Needs the database update (phase42) — until it is applied, per-device days are not available.';
  }

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
  const chartsLoading = charts === null && core.status === 'loading';
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
      const data = report.deviceDaily.data;
      if (!data || !data.available) throw new Error('The daily figures per circuit are not available.');
      const dayRows = scopeRows(data.rows, scope);
      if (dayRows.length === 0) throw new Error(narrowed ? `No device on ${narrowed} has daily figures for this period.` : 'No device has daily figures for this period.');
      const name = reportFilename(period, selected, 'devices-daily', 'csv', narrowed);
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
      const readings = await fetchReadingsForExport(supabase as unknown as ReadingsClient, ids, { startIso: win.win_start, endIso: win.win_end }, {
        signal,
        onProgress: (p) => progress(`${p.fetched.toLocaleString(undefined)} readings so far · ${nameOf(p.deviceId)}`),
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
      return `Saved ${name} · ${count.toLocaleString(undefined)} rows from ${ids.length} devices`;
    }

    if (format === 'device-csv') {
      if (!rows || !scopedRows || scopedRows.length === 0) throw new Error('No per-device rows were stored for this period.');
      // RM-082c: the narrowed rows, with the whole period's beside them so each share is still of the building.
      const name = reportFilename(period, selected, 'devices', 'csv', narrowed);
      downloadCsv(
        name,
        deviceCsv({ period, start: selected, rows: scopedRows, buildingRows: rows, nameOf, branchOf, meterIds: BUILDING_METER_IDS as readonly string[] })
      );
      return `Saved ${name} · ${scopedRows.length} devices${narrowed ? ` on ${narrowed}` : ''}`;
    }

    if (format === 'daily-csv') {
      if (!core.data) throw new Error('The daily figures have not loaded.');
      const name = reportFilename(period, selected, 'daily', 'csv');
      downloadCsv(name, dailyCsv({ daily: core.data.daily, tariffs: pricing.data?.tariffs ?? [], factors: pricing.data?.factors ?? [] }));
      return `Saved ${name} · ${core.data.daily.length} days`;
    }

    if (!charts || !rows) throw new Error('The report has not finished loading.');
    const started = performance.now();
    // RM-099: the circuit charts for the part of the building chosen, when their series are here. One that
    // is not is named in the document as left out, never drawn empty.
    const refs = circuitRefs(scope);
    const dailyData = report.deviceDaily.data;
    const circuitInput = {
      series: refs,
      days: dailyData && dailyData.available ? circuitDayPoints(dailyData.rows, refs) : null,
      trend: report.trend.data ? trendChartInput(report.trend.data, refs, SITE.utc_offset_minutes) : null,
    };
    const pdf = buildPdfReport({
      period,
      periodLabel,
      siteName: SITE.display_name,
      timezone: SITE.timezone,
      generatedAt: siteDateTime(Date.now()),
      buildId: bootedScript(),
      building,
      previous,
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
    });
    const assembled = performance.now();
    const name = reportFilename(period, selected, 'report', 'pdf', [narrowed, detail === 'simple' ? 'simple' : null].filter(Boolean).join(' '));
    // pdfmake is still loaded only here, on the first export — never on a page load.
    const { downloadReportPdf } = await import('@/lib/reportPdf/download');
    await downloadReportPdf(pdf, name);
    // Measured, not assumed: generation on the kiosk's Pi has never been timed (RM-072a), and RM-083c
    // moves it to a worker only if this says it is slow there.
    console.info(`[ibems] pdf: assembled in ${Math.round(assembled - started)} ms, rendered in ${Math.round(performance.now() - assembled)} ms`);
    return `Saved ${name} · ${detail === 'simple' ? 'Simple' : 'Detailed'}, ${pdf.sections?.length ?? 0} sections`;
  };

  return (
    <>
      <PageHeader
        title="Reports"
        sub={
          <>
            {period === 'week' ? 'Weekly' : 'Monthly'} energy, where it went, and when{' '}
            <InfoHint>
              Made from stored readings a couple of days after each {period} ends. Every figure says how much of the {period} was
              recorded — a partly recorded {period} gives a real number that is lower than what was used.
            </InfoHint>
          </>
        }
      />

      {/* RM-082b: every control in one sticky bar — what kind of period, which one, which part of the
          building, which reading of it, and what to take away. */}
      <ReportControlBar
        period={period}
        onPeriodChange={setPeriod}
        starts={months ? months.map((m) => m.period_start.slice(0, 10)) : []}
        selected={selected}
        onSelect={select}
        scopes={SCOPES}
        scope={encodeScope(scope)}
        onScopeChange={(value) => setScope(decodeScope(value))}
        actions={
          <button type="button" className="report-primary-btn" onClick={() => setExportOpen(true)} disabled={!selected} aria-haspopup="dialog">
            <Download size={16} aria-hidden="true" /> Export
          </button>
        }
      />

      {/* RM-101: the tabs decide the reading of the report, not the report — a strip of their own, so
          the bar above stays one line on the kiosk. */}
      <Tabs tabs={REPORT_TABS} activeId={tab} onChange={setTab} label="Report type" className="report-tabs-strip" />

      {narrowed && tab !== 'circuits' && tab !== 'compare' ? (
        // RM-096: the Overview and Usage patterns are the whole building's series; the chosen part of it
        // lives on Circuits. Said in one line with the way there, instead of a paragraph.
        <p className="reports-note report-scope-note" role="note">
          This tab shows the whole building. <strong>{narrowed}</strong> is on the Circuits tab.{' '}
          <button type="button" className="report-retry-btn" onClick={() => setTab('circuits')}>
            Open Circuits
          </button>
        </p>
      ) : null}

      {periods.status === 'loading' ? (
        <ReportSkeleton label={period === 'week' ? 'weekly' : 'monthly'} period={period} parts={['kpis', 'charts']} />
      ) : null}
      <ReportSectionNote section={periods} what="the list of reports" quietWhileLoading />

      {months?.length === 0 ? (
        <p className="reports-note">
          <FileText size={16} aria-hidden="true" /> No {period} has completed since reporting was switched on. The first report appears
          a couple of days after the end of the first full {period}.
        </p>
      ) : null}

      {/* ---- Overview ---------------------------------------------------------------------- */}
      {tab === 'overview' && building ? (
        <ErrorBoundary scope="The headline figures" variant="inline" resetKey={building}>
          <header className="report-heading">
            <h2 className="report-heading__title">
              {formatPeriod(period, building.period_start)} · {period === 'week' ? 'Weekly' : 'Monthly'} report
            </h2>
            <CoverageTag coverage={buildingCoverage} period={period} />
            {generatedLabel(building.generated_at) ? <p className="report-heading__meta">Made {generatedLabel(building.generated_at)}</p> : null}
            {/* RM-073: a restated share says so beside the badge it changed, never silently. */}
            {coverageRestatement(building) ? <p className="report-heading__meta">{coverageRestatement(building)?.text}</p> : null}
          </header>
          <ReportKpis
            period={period}
            building={building}
            summary={core.status === 'ready' ? (core.data?.summary ?? null) : core.status === 'error' ? null : undefined}
            notObserved={notObserved}
            cost={priced.cost}
            carbon={priced.carbon}
            pricing={pricing}
            previous={previous}
          />
          {/* What else the period recorded, as one line of small figures rather than a card. */}
          <dl className="report-glance" aria-label={`Also recorded for ${formatPeriod(period, building.period_start)}`}>
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
              <dt>Unusual readings</dt>
              <dd>{building.anomaly_count}</dd>
            </div>
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
          <ReportSectionNote section={core} what="the daily figures" quietWhileLoading />
          <ReportSectionNote section={report.devices} what="the per-device figures" quietWhileLoading />
          {charts ? (
            <ReportCharts
              period={period}
              start={selected}
              {...charts}
              only={['daily', 'useShare']}
              loading={{ useShare: report.devices.status === 'loading' }}
            />
          ) : chartsLoading ? (
            <ReportSkeleton label={periodLabel} period={period} parts={['charts']} />
          ) : null}
          {core.data ? (
            <ErrorBoundary scope="How much was recorded" variant="inline" resetKey={core.data}>
              <CoverageBanner
                summary={core.data.summary}
                observedDays={core.data.daily.filter((d) => d.usable_sample_count > 0).length}
                completeDays={core.data.daily.filter((d) => d.expected_samples > 0 && d.usable_sample_count / d.expected_samples >= 0.95).length}
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
          <ReportSectionNote section={report.devices} what="the per-device figures" />
          {report.devices.status === 'loading' ? <ReportSkeleton label={periodLabel} period={period} parts={['kpis', 'table']} /> : null}
          {rows && rows.length > 0 ? (
            <ErrorBoundary scope="The circuit report" variant="inline" resetKey={rows}>
              <CircuitDeepDive
                period={period}
                start={selected}
                rows={rows}
                scope={scope}
                nameOf={nameOf}
                building={building}
                deviceDaily={report.deviceDaily}
                trend={report.trend}
              />
            </ErrorBoundary>
          ) : null}
          {rows?.length === 0 ? <p className="reports-note">No per-device rows for {periodLabel}.</p> : null}
        </>
      ) : null}

      {/* ---- Usage patterns ------------------------------------------------------------------- */}
      {tab === 'patterns' && selected ? (
        <>
          <ReportSectionNote section={core} what="the daily figures" />
          <ReportSectionNote section={hours} what="the typical day chart" quietWhileLoading />
          <ReportSectionNote section={matrix} what="the busy hours chart" quietWhileLoading />
          <ReportSectionNote section={curve} what="the demand levels chart" quietWhileLoading />
          <ReportSectionNote section={ceiling} what="the max total draw" quietWhileLoading />
          {charts ? (
            <ErrorBoundary scope="The usage patterns" variant="inline" resetKey={charts}>
              <UsagePatterns
                period={period}
                start={selected}
                charts={charts}
                hoursLoading={hours.status === 'loading'}
                loading={{ hours: hours.status === 'loading', heat: matrix.status === 'loading', curve: curve.status === 'loading' }}
              />
            </ErrorBoundary>
          ) : chartsLoading ? (
            <ReportSkeleton label={periodLabel} period={period} parts={['kpis', 'charts']} />
          ) : null}
        </>
      ) : null}

      {/* ---- Compare ---------------------------------------------------------------------------- */}
      {tab === 'compare' && months ? (
        <ErrorBoundary scope="The comparison" variant="inline" resetKey={scopeKey}>
          <ComparisonReport period={period} periods={months} selected={selected} />
        </ErrorBoundary>
      ) : null}

      {exportOpen && selected ? (
        <ExportDrawer
          periodLabel={periodLabel}
          onClose={() => setExportOpen(false)}
          onExport={runExport}
          unavailable={exportUnavailable}
          sectionNotes={exportSectionNotes}
          scopeLabel={narrowed}
        />
      ) : null}
    </>
  );
}
