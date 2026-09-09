/**
 * Changing this building's room-comfort policy — RM-038, redefined by RM-061.
 *
 * WHY AN RPC AND NOT AN UPDATE. `sites` grants SELECT to authenticated and deliberately no
 * UPDATE (phase19), because the same row decides whether commands may leave the building for a
 * vendor cloud. Postgres RLS is row-level, so a policy narrow enough to permit the setpoint and
 * refuse the dispatch mode cannot be written; `set_acu_min_setpoint`
 * (supabase/phase26_policy_setpoint.sql) is a `security definer` function that touches one key.
 *
 * WHAT THIS NUMBER IS. Since RM-061 it is the coldest ROOM TEMPERATURE this building permits an
 * automatic rule to aim for — not a bound on the setpoint commanded to the aircon. It is
 * enforced where rules are written (`upsert_acu_rule`) and where the closed loop decides
 * (`server/acuLoopPlan.mjs`). A MANUAL setpoint below it is no longer refused: `validateCommand`
 * returns a warning, the Control page shows it, and `server/proxy.mjs` writes it into the
 * command audit note. The only hard bound on a command remains `ACU_MIN_C`/`ACU_MAX_C`, which is
 * a hardware fact.
 *
 * READING is deliberately NOT here. The floor in force comes from `/api/capabilities`, because
 * that is the number the next command will actually be validated against — including when the
 * proxy has fallen back to its build value during a database outage. Reading `sites` directly
 * would report what is stored rather than what applies.
 */

import { supabase } from '@/config/supabase';
import { SITE } from '@shared/siteConfig.mjs';

/** The whole degrees the IR library holds codes for. A room target outside them is not
 * reachable by any command, so it would be a rule that can never be satisfied. Mirrors
 * `ACU_MIN_C`/`ACU_MAX_C` in `shared/commands.mjs` and the check inside the SQL function — three
 * places, because each is a different layer's own refusal and none may assume another ran. */
export const FLOOR_MIN_C = 16;
export const FLOOR_MAX_C = 30;

export function isValidFloor(value: number | null): boolean {
  if (value === null) return true;
  return Number.isInteger(value) && value >= FLOOR_MIN_C && value <= FLOOR_MAX_C;
}

/**
 * Sets the floor, or clears it with `null`.
 *
 * `null` is a real choice and means "no policy floor — the hardware bound alone applies". It is
 * not the same as 16: that would be a floor that happens to coincide with the hardware minimum
 * today and would stop tracking it if the IR library ever gained a colder code.
 */
export async function setAcuMinRoomTarget(floorC: number | null): Promise<number | null> {
  if (supabase === null) throw new Error('Supabase is not configured — the setpoint floor is stored there.');
  if (!isValidFloor(floorC)) {
    throw new Error(`The floor must be a whole number between ${FLOOR_MIN_C} and ${FLOOR_MAX_C}, or empty.`);
  }
  // phase35's function. The pre-RM-061 `set_acu_min_setpoint` still exists and delegates here,
  // so a browser tab holding the old bundle keeps working for the length of the rename window.
  const { data, error } = await supabase.rpc('set_acu_min_room_target', {
    p_site_id: SITE.id,
    p_target_c: floorC,
  });
  if (error) throw new Error(error.message);
  // The function returns one row. A shape that is not that means the migration in the database
  // is not the one this build expects, which is worth saying rather than coercing past.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') throw new Error('set_acu_min_room_target returned nothing');
  const applied = (row as { acu_min_room_target_c?: unknown }).acu_min_room_target_c;
  return typeof applied === 'number' ? applied : null;
}
