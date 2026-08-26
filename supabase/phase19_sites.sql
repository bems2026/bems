-- RM-027: site identity.
--
-- WHY THIS EXISTS: nothing in this system knew which building it was. `dsm_thresholds` was a
-- singleton behind `check (id = 1)` with the comment "One building, one Pi"; `ingestion_health`
-- the same; `building_totals` was keyed by `ts` alone. Two deployments could not share a
-- project, and neither could be told apart in an export.
--
-- Each site still runs its own Pi and its own stack — that part of the original design stands.
-- What this table changes is that the rows become ATTRIBUTABLE, so a shared project later is a
-- configuration change rather than a second migration against tables holding real data.
--
-- Apply once, by hand, in the Supabase SQL editor — there is no migration runner in this repo,
-- same convention as every phase file before it. Re-running is safe: the table create is
-- guarded and the seed is `on conflict do nothing`. Re-running `create policy` will error;
-- drop the policy first if you need to re-apply.
--
-- Apply BEFORE supabase/phase20_site_scoping.sql, whose foreign keys target this table.

create table if not exists sites (
  -- A slug, not a uuid. It appears in `shared/sites/<id>/`, in log lines and in exports, and a
  -- human has to be able to match those up without a lookup.
  id                 text primary key,
  display_name       text not null,

  -- IANA zone. Consumed by the monthly report's day-grouping (`p_tz` in
  -- supabase/phase12_monthly_reports.sql), which is what makes a daily energy figure land in
  -- the right day.
  timezone           text not null,

  -- Minutes east of UTC. Redundant with `timezone` DELIBERATELY: the payload transform runs
  -- inside a Node-RED function node with no imports and no guaranteed full-ICU build, so it
  -- needs a plain number rather than a zone name. `test/site-config.test.mjs` measures the zone
  -- at two instants six months apart and asserts the two agree, which is what makes carrying
  -- one fact twice safe rather than merely convenient.
  utc_offset_minutes integer not null,

  -- Operating rules for the building: setpoint floors, office hours, and whatever the next site
  -- turns out to need. jsonb rather than columns because these are the OPERATOR's rules, not
  -- the schema's, and adding one must never require a migration on a table this central.
  --
  -- `acu_min_setpoint_c` is the first: the coldest aircon setpoint this building permits, from
  -- the university's energy-efficiency policy. Note it is NOT the same fact as `ACU_MIN_C` in
  -- shared/commands.mjs, which is what the IR library has codes for — a hardware bound that is
  -- identical everywhere. The policy narrows the hardware range; it can never widen it.
  policy             jsonb not null default '{}'::jsonb,

  created_at         timestamptz not null default now()
);

alter table sites enable row level security;

-- Read-only from the browser, the same access model `devices` has. Rows are written by hand or
-- by the provisioner (RM-033) through the service role, which bypasses RLS entirely — so no
-- insert/update policy is granted to `authenticated` on purpose: a signed-in user should not be
-- able to retarget a whole deployment. No anon policy; phase 5 dropped every one of those and
-- none comes back.
create policy sites_select_authenticated on sites
  for select using (auth.role() = 'authenticated');

-- The current deployment. Must stay in step with `shared/sites/mmsu-nberic-care/site.mjs`;
-- `test/phase19-sites-schema.test.mjs` reads that module and fails if the two drift.
insert into sites (id, display_name, timezone, utc_offset_minutes, policy)
values (
  'mmsu-nberic-care',
  'MMSU CARE Office / NBERIC',
  'Asia/Manila',
  480,
  '{"acu_min_setpoint_c": 25}'::jsonb
)
on conflict (id) do nothing;
