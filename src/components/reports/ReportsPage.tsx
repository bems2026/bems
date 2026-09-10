import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { InfoHint } from '@/components/ui/InfoHint';
import { useDeviceStore } from '@/stores/deviceStore';
import { supabase } from '@/config/supabase';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';
import {
  coverageOf,
  formatPeriod,
  getDevicePeriodReports,
  getReportPeriods,
  isQuotable,
  type Coverage,
  type PeriodBuildingReport,
  type ReportPeriod,
  type PeriodDeviceReport,
} from '@/lib/supabaseReports';
import {
  getDailySeries,
  getDemandCurve,
  getHourMatrix,
  getHourProfile,
  type CurveRow,
  type DailyRow,
  type HourRow,
  type MatrixRow,
} from '@/lib/reportSeries';
import { fetchScheduleContext } from '@/lib/supabaseConfig';
import { PeriodPicker } from './PeriodPicker';
import { ReportCharts } from './ReportCharts';
import { buildBreakdown } from '@/lib/circuitBreakdown';
import { Tabs, type TabDef } from '@/components/ui/Tabs';
import { BaselineReport } from './BaselineReport';
import { CircuitDeepDive } from './CircuitDeepDive';
import { ComparisonReport } from './ComparisonReport';
import { CoverageBanner } from './CoverageBanner';
import { getDemandSummary, type DemandSummary } from '@/lib/reportSeries';

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
 */

/** Tones reuse the shared `.badge--*` modifiers rather than introducing new colour values,
 * per CLAUDE.md: those four are already contrast-checked in both themes, and a fifth pair
 * invented here would be the first thing to fail an audit. */
const COVERAGE_COPY: Record<Coverage['band'], { label: string; tone: string; note: string }> = {
  complete: { label: 'Complete', tone: 'good', note: 'the whole month was observed' },
  partial: { label: 'Partial', tone: 'warn', note: 'over half the month was observed — this total is understated' },
  sparse: { label: 'Sparse', tone: 'bad', note: 'only a fraction of the month was observed — this total is not the month’s consumption' },
  none: { label: 'No data', tone: 'bad', note: 'the month passed with nothing recorded' },
};

function CoverageTag({ coverage }: { coverage: Coverage | null }) {
  // "Unknown" is not "none": one means the month recorded nothing, the other means we cannot
  // even say what full coverage would have been. Neutral badge, no tone.
  if (!coverage) return <span className="badge">Coverage unknown</span>;
  const copy = COVERAGE_COPY[coverage.band];
  return (
    <span className={`badge badge--${copy.tone}`} title={copy.note}>
      {copy.label} · {Math.round(coverage.ratio * 100)}%
    </span>
  );
}

/** A figure the report cannot stand behind is still shown — hiding it would be its own kind
 * of dishonesty — but never without the qualifier attached to the same line. */
