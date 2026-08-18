-- Architecture plan Phase 7: operator-editable device metadata.
--
-- WHY A SIBLING TABLE AND NOT NEW COLUMNS ON `devices`:
-- server/ingest.mjs's syncDevices() re-upserts every `devices` row from the bridge registry
-- every INGEST_DEVICE_SYNC_MS (5 min by default) with a FULL row body (server/shapeRows.mjs's
-- shapeDeviceRows, which emits `room: d.room ?? null`) under
-- `Prefer: resolution=merge-duplicates`. Anything a human typed into a `devices` column is not
-- merely ignored, it is actively nulled within five minutes. `devices` also grants
-- `authenticated` SELECT only, on purpose (supabase/schema.sql's RLS section). So operator
-- metadata lives here, keyed by device_id — the same shape `schedules` already uses.
--
-- Apply once, by hand, in the Supabase SQL editor. No migration runner in this repo; same
-- convention as phase4_/phase5_/phase6_*.sql. Re-running errors on `create policy` — drop the
-- policies first if you need to re-apply.

create table if not exists device_config (
  -- PRIMARY KEY, not a plain unique index and emphatically not a PARTIAL one: supabase-js's
  -- upsert() generates `ON CONFLICT (device_id) DO UPDATE`, and Postgres only matches that
  -- against an UNCONDITIONAL unique constraint. supabase/phase6_schedules_unique_fix.sql is
  -- this project's scar from learning that live. A primary key is unconditional by construction.
  --
  -- The FK means a row can only exist for a device server/ingest.mjs has already synced into
  -- `devices`. A device the bridge has only just started serving cannot be annotated until the
  -- next device sync — which is correct: this table annotates existing devices, it does not
  -- enroll new ones (that needs a Pi redeploy; see docs/bridge-contract.md's Deployment section).
  device_id             text primary key references devices(id) on delete cascade,

  -- Free text: this building has no fixed room list, and an enum here would mean a migration
  -- every time a room is renamed.
  room                  text check (room is null or char_length(room) <= 60),

  -- Operator-facing FUNCTIONAL grouping. Deliberately NOT `devices.class`: class is
  -- flow-critical (shared/commands.mjs validates against it, shared/buildLatest.mjs shapes
  -- state from it, src/lib/deviceClass.ts and DevicesView's CLASS_* maps key off it) and is
  -- constrained by schema.sql's own CHECK. It is also not `branch_circuit`, which is the
  -- electrical grouping. A device can be class='meter', branch_circuit='L.O Red' and
  -- category='lighting' at once, and all three are true.
  category              text check (category is null or category in ('lighting','hvac','office_equipment','critical','kitchen','other')),

  -- Which demand-side-management shed wave this device belongs to. RECORDED ONLY — nothing
  -- reads it yet; dsm_thresholds.auto_shed is still the gate and hardware dispatch is still
  -- closed. Writing it down is the prerequisite for the shed logic, not the logic itself.
  load_shed_group       text check (load_shed_group is null or load_shed_group in ('group_1','group_2','group_3','never')),

  -- Shown INSTEAD OF devices.display_name in this dashboard when set. Never written back to
  -- `devices`, so the registry name stays the one name the bridge and this table agree on, and
  -- the UI shows it alongside the override rather than erasing it.
  display_name_override text check (display_name_override is null or char_length(display_name_override) <= 60),

  notes                 text check (notes is null or char_length(notes) <= 500),

  -- schedules and dsm_thresholds both declare updated_by and then never write it. This one
  -- does (src/lib/supabaseDeviceConfig.ts reads the id off the already-persisted local
  -- session, no extra round trip), so "who renamed CO3?" has an answer.
  updated_by            uuid references auth.users(id),
  updated_at            timestamptz not null default now()
);

alter table device_config enable row level security;

-- Same access model as schedules: one admin role, no per-row ownership check. Naming follows
-- schema.sql's <table>_<verb>_<role> convention. No policy for the anon role — phase 5 dropped
-- every one of those and none comes back. No DELETE policy either: clearing metadata is a
-- write of NULLs, so nothing in the app ever needs to delete a row.
create policy device_config_select_authenticated on device_config
  for select using (auth.role() = 'authenticated');
create policy device_config_insert_authenticated on device_config
  for insert with check (auth.role() = 'authenticated');
create policy device_config_update_authenticated on device_config
  for update using (auth.role() = 'authenticated');
