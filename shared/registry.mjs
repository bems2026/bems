/**
 * iBEMS device registry — canonical, single source of truth.
 *
 * Derived from the 21 live `tuya-smart-device` nodes and the 99 flow-context keys
 * in the CARE office Node-RED flow (`flows.json`, 371 nodes / 4 tabs).
 *
 * This file is imported by:
 *   - `mock-bridge/server.mjs`      (local contract-identical fake)
 *   - `node-red-bridge/build-flow.mjs` (which inlines it into the generated flow JSON)
 *
 * Do NOT hand-edit `node-red-bridge/bridge-flow.json` — regenerate it instead, so the
 * registry can never drift between the mock and the real bridge:
 *     npm run build:flow
 *
 * ---------------------------------------------------------------------------
 * CT circuit map (confirmed on site — the only documentation of this that exists,
 * transcribed from the comment block at Original.html:1697-1705):
 *
 *   L.O red     -> the room's lighting circuits
 *   L.O yellow  -> OUTDOOR ACU (separate unit, right side outside the room)
 *   C.O yellow  -> convenience outlets
 *   ACU meter   -> indoor ACU
 *
 * `mtr_co_yellow` and `mtr_lo_yellow` are two logical meters on ONE physical
 * device (Tuya id eb3b887b3d0f0561fcbgzb) reading different DPS ranges, which is
 * why device identity here is the logical meter id, never the Tuya device id.
 * ---------------------------------------------------------------------------
 *
 * DPS families, confirmed against the live Unified Parser functions:
 *   type_a = 105/106/107      (power/current/voltage; no energy DPS)
 *   type_b = 17/18/19/20      (energy/current/power/voltage)
 *   type_c = 115/116/117      (power/current/voltage; no energy DPS)
 */

/** @typedef {'outlet_dual'|'switch'|'meter'|'acu_ir'|'sensor_temp_humidity'} DeviceClass */

export const DPS_MAPS = {
  type_a: { p: 105, c: 106, v: 107, scale: { p: 10, c: 1000, v: 10 } },
  type_b: { energy: 17, c: 18, p: 19, v: 20, scale: { p: 10, c: 1000, v: 10, energy: 100 } },
  type_c: { p: 115, c: 116, v: 117, scale: { p: 10, c: 1000, v: 10 } },
};

/**
 * `ctx` is the flow-context key prefix. A metered device exposes:
 *   <ctx>_last_v, <ctx>_last_c, <ctx>_last_p, <ctx>_energy, <ctx>_health
 * Outlets additionally expose <ctx>_last_time.
 *
 * `room` is intentionally null everywhere: nothing in the live flow records room
 * assignment. Capturing it is exactly what the Phase 4.5 onboarding wizard is for.
 * Do not invent values here.
 */
import { ENROLLED_DEVICES } from './registry.enrolled.mjs';

/**
 * Re-exported so a consumer that already imports the registry does not need a second import
 * for the site that registry belongs to. `shared/siteConfig.mjs` stays the single definition —
 * this is a pointer, not a copy.
 */
export { SITE } from './siteConfig.mjs';

/** This site's electrical tree (RM-029), and the derivation `PHASE_MAP` is built from. */
import { derivePhaseMap } from './circuits.mjs';
import { CIRCUITS } from './sites/mmsu-nberic-care/circuits.mjs';
export { CIRCUITS };

/**
 * The devices this system was built around, hand-written and stable.
 * Enrolled devices are appended below — see `registry.enrolled.mjs`.
 */
