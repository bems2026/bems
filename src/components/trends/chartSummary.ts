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

export interface TrendStats {
  peak: { power_w: number; ts: string } | null;
  average: number | null;
}

/** Peak and average power over the series — always computed from the FULL, real points
 * array, never the downsampled one below. Downsampling is a rendering decision; these
 * numbers are a claim about the building and must stay accurate to the actual readings. */
export function trendStats(points: HistoryPoint[]): TrendStats {
  if (points.length === 0) return { peak: null, average: null };
  let peak = points[0];
  let sum = 0;
  for (const p of points) {
    sum += p.power_w;
    if (p.power_w > peak.power_w) peak = p;
  }
  return { peak: { power_w: peak.power_w, ts: peak.ts }, average: sum / points.length };
}

/**
 * Bucket-averages `points` down to at most `maxPoints`, for the chart's `data` prop only —
 * 1440 raw samples (24h at 1/min) drawn into a ~180px-tall card is what makes a trend read
 * as noise rather than a shape. Averaging within each bucket (not simple stride-sampling)
 * smooths that noise instead of just thinning it, and can't hide a real spike the way
 * picking every Nth point could.
 */
export function downsampleTrend(points: HistoryPoint[], maxPoints: number): HistoryPoint[] {
  if (points.length <= maxPoints || maxPoints <= 0) return points;
  const bucketSize = points.length / maxPoints;
  const out: HistoryPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    const bucket = points.slice(start, end);
    const avgPower = bucket.reduce((sum, p) => sum + p.power_w, 0) / bucket.length;
    const point: HistoryPoint = { ts: bucket[Math.floor(bucket.length / 2)].ts, power_w: avgPower };
    // voltage/current are optional per point (see `HistoryPoint`), so each is averaged over
    // only the samples that actually carried it and omitted entirely when none did — a
    // bucket spanning the moment the bridge started recording V/A must not average the
    // missing half in as 0.
    const v = avgDefined(bucket, 'voltage');
    if (v !== undefined) point.voltage = v;
    const c = avgDefined(bucket, 'current');
    if (c !== undefined) point.current = c;
    out.push(point);
  }
  return out;
}

function avgDefined(bucket: HistoryPoint[], field: 'voltage' | 'current'): number | undefined {
  let sum = 0;
  let count = 0;
  for (const p of bucket) {
    const value = p[field];
    if (typeof value === 'number') {
      sum += value;
      count++;
    }
  }
  return count === 0 ? undefined : sum / count;
}
