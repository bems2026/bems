/**
 * The demo building's hardware. See `site.mjs` for why this file is here.
 *
 * Every field below is addressed by something: `class` decides which controls the app offers,
 * `ctx`/`sockets`/`state_key` are how the bridge reaches the device in flow context, `dps_map`
 * and `capability_profile` say how to read its data points, and `branch_circuit` must name a
 * branch in `circuits.mjs` — a device naming a circuit that does not exist is exactly the fault
 * `npm run site:check` exists to catch.
 */
export const BUILT_IN_DEVICES = [
  // --- Metering outlets: dual-socket, each socket switches and measures separately -----------
  ...[1, 2, 3, 4].map((n) => ({
    id: `co${n}`,
    display_name: `Outlet ${n}`,
    class: /** @type {const} */ ('outlet_dual'),
    room: null,
    dps_map: 'type_b',
    capability_profile: 'pc_outlet',
    ctx: `co${n}`,
    sockets: [`CO${n}_1`, `CO${n}_2`],
    branch_circuit: 'Outlets A',
    status: 'active',
  })),

  // --- Switched circuits: relay only. Their load is measured by the meter on their branch. ---
  ...[1, 2, 3, 4].map((n) => ({
    id: `l${n}`,
    display_name: `Lighting ${n}`,
    class: /** @type {const} */ ('switch'),
    room: null,
    dps_map: null,
    capability_profile: 'tdq_switch',
    ctx: null,
    state_key: `L${n}`,
    branch_circuit: 'Lighting A',
    status: 'active',
  })),

  // --- Branch meters: CT clamps in the panel. Building totals are summed from these. ---------
  {
    id: 'mtr_outlets_a',
    display_name: 'Outlets A',
    class: 'meter',
    room: null,
    dps_map: 'type_a',
    capability_profile: 'cz_ct_single',
    channel: 1,
    ctx: 'out_a',
    branch_circuit: 'Outlets A',
    description: 'Convenience outlets',
    phase: 'red',
    status: 'active',
  },
  {
    id: 'mtr_lighting_a',
    display_name: 'Lighting A',
    class: 'meter',
    room: null,
    dps_map: 'type_a',
    capability_profile: 'cz_ct_single',
    channel: 1,
    ctx: 'lgt_a',
    branch_circuit: 'Lighting A',
    description: 'Lighting circuits',
    phase: 'yellow',
    status: 'active',
  },
  {
    id: 'mtr_hvac',
    display_name: 'HVAC',
    class: 'meter',
    room: null,
    dps_map: 'type_a',
    capability_profile: 'cz_ct_single',
    channel: 1,
    ctx: 'hvac',
    branch_circuit: 'HVAC',
    description: 'Air-conditioning branch',
    phase: 'red',
    status: 'active',
  },

  // --- Air-conditioning, commanded by IR rather than by data point --------------------------
  {
    id: 'acu_main',
    display_name: 'Air Conditioner',
    class: 'acu_ir',
    room: null,
    dps_map: null,
    capability_profile: null,
    ctx: null,
    state_ctx: 'ac_dash_state',
    status: 'active',
  },

  // --- A sensor, read from the same state object rather than from data points ---------------
  {
    id: 'sens_outdoor',
    display_name: 'Outdoor Sensor',
    class: 'sensor_temp_humidity',
    room: null,
    dps_map: null,
    capability_profile: null,
    ctx: null,
    state_ctx: 'ac_dash_state',
    state_field: 'outTemp',
    status: 'active',
  },
];
