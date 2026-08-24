-- Phase 14: revise the device_config category vocabulary.
--
-- WHY: the original set (lighting, hvac, office_equipment, critical, kitchen, other) was a
-- generic building-management list. This site's operator groups devices the way the electrical
-- installation is actually laid out — by what the thing IS on the panel — so `hvac` becomes the
-- concrete `aircon`, `office_equipment` and `kitchen` go (nothing was ever filed under either),
-- and `outlet` and `branch_circuit` arrive, which are the two groupings the CT map has always
-- had and the category list never did.
--
-- `category` remains distinct from `Device.class` and from phase 13's `functions`. `class` is
-- flow-critical and immutable from the UI; `functions` is what a device is *for*; `category` is
-- the operator's own grouping and means nothing to the bridge. All three can legitimately say
-- "lighting" about the same device, and all three are true.
--
-- Apply once, by hand, in the Supabase SQL editor. No migration runner in this repo; same
-- convention as phase4_/phase5_/phase6_*.sql. Re-runnable: the value mapping is idempotent and
-- the constraint is dropped only if present.

-- 1. Map the retired values BEFORE swapping the constraint, or the ALTER fails on any row still
--    holding one. `hvac` has an obvious successor; `office_equipment` and `kitchen` do not, and
--    are deliberately mapped to NULL ("not categorised") rather than forced into `other` —
--    inventing a grouping for a device nobody classified would be worse than leaving it blank,
--    and `other` should mean "considered and none of these fit".
--
--    At the time of writing the live project holds exactly one row (`lighting`), which is
--    unaffected. This block exists for any other deployment, and because a migration that
--    assumes the data it will meet is how the phase 6 upsert fix came to be needed.
update device_config set category = 'aircon' where category = 'hvac';
update device_config set category = null    where category in ('office_equipment', 'kitchen');

-- 2. Swap the constraint. Named explicitly rather than relying on the auto-generated name,
--    because the original was inline and Postgres named it `device_config_category_check`.
alter table device_config drop constraint if exists device_config_category_check;

alter table device_config
  add constraint device_config_category_check
  check (category is null or category in ('lighting','aircon','outlet','branch_circuit','critical','other'));

comment on column device_config.category is
  'Operator grouping: lighting, aircon, outlet, branch_circuit, critical, other. NULL = not categorised. Distinct from devices.class and from device_config.functions.';
