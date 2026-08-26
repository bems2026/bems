-- RM-027: stamp every undimensioned table with the site it belongs to.
--
-- REQUIRES supabase/phase19_sites.sql to have been applied first — every foreign key below
-- targets that table.
--
-- ORDER MATTERS AND IT IS NOT COSMETIC. For each table: add the column nullable, backfill it,
-- and only then impose NOT NULL. Imposing it first fails on the rows already present, and this
-- runs against a project with months of real data in `building_totals`. A file applied by hand
-- has no transaction around it, so a statement that fails halfway leaves the schema in a state
-- nobody planned — which is why `test/phase20-site-scoping-schema.test.mjs` asserts the order
-- rather than trusting it.
--
-- REHEARSE FIRST: `supabase/rehearse.sh` replays schema.sql and every phase file in order
-- against a throwaway PostgreSQL. This is the first migration in this project to DROP a
-- constraint, and RM-009 records that the rehearsal caught two real defects the last time it
-- was skipped-then-run.
--
-- Apply once, by hand, in the Supabase SQL editor. Every statement is guarded, so a re-run is
-- safe.

-- ---------------------------------------------------------------------------
-- dsm_thresholds
--
-- Was `check (id = 1)` with the comment "One building, one Pi". That constraint is the single
-- most direct expression of the assumption this whole phase removes: it made a second
-- deployment sharing this project impossible by construction.
-- ---------------------------------------------------------------------------
alter table dsm_thresholds add column if not exists site_id text references sites(id);
update dsm_thresholds set site_id = 'mmsu-nberic-care' where site_id is null;
alter table dsm_thresholds alter column site_id set not null;

alter table dsm_thresholds drop constraint if exists dsm_thresholds_singleton;
-- One settings row per SITE — the same guarantee the singleton gave, scoped correctly instead
-- of globally. Dropping the old constraint without adding this would allow a second row for the
-- same site, and the app's `.eq('site_id', …).maybeSingle()` would begin throwing.
alter table dsm_thresholds drop constraint if exists dsm_thresholds_one_per_site;
alter table dsm_thresholds add constraint dsm_thresholds_one_per_site unique (site_id);

-- ---------------------------------------------------------------------------
-- ingestion_health
--
-- Same shape, same reason. Each Pi writes its own health row; with one row overall, a second
-- ingest daemon would have silently overwritten the first's status every 60 seconds.
-- ---------------------------------------------------------------------------
alter table ingestion_health add column if not exists site_id text references sites(id);
update ingestion_health set site_id = 'mmsu-nberic-care' where site_id is null;
alter table ingestion_health alter column site_id set not null;

alter table ingestion_health drop constraint if exists ingestion_health_singleton;
alter table ingestion_health drop constraint if exists ingestion_health_one_per_site;
alter table ingestion_health add constraint ingestion_health_one_per_site unique (site_id);

-- ---------------------------------------------------------------------------
-- building_totals
--
-- The primary key STAYS `(ts)`. Widening it to `(site_id, ts)` is the correct end state for a
-- shared project, but `roll_up_and_prune_building_totals` and `building_totals_hourly` were
-- built against this shape (RM-009, phase11), and changing a primary key underneath working
-- rollup functions does not belong in the same migration that introduces the column. Deferred
-- to RM-030, which rebuilds aggregation anyway and is where the rollups are already being
-- opened up.
--
-- Until then the constraint that actually holds is operational rather than declared: one Pi
-- writes this table. That is true today and is worth knowing rather than assuming.
-- ---------------------------------------------------------------------------
alter table building_totals add column if not exists site_id text references sites(id);
update building_totals set site_id = 'mmsu-nberic-care' where site_id is null;
alter table building_totals alter column site_id set not null;

-- Every read of this table filters by site once there is more than one, and `ts desc` matches
-- the ordering the existing `readings_device_id_ts_idx` established for the per-device table.
create index if not exists building_totals_site_id_ts_idx on building_totals (site_id, ts desc);
