-- Phase 35: `acu_min_setpoint_c` becomes `acu_min_room_target_c` — RM-068.
--
-- WHAT THE NUMBER MEANT, AND WHAT IT MEANS NOW. It was a bound on the setpoint COMMANDED to the
-- aircon: `validateCommand` refused anything below it with 400 `below_policy_floor`, and the
-- Control page simply did not offer those degrees. That reading became untenable once the
-- setpoint stopped being the thing a person sets and became the CONTROL LEVER a closed loop
-- moves (RM-069) — a loop that may never ask for 22 cannot hold a room at 24 on a hot afternoon,
-- and a person who genuinely needs 18 for an hour had no way to ask.
--
-- It now means the coldest ROOM TEMPERATURE this building permits an automatic rule to aim for.
-- The setpoint is bounded only by `ACU_MIN_C`/`ACU_MAX_C` (16..30), which is a hardware fact —
-- the degrees the IR library holds codes for. A manual setpoint below the comfort policy is
-- warned about and written into the command audit note, not refused.
--
-- EXPAND AND CONTRACT, IN THREE STEPS, AND THIS FILE IS ONLY THE FIRST TWO.
-- Migrations here are applied by hand and code deploys are a separate act, so either can be
-- late, in either order. This file COPIES the value and leaves both keys present, and redefines
-- the old writer to delegate to the new one so an un-refreshed browser tab cannot write only the
-- stale key. `shared/sitePolicy.mjs` reads new-then-old. A LATER, SEPARATE migration removes the
-- old key and drops `set_acu_min_setpoint` — only once every deployed bundle and daemon reads
-- the new one. At no point is neither key readable, which is the whole point of the shape.
--
-- ALSO DROPS `dsm_thresholds.care_acu_trigger_c`. It backed an "Ambient Trigger Setpoint" slider
-- on the Automation page that NOTHING on the server ever read — a whole-repo grep found it in
-- the browser, in one mapping file and in two mock-bridge key tests, and in no `server/` file at
-- all. The value round-tripped browser -> Supabase -> browser for months and acted on nothing.
-- RM-069's real controller replaces it.
--
-- Apply once, by hand, in the Supabase SQL editor.
--
-- RE-RUNNING IS SAFE: the copy is `where not (policy ? ...)`-guarded, the functions are
-- `create or replace`, the column drop is `if exists`, and every grant is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Copy, do not move. Both keys present and equal, so a bundle or daemon of either vintage
--    reads a correct number for the length of the rename window.
-- ---------------------------------------------------------------------------
update sites
   set policy = jsonb_set(policy, '{acu_min_room_target_c}', policy -> 'acu_min_setpoint_c', true)
 where policy ? 'acu_min_setpoint_c'
   and not (policy ? 'acu_min_room_target_c');

-- ---------------------------------------------------------------------------
-- 2. The new writer.
--
--    SECURITY DEFINER for the reason phase26 already argues: RLS is row-level, not key-level,
--    so a policy that permits writing THIS key and refuses the rest of `sites.policy` cannot be
--    expressed. The function is the narrow door, and `search_path` is pinned because a definer
--    function resolving objects through the caller's path is how privilege escalation gets
--    written by accident.
--
--    It writes BOTH keys while the rename window is open, so the two cannot drift apart under
--    an operator who changes the value before every reader has been updated.
-- ---------------------------------------------------------------------------
create or replace function public.set_acu_min_room_target(
  p_site_id text,
  p_target_c int
)
returns table (site_id text, acu_min_room_target_c int, updated_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  updated sites%rowtype;
begin
  -- Bounded by the hardware range even though this is a statement about the ROOM: a target
  -- outside the degrees the IR library can express is not reachable by any command, so
  -- accepting it would be accepting a rule that can never be satisfied.
  --
  -- NULL is a legitimate value and means "no policy — the hardware bound alone applies". It is
  -- not the same as 16, which would be a target that happens to coincide with the hardware
  -- minimum today and would stop tracking it if the IR library ever gained a colder code.
  if p_target_c is not null and (p_target_c < 16 or p_target_c > 30) then
    raise exception 'acu_min_room_target_c must be between 16 and 30, or null; got %', p_target_c
      using errcode = 'check_violation';
  end if;

  update sites s
     set policy = case
                    when p_target_c is null
                      then (s.policy - 'acu_min_room_target_c') - 'acu_min_setpoint_c'
                    else jsonb_set(
                           jsonb_set(s.policy, '{acu_min_room_target_c}', to_jsonb(p_target_c), true),
                           '{acu_min_setpoint_c}', to_jsonb(p_target_c), true)
                  end,
         policy_updated_at = now(),
         -- NULL under the service role, which has no auth.uid(). That is honest: a change made
         -- by a daemon was not made by a person.
         policy_updated_by = auth.uid()
   where s.id = p_site_id
  returning * into updated;

  if not found then
    raise exception 'no site %', p_site_id using errcode = 'no_data_found';
  end if;

  return query
    select updated.id,
           (updated.policy ->> 'acu_min_room_target_c')::int,
           updated.policy_updated_at;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 3. The OLD writer is REDEFINED, not dropped, and KEEPS ITS RETURN TYPE.
--
--    A browser tab still holding the pre-RM-068 bundle calls this one. Dropping it would break
--    that tab; leaving it writing only the stale key would let the two keys drift. Delegating
--    does neither.
--
--    The signature is reproduced exactly, including the column names, because
--    `create or replace function` CANNOT change a return type — Postgres refuses with "cannot
--    change return type of existing function", and this migration would abort at this
--    statement having already copied the key. Verified against phase26 rather than assumed.
-- ---------------------------------------------------------------------------
create or replace function public.set_acu_min_setpoint(
  p_site_id text,
  p_floor_c int
)
returns table (site_id text, acu_min_setpoint_c int, updated_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $fn$
begin
  return query
    select r.site_id, r.acu_min_room_target_c, r.updated_at
      from public.set_acu_min_room_target(p_site_id, p_floor_c) as r;
end;
$fn$;

revoke execute on function public.set_acu_min_room_target(text, int) from public;
grant execute on function public.set_acu_min_room_target(text, int) to authenticated, service_role;
revoke execute on function public.set_acu_min_setpoint(text, int) from public;
grant execute on function public.set_acu_min_setpoint(text, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Retire the dead ambient trigger. See the header.
-- ---------------------------------------------------------------------------
alter table dsm_thresholds drop column if exists care_acu_trigger_c;

comment on function public.set_acu_min_room_target(text, int) is
  'Sets the coldest ROOM TEMPERATURE this site permits an automatic rule to aim for. NOT a bound '
  'on the setpoint commanded to the aircon - that is ACU_MIN_C/ACU_MAX_C in shared/commands.mjs, '
  'a hardware fact. Writes the legacy acu_min_setpoint_c key too for the length of the RM-068 '
  'rename window.';
