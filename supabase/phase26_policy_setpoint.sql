-- RM-038: the aircon floor becomes a setting somebody can change, instead of a build constant.
--
-- REQUIRES supabase/phase19_sites.sql (the `sites` table and its `policy` jsonb).
--
-- WHAT WAS WRONG. `policy.acu_min_setpoint_c` is the coldest setpoint the building permits, and
-- it comes from the university's energy-efficiency policy. A university policy changes; this one
-- was compiled into the frontend bundle AND read by the proxy from `shared/sites/<id>/site.mjs`,
-- so changing it meant editing a source file, rebuilding and redeploying. That is a code change
-- standing in for an administrative decision.
--
-- WHY A FUNCTION AND NOT AN UPDATE POLICY. This is the decision worth defending.
--
-- phase19 grants `sites` SELECT to authenticated and deliberately no INSERT or UPDATE, because
-- "a signed-in user should not be able to retarget a whole deployment". That reasoning still
-- holds: the same `policy` jsonb also carries `dispatch`, which decides whether commands may
-- leave the building for the vendor cloud. Postgres RLS is row-level, not key-level, so an
-- UPDATE policy narrow enough to permit the setpoint and refuse the dispatch mode cannot be
-- written. A `security definer` function CAN: it touches one key and nothing else, and every
-- other column and key stays exactly as unwritable as phase19 made it.
--
-- WHAT THIS DOES NOT DO. It is not the enforcement. `validateCommand` in shared/commands.mjs is,
-- and it applies the HARDWARE bound (`ACU_MIN_C` = 16, `ACU_MAX_C` = 30 — the whole degrees the
-- IR library actually holds codes for) after the policy floor, so no value written here can ever
-- widen the range beyond what the hardware can be told to do. The bound below is a sanity check
-- on a number a person typed, not a second authority.
--
-- Apply once, by hand, in the Supabase SQL editor. Rehearse with supabase/rehearse.sh first.
--
-- RE-RUNNING IS SAFE. `add column if not exists` guards itself, `create or replace function`
-- replaces, and the grants are idempotent. `test/migration-idempotency.test.mjs` fails any file
-- that makes this promise without earning it.

-- Who changed it and when. A policy floor without attribution is a number that appeared: this
-- table had no audit columns because nothing could write to it, and now something can.
alter table sites add column if not exists policy_updated_at timestamptz;
alter table sites add column if not exists policy_updated_by uuid;

comment on column sites.policy_updated_at is
  'When policy.acu_min_setpoint_c was last changed through set_acu_min_setpoint. NULL means it has only ever been what the site file seeded.';
comment on column sites.policy_updated_by is
  'auth.uid() of whoever last changed the setpoint floor. NULL for the seeded value, or for a change made through the service role.';

-- =============================================================================
-- set_acu_min_setpoint — change one key of one site's policy, and nothing else.
-- =============================================================================
create or replace function public.set_acu_min_setpoint(
  p_site_id text,
  p_floor_c int
)
returns table (site_id text, acu_min_setpoint_c int, updated_at timestamptz)
language plpgsql
volatile
-- SECURITY DEFINER so an authenticated caller can write one key of a table that is otherwise
-- read-only to them. `search_path` is pinned because a definer function that resolves objects
-- through the caller's path is how privilege escalation gets written by accident.
security definer
set search_path = public
as $fn$
declare
  updated sites%rowtype;
begin
  -- NULL is a legitimate value and means "no policy floor — the hardware bound alone applies".
  -- It is not the same as 16, which would be a floor that happens to coincide with the hardware
  -- minimum today and would stop tracking it if the IR library ever gained a colder code.
  if p_floor_c is not null and (p_floor_c < 16 or p_floor_c > 30) then
    raise exception 'acu_min_setpoint_c must be between 16 and 30, or null; got %', p_floor_c
      using errcode = 'check_violation';
  end if;

  update sites s
     set policy = case
                    when p_floor_c is null then s.policy - 'acu_min_setpoint_c'
                    else jsonb_set(s.policy, '{acu_min_setpoint_c}', to_jsonb(p_floor_c), true)
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
           (updated.policy ->> 'acu_min_setpoint_c')::int,
           updated.policy_updated_at;
end;
$fn$;

-- `public` includes anon. The gate this function exists behind is a signed-in session, the same
-- one every other write in this schema requires.
revoke execute on function public.set_acu_min_setpoint(text, int) from public;
grant  execute on function public.set_acu_min_setpoint(text, int) to authenticated;
grant  execute on function public.set_acu_min_setpoint(text, int) to service_role;
