import { useCallback, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { InfoHint } from '@/components/ui/InfoHint';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useDeviceStore } from '@/stores/deviceStore';
import { supabase } from '@/config/supabase';
import { downloadCsv } from '@/lib/csv';
import { dailyCsv, deviceCsv } from '@/lib/reportCsv';
import { reportFilename } from '@/lib/reportFiles';
import type { ReportSectionId } from '@/lib/reportSections';
import { buildPdfReport } from '@/lib/reportPdf/buildReport';
import { bootedScript } from '@/lib/buildVersion';
import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { SITE } from '@shared/siteConfig.mjs';
import { coverageOf, formatPeriod, isQuotable, type PeriodDeviceReport, type ReportPeriod } from '@/lib/supabaseReports';
import { siteDateTime } from '@/lib/siteTime';
import { ReportControlBar } from './ReportControlBar';
import { ReportSkeleton } from './ReportSkeleton';
import { ReportCharts, type ChartsData } from './ReportCharts';
import { branchOf, buildBreakdown } from '@/lib/circuitBreakdown';
import type { TabDef } from '@/components/ui/Tabs';
import { BaselineReport } from './BaselineReport';
import { CircuitDeepDive } from './CircuitDeepDive';
import { ComparisonReport } from './ComparisonReport';
import { CoverageBanner } from './CoverageBanner';
import { ExportDrawer, type ExportFormat } from './ExportDrawer';
import { ReportSectionNote } from './ReportSectionNote';
import { ReportKpis } from './ReportKpis';
import { ReportFindings } from './ReportFindings';
import { ReportTable, type ReportColumn } from './ReportTable';
import { CoverageTag, ReportFigure } from './ReportFigure';
import { useReportData } from './useReportData';
import { carbonOf, costOf, type DayEnergy } from '@/lib/energyCost';

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
 * THE HEADLINE COMES FIRST AND LARGEST — RM-082. The period is named with its coverage badge, then
 * the key figures, then the coverage in detail, then what else the period recorded, then the
 * charts and the device table. Coverage still travels with every figure it qualifies: each
 * headline carries its own "(partial …)" on the same line, and the badge sits in the heading
 * directly above them.
 */

/**
 * Four readings of the same period, not four pages.
 *
 * The summary answers how much, the baseline answers whether the window is even a benchmark, the
 * circuits answer where it went, and the comparison answers what changed — and every one of them
 * is about the period the picker above them selects. Tabs rather than routes for that reason: the
 * period is the page's subject, and a tab that reset it would be a different page pretending.
 *
 * NO PANEL FETCHES ON MOUNT, which is `Tabs`' own stated requirement — selection follows focus,
 * so arrowing across the strip would otherwise fire four loads. Everything is fetched once at
 * this level, keyed on the period, and handed down.
 */
const REPORT_TABS: TabDef[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'baseline', label: 'Baseline' },
  { id: 'circuits', label: 'Circuits' },
  { id: 'compare', label: 'Compare' },
];

/** When the stored report was generated, in the building's own time; nothing when unreadable. */
function generatedLabel(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? siteDateTime(t) : null;
}

