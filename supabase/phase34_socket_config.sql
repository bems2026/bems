-- Phase 34: a shed tier per SOCKET, not per outlet — RM-060.
--
-- WHY A SIBLING TABLE AND NOT A COLUMN ON device_config. Two reasons, and the second decides it.
--
--   1. device_config is PK'd on device_id alone, and a socket tier is not a fact about a
--      device. An outlet is two relays behind one label, and one of them can be a fridge while
--      the other is a kettle. Those are not the same decision.
--   2. src/lib/supabaseDeviceConfig.ts builds a WHOLE-ROW upsert, and its own comment records
--      why: a row builder that omits a field nulls it on any unrelated edit. A `sockets jsonb`
--      column on that table would therefore be erased by a notes change, from a screen that
--      never mentioned load shedding, with no error — and the loss would surface only the next
--      time the building went over its limit and the tier that should have shed did not exist.
--
-- REJECTED ALSO: `load_shed_group_socket_1` / `_2` columns, which hard-code two sockets. The
-- runtime fan-out already refuses that shortcut; the schema must not reintroduce it.
--
-- device_config.load_shed_group STAYS and is not migrated away. It is the only tier a switch
-- can have, and it remains the FALLBACK for an outlet whose sockets carry no rows of their own.
-- src/lib/deviceConfig.ts's `resolveShedTier` is the single place that precedence is decided.
--
-- Apply once, by hand, in the Supabase SQL editor.
--
-- RE-RUNNING IS SAFE: the table and indexes are guarded, each policy is dropped before it is
-- created, and the backfill is `on conflict do nothing` so a second pass cannot overwrite a
-- tier an operator has since changed.

create table if not exists socket_config (
  -- Composite PRIMARY KEY, not a unique index and emphatically not a partial one: supabase-js's
  -- upsert generates `ON CONFLICT (device_id, socket) DO UPDATE`, and Postgres only matches that
  -- against an UNCONDITIONAL constraint. A primary key is unconditional by construction.
  -- supabase/phase6_schedules_unique_fix.sql is this project's scar from learning that live.
  device_id       text not null references devices(id) on delete cascade,
  socket          int  not null check (socket in (1, 2)),

  -- The same vocabulary device_config.load_shed_group uses, constrained in the database and not
  -- only in TypeScript — phase7's rule, for the same reason.
  load_shed_group text check (load_shed_group is null or load_shed_group in ('group_1','group_2','group_3','never')),

  -- What is plugged into it. Not required by RM-060; included because the migration is the
  -- expensive part and a per-socket screen is unreadable without it ("Socket 2" vs "Kettle").
  label           text check (label is null or char_length(label) <= 60),

  updated_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),

  primary key (device_id, socket)
);

-- Which sockets sit in a tier, for the shed panel's per-tier tallies.
create index if not exists socket_config_load_shed_group_idx
  on socket_config (load_shed_group) where load_shed_group is not null;

-- BACKFILL: preserve today's behaviour exactly.
--
-- A device-level tier currently sheds BOTH sockets, because server/scheduler.mjs runs every
-- shed target through `fanOutCommand`. Two rows per tiered outlet is that same behaviour,
-- written down rather than implied — which is what lets the fan-out be removed from the shed
-- path without changing what gets switched off.
--
-- `do nothing` rather than `do update`: on a re-run this must not stamp over a tier an operator
-- has since set per socket.
insert into socket_config (device_id, socket, load_shed_group, updated_by, updated_at)
select c.device_id, g.n, c.load_shed_group, c.updated_by, c.updated_at
  from device_config c
  join devices d
    on d.id = c.device_id
   and d.class = 'outlet_dual'
  cross join lateral generate_series(1, coalesce(jsonb_array_length(d.sockets), 0)) as g(n)
 where c.load_shed_group is not null
on conflict (device_id, socket) do nothing;

alter table socket_config enable row level security;

-- Same access model and naming convention as device_config. No DELETE policy: clearing a tier
-- is a write of NULL, so nothing in the app ever needs to remove a row. No anon policy —
-- phase5 dropped every one of those and none comes back.
drop policy if exists socket_config_select_authenticated on socket_config;
create policy socket_config_select_authenticated on socket_config
  for select using (auth.role() = 'authenticated');

drop policy if exists socket_config_insert_authenticated on socket_config;
create policy socket_config_insert_authenticated on socket_config
  for insert with check (auth.role() = 'authenticated');

drop policy if exists socket_config_update_authenticated on socket_config;
create policy socket_config_update_authenticated on socket_config
  for update using (auth.role() = 'authenticated');

comment on table socket_config is
  'Per-socket operator metadata for dual outlets. device_config holds the device-level tier, '
  'which stays the fallback for a socket with no row here — see resolveShedTier in '
  'src/lib/deviceConfig.ts, the one place that precedence is decided.';
