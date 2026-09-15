import { useCallback, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { InfoHint } from '@/components/ui/InfoHint';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useDeviceStore } from '@/stores/deviceStore';
import { supabase } from '@/config/supabase';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';
import { coverageOf, formatPeriod, isQuotable, type PeriodDeviceReport, type ReportPeriod } from '@/lib/supabaseReports';
import { siteDateTime } from '@/lib/siteTime';
import { ReportControlBar } from './ReportControlBar';
import { ReportSkeleton } from './ReportSkeleton';
import { ReportCharts, type ChartsData } from './ReportCharts';
import { buildBreakdown } from '@/lib/circuitBreakdown';
import type { TabDef } from '@/components/ui/Tabs';
import { BaselineReport } from './BaselineReport';
import { CircuitDeepDive } from './CircuitDeepDive';
import { ComparisonReport } from './ComparisonReport';
import { CoverageBanner } from './CoverageBanner';
import { ExportPdfButton } from './ExportPdfButton';
import { ReportSectionNote } from './ReportSectionNote';
import { ReportKpis } from './ReportKpis';
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

const DEVICE_CSV_COLUMNS: readonly CsvColumn<Record<string, unknown>>[] = [
  // `period` used to be computed in `exportCsv` and then dropped on the floor, because it was
  // absent from this list — so a weekly export's rows were headed "Month" and held a Monday.
  // The filename disambiguated them; the file's own contents did not.
  { key: 'period', header: 'Period' },
  { key: 'month', header: 'Period start' },
  { key: 'device_id', header: 'Device ID' },
  { key: 'device_name', header: 'Device' },
  { key: 'energy_kwh', header: 'Energy (kWh)' },
  { key: 'peak_power_w', header: 'Peak power (W)' },
  { key: 'avg_power_w', header: 'Average power (W)' },
  { key: 'coverage_pct', header: 'Coverage (%)' },
  { key: 'online_sample_count', header: 'Samples observed' },
  { key: 'expected_sample_count', header: 'Samples expected' },
];

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
  const report = useReportData(period);
  const { periods, selected, select, core, detail, pricing, ceiling } = report;
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

  /** The five charts need both the daily series and the hourly detail. The ceiling is optional:
   *  a failed read draws the curve without it and says so, rather than holding the chart back. */
  const charts: ChartsData | null = useMemo(
    () =>
      core.data && detail.data
        ? {
            daily: core.data.daily,
            hours: detail.data.hours,
            matrix: detail.data.matrix,
            curve: detail.data.curve,
            segments,
            untracked,
            ceilingW: ceiling.data ?? null,
            summary: core.data.summary,
          }
        : null,
    [core.data, detail.data, segments, untracked, ceiling.data]
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

  const pdfBlocked =
    pricing.status === 'error'
      ? 'The rates could not be loaded, so the document could not state what the period cost. Retry them first.'
      : pricing.status === 'loading'
        ? 'Still loading the rates.'
        : null;

  const exportCsv = () => {
    if (!rows || !selected) return;
    const flat = rows.map((r) => {
      const c = coverageOf(r.online_sample_count, r.expected_sample_count);
      return {
        period,
        month: selected,
        device_id: r.device_id,
        device_name: nameOf(r.device_id),
        energy_kwh: r.energy_kwh,
        peak_power_w: r.peak_power_w,
        avg_power_w: r.avg_power_w,
        // Rendered as a number the spreadsheet can sort and filter on, not "Partial · 13%".
        coverage_pct: c ? Math.round(c.ratio * 100) : null,
        online_sample_count: r.online_sample_count,
        expected_sample_count: r.expected_sample_count,
      };
    });
    // The whole date for a week, because seven of them share a `YYYY-MM` and would overwrite
    // each other in a downloads folder.
    downloadCsv(`ibems-${period}-report-${period === 'week' ? selected : selected.slice(0, 7)}.csv`, toCsv(flat, DEVICE_CSV_COLUMNS));
  };

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
  const chartsLoading =
    charts === null && (core.status === 'loading' || detail.status === 'loading') && core.status !== 'error' && detail.status !== 'error';
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
          <>
            <ExportPdfButton
              period={period}
              periodLabel={periodLabel}
              building={building}
              rows={rows}
              charts={charts}
              cost={priced.cost}
              carbon={priced.carbon}
              nameOf={nameOf}
              blockedReason={pdfBlocked}
            />
            <button type="button" className="devices-add-btn" onClick={exportCsv} disabled={!rows || rows.length === 0}>
              <Download size={16} aria-hidden="true" /> Export CSV
            </button>
          </>
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
          <ReportSectionNote section={detail} what="the hourly charts" quietWhileLoading />
          <ReportSectionNote section={ceiling} what="the demand ceiling" quietWhileLoading />
          {charts ? (
            <ReportCharts period={period} start={selected} {...charts} />
          ) : chartsLoading ? (
            <ReportSkeleton label={periodLabel} period={period} parts={['charts']} />
          ) : null}
        </>
      ) : null}

      {tab === 'baseline' && selected ? (
        <>
          <ReportSectionNote section={core} what="the daily figures" />
          <ReportSectionNote section={detail} what="the hourly charts" />
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
    </>
  );
}
