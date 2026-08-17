-- Fixes a mistake in phase6_schedules_config.sql: a PARTIAL unique index
-- (`schedules_device_id_no_socket_uidx`, scoped to `WHERE socket IS NULL`) cannot be
-- targeted by PostgREST/supabase-js's upsert(), which generates a plain
-- `ON CONFLICT (device_id) DO UPDATE` — Postgres only matches that against an
-- unconditional unique constraint, never a partial index, no matter how the columns line
-- up. Confirmed live: "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification".
--
-- This app never actually varies `socket` for schedules (every write sets it to NULL —
-- there is no per-socket scheduling anywhere in the UI), so a plain UNIQUE(device_id) is
-- both simpler and matches real usage exactly; the partial index was solving a generality
-- this phase never needed.
drop index if exists schedules_device_id_no_socket_uidx;
alter table schedules add constraint schedules_device_id_unique unique (device_id);
