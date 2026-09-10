import { useMemo } from 'react';
import { BUILDING_METER_IDS } from '@shared/registry.mjs';
import { coverageOf, isQuotable, type PeriodDeviceReport, type ReportPeriod, formatPeriod } from '@/lib/supabaseReports';
import { buildBreakdown } from '@/lib/circuitBreakdown';

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

const f = (v: number | null, digits = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v.toFixed(digits);

function Cell({ value, unit, coverage }: { value: string | null; unit: string; coverage?: ReturnType<typeof coverageOf> }) {
  if (value === null) return <span className="reports-figure reports-figure--missing">—</span>;
  const qualified = coverage !== undefined && !isQuotable(coverage);
  return (
    <span className={`reports-figure${qualified ? ' reports-figure--qualified' : ''}`}>
      {value} {unit}
      {qualified ? <span className="reports-figure__caveat"> (partial)</span> : null}
    </span>
  );
}

export function CircuitDeepDive({ period, start, rows, nameOf }: Props) {
  const meterIds = BUILDING_METER_IDS as readonly string[];
  const { untracked } = useMemo(() => buildBreakdown(rows, nameOf), [rows, nameOf]);

  const branches = rows.filter((r) => meterIds.includes(r.device_id));
  const devices = rows.filter((r) => !meterIds.includes(r.device_id));
  const total = branches.reduce((a, r) => a + (r.energy_kwh ?? 0), 0);
  const label = formatPeriod(period, start);

  const table = (caption: string, list: readonly PeriodDeviceReport[], withShare: boolean) => (
    <div className="devices-table-card devices-table-scroll">
      <table className="devices-table reports-table" aria-label={`${caption} for ${label}`}>
        <caption className="card-title">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Device</th>
            <th scope="col">Energy</th>
            {withShare ? <th scope="col">Share</th> : null}
            <th scope="col">Peak</th>
            <th scope="col">Average</th>
            <th scope="col">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const c = coverageOf(r.online_sample_count, r.expected_sample_count);
            return (
              <tr key={r.device_id}>
                <th scope="row">{nameOf(r.device_id)}</th>
                <td>
                  <Cell value={f(r.energy_kwh)} unit="kWh" coverage={c} />
                </td>
                {withShare ? (
                  <td>
                    {r.energy_kwh === null || total <= 0 ? (
                      <span className="reports-figure reports-figure--missing">—</span>
                    ) : (
                      `${((r.energy_kwh / total) * 100).toFixed(1)}%`
                    )}
                  </td>
                ) : null}
                <td>
                  <Cell value={f(r.peak_power_w, 0)} unit="W" coverage={c} />
                </td>
                <td>
                  <Cell value={f(r.avg_power_w, 0)} unit="W" coverage={c} />
                </td>
                <td>
                  {c ? (
                    <span className={`badge badge--${c.band === 'complete' ? 'good' : c.band === 'partial' ? 'warn' : 'bad'}`}>
                      {Math.round(c.ratio * 100)}%
                    </span>
                  ) : (
                    <span className="badge">unknown</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
