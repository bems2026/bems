-- RM-148, Stage 5: a space's totals read the hourly rollup where raw rows are gone.
--
-- REQUIRES supabase/phase22_node_totals.sql (which this replaces) and phase9_readings_hourly.sql.
--
-- THE BUG. `node_totals` read raw `readings` only. The Analytics page's Space totals card asks it for
-- 30 days and for a year (`SpaceTotalsCard.tsx`), so since raw rows were first pruned at 30 days its
-- "1 y" has been the last 30 days, presented as a year. At RM-148's 14-day raw window its "30 d"
-- would be 14 days the same way. Nothing said so: the figures were averages of what was there.
--
-- THE FIX. Hours the raw table still holds are aggregated from it, and every other hour is read from
-- `readings_hourly` — by the rule `readings_archive` (phase10) already uses, so a space and a device
-- chart agree:
--   * the rolled hour wins the seam, so an hour present in both is counted once;
--   * the average is weighted by each hour's own samples. An hour of 3 observed minutes does not
--     weigh the same as an hour of 60;
--   * only observed samples count. A window with none reports NULL, never 0.
-- A rolled hour's figures follow its rollup's rules (time-weighted since phase31, held minutes
-- excluded since phase47). The raw hours are the same arithmetic phase22 did.
--
-- The signature is unchanged, so phase22's grants (authenticated only) and every caller carry on.
--
-- Apply once, by hand, in the Supabase SQL editor. Safe to paste twice. Rehearse with
-- supabase/rehearse.sh first.

create or replace function public.node_totals(
  p_node_id uuid,
  p_since   timestamptz,
  p_until   timestamptz default now()
)
returns table (
  device_count        int,
  reporting_count     int,
  sample_count        bigint,
  online_sample_count bigint,
  avg_power_w         numeric,
  peak_power_w        numeric
)
language sql
stable
security invoker
as $$
  with scope as (
    select id from public.space_subtree(p_node_id)
  ),
  placed as (
    select dc.device_id
      from device_config dc
      join scope s on s.id = dc.space_node_id
  ),
  raw_hours as (
    -- The hours still at full resolution, in the shape readings_hourly stores.
    select r.device_id,
           date_trunc('hour', r.ts)                                             as hour,
           count(*)                                                             as sample_count,
           count(*) filter (where r.online)                                     as online_sample_count,
           avg(r.power_w) filter (where r.online and r.power_w is not null)     as power_w_avg,
           count(*) filter (where r.online and r.power_w is not null)           as power_samples,
           max(r.power_w) filter (where r.online and r.power_w is not null)     as power_w_max
      from readings r
      join placed p on p.device_id = r.device_id
     where r.ts >= p_since
       and r.ts <  p_until
     group by 1, 2
  ),
  rolled as (
    select h.device_id,
           h.hour,
           h.sample_count::bigint                                               as sample_count,
           h.online_sample_count::bigint                                        as online_sample_count,
           h.power_w_avg,
           case when h.power_w_avg is null then 0 else h.online_sample_count end::bigint as power_samples,
           h.power_w_max
      from readings_hourly h
      join placed p on p.device_id = h.device_id
     where h.hour >= p_since
       and h.hour <  p_until
  ),
  merged as (
    select * from rolled
    union all
    select rh.device_id, rh.hour, rh.sample_count, rh.online_sample_count, rh.power_w_avg, rh.power_samples, rh.power_w_max
      from raw_hours rh
     -- The rolled hour wins the seam: see phase10's header for how an hour can be in both.
     where not exists (
             select 1
               from readings_hourly h2
              where h2.device_id = rh.device_id
                and h2.hour = rh.hour
           )
  )
  select
    (select count(*)::int from placed),
    (select count(distinct m.device_id)::int from merged m where m.sample_count > 0),
    -- Counts are 0 over an empty window, as phase22's count(*) was: the frontend reads 0 samples
    -- as "nothing to look at". Only the power figures below are NULL when nothing was observed.
    (select coalesce(sum(m.sample_count), 0)::bigint from merged m),
    (select coalesce(sum(m.online_sample_count), 0)::bigint from merged m),
    -- NULL when nothing was observed, never 0: sum() over no rows is NULL, and nullif keeps a zero
    -- weight from becoming a division.
    (select sum(m.power_w_avg * m.power_samples)
              / nullif(sum(m.power_samples) filter (where m.power_w_avg is not null), 0)
       from merged m),
    (select max(m.power_w_max) from merged m);
$$;

notify pgrst, 'reload schema';
