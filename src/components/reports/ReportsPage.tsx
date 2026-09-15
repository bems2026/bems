import { useCallback, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { InfoHint } from '@/components/ui/InfoHint';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { useDeviceStore } from '@/stores/deviceStore';
import { supabase } from '@/config/supabase';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';
import { coverageOf, formatPeriod, isQuotable, type Coverage, type ReportPeriod } from '@/lib/supabaseReports';
import { PeriodPicker } from './PeriodPicker';
import { ReportCharts, type ChartsData } from './ReportCharts';
import { buildBreakdown } from '@/lib/circuitBreakdown';
import { Tabs, type TabDef } from '@/components/ui/Tabs';
import { BaselineReport } from './BaselineReport';
import { CircuitDeepDive } from './CircuitDeepDive';
import { ComparisonReport } from './ComparisonReport';
import { CoverageBanner } from './CoverageBanner';
import { ExportPdfButton } from './ExportPdfButton';
import { CostCarbonLine } from './CostCarbonLine';
import { ReportSectionNote } from './ReportSectionNote';
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
 */

/** Tones reuse the shared `.badge--*` modifiers rather than introducing new colour values,
 * per CLAUDE.md: those four are already contrast-checked in both themes, and a fifth pair
 * invented here would be the first thing to fail an audit. */
const COVERAGE_TONE: Record<Coverage['band'], { label: string; tone: string }> = {
  complete: { label: 'Complete', tone: 'good' },
  partial: { label: 'Partial', tone: 'warn' },
  sparse: { label: 'Sparse', tone: 'bad' },
  none: { label: 'No data', tone: 'bad' },
};

/** Period-aware — a weekly report used to describe itself as a month (RM-081). */
function coverageNote(band: Coverage['band'], period: ReportPeriod): string {
  switch (band) {
    case 'complete':
      return `the whole ${period} was observed`;
    case 'partial':
      return `over half the ${period} was observed — this total is understated`;
    case 'sparse':
      return `only a fraction of the ${period} was observed — this total is not the ${period}’s consumption`;
    case 'none':
      return `the ${period} passed with nothing recorded`;
  }
}

function CoverageTag({ coverage, period }: { coverage: Coverage | null; period: ReportPeriod }) {
  // "Unknown" is not "none": one means the month recorded nothing, the other means we cannot
  // even say what full coverage would have been. Neutral badge, no tone.
  if (!coverage) return <span className="badge">Coverage unknown</span>;
  const copy = COVERAGE_TONE[coverage.band];
  return (
    <span className={`badge badge--${copy.tone}`} title={coverageNote(coverage.band, period)}>
      {copy.label} · {Math.round(coverage.ratio * 100)}%
    </span>
  );
}

/** A figure the report cannot stand behind is still shown — hiding it would be its own kind
 * of dishonesty — but never without the qualifier attached to the same line.
 *
 * `notObserved` is the exception, and it is not hiding a figure: it is refusing to print one that
 * was never measured. Live, the week of 2026-08-10 is stored as 0 kWh from 10 of 10,080 samples,
 * none of them a real reading — and "0.00 kWh" says that week used no electricity. */
function Figure({
  value,
  unit,
  digits = 1,
  coverage,
  period,
  notObserved = false,
}: {
  value: number | null;
  unit: string;
  digits?: number;
  coverage?: Coverage | null;
  period: ReportPeriod;
  notObserved?: boolean;
}) {
  if (notObserved) {
    return <span className="reports-figure reports-figure--missing">— not observed</span>;
  }
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="reports-figure reports-figure--missing">—</span>;
  }
  const qualified = coverage !== undefined && !isQuotable(coverage);
  return (
    <span className={`reports-figure${qualified ? ' reports-figure--qualified' : ''}`}>
      {value.toFixed(digits)} {unit}
      {qualified ? <span className="reports-figure__caveat"> (partial {period})</span> : null}
    </span>
  );
}

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

  const building = useMemo(
    () => months?.find((m) => m.period_start.slice(0, 10) === selected) ?? null,
    [months, selected]
  );
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
        actions={
          <>
            {/* In the header beside the export, where every other page in this app puts its
                controls — the shape RM-071 settled on for Automation. */}
            <Tabs tabs={REPORT_TABS} activeId={tab} onChange={setTab} label="Report type" className="reports-tabs" />
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

      <ReportSectionNote section={periods} what="the list of reports" />

      {months?.length === 0 ? (
        <p className="reports-note">
          <FileText size={16} aria-hidden="true" /> No {period} has completed since reporting was switched on. The first
          report appears a couple of days after the end of the first full {period}.
        </p>
      ) : null}

      {/* Week or month — RM-041. Two buttons rather than a select: there are exactly two, and a
          select would hide one of them behind a click. */}
      <div className="reports-periods" role="group" aria-label="Report period">
        {(['month', 'week'] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`analytics-scope-btn${period === p ? ' analytics-scope-btn--active' : ''}`}
            aria-pressed={period === p}
            onClick={() => setPeriod(p)}
          >
            {p === 'month' ? 'Monthly' : 'Weekly'}
          </button>
        ))}
      </div>

      {months && months.length > 0 ? (
        <PeriodPicker
          period={period}
          starts={months.map((m) => m.period_start.slice(0, 10))}
          selected={selected}
          onSelect={select}
        />
      ) : null}

      {tab === 'summary' && selected ? (
        <>
          <ReportSectionNote section={core} what="the daily figures" />
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
        <ErrorBoundary scope="The building summary" variant="inline" resetKey={building}>
          <section className="devices-table-card reports-summary" aria-label={`Building summary for ${formatPeriod(period, building.period_start)}`}>
            <h2 className="card-title">
              {formatPeriod(period, building.period_start)} · building <CoverageTag coverage={buildingCoverage} period={period} />
            </h2>
            <dl className="reports-summary__grid">
              <div>
                <dt>Energy</dt>
                <dd>
                  <Figure value={building.energy_kwh} unit="kWh" digits={2} coverage={buildingCoverage} period={period} notObserved={notObserved} />
                </dd>
              </div>
              <div>
                <dt>Peak demand</dt>
                <dd>
                  <Figure value={building.peak_total_power_w} unit="W" digits={0} coverage={buildingCoverage} period={period} notObserved={notObserved} />
                </dd>
              </div>
              <div>
                <dt>Average voltage</dt>
                <dd>
                  <Figure value={building.avg_voltage} unit="V" period={period} />
                </dd>
              </div>
              <div>
                <dt>Phase current R / Y / B</dt>
                <dd>
                  <Figure value={building.phase_current_red_avg} unit="" digits={2} period={period} />
                  {' / '}
                  <Figure value={building.phase_current_yellow_avg} unit="" digits={2} period={period} />
                  {' / '}
                  {/* Blue is NULL by design — no Blue-phase meter is installed. */}
                  <Figure value={building.phase_current_blue_avg} unit="A" digits={2} period={period} />
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
              {/* Last in the list, deliberately: the cost is derived from the energy above it, and
                  putting a currency figure first would make it the headline of a report whose
                  headline is a measurement. */}
              <CostCarbonLine cost={priced.cost} carbon={priced.carbon} coverage={buildingCoverage} pricing={pricing} />
            </dl>
          </section>
        </ErrorBoundary>
      ) : null}

      {tab === 'summary' && selected ? (
        <>
          <ReportSectionNote section={detail} what="the hourly charts" />
          <ReportSectionNote section={ceiling} what="the demand ceiling" quietWhileLoading />
          {charts ? <ReportCharts period={period} start={selected} {...charts} /> : null}
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

      {tab === 'summary' && selected ? <ReportSectionNote section={report.devices} what="the per-device figures" /> : null}

      {tab === 'summary' && rows && rows.length > 0 ? (
        <ErrorBoundary scope="The per-device table" variant="inline" resetKey={rows}>
          <div className="devices-table-card devices-table-scroll">
            <table className="devices-table reports-table" aria-label={`Per-device report for ${periodLabel}`}>
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  <th scope="col">Energy</th>
                  <th scope="col">Peak</th>
                  <th scope="col">Average</th>
                  <th scope="col">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = coverageOf(r.online_sample_count, r.expected_sample_count);
                  return (
                    <tr key={r.device_id}>
                      <th scope="row">{nameOf(r.device_id)}</th>
                      <td>
                        <Figure value={r.energy_kwh} unit="kWh" digits={2} coverage={c} period={period} />
                      </td>
                      <td>
                        <Figure value={r.peak_power_w} unit="W" digits={0} coverage={c} period={period} />
                      </td>
                      <td>
                        <Figure value={r.avg_power_w} unit="W" digits={0} coverage={c} period={period} />
                      </td>
                      <td>
                        <CoverageTag coverage={c} period={period} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ErrorBoundary>
      ) : null}

      {tab === 'summary' && rows?.length === 0 && selected ? (
        <p className="reports-note">No per-device rows for {periodLabel}.</p>
      ) : null}
    </>
  );
}
