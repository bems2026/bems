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
  /**
   * Accumulated by the bridge from this device's daily counter as it rolls over, since no
   * meter reports anything longer than a day. Absent until the bridge has folded in at
   * least one completed day — and absent entirely on a bridge whose context storage was
   * wiped — which is why these are optional and must never be shown as 0.
   *
   * Not comparable to `Totals`' building-wide week/month: those come from the building's
   * own legacy flow, whose period boundaries are not knowable from here.
   */
  energy_kwh_week?: number;
  energy_kwh_month?: number;
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

/**
 * `GET /api/readings/history` point. `voltage`/`current` are optional for the same reason
 * `Reading`'s are: the bridge records them only when the poll actually carried them. Points
 * buffered before the bridge started recording V/A — and any meter that doesn't report them
 * — have `power_w` alone, and the UI must render that as a gap, never as 0.
 */
export interface HistoryPoint {
  ts: string;
  power_w: number;
  voltage?: number;
  current?: number;
  /**
   * Whether the device was actually reporting when this sample was taken (FI-010).
   *
   * Every meter last known wattage is carried forward into each sample, so without this a
   * device offline all day drew a confident flat line. Optional because points buffered before
   * the bridge recorded it have no value here — and that is unknown, not false. `pointValue`
   * suppresses a point only when it is explicitly `false`.
   */
  online?: boolean;
}

export interface HistoryResponse {
  device_id: string;
  range: '1h' | '6h' | '24h';
  points: HistoryPoint[];
}

// ---------------------------------------------------------------------------
// Command contract — Stage 2 (Phase L), mock-bridge only. Mirrors shared/commands.mjs.
// ---------------------------------------------------------------------------

export type SocketIndex = 1 | 2;

/** `POST /api/command` request body. `action` is always absolute — never a toggle; see
 * shared/commands.mjs's header for why. `socket` is required for `outlet_dual`, forbidden
 * otherwise. */
export interface CommandRequest {
  device_id: string;
  socket?: SocketIndex;
  action: SwitchState;
  command_id?: string;
  /** ACU only: the setpoint in whole degrees, 16-30. The aircon is IR-commanded and its logic
   * takes a code rather than a relay state, so "on" alone cannot say what to turn on to. See
   * shared/commands.mjs, which validates the same bounds server-side. */
  target_c?: number;
}

/**
 * `POST /api/command` response — always `202 Accepted`, never `200 OK`. `confirmed` is
 * always `false`: nothing in this system reads relay state back from hardware, so this ack
 * means "dispatched", not "verified". See `relayCorroboration.ts` for the one place this
 * app can partially corroborate a command against a real measurement.
 */
export interface CommandAck {
  command_id: string;
  device_id: string;
  socket?: SocketIndex;
  action: SwitchState;
  target: string;
  accepted_at: string;
  confirmed: false;
  confirmation: 'none';
  note: string;
  /**
   * Which path the dispatch actually took. `cloud` means the device stopped answering on the
   * LAN and the vendor fallback moved the relay instead — a success the operator would
   * otherwise read as unremarkable, and the earliest warning this system has that a device is
   * going bad. Null for a dry run, where no path was attempted, and absent from an older
   * bridge that predates it.
   */
  via?: 'local' | 'cloud' | 'none' | null;
}

// ---------------------------------------------------------------------------
// Context (write) contract — Stage 2 (Phase M4), mock-bridge only. Mirrors
// shared/context.mjs. Every value is a string — the same wire convention `days` uses below
// (a 7-char '1'/'0' string, not a boolean array) so the whole store round-trips through
// plain JSON without a second serialization scheme.
// ---------------------------------------------------------------------------

/** The full Node-RED global-context map as `GET /api/context` returns it — flat key to
 * string value, exactly what was last written. Empty on a freshly started mock: there are
 * no fabricated default schedules or thresholds. */
export type ContextMap = Record<string, string>;

/** `POST /api/context` request body — always a bulk write, never one key at a time; see
 * shared/context.mjs's header for why. */
export interface ContextWriteRequest {
  writes: ContextMap;
}

/** `POST /api/context` response — 202 and `confirmed: false` always: unlike a command,
 * there is nothing to poll back and confirm, ever. */
export interface ContextAck {
  keys: string[];
  accepted_at: string;
  confirmed: false;
  note: string;
}

// ---------------------------------------------------------------------------
// Capabilities — Stage 2 (Phase 6). Lets the UI honestly distinguish "commanded and
// audit-logged" from "actually dispatched to hardware" instead of assuming the latter.
// ---------------------------------------------------------------------------

/** `GET /api/capabilities`. The mock always reports `false` — it has no gated dispatch
 * path to enable, so there is nothing it could honestly report as `true`. */
export interface Capabilities {
  hardware_dispatch_enabled: boolean;
  /** The device classes a command actually reaches hardware for, right now — empty while the
   * gate is closed. Not the same fact as `hardware_dispatch_enabled`: the proxy only ever
   * dispatches `switch` commands, so an open gate still leaves outlets and the ACU changing
   * nothing. See `components/control/dispatchScope.ts` for why the UI needs both. */
  dispatch_classes: string[];
}
