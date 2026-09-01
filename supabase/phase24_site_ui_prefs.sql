-- RM-035: which optional cards a site shows.
--
-- REQUIRES supabase/phase19_sites.sql (every row belongs to a site).
--
-- WHY A SIBLING TABLE AND NOT A COLUMN ON `sites`. This is the whole design decision, so it is
-- worth stating rather than leaving to be rediscovered.
--
-- `sites` is deliberately read-only from the browser. phase19_sites.sql says so outright: "no
-- insert/update policy is granted to `authenticated` on purpose: a signed-in user should not be
-- able to retarget a whole deployment." That row also carries `policy.acu_min_setpoint_c` — the
-- university's energy-efficiency floor, which `shared/commands.mjs` validates SERVER-SIDE so
-- that a request bypassing the dashboard is refused too.
--
-- PostgreSQL's RLS is row-level, not column-level. An UPDATE policy admitting a display
-- preference admits the aircon floor, the timezone, the UTC offset and the site's identity in
-- the same breath. Column privileges could narrow it, but that is a subtler mechanism guarding
-- a boundary another file went out of its way to draw — and the wrong place to be subtle.
--
-- So: the operator-writable sibling of a read-only table, which is exactly what `device_config`
-- already is to `devices`. That pattern exists here and is the reason this is the right shape
-- rather than merely a way around the problem.
--
-- Apply once, by hand, in the Supabase SQL editor. Rehearse with supabase/rehearse.sh first.
--
-- RE-RUNNING IS SAFE. `create table if not exists` guards itself and every policy is dropped
-- before it is created — PostgreSQL has no `create policy if not exists`, the gap that made
-- phase21 a scar. `test/migration-idempotency.test.mjs` fails any file that makes this promise
-- without earning it.

create table if not exists site_ui_prefs (
  -- One row per site, so the primary key IS the site. Not a surrogate id with a unique index:
  -- supabase-js's upsert() generates `ON CONFLICT (site_id) DO UPDATE` and Postgres only matches
  -- that against an unconditional unique constraint — phase6_schedules_unique_fix.sql is this
  -- project's scar from learning that live.
  site_id    text primary key references sites(id) on delete cascade,

  -- jsonb, not a boolean column per card, for the reason space_nodes.attrs gives: these are
  -- presentation choices about one deployment and a new one must never require a migration.
  -- Keys are snake_case (`control_plan_card`, `overview_scene_card`) matching every other jsonb
  -- payload in this schema. `src/lib/siteUi.ts` owns the shape and tolerates anything.
  --
  -- DEFAULT '{}' AND NOT A ROW PER SITE. A site with no row reads as all-defaults, which is
  -- all-visible — so this migration changes nothing on screen until somebody asks it to. A
  -- migration that rearranges the dashboard unbidden is the surprise this project avoids.
  prefs      jsonb not null default '{}'::jsonb,

  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

comment on table site_ui_prefs is
  'Per-site display choices for cards that draw a building rather than report a reading. Operator-writable sibling of the read-only sites table; see src/lib/siteUi.ts for the key shape.';
comment on column site_ui_prefs.prefs is
  'Absent or unreadable keys fall back to VISIBLE. Hiding a card must never be something a malformed value can do by accident.';

alter table site_ui_prefs enable row level security;

-- Same access model as device_config and space_nodes: one admin role, no per-row ownership,
-- because this deployment has one operator and inventing a permission model it does not have
-- would be machinery with nothing to hold.
--
-- NO DELETE POLICY, and the omission is deliberate rather than forgotten. Clearing a preference
-- is a write of defaults, not a deletion — the same distinction device_config draws, where
-- DELETE is likewise not granted. Removing the row would also remove the attribution in
-- `updated_by`, which is the only record of who changed what the office screen shows.
--
-- No anon policy; phase 5 dropped every one of those and none comes back.
drop policy if exists site_ui_prefs_select_authenticated on site_ui_prefs;
create policy site_ui_prefs_select_authenticated on site_ui_prefs
  for select using (auth.role() = 'authenticated');
drop policy if exists site_ui_prefs_insert_authenticated on site_ui_prefs;
create policy site_ui_prefs_insert_authenticated on site_ui_prefs
  for insert with check (auth.role() = 'authenticated');
drop policy if exists site_ui_prefs_update_authenticated on site_ui_prefs;
create policy site_ui_prefs_update_authenticated on site_ui_prefs
  for update using (auth.role() = 'authenticated');

-- Postgres grants nothing on a new table to PUBLIC, but `anon` reaches PostgREST through its own
-- role grants, so state the intent explicitly rather than relying on the absence of a policy.
-- Order matters: granting before revoking undoes the grant.
revoke all on site_ui_prefs from public, anon;
grant select, insert, update on site_ui_prefs to authenticated;
