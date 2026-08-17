-- Architecture plan Phase 6: schema tweaks for the schedules/DSM Supabase migration.
--
-- 1. `schedules` needs a unique target for upsert("device_id,socket") to match against.
--    Every schedule this app writes today is whole-device (no per-socket schedules exist
--    in the UI), so `socket` is always NULL — and a plain UNIQUE(device_id, socket) would
--    NOT catch duplicates, since NULL is never equal to NULL in a uniqueness check. A
--    partial index scoped to `socket is null` is what actually enforces "one row per
--    device" for this app's real write pattern.
create unique index if not exists schedules_device_id_no_socket_uidx
  on schedules (device_id)
  where socket is null;

-- 2. The ACU's ambient trigger setpoint (`global.trigger.care_acu_on` in the old flat
--    context) is a second building-wide scalar, same singleton shape as DSM's thresholds.
--    Reuses dsm_thresholds' existing id=1 row rather than adding a second one-row table.
alter table dsm_thresholds add column if not exists care_acu_trigger_c numeric;

-- 3. Seed the singleton row if Phase 3 never created one — dsm_thresholds.save() uses
--    .update().eq('id', 1), which silently matches zero rows (and "succeeds") if id=1
--    doesn't exist yet.
insert into dsm_thresholds (id) values (1) on conflict (id) do nothing;
