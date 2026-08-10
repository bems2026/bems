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
  history: Record<string, HistoryPoint[]>;

  setDevices: (devices: Device[]) => void;
  setLatestReading: (deviceId: string, reading: Reading) => void;
  /** Bulk entry point for a `/ws/live` frame or an `/api/readings/latest` poll. */
  ingestReadings: (rows: ReadingsLatestRow[]) => void;
  setHistory: (deviceId: string, points: HistoryPoint[]) => void;
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

  setHistory: (deviceId, points) => set((s) => ({ history: { ...s.history, [deviceId]: points } })),
}));
