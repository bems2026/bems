/**
 * The aircon's full state, and the one place that turns a command into it.
 *
 * WHY A FULL STATE. An IR aircon cannot be asked what it is doing, and every IR frame it accepts
 * carries the whole state at once: power, mode, setpoint, fan and swing. "Set the fan to high" is
 * therefore not a thing that can be sent — only "be on, cooling, at 24, fan high, swing off" can.
 * This module expands every command into that complete, absolute state before it goes anywhere,
 * which is the aircon form of `shared/commands.mjs`'s rule that an action is never a toggle.
 *
 * WHY ONE STATE FOR BOTH PATHS. The aircon is reachable two ways: the hub's local IR library
 * (DP 201 on the LAN) and the vendor cloud, which composes a frame from the virtual "Air" remote's
 * DP properties. If each path filled the gaps from its own memory, a cloud command after a local
 * one would quietly restore whatever the cloud last remembered — the setpoint jumping back to the
 * pairing test's 16 °C, say. Resolving once, here, from the state THIS system last commanded, is
 * what keeps the two from ever disagreeing about what was asked.
 *
 * VENDOR VOCABULARY, MEASURED 2026-09-17. The "Air" remote's thing model declares `mode` "0".."4"
 * and `fan` "0".."3"; Tuya's IR AC API reference names them 0 cool / 1 heat / 2 auto / 3 fan /
 * 4 dry and 0 auto / 1 low / 2 medium / 3 high. The arrays below are in that order, so an index is
 * the wire value.
 *
 * Data and pure functions only: no imports. Read by the frontend bundle, the server daemons and
 * the flow generator, which inlines `LOCAL_LIBRARY_STATE` into the Node-RED function node.
 */

export const AC_MODES = Object.freeze(['cool', 'heat', 'auto', 'fan', 'dry']);
export const AC_FANS = Object.freeze(['auto', 'low', 'medium', 'high']);

/** The whole degrees the aircon's remote accepts, and the only bound on a setpoint. */
export const AC_SETPOINT_MIN_C = 16;
export const AC_SETPOINT_MAX_C = 30;

/**
 * What an ON command means when nothing else is known. 25 °C is the setpoint the retired dashboard
 * switch always sent, kept so a command with no history behaves as it always has.
 */
export const AC_DEFAULTS = Object.freeze({ mode: 'cool', setpoint_c: 25, fan: 'auto', swing: false });

/**
 * What the hand-captured local IR library encodes besides the setpoint.
 *
 * UNVERIFIED. The flow's `AC Master Logic` holds sixteen codes — OFF and 16..30 — captured before
 * this project began, with no record of the mode, fan or swing they were captured in. "Cool, fan
 * auto, swing off" is the likeliest reading and nothing more. The on-site acceptance test in the
 * ROADMAP records what the unit's own display shows for a local 24 °C; until then the site keeps
 * `aircon.local_ir_verified: false`, and dispatch sends ON states through the cloud first — because
 * a wrong local code does not fail, it succeeds at doing the wrong thing.
 */
export const LOCAL_LIBRARY_STATE = Object.freeze({ mode: 'cool', fan: 'auto', swing: false });

const isMode = (v) => AC_MODES.includes(v);
const isFan = (v) => AC_FANS.includes(v);
const isSetpoint = (v) => Number.isInteger(v) && v >= AC_SETPOINT_MIN_C && v <= AC_SETPOINT_MAX_C;

/**
 * A command -> the complete state to send.
 *
 * `cmd` is a VALIDATED command (`validateCommand` has already refused anything outside the
 * vocabulary). `last` is the aircon's latest reading, whose `setpoint_c`/`ac_mode`/`ac_fan`/
 * `ac_swing` are the last COMMANDED state — and are checked again here, because a reading is data
 * off the network and a garbled one must fall back to the default rather than reach a vendor API.
 */
export function resolveAcState(cmd, last = {}) {
  const prior = last ?? {};
  return {
    power: cmd?.action === 'off' ? 'off' : 'on',
    mode: isMode(cmd?.mode) ? cmd.mode : isMode(prior.ac_mode) ? prior.ac_mode : AC_DEFAULTS.mode,
    setpoint_c: isSetpoint(cmd?.target_c) ? cmd.target_c : isSetpoint(prior.setpoint_c) ? prior.setpoint_c : AC_DEFAULTS.setpoint_c,
    fan: isFan(cmd?.fan) ? cmd.fan : isFan(prior.ac_fan) ? prior.ac_fan : AC_DEFAULTS.fan,
    swing: typeof cmd?.swing === 'boolean' ? cmd.swing : typeof prior.ac_swing === 'boolean' ? prior.ac_swing : AC_DEFAULTS.swing,
  };
}

/**
 * A full state -> the "Air" remote's DP-instruction properties (thing model dp 101..105).
 *
 * OFF sends `switch_power` alone. Issuing a mode or a temperature alongside it invites the vendor
 * to compose a frame that switches the unit on to apply them; off is off.
 */
export function acStateToDps(state) {
  if (state.power === 'off') return { switch_power: false };
  return {
    switch_power: true,
    mode: String(AC_MODES.indexOf(state.mode)),
    temperature: state.setpoint_c,
    fan: String(AC_FANS.indexOf(state.fan)),
    swing: state.swing,
  };
}

/**
 * The local IR library key for a state — `'OFF'`, `'16'`..`'30'` — or `null` when the library has
 * no code for it. `null` is an ordinary answer, not a fault: it means this state needs the cloud.
 */
export function localIrKey(state, library = LOCAL_LIBRARY_STATE) {
  if (state?.power === 'off') return 'OFF';
  if (state?.power !== 'on') return null;
  const sameShape = state.mode === library.mode && state.fan === library.fan && state.swing === library.swing;
  return sameShape && isSetpoint(state.setpoint_c) ? String(state.setpoint_c) : null;
}

/** "Cool · 24 °C · fan auto · swing off", for confirmations and audit notes. */
export function describeAcState(state) {
  if (state.power === 'off') return 'Off';
  const mode = state.mode.charAt(0).toUpperCase() + state.mode.slice(1);
  return `${mode} · ${state.setpoint_c} °C · fan ${state.fan} · swing ${state.swing ? 'on' : 'off'}`;
}
