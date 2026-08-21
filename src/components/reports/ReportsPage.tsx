import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { InfoHint } from '@/components/ui/InfoHint';
import { useDeviceStore } from '@/stores/deviceStore';
import { supabase } from '@/config/supabase';
import { toCsv, downloadCsv, type CsvColumn } from '@/lib/csv';
import {
  coverageOf,
  formatMonth,
  getDeviceReports,
  getReportMonths,
  isQuotable,
  type Coverage,
  type MonthlyBuildingReport,
  type MonthlyDeviceReport,
} from '@/lib/supabaseReports';

/**
 * Monthly energy reports — Phase 12.
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
  { key: 'month', header: 'Month' },
  { key: 'device_id', header: 'Device ID' },
  { key: 'device_name', header: 'Device' },
  { key: 'energy_kwh', header: 'Energy (kWh)' },
  { key: 'peak_power_w', header: 'Peak power (W)' },
  { key: 'avg_power_w', header: 'Average power (W)' },
  { key: 'coverage_pct', header: 'Coverage (%)' },
  { key: 'online_sample_count', header: 'Samples observed' },
  { key: 'expected_sample_count', header: 'Samples expected' },
];

export function ReportsPage() {
  const devices = useDeviceStore((s) => s.devices);
  const [months, setMonths] = useState<MonthlyBuildingReport[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * Tagged with the month it was fetched for, and derived rather than stored — the same fix
   * commit c5d4e18 made for `deviceStore.history`, for the same reason. A plain `rows` state
   * cleared inside the effect would both need a setState in the effect body (a cascading
   * render, which `react-hooks/set-state-in-effect` rightly rejects) and, until it was
   * cleared, render July's per-device figures under August's heading. A result for another
   * month simply is not a result for this one.
   */
  const [fetched, setFetched] = useState<{ month: string; rows: MonthlyDeviceReport[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nameOf = useCallback(
    (id: string) => devices.find((d) => d.id === id)?.display_name ?? id,
    [devices]
  );

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    getReportMonths()
      .then((list) => {
        if (cancelled) return;
        setMonths(list);
        setSelected((current) => current ?? list[0]?.month?.slice(0, 10) ?? null);
      })
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!supabase || !selected) return;
    let cancelled = false;
    getDeviceReports(selected)
      .then((list) => !cancelled && setFetched({ month: selected, rows: list }))
      .catch((err) => !cancelled && setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const rows = fetched && fetched.month === selected ? fetched.rows : null;

  const building = useMemo(
    () => months?.find((m) => m.month.slice(0, 10) === selected) ?? null,
    [months, selected]
  );
  const buildingCoverage = building ? coverageOf(building.online_sample_count, building.expected_sample_count) : null;

  const exportCsv = () => {
    if (!rows || !selected) return;
    const flat = rows.map((r) => {
      const c = coverageOf(r.online_sample_count, r.expected_sample_count);
      return {
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
    downloadCsv(`ibems-report-${selected.slice(0, 7)}.csv`, toCsv(flat, DEVICE_CSV_COLUMNS));
  };

  if (!supabase) {
    return (
      <>
        <PageHeader title="Reports" sub="Monthly energy reports" />
        <p className="reports-note">
          Reports are stored in Supabase, which is not configured in this build. Nothing to show — rather than an
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
            Monthly energy, demand and activity per device{' '}
            <InfoHint>
              Generated server-side once a month has ended and settled, from the same hourly archive the long-range
              charts read. Every figure carries the share of the month actually observed — a partial month produces a
              real number that is not the month&rsquo;s consumption.
            </InfoHint>
          </>
        }
        actions={
          <button type="button" className="devices-add-btn" onClick={exportCsv} disabled={!rows || rows.length === 0}>
            <Download size={16} aria-hidden="true" /> Export CSV
          </button>
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

      {months && months.length > 0 ? (
        <div className="reports-months" role="group" aria-label="Report month">
          {months.map((m) => {
            const key = m.month.slice(0, 10);
            return (
              <button
                key={key}
                type="button"
                className={`analytics-scope-btn${selected === key ? ' analytics-scope-btn--active' : ''}`}
                aria-pressed={selected === key}
                onClick={() => setSelected(key)}
              >
                {formatMonth(key)}
              </button>
            );
          })}
        </div>
      ) : null}

      {building ? (
        <section className="devices-table-card reports-summary" aria-label={`Building summary for ${formatMonth(building.month)}`}>
          <h2 className="card-title">
            {formatMonth(building.month)} · building <CoverageTag coverage={buildingCoverage} />
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

      {rows && rows.length > 0 ? (
        <div className="devices-table-card devices-table-scroll">
          <table className="devices-table reports-table" aria-label={`Per-device report for ${selected ? formatMonth(selected) : ''}`}>
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

      {rows?.length === 0 && selected ? (
        <p className="reports-note">No per-device rows for {formatMonth(selected)}.</p>
      ) : null}
    </>
  );
}
