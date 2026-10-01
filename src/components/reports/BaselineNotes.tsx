import { BASELINE_LEDE, BASELINE_TITLE } from '@shared/reportProse.mjs';
import { baselineAssumptionItems, dayTypeCounts, loadSeries, windowText, type ProjectedBaseline, type RecordedDay } from '@/lib/baselineCompare';
import { ReportCaveats } from './ReportCaveats';
import { ReportTable, type ReportColumn } from './ReportTable';

/**
 * How a baseline period was made — RM-154. Where a recorded report says how much of it was recorded, a
 * projected one says what it was built from: the rule, the days, what it assumes, and every recorded day of
 * August and September with what the baseline did with it (the backup the operator asked for in RM-153).
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function BaselineNotes({ baseline: b, scales }: { baseline: ProjectedBaseline; scales: Readonly<Record<string, number>> }) {
  const used = b.recorded.days.filter((d) => d.used_as !== null).length;
  const columns: ReportColumn<RecordedDay>[] = [
    { id: 'day', header: 'Day', cell: (d) => d.date },
    { id: 'weekday', header: 'Weekday', cell: (d) => WEEKDAYS[d.weekday] },
    ...loadSeries(b).map(
      (s): ReportColumn<RecordedDay> => ({ id: s.id, header: s.label, unit: 'kWh', numeric: true, cell: (d) => (d.hours_recorded > 0 ? (d.kwh[s.id] ?? 0).toFixed(2) : '—') })
    ),
    { id: 'total', header: 'Total', unit: 'kWh', numeric: true, cell: (d) => (d.hours_recorded > 0 ? d.kwh.total.toFixed(2) : '—') },
    { id: 'hours', header: 'Hours recorded', numeric: true, cell: (d) => d.hours_recorded },
    { id: 'use', header: 'In the baseline', cell: (d) => (d.used_as ? `Used: ${b.day_types[d.used_as]?.label ?? d.used_as}` : `Left out: ${d.reason ?? '—'}`) },
  ];
  const scaleWords = Object.entries(scales)
    .filter(([, k]) => Math.abs(k - 1) >= 0.005)
    .map(([t, k]) => `${b.day_types[t]?.label.toLowerCase() ?? t}s × ${k.toFixed(2)}`);

  return (
    <section className="devices-table-card reports-summary report-baseline-notes" aria-label="How this baseline was made">
      <h2 className="card-title">How this baseline was made</h2>
      <p className="reports-note">{BASELINE_LEDE}</p>
      <p className="reports-note">
        Each date is one recorded day of its kind, from {windowText(b)} ({dayTypeCounts(b)}), the same day however the date is
        read. Each kind is scaled once so its days average the baseline's
        {scaleWords.length > 0 ? ` (${scaleWords.join(', ')})` : ''}, so the days keep their real spread and the month keeps its
        total.
        {b.peak_operating_draw.w !== null
          ? ` Peak operating draw ${(b.peak_operating_draw.w / 1000).toFixed(2)} kW: ${Math.round(b.peak_operating_draw.quantile * 10)} in 10 of ${b.peak_operating_draw.days} working days stayed below it.`
          : ''}
      </p>
      <ReportCaveats title={BASELINE_TITLE} items={baselineAssumptionItems(b)} />
      <details className="report-table-card">
        <summary className="report-recorded__summary">
          The recorded days behind it — {used} of {b.recorded.days.length} used
        </summary>
        <ReportTable label="The recorded days behind the baseline" columns={columns} rows={b.recorded.days} rowKey={(d) => d.date} />
      </details>
    </section>
  );
}
