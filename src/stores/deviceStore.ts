import { create } from 'zustand';
import type { Device, Reading, HistoryPoint, ReadingsLatestRow, Totals } from '@/lib/types';
import { isTotals } from '@/lib/types';

/**
 * Shape follows `ibems-dashboard-stage1-plan.md` §4: `latestReadings` and `history` stay
 * separate keyed maps (not nested under each device) so a `TrendChart` mounting and
 * lazy-loading its own range doesn't re-render every gauge subscribed to `latestReadings`.
 */
export interface DeviceState {
  devices: Device[];
  latestReadings: Record<string, Reading>;
  /** The `_totals` pseudo-row, split out of the readings array on ingest. */
  totals: Totals | null;
  /**
   * Per-device history, TAGGED with the range it was fetched for.
   *
   * The range used not to be recorded, and one untagged map was shared by three writers
   * asking for different windows — Analytics at 24h/7d/90d/1y and Overview's EnergyFlowCard,
   * which always fetches 24h. Nothing ever cleared it, so points from one range were read
   * as another in three separate ways:
   *
   *   - switching 24h -> 7d rendered the 24h points under a 7d label until the new fetch
   *     landed (and the axis was already formatted for 7d);
   *   - if the 7d fetch FAILED, they stayed on screen indefinitely, because the page's
   *     "history unavailable" message only appears when there are no rows at all;
   *   - visiting Overview and returning re-stamped every meter's series with 24h data.
   *
   * That is the same class of fault as the truncation bug in `supabaseHistory.ts`: a chart
   * that renders confidently over data that does not mean what its label says. Reading
   * through `historyFor` makes a range mismatch a gap rather than a silent substitution.
   */
  history: Record<string, { range: string; points: HistoryPoint[] }>;

  setDevices: (devices: Device[]) => void;
  setLatestReading: (deviceId: string, reading: Reading) => void;
  /** Bulk entry point for a `/ws/live` frame or an `/api/readings/latest` poll. */
  ingestReadings: (rows: ReadingsLatestRow[]) => void;
  /** `range` tags the points so a reader asking for a different window gets nothing back
   * rather than someone else's data. */
  setHistory: (deviceId: string, points: HistoryPoint[], range: string) => void;
}

export const useDeviceStore = create<DeviceState>((set) => ({
  devices: [],
  latestReadings: {},
  totals: null,
  history: {},

  setDevices: (devices) => set({ devices }),

  setLatestReading: (deviceId, reading) =>
    set((s) => ({ latestReadings: { ...s.latestReadings, [deviceId]: reading } })),

  ingestReadings: (rows) =>
    set((s) => {
      const latestReadings = { ...s.latestReadings };
      let totals = s.totals;
      for (const row of rows) {
        if (isTotals(row)) totals = row;
        else latestReadings[row.device_id] = row;
      }
      return { latestReadings, totals };
    }),

  setHistory: (deviceId, points, range) => set((s) => ({ history: { ...s.history, [deviceId]: { range, points } } })),
}));

/**
 * The only way to read history. Returns `[]` when the stored series was fetched for a
 * different range — a gap the UI already knows how to render, rather than a plausible-
 * looking chart of the wrong window.
 *
 * Pure, and takes the map rather than the store, so it works inside a selector and is
 * testable without mounting anything.
 */
const NO_POINTS: HistoryPoint[] = [];

export function historyFor(
  history: DeviceState['history'],
  deviceId: string,
  range: string,
): HistoryPoint[] {
  const entry = history[deviceId];
  // NO_POINTS, not a fresh [] — this runs inside zustand selectors, where a new
  // reference each call would re-render the subscriber on every unrelated store change.
  return entry && entry.range === range ? entry.points : NO_POINTS;
}
