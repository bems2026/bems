-- Phase 17: add `sensor` to the device_config category vocabulary.
--
-- WHY: `sensor_temp_humidity` is a real device class on this site, but the operator grouping
-- had no way to say so — a sensor could only be filed under `other`, which is meant for
-- "considered, and none of these fit" rather than "there is no right answer available".
--
-- WHY A NEW FILE RATHER THAN EDITING PHASE 14: phase 14 is already applied to the live
-- project. Editing an applied migration makes the repository disagree with the database while
-- looking like it agrees, which is worse than an extra file.
--
-- This one only WIDENS what the CHECK accepts, so unlike phase 14 it needs no value mapping
-- first: no existing row can fail a constraint that permits strictly more than the one it
-- replaces. That also makes it safe to apply before the frontend ships, in either order.
--
-- Apply once, by hand, in the Supabase SQL editor. Re-runnable.

alter table device_config drop constraint if exists device_config_category_check;

alter table device_config
  add constraint device_config_category_check
  check (category is null or category in ('lighting','aircon','outlet','branch_circuit','sensor','critical','other'));

comment on column device_config.category is
  'Operator grouping: lighting, aircon, outlet, branch_circuit, sensor, critical, other. NULL = not categorised. Distinct from devices.class and from device_config.functions.';
