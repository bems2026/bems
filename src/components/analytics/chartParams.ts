import type { HistoryPoint } from '@/lib/types';

/**
 * The parameters Analytics can chart over time. Deliberately three, not v4's four:
 * `energy_kwh_today` is a cumulative daily counter, not a sampled instantaneous quantity —
 * the bridge's ring buffer never recorded it and charting a counter that resets at midnight
 * alongside three instantaneous signals would misrepresent what it is.
 *
 * Power has always been buffered. Voltage and current are recorded from the same poll as of
 * the change that added this module, so on a bridge that has been running longer than that,
 * their series begin partway through the window — `HistoryPoint`'s optional fields and
 * `pointValue`'s `undefined` return keep that as an honest gap in the line.
 */
export type ChartParam = 'power' | 'voltage' | 'current';

export const CHART_PARAMS: Record<ChartParam, { label: string; field: keyof HistoryPoint; unit: string; digits: number }> = {
  power: { label: 'Power', field: 'power_w', unit: 'W', digits: 0 },
  voltage: { label: 'Voltage', field: 'voltage', unit: 'V', digits: 1 },
  current: { label: 'Current', field: 'current', unit: 'A', digits: 2 },
};

export const CHART_PARAM_ORDER: ChartParam[] = ['power', 'voltage', 'current'];

/** The point's value for `param`, or `undefined` when that point never carried it — never
 * coerced to 0, so Recharts renders a gap instead of a fabricated zero reading. */
export function pointValue(point: HistoryPoint | undefined, param: ChartParam): number | undefined {
  const raw = point?.[CHART_PARAMS[param].field];
  return typeof raw === 'number' ? raw : undefined;
}

export function formatParamValue(value: number, param: ChartParam): string {
  const { digits, unit } = CHART_PARAMS[param];
  return `${value.toFixed(digits)} ${unit}`;
}
