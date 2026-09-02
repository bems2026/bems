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
  /**
   * Names an entry in `shared/deviceCapabilities.mjs` — what this device's PRODUCT can do.
   *
   * Distinct from `class`, and it has to be: the single- and dual-channel CT meters are both
   * `class: 'meter'` and both read power from dp 105 on channel 1, yet they disagree about what
   * dp 113 means. `null` is a real answer — the IR blaster and the ambient sensor have no dps at
   * all — and is different from the field being absent, which means an older bridge.
   */
  capability_profile?: string | null;
  /** Which half of a dual-channel product this logical device reads. Absent on single-channel. */
  channel?: 1 | 2;
  status: DeviceStatus;
  sockets?: [string, string];
  branch_circuit?: string;
  description?: string;
  phase?: 'red' | 'yellow';
}

/**
 * A single decoded capability value. `number` for scaled measurements and settings, `boolean`
 * for relay and lock states, `string` for the enums (`relay_status`, `net_state`, `power_type`).
 */
export type CapabilityValue = number | boolean | string;

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
  /**
   * Everything the device reports beyond volts, amps and watts, keyed by its VENDOR capability
   * code and already in canonical units — `child_lock`, `countdown_1`, `warn_power1`,
   * `today_acc_energy2`, the outlet's `fault` bitmap, and so on.
   *
   * Which codes a device carries is a fact about its PRODUCT, declared in
   * `shared/deviceCapabilities.mjs` and checked against the vendor's own device model by
   * `npm run tuya:spec`. Nothing in `src/` should test for a code by hand: use
   * `lib/capabilitySchema.ts`, which resolves the channel suffix (one physical dual-channel
   * meter is two logical devices here, and `cur_power1` vs `cur_power2` is the difference
   * between two branch circuits reading correctly and reading each other's load).
   *
   * Absent on a bridge whose parsers predate this, and on devices with no dps at all (the IR
   * blaster, the ambient sensor). Individual codes are omitted rather than zeroed, on the same
   * rule as the metered fields above.
   */
  capabilities?: Record<string, CapabilityValue>;
  /**
   * How long this device's reading may go without advancing before it stops being fresh —
   * decided by the bridge, in `shared/registry.mjs`'s `STALE_AFTER_MS_BY_CLASS`, and carried
   * on the row so nothing in `src/` has to re-derive it.
   *
   * It is the bridge's number because the bridge owns the cadence: it runs the 60 s outlet
   * poller, so it is the only party that knows an outlet cannot report faster than that. A
   * copy of that table in the frontend would be free to disagree with the thing it describes,
   * which is exactly what a single global 30 s did — every outlet read "stale" for half of
   * every minute while Node-RED reported it connected.
   *
   * Absent on `_totals` (not a device) and on any bridge predating this field, where
   * `isReadingStale` falls back to `TIMING.STALE_AFTER_MS` unchanged.
   */
  stale_after_ms?: number;
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
  /**
   * Command audit rows written to the Pi's local buffer because Supabase was unreachable, and
   * not yet uploaded. Non-zero means commands are still working — the device layer is local —
   * but the audit trail is currently behind, which is a fact worth showing rather than hiding.
   */
  audit_buffer_pending?: number;
  /**
   * Which dispatch paths this site permits — `local-first` or `local-only`. Declared in
   * `shared/sites/<id>/site.mjs`. Optional: a proxy predating the field says nothing, which is
   * not the same as saying `local-first`.
   */
  dispatch_policy?: string;
  /**
   * Whether a vendor-cloud fallback is actually configured on this deployment.
   *
   * Carried beside the policy because the two answer different questions and neither is
   * sufficient alone: `local-first` with no credentials set behaves identically to
   * `local-only` today, and is a completely different promise about tomorrow.
   */
  cloud_fallback_configured?: boolean;
  /**
   * The aircon setpoint floor the next command will be validated against — RM-038.
   *
   * NOT the same fact as `SITE.policy.acu_min_setpoint_c` in this bundle: that is what the build
   * declared, and an operator can change the live one without a redeploy. Optional, because a
   * proxy predating the field says nothing; `null` means the site has no policy floor and the
   * hardware bound alone applies.
   */
  acu_min_setpoint_c?: number | null;
  /** `'database'` or `'build'` — where the proxy got the floor above. During a Supabase outage
   * it falls back to the build value, and a page presenting that as current would be wrong. */
  policy_source?: string;
}
