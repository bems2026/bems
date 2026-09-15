import { useMemo } from 'react';
import { qualityTag, staleNote, tooltipTime, type SyncStatus } from '@/lib/dataQuality';
import { useNowTick } from '@/lib/useNowTick';
import { seriesKey, type ChartRow, type SlotMeta, type TooltipSeries } from './analyticsMath';
import { formatParamValue, type ChartParam } from './chartParams';

/**
 * The tooltip every Analytics chart uses — RM-076, kept minimal at the operator's request
 * (2026-09-15): the time, each device's value, and a short tag only where a point is not a plain
 * reading ("Estimated", "Frozen", "Offline", "No data"). A note appears only when the data behind
 * the chart has stopped arriving. Recharts passes `active` and `label`; the rest comes from the chart
 * model, so the tooltip never re-derives a point's quality. The words live in `lib/dataQuality.ts`.
 */
export function ChartTooltip({
  active,
  label,
  rows,
  meta,
  series,
  param,
  sync,
  stepMs,
}: {
  active?: boolean;
  label?: number | string;
  rows: ChartRow[];
  meta: Record<string, SlotMeta>[];
  series: TooltipSeries[];
  param: ChartParam;
  sync: SyncStatus;
  stepMs: number;
}) {
  const now = useNowTick();
  const index = useMemo(() => new Map(rows.map((r, i) => [r.t as number, i])), [rows]);
  if (!active || label === undefined) return null;
  const t = Number(label);
  const i = index.get(t);
  if (i === undefined) return null;

  const row = rows[i];
  const metaRow = meta[i] ?? {};
  const note = staleNote(sync, now);

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__time">{tooltipTime(t, stepMs)}</div>
      {series.map((s) => {
        const m = metaRow[s.key];
        if (!m) return null;
        const value = row[s.key] ?? row[seriesKey(s.key, 'interpolated')] ?? row[seriesKey(s.key, 'frozen')];
        const tag = qualityTag(m);
        return (
          <div className="chart-tooltip__row" key={s.key}>
            <span className="chart-tooltip__swatch" style={{ background: s.color }} aria-hidden="true" />
            <span className="chart-tooltip__name">{s.name}</span>
            {tag && <span className={`chart-tooltip__tag chart-tooltip__tag--${m.quality}`}>{tag}</span>}
            <span className="chart-tooltip__value mono">{value !== undefined ? formatParamValue(value, param) : '—'}</span>
          </div>
        );
      })}
      {note && <div className="chart-tooltip__note">{note}</div>}
    </div>
  );
}
