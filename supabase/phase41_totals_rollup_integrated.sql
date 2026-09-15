-- =============================================================================
-- Phase 41 — RM-087. The hourly totals rollup carries phase32's integrated series.
--
-- WHAT WAS WRONG. phase32 (RM-057) made the building total the sum of its branch meters and kept
-- the legacy two-second integration beside it, in `building_totals.energy_kwh_*_integrated`, as the
-- only independent measurement of those circuits this system has. It added the matching
-- `building_totals_hourly.energy_kwh_*_integrated_max` columns — and never redefined the rollup, so
-- `roll_up_and_prune_building_totals` is still phase11's and names neither. A retention pass over a
-- row carrying the series would store NULL in the hourly bucket and then delete the raw row: the
-- cross-check gone, for that hour, for good, with no error anywhere.
--
-- WHEN IT WOULD HAVE BITTEN. The series starts at 2026-09-08 07:31 UTC. Retention keeps thirty days
-- and asks every six hours, so the first pass to delete a row holding it falls on 2026-10-08. Found on
-- 2026-09-15 while checking the first real retention pass, which prunes only rows from before phase32,
-- whose integrated columns are NULL anyway — so nothing has been lost. `supabase/rehearse.sh`
-- reproduced it before this file existed: the integrated maxima came back NULL.
--
-- WHAT THIS CHANGES. This one function: the same signature and OUT columns, the same rules phase11
-- set and `test/phase11-totals-retention-schema.test.mjs` holds — a partial hour is never rolled up,
-- the first bucket is kept on conflict, the delete follows the insert inside the one call — plus three
-- within-hour maxima.
--
-- WHAT IT DOES NOT CHANGE. Hours already rolled keep whatever they hold (`on conflict do nothing`, by
-- design), and none of them held a value; there is no backfill to do. Nor does it scope the rollup by
-- site: `building_totals_hourly` still has no `site_id`, and phase20's deferral of that to RM-030
-- stands.
--
-- Idempotent — `create or replace` with unchanged OUT columns, so a second paste is a no-op. Apply once,
-- by hand, in the Supabase SQL editor, like every phase file here. Rehearsed by `supabase/rehearse.sh`,
-- which applies it twice.
-- =============================================================================

create or replace function public.roll_up_and_prune_building_totals(p_before timestamptz)
returns table (rolled int, deleted int)
language plpgsql
volatile
security invoker
as $fn$
declare
  -- Truncated to an hour boundary so a partial hour is never rolled up and then completed
  -- from a fragment on the next pass.
  cutoff timestamptz := date_trunc('hour', p_before);
  n_rolled int;
  n_deleted int;
begin
  insert into building_totals_hourly (
    hour, total_power_w_avg, total_power_w_max, avg_voltage_avg,
    phase_current_red_avg, phase_current_yellow_avg, phase_current_blue_avg,
    energy_kwh_today_max, energy_kwh_week_max, energy_kwh_month_max, sample_count,
    energy_kwh_today_integrated_max, energy_kwh_week_integrated_max, energy_kwh_month_integrated_max
  )
  select date_trunc('hour', b.ts),
         avg(b.total_power_w),
         max(b.total_power_w),
         avg(b.avg_voltage),
         avg(b.phase_current_red),
         avg(b.phase_current_yellow),
         avg(b.phase_current_blue),
         max(b.energy_kwh_today),
         max(b.energy_kwh_week),
         max(b.energy_kwh_month),
         count(*)::int,
         -- phase32's cross-check, rolled up the only way a cumulative counter can be: a within-hour
         -- maximum. The max of an hour with no integrated value is NULL — not measured — never zero.
         max(b.energy_kwh_today_integrated),
         max(b.energy_kwh_week_integrated),
         max(b.energy_kwh_month_integrated)
    from building_totals b
   where b.ts < cutoff
   group by 1
  -- Keeping the first value is the safe direction to be wrong in: the original bucket was
  -- computed from a complete hour, a replacement would be computed from a fragment.
  on conflict (hour) do nothing;
  get diagnostics n_rolled = row_count;

  delete from building_totals b where b.ts < cutoff;
  get diagnostics n_deleted = row_count;

  return query select n_rolled, n_deleted;
end;
$fn$;

-- Restated, because `create or replace function` does not reset grants and a reader should not have
-- to go back to phase11 to learn that this function DELETES and who may call it.
revoke execute on function public.roll_up_and_prune_building_totals(timestamptz) from public;
grant  execute on function public.roll_up_and_prune_building_totals(timestamptz) to service_role;
