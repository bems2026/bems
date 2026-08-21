-- Architecture plan Phase 11: retention for the two tables Phase 9 left unbounded.
--
-- THE GAP THIS CLOSES:
-- RM-006 was scoped to `readings`, and phase9_readings_hourly.sql bounded exactly that.
-- Two tables were left growing forever:
--
--   * `building_totals` — one row per minute from every ingest tick, ~525k rows/year, and
--     nothing has ever read it. Write-only and unbounded is the worst of both: it costs
--     storage continuously and returns nothing, and when the storage ceiling is reached it
--     is ingestion's own writes that start failing.
--   * `anomalies` — one row per flagged tick, forever.
--
-- `building_totals` is NOT simply prunable, though: it holds `energy_kwh_week`,
-- `energy_kwh_month` and the per-phase currents, which are the building-wide figures any
-- energy report has to quote and which exist nowhere else. So it gets the same treatment
-- `readings` got — rolled into permanent hourly buckets, then pruned — rather than deleted.
-- `anomalies` is derived from readings that are themselves retained, so it is pruned outright
-- at a longer window with no rollup; a count-per-period belongs in a report, not in a second
-- table.
--
-- WHY `commands` IS DELIBERATELY EXEMPT:
-- it is the audit trail for every attempt to move a relay, attributed to a real signed-in
-- user (EX-101). It is small — one row per command, not one per minute — and deleting it
-- destroys accountability for physical actions taken in a building. Nothing in this file
-- touches it, and test/phase11-totals-retention-schema.test.mjs asserts that, so a later
-- "finish the job" pass has to argue with a failing test rather than a comment.
--
-- WHY THERE IS NO `online` FILTER HERE, unlike phase9_history_buckets.sql:
-- `building_totals` is the bridge's own `_totals` pseudo-row and carries no `online` column.
-- The honesty is enforced upstream instead: `shared/buildLatest.mjs` already refuses to let
-- a disconnected meter contribute its frozen last reading to a total (EX-063), so what
-- arrives here has been filtered already.
--
-- Rollup and prune share one function, and therefore one transaction, for the reason
-- phase9_readings_hourly.sql's header gives: a delete that commits without its rollup
-- destroys the data with nothing to show for it.
--
-- Apply once, by hand, in the Supabase SQL editor. No migration runner in this repo; same
-- convention as phase4_/.../phase10_*.sql.

-- =============================================================================
-- building_totals_hourly — the permanent record behind the 30-day raw window.
-- =============================================================================
create table if not exists building_totals_hourly (
  hour                     timestamptz primary key,
  total_power_w_avg        numeric,
  total_power_w_max        numeric,
  avg_voltage_avg          numeric,
  phase_current_red_avg    numeric,
  phase_current_yellow_avg numeric,
  -- Stays NULL, never 0 — no Blue-phase meter is installed (schema.sql:59,
  -- shared/registry.mjs's PHASE_MAP). avg() over all-NULL yields NULL, which is correct;
  -- coalescing it to 0 would invent a meter that does not exist.
  phase_current_blue_avg   numeric,
  -- Cumulative counters that reset, so the within-hour MAXIMUM is the only meaningful
  -- aggregate — averaging a counter is the trap phase9_readings_hourly.sql's
  -- energy_kwh_today_max already avoids.
  energy_kwh_today_max     numeric,
  energy_kwh_week_max      numeric,
  energy_kwh_month_max     numeric,
  sample_count             int not null
);
create index if not exists building_totals_hourly_hour_idx on building_totals_hourly (hour desc);

alter table building_totals_hourly enable row level security;

-- Same access model as readings_hourly: read-only from the browser, written only by
-- ibems-server via the service-role key, which bypasses RLS entirely. No insert/update
-- policy for `authenticated` on purpose, and no anon policy — phase5_lockdown_rls.sql
-- dropped every one of those and none comes back.
create policy building_totals_hourly_select_authenticated on building_totals_hourly
  for select using (auth.role() = 'authenticated');

-- =============================================================================
-- Supporting indexes for the prune predicates.
-- `readings`' only index is (device_id, ts desc). A composite index leading with device_id
-- cannot serve a `ts`-only predicate, so every retention pass has been seq-scanning the
-- whole table. Same for `anomalies`. `building_totals` is already keyed on ts.
-- =============================================================================
create index if not exists readings_ts_idx  on readings  (ts);
create index if not exists anomalies_ts_idx on anomalies (ts);

-- =============================================================================
-- Roll every completed hour older than p_before into building_totals_hourly, then delete
-- those raw rows. Returns what it actually did, so server/retention.mjs can log real
-- numbers rather than assert success.
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
    energy_kwh_today_max, energy_kwh_week_max, energy_kwh_month_max, sample_count
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
         count(*)::int
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

-- =============================================================================
-- Prune anomalies outright. No rollup: an anomaly is derived from readings that are
-- themselves retained, and a count-per-period belongs in a report rather than a table.
-- Returns the same (rolled, deleted) shape as its sibling so server/retention.mjs can drive
-- both through one code path; `rolled` is always 0 and says so.
-- =============================================================================
create or replace function public.prune_anomalies(p_before timestamptz)
returns table (rolled int, deleted int)
language plpgsql
volatile
security invoker
as $fn$
declare
  n_deleted int;
begin
  delete from anomalies a where a.ts < p_before;
  get diagnostics n_deleted = row_count;

  return query select 0, n_deleted;
end;
$fn$;

-- Postgres grants EXECUTE to PUBLIC by default. Both of these DELETE data — revoke that
-- default before granting to the one role that owns ingestion writes. Neither is ever
-- granted to `authenticated`: nothing in the browser may prune anything.
revoke execute on function public.roll_up_and_prune_building_totals(timestamptz) from public;
grant  execute on function public.roll_up_and_prune_building_totals(timestamptz) to service_role;

revoke execute on function public.prune_anomalies(timestamptz) from public;
grant  execute on function public.prune_anomalies(timestamptz) to service_role;
