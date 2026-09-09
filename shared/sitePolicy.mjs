/**
 * Reading the site policy, in the one place that knows what its keys mean.
 *
 * WHY THIS EXISTS — RM-068 redefined a number without moving it. `acu_min_setpoint_c` used to
 * be a bound on the SETPOINT COMMANDED to the aircon: `validateCommand` refused anything below
 * it, and the Control page's selector simply did not offer those degrees. That reading was
 * always slightly wrong about the building, and it became load-bearing wrong once RM-069's
 * closed-loop controller arrived: the setpoint is the CONTROL LEVER, and a loop that may never
 * ask for 22 cannot hold a room at 24 on a hot afternoon.
 *
 * So the number now means the coldest ROOM TEMPERATURE the building permits an automatic rule
 * to aim for, and the setpoint is free across the hardware range 16..30. Once it means that,
 * `acu_min_setpoint_c` actively misdescribes itself, so the key is renamed
 * `acu_min_room_target_c`.
 *
 * EXPAND AND CONTRACT, because migrations are hand-applied here and code deploys are a separate
 * act (CLAUDE.md) — either can be late, in either order:
 *
 *   phase35 COPIES the value to the new key and leaves both present, and redefines the old
 *     writer to delegate so an un-refreshed browser tab cannot write only the stale one;
 *   this function reads NEW KEY FIRST, OLD KEY AS FALLBACK, so a bundle deployed before the
 *     migration still finds the number;
 *   a later, separate migration removes the old key once every deployed bundle and daemon
 *     reads the new one.
 *
 * At no point in that sequence is neither key readable, which is the property the whole shape
 * exists to buy.
 */

/**
 * The coldest ROOM TARGET this site permits an automatic rule to aim for, or null when the site
 * declares no such rule.
 *
 * Not a bound on a commanded setpoint. `shared/commands.mjs` keeps `ACU_MIN_C`/`ACU_MAX_C` as
 * the only hard bound on that, and those are a hardware fact — the degrees the IR library holds
 * codes for — identical at every site.
 */
export function roomTargetFloorC(policy) {
  const v = policy?.acu_min_room_target_c ?? policy?.acu_min_setpoint_c;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Whether a manually chosen setpoint is below the building's room-comfort policy.
 *
 * A WARNING, NOT A REFUSAL, and that is the decision RM-068 records. The old behaviour refused
 * the command server-side; an operator who genuinely needs 18 °C for an hour then has no way to
 * ask for it, and the number they are fighting is one about the ROOM rather than about the
 * knob. The refusal is replaced by a warning the UI shows and the audit trail records — so the
 * fact is not lost, it is attributed.
 *
 * @returns {{code: string, floor: number, detail: string}|null}
 */
export function setpointPolicyWarning(targetC, policy) {
  const floor = roomTargetFloorC(policy);
  if (typeof targetC !== 'number' || floor === null || targetC >= floor) return null;
  return {
    code: 'below_room_comfort_policy',
    floor,
    detail: `${targetC}°C is below this building's ${floor}°C room-comfort policy`,
  };
}
