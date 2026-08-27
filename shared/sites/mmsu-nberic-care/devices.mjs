/**
 * The 21 devices of the MMSU CARE Office / NBERIC deployment - RM-033 / FI-017.
 *
 * WHY THIS FILE EXISTS. This list is the most site-specific thing in the whole codebase: it is
 * hardware screwed to one building's walls, with that building's flow-context keys and that
 * building's branch-circuit labels. It lived inline in `shared/registry.mjs` - the file EVERY
 * deployment shares - so standing up a second site meant editing shared code.
 * `test/site-config.test.mjs` now fails if any of these ids reappears there.
 *
 * Data only: no imports, no logic, no runtime dependency on the registry that composes it. Read
 * by the frontend bundle, by the server daemons and, indirectly, by the generated Node-RED flow,
 * so it has to be safe in all three.
 *
 * ---------------------------------------------------------------------------
 * CT circuit map (confirmed on site - the only documentation of this that exists,
 * transcribed from the comment block at Original.html:1697-1705):
 *
 *   L.O red     -> the room's lighting circuits
 *   L.O yellow  -> OUTDOOR ACU (separate unit, right side outside the room)
 *   C.O yellow  -> convenience outlets
 *   ACU meter   -> indoor ACU
 *
 * The two yellow meters are two logical meters on ONE physical device reading different DPS
 * ranges, which is why device identity here is the logical meter id, never the Tuya device id.
 * ---------------------------------------------------------------------------
 *
 * `dps_map` names a family in `shared/registry.mjs`'s `DPS_MAPS`. Those families describe Tuya
 * firmware, not this building, which is why they stayed shared while this moved.
 *
 * `room` is intentionally null everywhere: nothing in the live flow records room assignment.
 * The space tree (RM-028) is where a device's location is recorded now. Do not invent values.
 */

/** @typedef {import('../../registry.mjs').DeviceClass} DeviceClass */

export const BUILT_IN_DEVICES = [
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
