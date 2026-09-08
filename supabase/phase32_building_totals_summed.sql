-- Phase 32 — RM-057. The building's energy totals become the SUM OF ITS BRANCH METERS, and the
-- figure they replace is kept beside them rather than thrown away.
--
-- WHAT CHANGED UPSTREAM. Until RM-057 `building_totals.energy_kwh_*` held the legacy flow's own
-- two-second integration of power, while the per-branch split on Analytics came from each
-- meter's own register. Two derivations of the SAME four circuits, rendered side by side on two
-- pages and never compared: they disagreed by a few tenths of a percent on a good day, by 5.4x
-- during RM-053, and by 6.7% while RM-056 was quietly deleting a third of one branch. The bridge
-- now publishes the sum of the branch meters as the building total, so the headline figure and
-- the split are the same arithmetic done once.
--
-- WHY BOTH SERIES ARE STORED, and this is the whole point of the migration. The integrated
-- figure is the only INDEPENDENT measurement of those circuits this system has. Dropping it
-- would leave the disagreement guard (RM-054) comparing a number against itself, and would
-- retire the only signal that has ever caught this class of fault. It is no longer the headline;
-- it is the second opinion.
--
-- THE SERIES DOES NOT BREAK AT THE CHANGEOVER. `energy_kwh_*` mirrors the payload field of the
-- same name, so its meaning changes on the day this ships — but every row written BEFORE that
-- day already holds the integrated value, which is exactly what the new column holds after it.
-- So `coalesce(energy_kwh_today_integrated, energy_kwh_today)` is one continuous integrated
-- series across the boundary, and that is the expression any reader wanting the old meaning
-- should use.
-- Checked rather than assumed: **nothing reads it that way today.**
-- `server/baseline-report.mjs` names `energy_kwh_today` in its select and then works entirely
-- from `total_power_w`, so Milestone 1's artifact is unaffected either way. The coalesce rule is
-- recorded here for the next reader, not to describe code that exists.
--
-- APPLY THIS BEFORE DEPLOYING THE SERVER THAT WRITES IT. `server/shapeRows.mjs` names these
-- columns on every totals insert, and PostgREST fails the whole row when a named column does not
-- exist — so an unmigrated database plus new server code means no totals are stored at all,
-- silently, until someone reads the ingestion health table. The reverse order is safe: an older
-- server simply leaves them null.
--
-- Nullable with no default, deliberately. A default would invent a measurement for every row
-- written before this existed; null says "not measured", which is the truth and is what every
-- reader in this project already renders as "No data".

alter table building_totals add column if not exists energy_kwh_today_integrated numeric;
alter table building_totals add column if not exists energy_kwh_week_integrated  numeric;
alter table building_totals add column if not exists energy_kwh_month_integrated numeric;

comment on column building_totals.energy_kwh_today_integrated is
  'RM-057: the legacy two-second power integration of the same circuits energy_kwh_today now sums. The independent cross-check, not the headline. Null before phase32.';
comment on column building_totals.energy_kwh_week_integrated is
  'RM-057: as energy_kwh_today_integrated, for the week. Null before phase32.';
comment on column building_totals.energy_kwh_month_integrated is
  'RM-057: as energy_kwh_today_integrated, for the month. Null before phase32.';

-- The hourly rollup keeps the same shape as the table it summarises: a cumulative counter can
-- only be aggregated as a within-hour MAXIMUM, which is the trap phase9/phase11 already document.
alter table building_totals_hourly add column if not exists energy_kwh_today_integrated_max numeric;
alter table building_totals_hourly add column if not exists energy_kwh_week_integrated_max  numeric;
alter table building_totals_hourly add column if not exists energy_kwh_month_integrated_max numeric;
