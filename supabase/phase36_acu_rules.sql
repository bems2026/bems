-- Phase 36: closed-loop aircon control — RM-062.
--
-- WHAT THIS REPLACES. An "Ambient Trigger Setpoint" slider on the Automation page wrote
-- `dsm_thresholds.care_acu_trigger_c`, and NOTHING on the server ever read it: the value
-- round-tripped browser -> Supabase -> browser for months and acted on nothing. phase35 drops
-- that column. This is the real thing.
--
-- WHAT IT DOES. An operator sets a ROOM TEMPERATURE target and names a sensor to read. The
-- controller compares the sensor against the target and steps the aircon's SETPOINT — one
-- degree at a time, rate-limited — until the room reaches the target. The setpoint is the lever,
-- not the goal; that distinction is what RM-061 renamed `acu_min_setpoint_c` to record.
--
-- WHAT IT DELIBERATELY CANNOT DO, and the whole safety posture in one line:
--
--   IT MAY CHANGE HOW COLD A RUNNING AIRCON IS ASKED TO BE.
--   IT MAY NEVER CHANGE WHETHER THE BUILDING IS BEING COOLED.
--
-- No branch in `server/acuLoopPlan.mjs` emits an `off`, and none acts unless the unit already
-- reports `on`. Losing the loop leaves the unit running at its last setpoint; a runaway loop
-- cannot leave the building without cooling. That is the aircon equivalent of "auto-shed sheds,
-- it never restores".
--
-- IT SHIPS DORMANT ON THIS SITE. `acu_main` and `sens_outside_temp` have never been paired to
-- the vendor account (RM-016), so every rule will correctly hold on `acu_offline` until they
-- are. That is not a reason to withhold it — it is a reason the planner reports WHY it is idle.
--
-- Apply once, by hand, in the Supabase SQL editor. Apply phase35 first: this file's policy check
-- reads `acu_min_room_target_c`.
--
-- RE-RUNNING IS SAFE. Every table, column and index is guarded, each policy is dropped before it
-- is created, every constraint is dropped before it is added, and the functions are
-- `create or replace`.

-- ---------------------------------------------------------------------------
-- 1. `commands.target_c` — what a setpoint command actually asked for.
--
--    `target` on this table resolves to the literal 'AC_POWER' for an aircon and the scheduler
--    writes NULL into it, so a row recording a setpoint change has, today, no field saying which
--    setpoint. For a loop writing dozens of rows a day that is the entire content of the row.
--
--    Nullable, no backfill: a pre-migration row genuinely does not know, and inventing a value
--    for it would be worse than the gap. Same reasoning phase18 gives for `via`.
-- ---------------------------------------------------------------------------
alter table commands add column if not exists target_c smallint;
alter table commands drop constraint if exists commands_target_c_range;
alter table commands
  add constraint commands_target_c_range
  check (target_c is null or (target_c >= 16 and target_c <= 30));

comment on column commands.target_c is
  'The aircon setpoint this command asked for, in whole degrees. NULL for every command that is '
  'not a setpoint, and for rows written before phase36. Bounded by the IR library range, which '
  'is a hardware fact rather than a policy.';

-- `source` has no CHECK and deliberately never has — see schema.sql. So `acu_loop` needs no
-- migration; this only keeps the column comment from being incomplete.
comment on column commands.source is
  'Who asked: ''ibems-app'' (a person), ''schedule'', ''dsm_autoshed'', ''acu_loop''. Free text '
  'on purpose: adding a value here must never require a migration on a table this safety-critical.';

