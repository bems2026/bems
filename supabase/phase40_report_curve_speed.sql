-- =============================================================================================
-- phase40 — the duration curve in one pass, and the totals policies' auth check evaluated once
-- RM-086
--
-- MEASURED BEFORE IT WAS WRITTEN, on the live project, 2026-09-15:
--
--   * Signed in, the Reports page's call to `report_demand_curve` for August 2026 was cancelled by
--     the statement timeout on EVERY attempt — about nine seconds each, consistent, not load.
--   * The same call as the service role, which bypasses RLS, took 3.5 s. Its four sibling
--     functions over the same window took 0.6–1.4 s. So the curve is the slow one, and RLS makes
--     it slower still.
--
-- TWO CAUSES, BOTH IN PLAIN SIGHT ONCE LOOKED FOR.
--
-- 1. phase37 computed the curve as a CORRELATED scalar subquery per fraction:
--        (select percentile_cont(f) within group (order by v desc) from samples)
--    once for each of the 101 points. `samples` is referenced inside that subquery, so it is
--    re-evaluated per point: the whole month of `building_totals` was scanned and sorted 101 times.
--    `percentile_cont` takes an ARRAY of fractions and answers all of them from one sort, which is
--    the form written here.
--
-- 2. The two policies that let `authenticated` read the totals compare `auth.role()` directly. A
--    function called bare in a policy is evaluated for EVERY ROW the query touches; wrapped as
--    `(select auth.role())` the planner evaluates it once per statement and reuses the answer.
--    Same rows visible, same roles allowed — the comparison is unchanged, only how often it runs.
--
-- WHAT DOES NOT CHANGE. The curve's shape, its 101 points, its NULLs for a period nobody observed,
-- its resolution column and its signature. `supabase/rehearse.sh` recomputes the curve the phase37
-- way over the same fixture and requires the two to agree point for point: a faster query that
-- draws a different curve is not a fix. Every other phase37 function is untouched.
--
-- APPLY: paste into the Supabase SQL editor, after phase39. Re-running this file is safe: the
-- function is dropped by its exact signature before it is created, and each policy is dropped
-- before it is recreated. `rehearse.sh` applies it twice to prove that.
--
-- READ BACK: open Reports signed in and let the charts load. The duration curve should draw, and
-- the page should not show "the load duration curve could not be loaded".
-- =============================================================================================

-- ---- 1. report_demand_curve: one sort, not 101 --------------------------------------------------
--
-- Dropped by explicit signature, never `cascade`, for the reason RM-072h records: `create or
-- replace` cannot change a function's shape, and if something ever depends on this function an
-- error naming it beats its silent removal.
drop function if exists public.report_demand_curve(text, date, text, int);

create function public.report_demand_curve(
  p_period text,
  p_start  date,
  p_tz     text default 'Asia/Manila',
  p_points int default 101
)
returns table (
  pct         numeric,
  power_w     numeric,
  resolution  text
)
language plpgsql
stable
security invoker
as $fn$
declare
  w record;
  res text;
  fs double precision[];
begin
  if p_points < 2 or p_points > 501 then
    raise exception 'p_points must be between 2 and 501, got %', p_points
      using errcode = 'invalid_parameter_value';
  end if;

  select * into w from public.report_window(p_period, p_start, p_tz);
  res := public.report_resolution(w.win_start, w.win_end);

  -- The fractions, computed once. A plpgsql variable is a constant to the query below, which is
  -- what an ordered-set aggregate's direct argument has to be.
  fs := array(select i::double precision / (p_points - 1) from generate_series(0, p_points - 1) i order by i);

  return query
  with samples as (
    select t.total_power_w as v
      from building_totals t
     where t.ts >= w.win_start and t.ts < w.win_end and t.total_power_w is not null
    union all
    select b.total_power_w_avg
      from building_totals_hourly b
     where b.hour >= w.win_start and b.hour < w.win_end
       and b.total_power_w_avg is not null
       -- Range, not date_trunc equality: an index on `ts` can serve this and cannot serve a
       -- function of the column.
       and not exists (select 1 from building_totals t2
                        where t2.ts >= b.hour and t2.ts < b.hour + interval '1 hour')
  ),
  curve as (
    -- ONE aggregate over all the fractions: one scan and one sort of the samples. Descending, so the
    -- curve starts at the peak and falls — fraction 0 is the highest sample, fraction 1 the lowest.
    -- Over no samples at all this is one row holding NULL, and the unnest below then yields every
    -- point with an empty value: a period nobody observed is a curve of NULLs, never of zeros.
    select percentile_cont(fs) within group (order by s.v desc) as vals
      from samples s
  )
  select round(((u.ord - 1)::numeric / (p_points - 1)) * 100, 2),
         u.val::numeric,
         res
    from curve
   cross join lateral unnest(fs, curve.vals) with ordinality as u(f, val, ord)
   order by u.ord;
end;
$fn$;

-- A dropped function takes its grants with it. `anon` is named, not just PUBLIC, because revoking
-- from PUBLIC does not remove a privilege Supabase granted `anon` directly.
revoke execute on function public.report_demand_curve(text, date, text, int) from public, anon;
grant execute on function public.report_demand_curve(text, date, text, int) to authenticated;

-- ---- 2. the totals policies: auth.role() once per statement, not once per row --------------------
drop policy if exists building_totals_select_authenticated on building_totals;
create policy building_totals_select_authenticated on building_totals
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists building_totals_hourly_select_authenticated on building_totals_hourly;
create policy building_totals_hourly_select_authenticated on building_totals_hourly
  for select using ((select auth.role()) = 'authenticated');

-- PostgREST caches the schema; a changed function should be served at once rather than after the
-- next automatic reload.
notify pgrst, 'reload schema';
