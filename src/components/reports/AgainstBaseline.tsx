import { BASELINE_OWN_WINDOW } from '@shared/reportProse.mjs';
import { describeAgainstBaseline, shortDate, type BaselineComparison } from '@/lib/baselineCompare';
import type { ReportPeriod } from '@/lib/supabaseReports';
import { ReportTable, type ReportColumn } from './ReportTable';

/**
 * A recorded period against its baseline — RM-153, moved to the Compare tab by RM-154.
 *
 * The expectation is the baseline laid on the period's own dates (holidays as closed days), so a month is set
 * against the month the Baseline view shows, day for day. Refused under 95% recorded: set against an
 * expectation, every missing hour would read as energy avoided.
 */

const kwh = (v: number | null | undefined, digits: number) => (v === null || v === undefined || !Number.isFinite(v) ? null : `${v.toFixed(digits)} kWh`);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Tile({ term, value, sub, hero = false }: { term: string; value: string | null; sub?: string; hero?: boolean }) {
  return (
    <div className={hero ? 'report-kpi--hero' : undefined}>
      <dt>{term}</dt>
      <dd className={hero ? 'report-kpi__hero-value' : undefined}>
        {value === null ? <span className="reports-figure reports-figure--missing">—</span> : <span className="reports-figure">{value}</span>}
        {sub ? <span className="reports-figure__caveat report-kpi__sub">{sub}</span> : null}
      </dd>
    </div>
  );
}

const difference = (recorded: number | null, expected: number) =>
  recorded === null ? '—' : `${Math.abs(recorded - expected).toFixed(2)} ${recorded <= expected ? 'less' : 'more'}`;

export function AgainstBaseline({ c, period, label }: { c: BaselineComparison; period: ReportPeriod; label: string }) {
  if (!c.comparable) {
    return (
      <section className="devices-table-card reports-summary report-baseline__against" aria-label={`Against the baseline, ${label}`}>
        <h2 className="card-title">{label} against its baseline</h2>
        <p className="reports-note" role="note">
          <span className="badge badge--warn">Not compared</span> {c.reason}
        </p>
      </section>
    );
  }
  const byUse: ReportColumn<(typeof c.byLoad)[number]>[] = [
    { id: 'use', header: 'Use', cell: (r) => r.label },
    { id: 'expected', header: 'Baseline', unit: 'kWh', numeric: true, cell: (r) => r.expectedKwh.toFixed(1) },
    { id: 'recorded', header: 'Recorded', unit: 'kWh', numeric: true, cell: (r) => (r.recordedKwh === null ? '—' : r.recordedKwh.toFixed(1)) },
    { id: 'difference', header: 'Difference', unit: 'kWh', numeric: true, cell: (r) => difference(r.recordedKwh, r.expectedKwh) },
  ];
  type Day = NonNullable<typeof c.days>[number];
  const byDay: ReportColumn<Day>[] = [
    { id: 'day', header: 'Day', cell: (d) => `${WEEKDAYS[new Date(`${d.date}T00:00:00Z`).getUTCDay()]} ${shortDate(d.date)}` },
    { id: 'expected', header: 'Baseline', unit: 'kWh', numeric: true, cell: (d) => d.expectedKwh.toFixed(2) },
    { id: 'recorded', header: 'Recorded', unit: 'kWh', numeric: true, cell: (d) => (d.recordedKwh === null ? '—' : d.recordedKwh.toFixed(2)) },
    { id: 'difference', header: 'Difference', unit: 'kWh', numeric: true, cell: (d) => difference(d.recordedKwh, d.expectedKwh) },
  ];
  return (
    <section className="devices-table-card reports-summary report-baseline__against" aria-label={`Against the baseline, ${label}`}>
      <h2 className="card-title">{label} against its baseline</h2>
      <dl className="report-kpis">
        <Tile hero term="Energy avoided" value={c.avoidedKwh > 0 ? kwh(c.avoidedKwh, 1) : 'None'} sub={describeAgainstBaseline(c, period)} />
        <Tile
          term="Baseline"
          value={kwh(c.expectedKwh, 1)}
          sub={c.holidays.length > 0 ? `${c.holidays.length} holiday${c.holidays.length === 1 ? '' : 's'} counted as closed` : 'On this period’s own days'}
        />
        <Tile term="Recorded" value={kwh(c.recordedKwh, 1)} sub="The sum of the circuits; at least 95% of the period recorded" />
      </dl>
      {c.holidays.length > 0 ? (
        <p className="reports-note">Counted as closed days: {c.holidays.map((h) => `${shortDate(h.date)}, ${h.name}`).join('; ')}.</p>
      ) : null}
      {c.ownWindowDays > 0 ? (
        <p className="reports-note" role="note">
          {BASELINE_OWN_WINDOW}
        </p>
      ) : null}
      <ReportTable label={`By use, against the baseline, ${label}`} columns={byUse} rows={c.byLoad} rowKey={(r) => r.load} />
      {c.days && c.days.length > 1 ? (
        <details className="report-table-card">
          <summary className="report-recorded__summary">Day by day</summary>
          <ReportTable label={`Day by day, against the baseline, ${label}`} columns={byDay} rows={c.days} rowKey={(d) => d.date} />
        </details>
      ) : null}
    </section>
  );
}