-- ---------------------------------------------------------------------------
-- 2. `acu_rules` — one closed-loop rule.
-- ---------------------------------------------------------------------------
create table if not exists acu_rules (
  id                  uuid primary key default gen_random_uuid(),

  -- Which site's policy bounds `target_c`. Defaulted for the same transitional reason phase20
  -- records: the daemons already running do not send one.
  site_id             text not null references sites(id) default 'mmsu-nberic-care',

  -- The unit to command and the thing to read. They MAY BE THE SAME DEVICE: `acu_main` reports
  -- `roomTemp` in its flow context, so a loop can close on the blaster's own return-air reading.
  -- That is legal and it is not the same as a room temperature — `shared/temperatureSources.mjs`
  -- carries the caveat and the rule editor states it where the choice is made.
  acu_device_id       text not null references devices(id) on delete cascade,
  sensor_device_id    text not null references devices(id) on delete cascade,

  -- The ROOM temperature the operator wants. NOT the setpoint: the setpoint is what the loop
  -- computes, and the loop alone owns it.
  target_c            numeric(4,1) not null check (target_c >= 16 and target_c <= 30),

  -- Half-width of the hold band. Above target+deadband step down, below target-deadband step up,
  -- inside it hold.
  deadband_c          numeric(3,1) not null default 0.5 check (deadband_c > 0 and deadband_c <= 5),
  step_c              int  not null default 1 check (step_c between 1 and 5),

  -- THE RATE LIMIT, and the single most important number here. A room takes minutes to respond;
  -- stepping faster than it responds is how a controller hunts instead of settling.
  min_step_interval_s int  not null default 600 check (min_step_interval_s >= 60),

  -- How long a command from anyone else suppresses this loop. It must cover a SCHEDULE too, not
  -- just a person: sending "set 23" to a unit a schedule has just switched off will, on many IR
  -- libraries, turn it back on.
  manual_hold_s       int  not null default 600 check (manual_hold_s >= 60),

  -- The active window, in the site's local time, in the SAME encoding schedules use so there is
  -- one convention in this database rather than two. days[0] is MONDAY; `Date.getDay()` is
  -- Sunday-first and the conversion is a rotation that lives only in `appDayIndex`.
  days                text not null check (days ~ '^[01]{7}$'),
  window_start        text not null check (window_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  window_end          text not null check (window_end   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- A window never wraps midnight. `22:00 -> 06:00` is refused here and reported by the planner
  -- rather than silently spanned: guessing which of the two readings an operator meant is how a
  -- controller ends up running all night on a rule that reads like an evening one.
  constraint acu_rules_window_forward check (window_end > window_start),

  label               text check (label is null or char_length(label) <= 60),

  -- OFF BY DEFAULT. A rule that starts armed is a rule that acts before anyone has read it.
  enabled             boolean not null default false,

  -- The sub-policy override. A target below the site's room-comfort policy is permitted only
  -- with a written reason, and the reason is not decoration — it IS the audit.
  --
  -- The comparison itself cannot be a CHECK: the policy lives in `sites.policy`, another table.
  -- It is enforced by `upsert_acu_rule` below. What IS enforceable here is that the three
  -- override columns arrive together or not at all.
  override_reason     text check (override_reason is null or char_length(override_reason) between 10 and 500),
  override_by         uuid references auth.users(id),
  override_at         timestamptz,
  constraint acu_rules_override_complete check (
    (override_reason is null and override_by is null and override_at is null)
    or (override_reason is not null and override_by is not null and override_at is not null)
  ),

  -- Same attribution rule as `schedules`: no actor, no command. `commands.requested_by` is NOT
  -- NULL and a fabricated user in the audit table is worse than a gap.
  updated_by          uuid not null references auth.users(id),
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists acu_rules_enabled_idx on acu_rules (acu_device_id) where enabled;

-- ---------------------------------------------------------------------------
-- 3. `acu_loop_state` — what the controller remembers between ticks.
--
--    THIS IS A TABLE AND NOT A VARIABLE, and the reason is specific rather than tidy.
--    `server/ibems-scheduler.service` runs with `Restart=on-failure` and `RestartSec=10`. With
--    the last-step time held only in memory, a crash loop re-arms the rate limiter every ten
--    seconds and walks the setpoint from 30 to 16 in two and a half minutes, with nothing in the
--    way. Persisting it is what makes the rate limit a rate limit.
--
--    It is also readable by the page, which is the second reason: "holding at 22 °C, last
--    stepped 4 minutes ago" is the sentence that makes an idle loop legible.
-- ---------------------------------------------------------------------------
create table if not exists acu_loop_state (
  rule_id           uuid primary key references acu_rules(id) on delete cascade,

  -- The setpoint the controller BELIEVES it last commanded. Not read back from the device:
  -- `ac_dash_state.setTemp` comes from the IR blaster, which on this site has never paired, so
  -- `setpoint_c` is absent from `acu_main`'s reading entirely. Without a remembered value there
  -- is no base to step from — and the planner refuses to invent one.
  commanded_c       int  check (commanded_c is null or commanded_c between 16 and 30),

  -- The columns that make this table worth existing. See the note above.
  last_step_at      timestamptz,
  last_direction    text check (last_direction is null or last_direction in ('up','down')),

  last_reason       text,
  last_evaluated_at timestamptz,

  -- Edge-triggered alerting, the same shape `server/fleetAlarm.mjs` uses and for the same
  -- reason: a level-triggered condition would re-notify every tick until somebody muted it,
  -- which is how alerting gets switched off entirely.
  alert_kind        text check (alert_kind is null or alert_kind in
                      ('floor_reached','ceiling_reached','sensor_unavailable','target_below_policy')),
  alert_since       timestamptz,

  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. RLS.
--
--    `acu_rules` grants SELECT and DELETE to authenticated and NO insert or update policy at
--    all. Every field change goes through the two functions below, for the reason
--    phase26_policy_setpoint.sql already argues: RLS is row-level, not key-level, and
--    `WITH CHECK` cannot see OLD — so a policy narrow enough to permit an in-policy target and
--    refuse a sub-policy one without a reason simply cannot be written.
--
--    `acu_loop_state` is written by the daemon with the service-role key, which bypasses RLS.
--    Same posture as `readings`, `anomalies` and `building_totals`.
-- ---------------------------------------------------------------------------
alter table acu_rules enable row level security;
alter table acu_loop_state enable row level security;

drop policy if exists acu_rules_select_authenticated on acu_rules;
create policy acu_rules_select_authenticated on acu_rules
  for select using (auth.role() = 'authenticated');

drop policy if exists acu_rules_delete_authenticated on acu_rules;
create policy acu_rules_delete_authenticated on acu_rules
  for delete using (auth.role() = 'authenticated');

drop policy if exists acu_loop_state_select_authenticated on acu_loop_state;
create policy acu_loop_state_select_authenticated on acu_loop_state
  for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 5. The one door rules are written through.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_acu_rule(
  p_id                  uuid,
  p_acu_device_id       text,
  p_sensor_device_id    text,
  p_target_c            numeric,
  p_deadband_c          numeric,
  p_step_c              int,
  p_min_step_interval_s int,
  p_manual_hold_s       int,
  p_days                text,
  p_window_start        text,
  p_window_end          text,
  p_enabled             boolean,
  p_label               text,
  p_override_reason     text,
  p_site_id             text default 'mmsu-nberic-care'
)
returns acu_rules
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_floor numeric;
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_override_reason, '')), '');
  v_row acu_rules;
begin
  -- No actor, no rule. The planner attributes every command it fires to whoever saved the rule
  -- and skips any row without one, so a rule saved unattributed would sit on the page looking
  -- armed and never act.
  if v_actor is null then
    raise exception 'a rule must be saved by a signed-in user: an unattributed rule would never fire'
      using errcode = 'check_violation';
  end if;

  -- The policy in force, new key preferred and the pre-RM-061 key as the fallback — the same
  -- expand-and-contract window `shared/sitePolicy.mjs` reads through. A site with neither key
  -- has no policy.
  select coalesce((policy ->> 'acu_min_room_target_c')::numeric,
                  (policy ->> 'acu_min_setpoint_c')::numeric)
    into v_floor
    from sites where id = p_site_id;

  -- A target below the building's room-comfort policy is PERMITTED, but only on the record.
  -- Refusing outright would leave a genuine exception — a server rack, a clinic — with no way to
  -- ask; permitting silently would make the policy decorative.
  if v_floor is not null and p_target_c < v_floor and v_reason is null then
    raise exception
      'a room target of %C is below this site''s %C room-comfort policy; record a written reason (at least 10 characters) to set it anyway',
      p_target_c, v_floor using errcode = 'check_violation';
  end if;

  insert into acu_rules as r (
    id, site_id, acu_device_id, sensor_device_id, target_c, deadband_c, step_c,
    min_step_interval_s, manual_hold_s, days, window_start, window_end, enabled, label,
    override_reason, override_by, override_at, updated_by, updated_at
  )
  values (
    coalesce(p_id, gen_random_uuid()), p_site_id, p_acu_device_id, p_sensor_device_id,
    p_target_c, coalesce(p_deadband_c, 0.5), coalesce(p_step_c, 1),
    coalesce(p_min_step_interval_s, 600), coalesce(p_manual_hold_s, 600),
    p_days, p_window_start, p_window_end, coalesce(p_enabled, false), p_label,
    v_reason,
    case when v_reason is null then null else v_actor end,
    case when v_reason is null then null else now() end,
    v_actor, now()
  )
  on conflict (id) do update
    set acu_device_id       = excluded.acu_device_id,
        sensor_device_id    = excluded.sensor_device_id,
        target_c            = excluded.target_c,
        deadband_c          = excluded.deadband_c,
        step_c              = excluded.step_c,
        min_step_interval_s = excluded.min_step_interval_s,
        manual_hold_s       = excluded.manual_hold_s,
        days                = excluded.days,
        window_start        = excluded.window_start,
        window_end          = excluded.window_end,
        enabled             = excluded.enabled,
        label               = excluded.label,
        override_reason     = excluded.override_reason,
        -- Re-stamped whenever the reason changes, cleared with it. An override attributed to
        -- whoever first wrote one, on a reason somebody else later replaced, would be a lie in
        -- the one field that exists to be trustworthy.
        override_by         = excluded.override_by,
        override_at         = excluded.override_at,
        updated_by          = excluded.updated_by,
        updated_at          = now()
  returning r.* into v_row;

  return v_row;
end;
$fn$;

/* Arming and disarming, separately: it is the one change an operator makes often, and routing
   it through the full upsert would mean re-sending every field to flip one boolean. */
create or replace function public.set_acu_rule_enabled(p_id uuid, p_enabled boolean)
returns acu_rules
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_row acu_rules;
begin
  if auth.uid() is null then
    raise exception 'a rule must be armed by a signed-in user' using errcode = 'check_violation';
  end if;
  update acu_rules
     set enabled = p_enabled, updated_by = auth.uid(), updated_at = now()
   where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'no acu rule %', p_id using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$fn$;

revoke execute on function public.upsert_acu_rule(uuid, text, text, numeric, numeric, int, int, int, text, text, text, boolean, text, text, text) from public;
grant execute on function public.upsert_acu_rule(uuid, text, text, numeric, numeric, int, int, int, text, text, text, boolean, text, text, text) to authenticated, service_role;
revoke execute on function public.set_acu_rule_enabled(uuid, boolean) from public;
grant execute on function public.set_acu_rule_enabled(uuid, boolean) to authenticated, service_role;

comment on table acu_rules is
  'Closed-loop aircon rules — RM-062. The operator sets a ROOM temperature target and a sensor; '
  'the controller steps the aircon SETPOINT toward it. Setpoint-only: no rule can power a unit '
  'on or off. Written only through upsert_acu_rule / set_acu_rule_enabled.';

comment on table acu_loop_state is
  'What the controller remembers between ticks. Persisted rather than held in memory because '
  'the daemon restarts on failure every 10s, and an in-memory last-step time would let a crash '
  'loop walk the setpoint from 30 to 16 in under three minutes.';
