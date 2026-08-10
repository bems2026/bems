/**
 * Types mirroring the bridge contract in `docs/bridge-contract.md` field-for-field.
 * Schema alignment is load-bearing (Stage 1 plan §7): if a field here changes, the
 * contract doc, `shared/registry.mjs` / `shared/buildLatest.mjs`, the onboarding spec's
 * §4, and the architecture doc's §3.4 all change in the same commit.
 */

export type DeviceClass = 'outlet_dual' | 'switch' | 'meter' | 'acu_ir' | 'sensor_temp_humidity';
export type DpsMap = 'type_a' | 'type_b' | 'type_c' | null;
export type DeviceStatus = 'active' | 'skipped' | 'disabled';
export type SwitchState = 'on' | 'off';

/** `GET /api/devices` — one entry. Static for the process lifetime. */
export interface Device {
  id: string;
  display_name: string;
  class: DeviceClass;
  room: string | null;
  dps_map: DpsMap;
  status: DeviceStatus;
  sockets?: [string, string];
  branch_circuit?: string;
  description?: string;
  phase?: 'red' | 'yellow';
}

/**
 * One row of `GET /api/readings/latest` (and of each `/ws/live` frame). Metered fields
 * are omitted, never zeroed, when no reading exists — "no data" and "zero watts" are
 * different facts.
 */
export interface Reading {
  device_id: string;
  ts: string;
  voltage?: number;
  current?: number;
  power_w?: number;
  energy_kwh_today?: number;
  online: boolean;
  state: SwitchState | null;
  /** `outlet_dual` only. */
  socket_states?: { 1: SwitchState; 2: SwitchState };
  /** `acu_ir` only. */
  setpoint_c?: number;
  room_temp_c?: number;
  humidity_pct?: number;
  /** `sensor_temp_humidity` only. */
  temp_c?: number;
}

/**
 * The trailing `_totals` pseudo-row in the same array. `phase_current.blue` is `null`,
 * never `0` — no Blue-phase meter is installed; rendering it as a real zero would be
 * a lie about the building's electrical layout, not a missing reading.
 */
export interface Totals {
  device_id: '_totals';
  ts: string;
  energy_kwh_today: number | null;
  energy_kwh_week: number | null;
  energy_kwh_month: number | null;
  total_power_w: number | null;
  avg_voltage: number | null;
  phase_current: { red: number | null; yellow: number | null; blue: null };
}

export type ReadingsLatestRow = Reading | Totals;

export function isTotals(row: ReadingsLatestRow): row is Totals {
  return row.device_id === '_totals';
}

/** `GET /api/readings/history` point. */
export interface HistoryPoint {
  ts: string;
  power_w: number;
}

export interface HistoryResponse {
  device_id: string;
  range: '1h' | '6h' | '24h';
  points: HistoryPoint[];
}
