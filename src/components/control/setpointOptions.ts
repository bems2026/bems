/**
 * Which aircon setpoints this site's selector offers, where it opens, and when to say something.
 *
 * ONE BOUND NOW, NOT TWO — RM-068.
 *
 * `ACU_MIN_C`/`ACU_MAX_C` (`shared/commands.mjs`) are the whole degrees the live flow's IR
 * library actually holds codes for. A hardware fact, identical at every site, and anything
 * outside resolves to no code at all — so offering it would be offering a no-op.
 *
 * The site's comfort policy used to narrow that range as well, because it was read as a bound on
 * the COMMANDED SETPOINT and `validateCommand` refused anything below it. That number now means
 * the coldest ROOM TEMPERATURE an automatic rule may aim for, which is not a statement about
 * this control at all: a person who needs 18 °C for an hour is entitled to ask for it. So the
 * selector offers the full hardware range and `setpointWarning` says when a choice is below the
 * building's policy — shown here, and recorded in the command audit note by `server/proxy.mjs`.
 *
 * Hiding an option was never enforcement anyway; the note in `shared/commands.mjs` about every
 * dispatch path going through one validator is what enforcement looks like.
 *
 * Pure and separately tested, following the same split as `dispatchScope.ts`: the card renders,
 * this decides.
 */
import { ACU_MIN_C, ACU_MAX_C } from '@shared/commands.mjs';

/** What the retired dashboard switch sent, so an untouched selector behaves as it always has. */
export const DEFAULT_SETPOINT_C = 25;

/** Every whole degree the hardware can be told, ascending. */
export function setpointOptions(): number[] {
  const out: number[] = [];
  for (let c = ACU_MIN_C; c <= ACU_MAX_C; c++) out.push(c);
  return out;
}

/**
 * Where the selector opens: the ACU's own last known setpoint when that is a legal option, so
 * the control shows where the room actually is rather than a fixed guess.
 *
 * Simpler than it was. The old version had to fall back when the unit sat below a floor the
 * server would refuse; with no such refusal left, any hardware-legal last-known value is a fine
 * place to open.
 */
export function seedSetpoint(lastKnownC: number | null | undefined): number {
  if (typeof lastKnownC === 'number' && Number.isFinite(lastKnownC)) {
    const rounded = Math.round(lastKnownC);
    if (rounded >= ACU_MIN_C && rounded <= ACU_MAX_C) return rounded;
  }
  return DEFAULT_SETPOINT_C;
}

/**
 * What to tell somebody choosing a setpoint below the building's room-comfort policy.
 *
 * Returns null when there is nothing to say — no policy, or a choice at or above it. The text
 * deliberately explains what the number IS, because its meaning changed: an operator who
 * remembers it as "the coldest you may set" needs to be told it is now about the room.
 */
export function setpointWarning(chosenC: number, roomTargetFloorC: number | null | undefined): string | null {
  if (typeof roomTargetFloorC !== 'number' || chosenC >= roomTargetFloorC) return null;
  return `Below this building's ${roomTargetFloorC}°C room-comfort policy. This is allowed, and it is recorded in the command audit trail.`;
}
