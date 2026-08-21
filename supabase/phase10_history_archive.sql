-- Architecture plan Phase 10: a read path for the permanent archive.
--
-- THE GAP THIS CLOSES:
-- Phase 9 built `readings_hourly` specifically so long-range history would survive the
-- 30-day prune (supabase/phase9_readings_hourly.sql), and `server/retention.mjs` has been
-- filling it. Nothing ever read it. `readings_buckets` selects from `readings` alone, and
-- the frontend only ever called that — so the archive was write-only, and any window older
-- than the retention period was unreachable by the application. That was invisible while
-- every query still landed inside the raw window, and would have become "the history is
-- gone" the first time one did not.
--
-- WHY A SECOND FUNCTION RATHER THAN CHANGING readings_buckets:
-- the two answer different questions. `readings_buckets` serves the 7d/30d charts at
-- sub-hour resolution from raw rows; this serves month- and year-scale questions across the
-- retention boundary, where hourly is the finest grain that exists. Widening the first to do
-- both would mean one function whose resolution silently depends on how old the window is.
--
-- WHY THE SEAM IS DEDUPLICATED:
-- `roll_up_and_prune_readings` rolls up and deletes in one transaction, so an hour should
-- never exist in both tables. But that function uses `on conflict do nothing` precisely
-- because raw rows for an already-rolled-up hour COULD come back (its header says so). If
-- that ever happens, a naive union counts the hour twice and silently doubles a reported
-- total. The rollup wins for any hour it holds; raw is consulted only for hours it does not.
--
-- WHY THE COARSER BUCKETS ARE WEIGHTED:
-- rolling hourly averages up to a day or a month is an average of averages. A flat
-- `avg(power_w_avg)` treats an hour with 3 online samples as equal to an hour with 60, which
-- is wrong in exactly the situation this system is in most often — partial coverage during
-- an outage. Each hour is weighted by its own `online_sample_count`.
--
-- WHY THE BUCKET FLOOR IS ONE HOUR:
-- `readings_hourly` has no sub-hour detail. Accepting a smaller bucket would return real
-- values inside the raw window and fabricated ones outside it, with nothing in the response
-- to distinguish them. Asking for something this function cannot honestly answer is an
-- error, not a rounding.
--
-- NOTE ON BUCKET ALIGNMENT: buckets are epoch-aligned, so a 86400-second bucket is a UTC
-- day, not a local one. Callers needing local-day or calendar-month boundaries must handle
-- that themselves — this function will not pretend to know the site's timezone.
--
-- Apply once, by hand, in the Supabase SQL editor. No migration runner in this repo; same
-- convention as phase4_/.../phase9_*.sql.

create or replace function public.readings_archive(
  p_device_id      text,
  p_since          timestamptz,
  p_until          timestamptz,
  p_bucket_seconds int
)
returns table (
  ts             timestamptz,
  power_w        numeric,
  power_w_max    numeric,
  voltage        numeric,
  current        numeric,
  energy_kwh_max numeric,
  sample_count   int,
  online_count   int
)
language plpgsql
stable
-- security invoker (the default, stated because it is load-bearing): RLS on `readings` and
-- `readings_hourly` is what keeps this data behind a login. A definer function would run as
-- its owner and hand every reading to any caller, undoing phase5_lockdown_rls.sql.
security invoker
as $fn$
declare
  max_buckets constant int := 900;
  span_seconds numeric;
  would_return numeric;
begin
  if p_bucket_seconds is null or p_bucket_seconds < 3600 or mod(p_bucket_seconds, 3600) <> 0 then
    raise exception
      'p_bucket_seconds must be a positive multiple of 3600 (got %) - readings_hourly has no finer grain',
      p_bucket_seconds
      using errcode = '22023';
  end if;

  if p_since is null or p_until is null or p_until <= p_since then
    raise exception 'p_until (%) must be after p_since (%)', p_until, p_since
      using errcode = '22023';
  end if;

  span_seconds := extract(epoch from (p_until - p_since));
  would_return := ceil(span_seconds / p_bucket_seconds);
  if would_return > max_buckets then
    raise exception
      'readings_archive would return % buckets, over the % cap; use a larger p_bucket_seconds',
      would_return, max_buckets
      using errcode = '22023';
  end if;

  return query
  with raw_hours as (
    -- Hours still held at full resolution. Aggregated to the same shape readings_hourly
    -- stores, so the two halves of the union are directly comparable.
    select date_trunc('hour', r.ts)                          as hour,
           avg(r.power_w)          filter (where r.online)   as power_w_avg,
           max(r.power_w)          filter (where r.online)   as power_w_max,
           avg(r.voltage)          filter (where r.online)   as voltage_avg,
           avg(r.current)          filter (where r.online)   as current_avg,
           max(r.energy_kwh_today) filter (where r.online)   as energy_kwh_today_max,
           count(*)::int                                     as sample_count,
           count(*) filter (where r.online)::int             as online_sample_count
      from readings r
     where r.device_id = p_device_id
       and r.ts >= p_since
       and r.ts <  p_until
     group by 1
  ),
  merged as (
    select h.hour, h.power_w_avg, h.power_w_max, h.voltage_avg, h.current_avg,
           h.energy_kwh_today_max, h.sample_count, h.online_sample_count
      from readings_hourly h
     where h.device_id = p_device_id
       and h.hour >= p_since
       and h.hour <  p_until
    union all
    select rh.hour, rh.power_w_avg, rh.power_w_max, rh.voltage_avg, rh.current_avg,
           rh.energy_kwh_today_max, rh.sample_count, rh.online_sample_count
      from raw_hours rh
     -- The rollup wins the seam. See this file's header for why an overlap is possible at
     -- all, and why counting it twice would be worse than any alternative.
     where not exists (
             select 1
               from readings_hourly h2
              where h2.device_id = p_device_id
                and h2.hour = rh.hour
           )
  )
  select to_timestamp(
           floor(extract(epoch from m.hour) / p_bucket_seconds) * p_bucket_seconds
         )                                                             as ts,
         -- Weighted by each hour's own online sample count. The denominator is filtered to
         -- the hours that actually contributed a value: an unmetered device can be online
         -- with a null reading, and counting its samples would dilute the average with
         -- weight it never carried.
         sum(m.power_w_avg * m.online_sample_count)
           / nullif(sum(m.online_sample_count) filter (where m.power_w_avg is not null), 0)
                                                                       as power_w,
         max(m.power_w_max)                                            as power_w_max,
         sum(m.voltage_avg * m.online_sample_count)
           / nullif(sum(m.online_sample_count) filter (where m.voltage_avg is not null), 0)
                                                                       as voltage,
         sum(m.current_avg * m.online_sample_count)
           / nullif(sum(m.online_sample_count) filter (where m.current_avg is not null), 0)
                                                                       as current,
         -- The daily counter's high-water mark within the bucket. Correct for a bucket that
         -- is one day or less; across a longer bucket this is the largest single day, NOT a
         -- total. Summing days into a period total is the report's job, not this function's.
         max(m.energy_kwh_today_max)                                   as energy_kwh_max,
         sum(m.sample_count)::int                                      as sample_count,
         sum(m.online_sample_count)::int                               as online_count
    from merged m
   group by 1
   order by 1;
end;
$fn$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which would include the
-- `anon` role. RLS would still block the rows (security invoker, and phase5 left anon with
-- no select policy on either source table), but defence in depth: revoke first, then grant
-- only to the role meant to call this.
revoke execute on function public.readings_archive(text, timestamptz, timestamptz, int) from public;
grant  execute on function public.readings_archive(text, timestamptz, timestamptz, int) to authenticated;
