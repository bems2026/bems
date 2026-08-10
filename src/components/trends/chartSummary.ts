import type { HistoryPoint, HistoryResponse } from '@/lib/types';

const RANGE_LABEL: Record<HistoryResponse['range'], string> = {
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
};

/**
 * A `<LineChart>`'s SVG conveys nothing to a screen reader on its own — Recharts renders
 * plain `<path>`/`<g>` elements with no accessible name. This generates the text
 * alternative `TrendChart` exposes via `role="img"`/`aria-label`. Pure and independently
 * testable, rather than asserted against rendered SVG output.
 */
export function summarizeTrend(deviceLabel: string, range: HistoryResponse['range'], points: HistoryPoint[]): string {
  const rangeLabel = RANGE_LABEL[range];
  if (points.length === 0) {
    return `${deviceLabel} power over ${rangeLabel}: no readings yet.`;
  }
  const values = points.map((p) => p.power_w);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const current = values[values.length - 1];
  return `${deviceLabel} power over ${rangeLabel}: ${points.length} readings, ranging ${Math.round(min)} to ${Math.round(max)} watts, currently ${Math.round(current)} watts.`;
}
