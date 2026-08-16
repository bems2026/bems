-- iBEMS Supabase schema — architecture plan Phase 3.
--
-- Additive to the field names already established in docs/bridge-contract.md
-- (device_id, ts, voltage, current, power_w, energy_kwh_today, online, state,
-- socket_states) — this is not a rename. See docs/storage-contract.md for the field-level
-- rationale (why state/socket_states are deliberately absent from `readings`, why
-- phase_current_blue is nullable, etc).
--
-- Apply once, in order, against a new Supabase project (SQL Editor, or `supabase db push`
-- if using the CLI). Idempotent-ish via IF NOT EXISTS where practical; re-running against
-- an already-applied project is safe for the `create table` statements but will error on
-- `create policy` (drop first if you need to re-apply policies).

-- =============================================================================
-- devices — synced from GET /api/devices. shared/registry.mjs stays the actual source of
-- truth; this table is never hand-edited, only upserted by ibems-server.
-- =============================================================================
create table if not exists devices (
  id             text primary key,
  display_name   text not null,
  class          text not null check (class in ('outlet_dual','switch','meter','acu_ir','sensor_temp_humidity')),
  room           text,                    -- nullable; null for every device today (Phase 4.5 onboarding wizard scope)
  dps_map        text,
  sockets        jsonb,                   -- e.g. ["CO3_1","CO3_2"]; null for non-outlet devices
  branch_circuit text,
  status         text,
  updated_at     timestamptz not null default now()
);

-- =============================================================================
-- readings — per-device metering only. Deliberately NO state/socket_states column:
-- docs/bridge-contract.md documents these as transient device state, not readings.
-- =============================================================================
create table if not exists readings (
  device_id        text not null references devices(id),
  ts               timestamptz not null,
  voltage          numeric,
  current          numeric,
  power_w          numeric,
  energy_kwh_today numeric,
  online           boolean not null,
  primary key (device_id, ts)
);
create index if not exists readings_device_id_ts_idx on readings (device_id, ts desc);

-- =============================================================================
-- building_totals — the _totals pseudo-row from GET /api/readings/latest. Different shape
-- from readings (building-wide, not per-device), doesn't fit a per-device row.
-- =============================================================================
create table if not exists building_totals (
  ts                    timestamptz primary key,
  energy_kwh_today      numeric,
  energy_kwh_week       numeric,
  energy_kwh_month      numeric,
  total_power_w         numeric,
  avg_voltage           numeric,
  phase_current_red     numeric,
  phase_current_yellow  numeric,
  phase_current_blue    numeric  -- NULL, not 0 — no Blue-phase meter is installed. Preserve that fact.
);

-- =============================================================================
-- commands — audit log for every command *attempt*, from Phase 6 on. Logged even while
-- hardware dispatch is gated off (status='dry_run'), so the whole path is exercised and
-- reviewable before Phase 7 opens the gate.
-- =============================================================================
create table if not exists commands (
  id            uuid primary key default gen_random_uuid(),
  command_id    text,                     -- optional client correlation id
  device_id     text not null references devices(id),
  socket        int,
  action        text not null check (action in ('on','off')),  -- absolute only, never toggle
  target        text,
  requested_by  uuid not null references auth.users(id),
  requested_at  timestamptz not null default now(),
  accepted_at   timestamptz,
  confirmed     boolean not null default false,
  confirmation  text,
  note          text,
  status        text not null,            -- 'dispatched' | 'dry_run' | 'failed' | 'superseded'
  source        text not null             -- 'ibems-app' | 'schedule' | 'dsm_autoshed'
);
create index if not exists commands_device_id_requested_at_idx on commands (device_id, requested_at desc);

-- =============================================================================
-- schedules — shape kept close to Node-RED's existing global.schedule.<device>.* context
-- keys, so the (later, gated) sync-to-Node-RED step is a mechanical translation.
-- =============================================================================
create table if not exists schedules (
  id          uuid primary key default gen_random_uuid(),
  device_id   text not null references devices(id),
  socket      int,
  rule        jsonb not null,
  enabled     boolean not null default true,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);

-- =============================================================================
-- dsm_thresholds — singleton (id always 1). One building, one Pi.
-- =============================================================================
create table if not exists dsm_thresholds (
  id                 int primary key default 1,
  max_phase_current  numeric,
  max_total_kw       numeric,
  auto_shed          boolean not null default false,
  updated_by         uuid references auth.users(id),
  updated_at         timestamptz not null default now(),
  constraint dsm_thresholds_singleton check (id = 1)
);

-- =============================================================================
-- ingestion_health — singleton (id always 1). Written best-effort by ibems-server every
-- ingest tick; not itself buffered on outage (it's a derived status snapshot, not data).
-- =============================================================================
create table if not exists ingestion_health (
  id                  int primary key default 1,
  last_success_at     timestamptz,
  buffered_row_count  int not null default 0,
  last_error          text,
  constraint ingestion_health_singleton check (id = 1)
);

-- =============================================================================
-- Row Level Security — single policy everywhere (one admin role, no RBAC, per the
-- architecture plan's access-model decision).
-- =============================================================================
alter table devices           enable row level security;
alter table readings          enable row level security;
alter table building_totals   enable row level security;
alter table commands          enable row level security;
alter table schedules         enable row level security;
alter table dsm_thresholds    enable row level security;
alter table ingestion_health  enable row level security;

-- devices / readings / building_totals / ingestion_health: read-only from the browser.
-- Written only by ibems-server via the service-role key, which bypasses RLS entirely —
-- no insert/update policy is granted to `authenticated` on these four tables on purpose.
create policy devices_select_authenticated on devices
  for select using (auth.role() = 'authenticated');
create policy readings_select_authenticated on readings
  for select using (auth.role() = 'authenticated');
create policy building_totals_select_authenticated on building_totals
  for select using (auth.role() = 'authenticated');
create policy ingestion_health_select_authenticated on ingestion_health
  for select using (auth.role() = 'authenticated');

-- commands / schedules / dsm_thresholds: authenticated users may read AND write (single
-- admin role — no per-row ownership check, matches "authorization can stay simple").
create policy commands_select_authenticated on commands
  for select using (auth.role() = 'authenticated');
create policy commands_insert_authenticated on commands
  for insert with check (auth.role() = 'authenticated');

create policy schedules_select_authenticated on schedules
  for select using (auth.role() = 'authenticated');
create policy schedules_insert_authenticated on schedules
  for insert with check (auth.role() = 'authenticated');
create policy schedules_update_authenticated on schedules
  for update using (auth.role() = 'authenticated');

create policy dsm_thresholds_select_authenticated on dsm_thresholds
  for select using (auth.role() = 'authenticated');
create policy dsm_thresholds_update_authenticated on dsm_thresholds
  for update using (auth.role() = 'authenticated');

-- Seed the dsm_thresholds singleton row so `update` (not `insert`) is always the right
-- operation from the app side.
insert into dsm_thresholds (id) values (1) on conflict (id) do nothing;
insert into ingestion_health (id) values (1) on conflict (id) do nothing;

-- Deliberately NOT building now (see architecture plan "Explicitly deferred" section):
-- a device_state_events table for on/off/online transition history. State is transient
-- per the existing bridge contract — add only if uptime/utilization reporting becomes an
-- actual requirement.
