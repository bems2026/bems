/**
 * Which aircon setpoints this site's selector may offer, and where it opens.
 *
 * TWO BOUNDS, deliberately kept apart:
 *
 *   - `ACU_MIN_C`/`ACU_MAX_C` (`shared/commands.mjs`) are the whole degrees the live flow's IR
 *     library actually holds codes for. A hardware fact, identical at every site. Anything
 *     outside resolves to no code at all, so offering it would be offering a no-op.
 *   - The site's `policy.acu_min_setpoint_c` is what the operator permits, and it narrows the
 *     range. Here that is the university's energy-efficiency policy.
 *
 * `validateCommand` refuses both, server-side, and that refusal is the enforcement — this file
 * exists so the UI does not offer a value that is going to come back as a 400, which reads as a
 * bug rather than as a policy.
 *
 * Pure and separately tested, following the same split as `dispatchScope.ts` and
 * `planGeometry.ts`: the card renders, this decides.
 */
import { ACU_MIN_C, ACU_MAX_C } from '@shared/commands.mjs';

/** What the retired dashboard switch sent, so an untouched selector behaves as it always has. */
export const DEFAULT_SETPOINT_C = 25;

/**
 * The whole degrees this site may command, ascending.
 *
 * A policy floor below the hardware minimum is ignored rather than honoured — it cannot widen
 * the range, because there is no code to send. A floor above the maximum yields the single
 * warmest legal value rather than an empty list: a `<select>` with no options is a dead control,
 * and the honest response to an over-strict policy is the closest thing that can actually be sent.
 */
export function setpointOptions(policyFloorC: number | null | undefined): number[] {
  const floor = typeof policyFloorC === 'number' ? Math.max(ACU_MIN_C, Math.min(policyFloorC, ACU_MAX_C)) : ACU_MIN_C;
  const out: number[] = [];
  for (let c = floor; c <= ACU_MAX_C; c++) out.push(c);
  return out;
}

/**
 * Where the selector opens: the ACU's own last known setpoint when that is a legal option, so
 * the control shows where the room actually is rather than a fixed guess.
 *
 * The fallback matters more than it looks. The unit can genuinely be sitting below the policy
 * floor — set from the physical remote, or before the policy existed — and seeding the selector
 * there would preselect a value the server refuses, so the first click fails for no visible
 * reason. Falling back to the lowest legal value is both safe and the one the operator most
 * likely wants.
 */
export function seedSetpoint(lastKnownC: number | null | undefined, policyFloorC: number | null | undefined): number {
  const options = setpointOptions(policyFloorC);
  if (typeof lastKnownC === 'number' && Number.isFinite(lastKnownC)) {
    const rounded = Math.round(lastKnownC);
    if (options.includes(rounded)) return rounded;
  }
  return options.includes(DEFAULT_SETPOINT_C) ? DEFAULT_SETPOINT_C : options[0];
}
