import type { HistoryPoint } from '@/lib/types';
import { downsampleTrend } from '@/components/trends/chartSummary';

/** One row of the multi-series chart's Recharts data — `t` is the point's timestamp in ms,
 * every other key is a device id mapped to that device's power_w at this point. */
export type ChartRow = Record<string, number>;

/**
 * Builds one Recharts-ready row array from several devices' own history, each independently
 * downsampled first (reusing `downsampleTrend`, already tested) then zipped by index. Zipping
 * after a shared bucket count is safe here the same way `totalPowerSeries.ts`'s
 * index-alignment is: every metered device's history is seeded/sampled on the same tick in
 * both the mock and the real bridge, so same-index points share a timestamp.
 */
export function buildChartRows(deviceIds: string[], historyByDevice: Record<string, HistoryPoint[]>, maxPoints: number): ChartRow[] {
  const downsampled: Record<string, HistoryPoint[]> = {};
  for (const id of deviceIds) downsampled[id] = downsampleTrend(historyByDevice[id] ?? [], maxPoints);

  const lengths = deviceIds.map((id) => downsampled[id].length).filter((n) => n > 0);
  if (lengths.length === 0) return [];
  const length = Math.min(...lengths);

  const tsSourceId = deviceIds.find((id) => downsampled[id].length > 0)!;
  const rows: ChartRow[] = [];
  for (let i = 0; i < length; i++) {
    const row: ChartRow = { t: Date.parse(downsampled[tsSourceId][i].ts) };
    for (const id of deviceIds) row[id] = downsampled[id][i]?.power_w ?? 0;
    rows.push(row);
  }
  return rows;
}

export interface UntrackedPoint {
  ts: string;
  total: number;
  metered: number;
}

/**
 * Pairs the panel total (summed from the 4 branch meters) against the metered total
 * (summed from the 7 outlets) into one aligned series — the real version of v4's dead
 * `panelLine`/`meterArea`/`gapArea` computeds (see the Phase M plan §6.2: v4 computes this
 * shape but never renders it). Right-aligned to the shorter of the two, same defensive
 * reasoning as `totalPowerSeries.ts`'s `sumHistories`.
 */
export function alignTotalAndMetered(total: HistoryPoint[], metered: HistoryPoint[]): UntrackedPoint[] {
  const length = Math.min(total.length, metered.length);
  if (length === 0) return [];
  const t = total.slice(total.length - length);
  const m = metered.slice(metered.length - length);
  return t.map((p, i) => ({ ts: p.ts, total: p.power_w, metered: m[i].power_w }));
}
