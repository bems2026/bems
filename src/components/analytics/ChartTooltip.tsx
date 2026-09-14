import { useMemo } from 'react';
import { siteDateTime, siteTime } from '@/lib/siteTime';
import { describeSlot, sourceLabel, type SyncStatus } from '@/lib/dataQuality';
import { useNowTick } from '@/lib/useNowTick';
import { seriesKey, type ChartRow, type SlotMeta, type TooltipSeries } from './analyticsMath';
import { CHART_PARAMS, type ChartParam } from './chartParams';

/**
 * The tooltip every Analytics chart uses — RM-076.
 *
 * It says four things the old one did not: the exact moment to the second (and the span, when a row
 * stands for more than a minute), what kind of point each value is (measured, bridged, frozen,
 * rejected), what the device itself carried when that differs from what is drawn, and where the
 * point came from and how current that source is. Recharts passes `active` and `label`; everything
 * else comes from the chart model, so the tooltip never has to re-derive a point's quality.
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
  const unit = CHART_PARAMS[param].unit;
  const span = stepMs > 60_000 ? ` – ${siteTime(t + stepMs, { hour: '2-digit', minute: '2-digit' })}` : '';
  const anyLive = series.some((s) => metaRow[s.key]?.quality === 'live');

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__time mono">
        {siteDateTime(t)}
        {span}
      </div>
      {series.map((s) => {
        const m = metaRow[s.key];
        if (!m) return null;
        const value = row[s.key] ?? row[seriesKey(s.key, 'interpolated')] ?? row[seriesKey(s.key, 'frozen')];
        return (
          <div className="chart-tooltip__series" key={s.key}>
            <div className="chart-tooltip__head">
              <span className="chart-tooltip__swatch" style={{ background: s.color }} aria-hidden="true" />
              <span className="chart-tooltip__name">{s.name}</span>
              <span className="chart-tooltip__value mono">{value !== undefined ? `${Number(value.toFixed(2))} ${unit}` : '—'}</span>
            </div>
            <div className={`chart-tooltip__quality chart-tooltip__quality--${m.quality}`}>{describeSlot(m, param)}</div>
            {m.readingTs && <div className="chart-tooltip__meta mono">Reading at {siteTime(m.readingTs)}</div>}
          </div>
        );
      })}
      <div className="chart-tooltip__source">{sourceLabel(sync, anyLive ? 'live' : 'measured', now)}</div>
    </div>
  );
}
