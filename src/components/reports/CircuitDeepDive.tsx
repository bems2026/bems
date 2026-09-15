import { useMemo } from 'react';
import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { coverageOf, type PeriodDeviceReport, type ReportPeriod, formatPeriod } from '@/lib/supabaseReports';
import { buildBreakdown } from '@/lib/circuitBreakdown';
import { ReportTable, type ReportColumn } from './ReportTable';
import { ReportFigure } from './ReportFigure';

/**
 * Where the energy went, circuit by circuit and device by device.
 *
 * The period summary answers "how much"; this answers "where", which is the question that
 * precedes any decision about it. The building total is the sum of the branch meters (RM-057),
 * so a branch's share is exact — and the row that matters most is usually the gap between what a
 * branch measured and what the sub-meters beneath it accounted for.
 *
 * WHY THE BRANCHES ARE SEPARATED FROM EVERYTHING ELSE. A flat table of twenty devices puts a
 * branch meter and one of the outlets inside that branch on adjacent rows, reading as peers.
 * They are not: adding them together double-counts. The tree is the honest arrangement, and
 * `BUILDING_METER_IDS` — the same constant the ingest path sums — decides which rows are which.
 */

interface Props {
  period: ReportPeriod;
  start: string;
  rows: readonly PeriodDeviceReport[];
  nameOf: (id: string) => string;
}

const toneOf = (band: string) => (band === 'complete' ? 'good' : band === 'partial' ? 'warn' : 'bad');

export function CircuitDeepDive({ period, start, rows, nameOf }: Props) {
  const meterIds = BUILDING_METER_IDS as readonly string[];
  const { untracked } = useMemo(() => buildBreakdown(rows, nameOf), [rows, nameOf]);

  const branches = rows.filter((r) => meterIds.includes(r.device_id));
  const devices = rows.filter((r) => !meterIds.includes(r.device_id));
  const total = branches.reduce((a, r) => a + (r.energy_kwh ?? 0), 0);
  const label = formatPeriod(period, start);

  // RM-082: the shared report table — units in the header, figures right-aligned.
  const coverage = (r: PeriodDeviceReport) => coverageOf(r.online_sample_count, r.expected_sample_count);
  const columns = (withShare: boolean): ReportColumn<PeriodDeviceReport>[] => [
    { id: 'device', header: 'Device', cell: (r) => nameOf(r.device_id) },
    {
      id: 'energy',
      header: 'Energy',
      unit: 'kWh',
      numeric: true,
      cell: (r) => <ReportFigure value={r.energy_kwh} unit="" digits={2} coverage={coverage(r)} period={period} />,
    },
    ...(withShare
      ? [
          {
            id: 'share',
            header: 'Share',
            numeric: true,
            cell: (r: PeriodDeviceReport) => (r.energy_kwh === null || total <= 0 ? null : `${((r.energy_kwh / total) * 100).toFixed(1)}%`),
          },
        ]
      : []),
    {
      id: 'peak',
      header: 'Peak',
      unit: 'W',
      numeric: true,
      cell: (r) => <ReportFigure value={r.peak_power_w} unit="" digits={0} coverage={coverage(r)} period={period} />,
    },
    {
      id: 'average',
      header: 'Average',
      unit: 'W',
      numeric: true,
      cell: (r) => <ReportFigure value={r.avg_power_w} unit="" digits={0} coverage={coverage(r)} period={period} />,
    },
    {
      id: 'coverage',
      header: 'Coverage',
      cell: (r) => {
        const c = coverage(r);
        return c ? <span className={`badge badge--${toneOf(c.band)}`}>{Math.round(c.ratio * 100)}%</span> : <span className="badge">unknown</span>;
      },
    },
  ];

  const table = (caption: string, list: readonly PeriodDeviceReport[], withShare: boolean) => (
    <div className="report-table-card">
      <ReportTable
        columns={columns(withShare)}
        rows={list}
        rowKey={(r) => r.device_id}
        label={`${caption} for ${label}`}
        caption={caption}
      />
    </div>
  );

  return (
    <>
      <section className="devices-table-card reports-summary" aria-label={`Circuit summary for ${label}`}>
        <h2 className="card-title">The building, by circuit</h2>
        <p className="reports-note">
          The building total is the sum of these branch meters, so their shares are exact rather than reconciled.
          The devices below sit <em>inside</em> these branches — adding the two tables together would count the
          same energy twice.
        </p>
        {untracked && untracked.kwh !== null && untracked.kwh > 0 ? (
          <p className="reports-note reports-note--error" role="note">
            <strong>{untracked.kwh.toFixed(2)} kWh on {untracked.label} is not attributable to any sub-meter beneath it.</strong>{' '}
            The branch measured it and none of the metered devices on that branch reported it — which is a
            statement about the devices, not about the branch.
          </p>
        ) : null}
      </section>

      {branches.length > 0 ? table('Branch circuits', branches, true) : null}
      {devices.length > 0 ? table('Devices within those branches', devices, false) : null}
    </>
  );
}