function Figure({ value, unit, digits = 1, coverage }: { value: number | null; unit: string; digits?: number; coverage?: Coverage | null }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="reports-figure reports-figure--missing">—</span>;
  }
  const qualified = coverage !== undefined && !isQuotable(coverage);
  return (
    <span className={`reports-figure${qualified ? ' reports-figure--qualified' : ''}`}>
      {value.toFixed(digits)} {unit}
      {qualified ? <span className="reports-figure__caveat"> (partial month)</span> : null}
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
   * Changing it clears the selection rather than trying to map one period onto the other. The
   * week containing 1 July is not "July", and a mapping that picked one would be inventing a
   * correspondence that does not exist.
   */
  const [period, setPeriod] = useState<ReportPeriod>('month');
  /** Tagged with the period it was fetched for, and derived — the same shape as `fetched`
   * below and for the same reason. Clearing it inside the effect was a synchronous setState in
   * a commit, which cascades a render; and until it cleared, the list of MONTHS would render
   * under a heading that said weeks. */
  const [loaded, setLoaded] = useState<{ period: ReportPeriod; list: PeriodBuildingReport[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const months = loaded && loaded.period === period ? loaded.list : null;
  /**
   * Tagged with the month it was fetched for, and derived rather than stored — the same fix
   * commit c5d4e18 made for `deviceStore.history`, for the same reason. A plain `rows` state
   * cleared inside the effect would both need a setState in the effect body (a cascading
   * render, which `react-hooks/set-state-in-effect` rightly rejects) and, until it was
   * cleared, render July's per-device figures under August's heading. A result for another
   * month simply is not a result for this one.
   */
  const [fetched, setFetched] = useState<{ period: ReportPeriod; month: string; rows: PeriodDeviceReport[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * phase37's series, behind the charts. Tagged with the period and start they were fetched for,
   * exactly like `fetched` above and for the same reason: a result for another month is not a
   * result for this one, and rendering it under this month's heading would be worse than
   * rendering nothing.
   */
  const [series, setSeries] = useState<
    | {
        period: ReportPeriod;
        start: string;
        daily: DailyRow[];
        hours: HourRow[];
        matrix: MatrixRow[];
        curve: CurveRow[];
        ceilingW: number | null;
        summary: DemandSummary | null;
      }
    | null
  >(null);

  const nameOf = useCallback(
    (id: string) => devices.find((d) => d.id === id)?.display_name ?? id,
    [devices]
  );

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    getReportPeriods(period)
      .then((list) => {
        if (cancelled) return;
        setLoaded({ period, list });
        // Always the newest of the period just switched to — NOT `current ?? …`, which would
        // keep a month's date selected after switching to weeks and then match no week at all.
        setSelected(list[0]?.period_start?.slice(0, 10) ?? null);
      })
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [period]);

  useEffect(() => {
    if (!supabase || !selected) return;
    let cancelled = false;
    getDevicePeriodReports(period, selected)
      .then((list) => !cancelled && setFetched({ period, month: selected, rows: list }))
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [period, selected]);

  useEffect(() => {
    if (!supabase || !selected) return;
    let cancelled = false;
    Promise.all([
      getDailySeries(period, selected),
      getHourProfile(period, selected),
      getHourMatrix(period, selected),
      getDemandCurve(period, selected),
      getDemandSummary(period, selected),
      // The DSM ceiling the duration curve is drawn against. Read from the same row the
      // Automation page writes, so the chart cannot disagree with the page that sets it.
      fetchScheduleContext().then((ctx) => {
        const kw = Number(ctx['global.dsm.max_total_kw']);
        return Number.isFinite(kw) && kw > 0 ? kw * 1000 : null;
      }),
    ])
      .then(([daily, hours, matrix, curve, summary, ceilingW]) => {
        if (!cancelled) setSeries({ period, start: selected, daily, hours, matrix, curve, summary, ceilingW });
      })
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [period, selected]);

  // Tagged with the PERIOD as well as the start, so week 2026-06-01's rows are never rendered
  // under month 2026-06-01's heading — the two are different reports that share a first day.
  const rows = fetched && fetched.month === selected && fetched.period === period ? fetched.rows : null;
  const live = series && series.period === period && series.start === selected ? series : null;

  /**
   * The breakdown, derived from the circuit tree rather than from device names. Which meters
   * make the whole is `BUILDING_METER_IDS` — the same derived constant `shared/buildLatest.mjs`
   * sums to produce the building total — so the chart and the figure printed above it cannot
   * disagree. See `src/lib/circuitBreakdown.ts` for why none of it is written here.
   */
  const { segments, untracked } = useMemo(() => buildBreakdown(rows ?? [], nameOf), [rows, nameOf]);

  const building = useMemo(
    () => months?.find((m) => m.period_start.slice(0, 10) === selected) ?? null,
    [months, selected]
  );
  const buildingCoverage = building ? coverageOf(building.online_sample_count, building.expected_sample_count) : null;

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
            <button type="button" className="devices-add-btn" onClick={exportCsv} disabled={!rows || rows.length === 0}>
              <Download size={16} aria-hidden="true" /> Export CSV
            </button>
          </>
        }
      />

      {error ? <p className="reports-note reports-note--error">{error}</p> : null}

      {months === null && !error ? <p className="reports-note">Loading reports…</p> : null}

      {months?.length === 0 ? (
        <p className="reports-note">
          <FileText size={16} aria-hidden="true" /> No month has completed since reporting was switched on. The first
          report appears a couple of days after the end of the first full month.
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
          onSelect={setSelected}
        />
      ) : null}

      {tab === 'summary' && live && selected ? (
        <CoverageBanner
          summary={live.summary}
          observedDays={live.daily.filter((d) => d.usable_sample_count > 0).length}
          completeDays={live.daily.filter((d) => d.expected_samples > 0 && d.usable_sample_count / d.expected_samples >= 0.95).length}
          label={formatPeriod(period, selected)}
        />
      ) : null}

      {tab === 'summary' && building ? (
        <section className="devices-table-card reports-summary" aria-label={`Building summary for ${formatPeriod(period, building.period_start)}`}>
          <h2 className="card-title">
            {formatPeriod(period, building.period_start)} · building <CoverageTag coverage={buildingCoverage} />
          </h2>
          <dl className="reports-summary__grid">
            <div>
              <dt>Energy</dt>
              <dd><Figure value={building.energy_kwh} unit="kWh" digits={2} coverage={buildingCoverage} /></dd>
            </div>
            <div>
              <dt>Peak demand</dt>
              <dd><Figure value={building.peak_total_power_w} unit="W" digits={0} coverage={buildingCoverage} /></dd>
            </div>
            <div>
              <dt>Average voltage</dt>
              <dd><Figure value={building.avg_voltage} unit="V" /></dd>
            </div>
            <div>
              <dt>Phase current R / Y / B</dt>
              <dd>
                <Figure value={building.phase_current_red_avg} unit="" digits={2} />
                {' / '}
                <Figure value={building.phase_current_yellow_avg} unit="" digits={2} />
                {' / '}
                {/* Blue is NULL by design — no Blue-phase meter is installed. */}
                <Figure value={building.phase_current_blue_avg} unit="A" digits={2} />
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
      ) : null}

      {tab === 'summary' && live && selected ? (
        <ReportCharts
          period={period}
          start={selected}
          daily={live.daily}
          hours={live.hours}
          matrix={live.matrix}
          curve={live.curve}
          segments={segments}
          untracked={untracked}
          ceilingW={live.ceilingW}
        />
      ) : null}

      {tab === 'baseline' && live && selected ? (
        <BaselineReport
          period={period}
          start={selected}
          summary={live.summary}
          charts={{
            daily: live.daily,
            hours: live.hours,
            matrix: live.matrix,
            curve: live.curve,
            segments,
            untracked,
            ceilingW: live.ceilingW,
          }}
        />
      ) : null}

      {tab === 'circuits' && rows && selected ? (
        <CircuitDeepDive period={period} start={selected} rows={rows} nameOf={nameOf} />
      ) : null}

      {tab === 'compare' && months ? (
        <ComparisonReport period={period} periods={months} selected={selected} />
      ) : null}

      {tab === 'summary' && rows && rows.length > 0 ? (
        <div className="devices-table-card devices-table-scroll">
          <table className="devices-table reports-table" aria-label={`Per-device report for ${selected ? formatPeriod(period, selected) : ''}`}>
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
                    <td><Figure value={r.energy_kwh} unit="kWh" digits={2} coverage={c} /></td>
                    <td><Figure value={r.peak_power_w} unit="W" digits={0} coverage={c} /></td>
                    <td><Figure value={r.avg_power_w} unit="W" digits={0} coverage={c} /></td>
                    <td><CoverageTag coverage={c} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'summary' && rows?.length === 0 && selected ? (
        <p className="reports-note">No per-device rows for {formatPeriod(period, selected)}.</p>
      ) : null}
    </>
  );
}