export function ReportsPage() {
  const [tab, setTab] = useState('summary');
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
  const report = useReportData(period);
  const { periods, selected, select, core, hours, matrix, curve, pricing, ceiling } = report;
  const months = periods.data;
  const rows = report.devices.data;

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
            untracked,
            ceilingW: ceiling.data ?? null,
            summary: core.data.summary,
          }
        : null,
    [core.data, hours.data, matrix.data, curve.data, segments, untracked, ceiling.data]
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
  const runExport = async (format: ExportFormat, sections: ReportSectionId[]): Promise<string> => {
    if (!selected) throw new Error('No report period is selected.');

    if (format === 'device-csv') {
      if (!rows || rows.length === 0) throw new Error('No per-device rows were stored for this period.');
      const name = reportFilename(period, selected, 'devices', 'csv');
      downloadCsv(name, deviceCsv({ period, start: selected, rows, nameOf, branchOf, meterIds: BUILDING_METER_IDS as readonly string[] }));
      return `Saved ${name} · ${rows.length} devices`;
    }

    if (format === 'daily-csv') {
      if (!core.data) throw new Error('The daily figures have not loaded.');
      const name = reportFilename(period, selected, 'daily', 'csv');
      downloadCsv(name, dailyCsv({ daily: core.data.daily, tariffs: pricing.data?.tariffs ?? [], factors: pricing.data?.factors ?? [] }));
      return `Saved ${name} · ${core.data.daily.length} days`;
    }

    if (!charts || !rows) throw new Error('The report has not finished loading.');
    const started = performance.now();
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
      charts,
      cost: priced.cost,
      carbon: priced.carbon,
      nameOf,
      meterIds: BUILDING_METER_IDS as readonly string[],
      sections,
    });
    const assembled = performance.now();
    const name = reportFilename(period, selected, 'report', 'pdf');
    // pdfmake is still loaded only here, on the first export — never on a page load.
    const { downloadReportPdf } = await import('@/lib/reportPdf/download');
    await downloadReportPdf(pdf, name);
    // Measured, not assumed: generation on the kiosk's Pi has never been timed (RM-072a), and RM-083c
    // moves it to a worker only if this says it is slow there.
    console.info(`[ibems] pdf: assembled in ${Math.round(assembled - started)} ms, rendered in ${Math.round(performance.now() - assembled)} ms`);
    return `Saved ${name} · ${pdf.sections?.length ?? 0} sections`;
  };

  const rowCoverage = (r: PeriodDeviceReport) => coverageOf(r.online_sample_count, r.expected_sample_count);
  const deviceColumns: ReportColumn<PeriodDeviceReport>[] = [
    { id: 'device', header: 'Device', cell: (r) => nameOf(r.device_id) },
    {
      id: 'energy',
      header: 'Energy',
      unit: 'kWh',
      numeric: true,
      cell: (r) => <ReportFigure value={r.energy_kwh} unit="" digits={2} coverage={rowCoverage(r)} period={period} />,
    },
    {
      id: 'peak',
      header: 'Peak',
      unit: 'W',
      numeric: true,
      cell: (r) => <ReportFigure value={r.peak_power_w} unit="" digits={0} coverage={rowCoverage(r)} period={period} />,
    },
    {
      id: 'average',
      header: 'Average',
      unit: 'W',
      numeric: true,
      cell: (r) => <ReportFigure value={r.avg_power_w} unit="" digits={0} coverage={rowCoverage(r)} period={period} />,
    },
    { id: 'coverage', header: 'Coverage', cell: (r) => <CoverageTag coverage={rowCoverage(r)} period={period} /> },
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        sub={
          <>
            {period === 'week' ? 'Weekly' : 'Monthly'} energy, demand and activity per device{' '}
            <InfoHint>
              Generated server-side once a month has ended and settled, from the same hourly archive the long-range
              charts read. Every figure carries the share of the month actually observed — a partial month produces a
              real number that is not the month&rsquo;s consumption.
            </InfoHint>
          </>
        }
      />

      {/* RM-082b: every control in one sticky bar — what kind of period, which one, which reading
          of it, and what to take away — instead of the header and two rows below it. */}
      <ReportControlBar
        period={period}
        onPeriodChange={setPeriod}
        starts={months ? months.map((m) => m.period_start.slice(0, 10)) : []}
        selected={selected}
        onSelect={select}
        tabs={REPORT_TABS}
        tab={tab}
        onTabChange={setTab}
        actions={
          // RM-083b: one Export, opening the drawer that asks what to take away, instead of a PDF
          // button and a CSV button that could each only ever export everything.
          <button type="button" className="devices-add-btn" onClick={() => setExportOpen(true)} disabled={!selected} aria-haspopup="dialog">
            <Download size={16} aria-hidden="true" /> Export
          </button>
        }
      />

      {periods.status === 'loading' ? (
        <ReportSkeleton label={period === 'week' ? 'weekly' : 'monthly'} period={period} parts={['kpis', 'charts', 'table']} />
      ) : null}
      <ReportSectionNote section={periods} what="the list of reports" quietWhileLoading />

      {months?.length === 0 ? (
        <p className="reports-note">
          <FileText size={16} aria-hidden="true" /> No {period} has completed since reporting was switched on. The first
          report appears a couple of days after the end of the first full {period}.
        </p>
      ) : null}

      {tab === 'summary' && building ? (
        <ErrorBoundary scope="The headline figures" variant="inline" resetKey={building}>
          <header className="report-heading">
            <h2 className="report-heading__title">
              {formatPeriod(period, building.period_start)} · {period === 'week' ? 'Weekly' : 'Monthly'} report
            </h2>
            <CoverageTag coverage={buildingCoverage} period={period} />
            {generatedLabel(building.generated_at) ? (
              <p className="report-heading__meta">Generated {generatedLabel(building.generated_at)}</p>
            ) : null}
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
        </ErrorBoundary>
      ) : null}

      {tab === 'summary' && selected ? (
        <>
          <ReportSectionNote section={core} what="the daily figures" quietWhileLoading />
          {core.data ? (
            <ErrorBoundary scope="The coverage summary" variant="inline" resetKey={core.data}>
              <CoverageBanner
                summary={core.data.summary}
                observedDays={core.data.daily.filter((d) => d.usable_sample_count > 0).length}
                completeDays={
                  core.data.daily.filter((d) => d.expected_samples > 0 && d.usable_sample_count / d.expected_samples >= 0.95).length
                }
                label={periodLabel}
              />
            </ErrorBoundary>
          ) : null}
          {/* RM-084: after the coverage that qualifies them, before the records and charts. */}
          {core.data ? (
            <ErrorBoundary scope="The findings" variant="inline" resetKey={core.data}>
              <ReportFindings
                label={periodLabel}
                daily={core.data.daily}
                hours={hours.data}
                hoursLoading={hours.status === 'loading'}
                summary={core.data.summary}
              />
            </ErrorBoundary>
          ) : null}
        </>
      ) : null}

      {tab === 'summary' && building ? (
        <ErrorBoundary scope="The period’s other records" variant="inline" resetKey={building}>
          <section className="devices-table-card reports-summary" aria-label={`Also recorded for ${formatPeriod(period, building.period_start)}`}>
            <h2 className="card-title">Also recorded</h2>
            <dl className="reports-summary__grid">
              <div>
                <dt>Average voltage</dt>
                <dd>
                  <ReportFigure value={building.avg_voltage} unit="V" period={period} />
                </dd>
              </div>
              <div>
                <dt>Phase current R / Y / B</dt>
                <dd>
                  <ReportFigure value={building.phase_current_red_avg} unit="" digits={2} period={period} />
                  {' / '}
                  <ReportFigure value={building.phase_current_yellow_avg} unit="" digits={2} period={period} />
                  {' / '}
                  {/* Blue is NULL by design — no Blue-phase meter is installed. */}
                  <ReportFigure value={building.phase_current_blue_avg} unit="A" digits={2} period={period} />
                </dd>
              </div>
              <div>
                <dt>Commands</dt>
                <dd>
                  {building.command_count} total · {building.command_count_manual} manual ·{' '}
                  {building.command_count_schedule} scheduled · {building.command_count_autoshed} auto-shed
                </dd>
              </div>
              <div>
                <dt>Anomalies</dt>
                <dd>{building.anomaly_count}</dd>
              </div>
            </dl>
          </section>
        </ErrorBoundary>
      ) : null}

      {tab === 'summary' && selected ? (
        <>
          <ReportSectionNote section={hours} what="the hour-of-day profile" quietWhileLoading />
          <ReportSectionNote section={matrix} what="the day-by-hour heatmap" quietWhileLoading />
          <ReportSectionNote section={curve} what="the load duration curve" quietWhileLoading />
          <ReportSectionNote section={ceiling} what="the demand ceiling" quietWhileLoading />
          {charts ? (
            <ReportCharts
              period={period}
              start={selected}
              {...charts}
              loading={{
                hours: hours.status === 'loading',
                heat: matrix.status === 'loading',
                curve: curve.status === 'loading',
                breakdown: report.devices.status === 'loading',
              }}
            />
          ) : chartsLoading ? (
            <ReportSkeleton label={periodLabel} period={period} parts={['charts']} />
          ) : null}
        </>
      ) : null}

      {tab === 'baseline' && selected ? (
        <>
          <ReportSectionNote section={core} what="the daily figures" />
          <ReportSectionNote section={hours} what="the hour-of-day profile" quietWhileLoading />
          <ReportSectionNote section={matrix} what="the day-by-hour heatmap" quietWhileLoading />
          <ReportSectionNote section={curve} what="the load duration curve" quietWhileLoading />
          {charts ? (
            <ErrorBoundary scope="The baseline report" variant="inline" resetKey={charts}>
              <BaselineReport period={period} start={selected} summary={charts.summary ?? null} charts={charts} />
            </ErrorBoundary>
          ) : null}
        </>
      ) : null}

      {tab === 'circuits' && selected ? (
        <>
          <ReportSectionNote section={report.devices} what="the per-device figures" />
          {rows ? (
            <ErrorBoundary scope="The circuit report" variant="inline" resetKey={rows}>
              <CircuitDeepDive period={period} start={selected} rows={rows} nameOf={nameOf} />
            </ErrorBoundary>
          ) : null}
        </>
      ) : null}

      {tab === 'compare' && months ? (
        <ErrorBoundary scope="The comparison" variant="inline" resetKey={scopeKey}>
          <ComparisonReport period={period} periods={months} selected={selected} />
        </ErrorBoundary>
      ) : null}

      {tab === 'summary' && selected ? (
        <>
          <ReportSectionNote section={report.devices} what="the per-device figures" quietWhileLoading />
          {report.devices.status === 'loading' ? (
            // Silent when the charts' skeleton is already saying what is loading.
            <ReportSkeleton label={periodLabel} period={period} parts={['table']} announce={!chartsLoading} />
          ) : null}
        </>
      ) : null}

      {tab === 'summary' && rows && rows.length > 0 ? (
        <ErrorBoundary scope="The per-device table" variant="inline" resetKey={rows}>
          <div className="report-table-card">
            <ReportTable columns={deviceColumns} rows={rows} rowKey={(r) => r.device_id} label={`Per-device report for ${periodLabel}`} />
          </div>
        </ErrorBoundary>
      ) : null}

      {tab === 'summary' && rows?.length === 0 && selected ? (
        <p className="reports-note">No per-device rows for {periodLabel}.</p>
      ) : null}

      {exportOpen && selected ? (
        <ExportDrawer
          periodLabel={periodLabel}
          onClose={() => setExportOpen(false)}
          onExport={runExport}
          unavailable={exportUnavailable}
          sectionNotes={exportSectionNotes}
        />
      ) : null}
    </>
  );
}