const BUILT_IN_DEVICES = [
  // --- Convenience outlets: dual-socket, self-metering (DPS type_b) ------------
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({
    id: `co${n}`,
    display_name: `Outlet ${n}`,
    class: /** @type {DeviceClass} */ ('outlet_dual'),
    room: null,
    dps_map: 'type_b',
    ctx: `co${n}`,
    sockets: [`CO${n}_1`, `CO${n}_2`],
    branch_circuit: 'C.O Yellow',
    status: 'active',
  })),

  // --- Lighting circuits: relay only, no metering -----------------------------
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({
    id: `l${n}`,
    display_name: `Light Switch ${n}`,
    class: /** @type {DeviceClass} */ ('switch'),
    room: null,
    dps_map: null,
    ctx: null,
    state_key: `L${n}`, // key within flow context `bems_lights_state`
    branch_circuit: 'L.O Red',
    status: 'active',
  })),

  // --- CT branch meters on the CHNT sub-panel ---------------------------------
  {
    id: 'mtr_co_yellow',
    display_name: 'C.O Yellow',
    class: 'meter',
    room: null,
    dps_map: 'type_a',
    ctx: 'co_yel',
    branch_circuit: 'C.O Yellow',
    description: 'Convenience outlets branch',
    phase: 'yellow',
    status: 'active',
  },
  {
    id: 'mtr_lo_red',
    display_name: 'L.O Red',
    class: 'meter',
    room: null,
    dps_map: 'type_a',
    ctx: 'lo_red',
    branch_circuit: 'L.O Red',
    description: "The room's lighting circuits",
    phase: 'red',
    status: 'active',
  },
  {
    id: 'mtr_arec_acu',
    display_name: 'AREC ACU',
    class: 'meter',
    room: null,
    dps_map: 'type_a',
    ctx: 'arec',
    branch_circuit: 'ACU',
    description: 'Indoor ACU',
    phase: 'red',
    status: 'active',
  },
  {
    id: 'mtr_lo_yellow',
    display_name: 'L.O Yellow',
    class: 'meter',
    room: null,
    dps_map: 'type_c',
    ctx: 'lo_yel2',
    branch_circuit: 'L.O Yellow',
    description: 'Outdoor ACU (separate unit, right side outside the room)',
    phase: 'yellow',
    status: 'active',
  },

  // --- Aircon, IR-controlled (never power-cut; compressor safety) -------------
  {
    id: 'acu_main',
    display_name: 'Aircon',
    class: 'acu_ir',
    room: null,
    dps_map: null,
    ctx: null,
    state_ctx: 'ac_dash_state', // { power, setTemp, roomTemp, humidity, outTemp }
    status: 'active',
  },

  // --- Ambient sensor ---------------------------------------------------------
  {
    id: 'sens_outside_temp',
    display_name: 'Outside Temp',
    class: 'sensor_temp_humidity',
    room: null,
    dps_map: null,
    ctx: null,
    state_ctx: 'ac_dash_state',
    state_field: 'outTemp',
    status: 'active',
  },
];

/**
 * Everything the system knows about. Built-in devices come first so that enrolling one cannot
 * reorder the list every existing test and generated flow was written against — several places
 * key off position implicitly (the flow's node order, the analytics colour cycle), and a
 * reordering would be a silent, wide-reaching change for no benefit.
 */
export const DEVICE_REGISTRY = [...BUILT_IN_DEVICES, ...ENROLLED_DEVICES];

/**
 * Phase assignment, DERIVED from this site's electrical tree rather than declared here — RM-029.
 *
 * It used to be a constant naming four specific meters, mirroring `Calculate 3-Phase Totals` in
 * the live flow — and it was the most direct statement in this codebase that this building's
 * panel is the only panel that will ever exist. The shape is unchanged, and
 * `test/circuit-tree.test.mjs` asserts the derivation reproduces the old constant meter for
 * meter; what changed is that a second site describes its own panel instead of editing this line.
 *
 * `blue` is still an EMPTY LIST, not a missing key — no Blue-phase meter is installed, and the UI
 * must render that as "not metered", never as a real zero reading.
 */
export const PHASE_MAP = derivePhaseMap(CIRCUITS);

/** Timing constants. Derived from the live flow's actual tick rates — see docs/bridge-contract.md. */
export const TIMING = {
  WS_PUSH_MS: 2000, // `Update Main UI` inject, repeat: 2
  HISTORY_SAMPLE_MS: 60000, // 1440 samples = 24h; matches the 60s `Cron *` injects
  HISTORY_MAX_POINTS: 1440,
  POLL_FALLBACK_MS: 15000,
  STALE_AFTER_MS: 30000,
  FETCH_TIMEOUT_MS: 10000,
  BACKOFF_CAP_MS: 120000,
  // Stage 2 (command path). Shorter than FETCH_TIMEOUT_MS deliberately — a toggle that
  // spins for 10s is worse than one that fails at 5s and invites a retry, and unlike a
  // poll, nothing else is waiting on this particular request.
  COMMAND_TIMEOUT_MS: 5000,
  // How long a pending command waits for the feed to echo it back before giving up and
  // showing "failed" — 3 WS push cycles (WS_PUSH_MS=2000), not 1: a frame can already be
  // in flight when the ack lands, so one cycle of tolerance isn't enough headroom.
  COMMAND_CONFIRM_MS: 6000,
};

/** Devices that report voltage/current/power — i.e. everything with a `ctx` prefix. */
export const METERED = DEVICE_REGISTRY.filter((d) => d.ctx);

/** Public device list as served by `GET /api/devices` (internal wiring fields stripped). */
export function publicDevices() {
  return DEVICE_REGISTRY.map(({ ctx, state_key, state_ctx, state_field, ...pub }) => pub);
}
