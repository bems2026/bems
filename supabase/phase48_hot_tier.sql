-- RM-148, Stage 3: the cloud as a 14-day hot tier.
--
-- WHY. Measured 2026-09-29 (E-218): the project is on the Free plan at 392 of 500 MB, above which it
-- turns read-only and ingest's own writes fail. `readings` is 346 MB of it, 130 MB of that indexes.
-- From RM-148 on, the edge keeps every raw row for good (server/archiveDb.mjs), so the cloud needs
-- only a short window of raw rows plus the permanent rollups. This phase prepares for that. It
-- touches no rows:
--
--   1. It drops eight indexes that duplicate a primary key or unique constraint. A btree scans
--      backwards as well as forwards, so `(a, b desc)` beside a key on `(a, b)` is the same index
--      twice. Every write pays for both, and the one on `readings` is tens of MB.
--   2. It makes autovacuum visit the two raw tables after 2 % of their rows change rather than the
--      default 20 %. Both are pruned daily, so dead rows are cleared promptly and their space is
--      reused rather than the table growing past it.
--   3. It adds the per-hour counts the edge's janitor compares with its archive before it prunes a
--      day. Nothing is pruned from the cloud that the edge does not hold.
--
-- WHAT IT IS NOT. It does not shrink the table files already on disk: dropping rows never does,
-- and `VACUUM FULL` builds a whole new copy beside the old one, which at this size could push the
-- database over the plan's cap in the middle of the operation. RM-148's Stage 4 does that shrink
-- a different way, from the edge's archive.
--
-- Apply once, by hand, in the Supabase SQL editor. Safe to paste twice. Rehearse with
-- supabase/rehearse.sh first.

-- 1. Indexes that duplicate a key ---------------------------------------------------------------
drop index if exists public.readings_device_id_ts_idx;           -- covered by readings' primary key (device_id, ts)
drop index if exists public.readings_hourly_device_id_hour_idx;  -- covered by readings_hourly's primary key (device_id, hour)
drop index if exists public.building_totals_hourly_hour_idx;     -- covered by building_totals_hourly's primary key (hour)
drop index if exists public.anomalies_device_id_ts_idx;          -- covered by anomalies' primary key (device_id, ts, metric)
drop index if exists public.monthly_reports_month_idx;           -- covered by monthly_reports' primary key (month, device_id)
drop index if exists public.period_reports_lookup_idx;           -- covered by period_reports' primary key (period, period_start, device_id)
drop index if exists public.energy_tariffs_site_from_idx;        -- covered by energy_tariffs' unique (site_id, effective_from)
drop index if exists public.emission_factors_site_from_idx;      -- covered by emission_factors' unique (site_id, effective_from)

-- 2. Vacuum the raw tables sooner ---------------------------------------------------------------
alter table public.readings set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.building_totals set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);

-- 3. What the cloud holds, hour by hour, for the edge's janitor ---------------------------------
--
-- 48 hours at most: 20 devices x 48 hours is 960 rows, under PostgREST's 1,000-row page. A bigger
-- window would be cut short with no signal, which is how a full archive could look incomplete, or
-- worse, an incomplete one look full. Asking for more RAISES, as readings_buckets does.
create or replace function public.readings_manifest(p_since timestamptz, p_until timestamptz)
returns table (device_id text, hour timestamptz, n bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_until <= p_since or p_until - p_since > interval '48 hours' then
    raise exception 'readings_manifest: the window must be positive and at most 48 hours (asked % to %)', p_since, p_until;
  end if;
  return query
    select r.device_id, date_trunc('hour', r.ts) as hour, count(*) as n
      from readings r
     where r.ts >= p_since and r.ts < p_until
     group by 1, 2
     order by 2, 1;
end;
$$;

create or replace function public.building_totals_manifest(p_since timestamptz, p_until timestamptz)
returns table (hour timestamptz, n bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_until <= p_since or p_until - p_since > interval '48 hours' then
    raise exception 'building_totals_manifest: the window must be positive and at most 48 hours (asked % to %)', p_since, p_until;
  end if;
  return query
    select date_trunc('hour', b.ts) as hour, count(*) as n
      from building_totals b
     where b.ts >= p_since and b.ts < p_until
     group by 1
     order by 1;
end;
$$;

-- The janitor runs as the service role. Nobody signed in needs these, so nobody signed in gets them.
revoke all on function public.readings_manifest(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.readings_manifest(timestamptz, timestamptz) to service_role;
revoke all on function public.building_totals_manifest(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.building_totals_manifest(timestamptz, timestamptz) to service_role;

notify pgrst, 'reload schema';
