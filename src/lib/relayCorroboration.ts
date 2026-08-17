import type { Device, Reading } from './types';

/**
 * How well a device's *measured* power agrees with its *commanded* relay state — the one
 * place this app can partially corroborate a command against something real, since nothing
 * reads relay DPS back directly (see `docs/bridge-contract.md` and `shared/commands.mjs`'s
 * header). Only `outlet_dual` has a meter at all, and it measures the WHOLE outlet, not
 * either socket individually — that asymmetry is exactly what the five cases below encode:
 *
 *   - `contradicted`: both sockets commanded off, but the meter reads real power. The one
 *     unambiguous, actionable case — something is drawing current through relays believed
 *     open. The only case that should read as a warning.
 *   - `no-load`: commanded on, meter reads ~0. NOT an error — the socket may simply have
 *     nothing plugged into it.
 *   - `drawing`: commanded on (either or both sockets), meter reads real power. Consistent,
 *     unremarkable.
 *   - `indeterminate`: exactly one socket on, or no reading yet — the whole-outlet meter
 *     can't attribute a draw to a single socket, so no claim is possible either way.
 *   - `unmeasured`: any class with no meter at all (`switch`, `acu_ir`) — permanent, not a
 *     transient "no reading yet" state.
 */
export type Corroboration = 'contradicted' | 'no-load' | 'drawing' | 'indeterminate' | 'unmeasured';

/** Below this, a real CT reading is treated as noise/idle draw rather than "drawing". */
const LOAD_EPSILON_W = 3;

export function corroborate(device: Device, reading: Reading | undefined): Corroboration {
  if (device.class !== 'outlet_dual') return 'unmeasured';

  // A disconnected outlet's meter reading is frozen, not real — without this, a stale
  // "both sockets off, meter shows real power" snapshot reads as `contradicted` (a
  // warning) purely because the bridge stopped hearing from the device, not because
  // anything is actually wrong. Caught live: this is the exact false-positive mechanism
  // behind "device states are not accurate."
  if (reading?.online === false) return 'indeterminate';

  const power = reading?.power_w;
  const states = reading?.socket_states;
  if (typeof power !== 'number' || !states) return 'indeterminate';

  const s1On = states[1] === 'on';
  const s2On = states[2] === 'on';
  const drawing = power > LOAD_EPSILON_W;

  if (!s1On && !s2On) return drawing ? 'contradicted' : 'no-load';
  if (s1On && s2On) return drawing ? 'drawing' : 'no-load';
  return 'indeterminate'; // one socket on, one off — meter can't attribute the draw
}
