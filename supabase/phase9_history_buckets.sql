-- Architecture plan Phase 9a: server-side bucketed history for the Analytics 7d/30d ranges.
--
-- WHY THIS FUNCTION EXISTS AT ALL — the bug it fixes:
-- src/lib/supabaseHistory.ts used to select raw `readings` rows with no .limit() and no
-- pagination, trusting that "no limit" meant "every row". PostgREST caps every result at
-- db-max-rows (1000 on this project) and says nothing: no error, no flag, just a shorter
-- array. Combined with `order by ts asc`, the 1000 rows kept were the OLDEST in the window.
-- Measured on the live Pi on 2026-08-21: 6,614 rows existed in mtr_co_yellow's 7-day
-- window, the query returned 1,000 of them, and the resulting "7d" chart showed 17h39m of
-- data ending FOUR DAYS in the past — rendered with axes and a plausible curve, and wrong.
-- An explicit limit=20000 still returns 1000; db-max-rows cannot be raised from the client,
-- so no client-side change alone could have fixed this. Aggregating in Postgres is the fix:
-- a bounded number of buckets is returned no matter how many rows underlie them.
--
-- This is the read-path twin of the write-path bug fixed in 2e4c0c2, where PostgREST
-- reported an RLS-blocked write as a plain 200 with an empty array. Same lesson both times:
-- an implicit limit from an external service is not a contract. Never infer completeness
-- from a response that has no way to signal truncation.
--
-- WHY `filter (where r.online)`:
-- shared/buildLatest.mjs already refuses to let a disconnected meter contribute its frozen
-- last reading to building totals (EX-063). The long-range chart threw that away by not
-- even SELECTING `online` — so with 18 of 20 devices offline on 2026-08-21, the 7d chart
-- would have drawn mtr_co_yellow's frozen 746.5 W as a flat, real-looking line. Averaging
-- only online samples restores the invariant: a bucket with no online sample yields NULL,
-- and mapReadingsRows() already drops NULL power as a gap rather than coercing it to 0.
-- "No data" and "zero watts" are different facts, in this layer as in every other.
--
-- WHY security invoker (the default, stated explicitly because it is load-bearing):
-- RLS on `readings` is what keeps this data behind a login. A security definer function
-- would run as its owner and hand every reading to any caller, silently undoing
-- phase5_lockdown_rls.sql. Invoker keeps readings_select_authenticated in force.
--
-- Apply once, by hand, in the Supabase SQL editor. No migration runner in this repo; same
-- convention as phase4_/.../phase8_*.sql.

-- Ceiling on rows this function may return. Deliberately below PostgREST's db-max-rows so
-- the cap that caused the original bug can never be the thing that truncates the answer.
-- If a caller asks for a bucket size that would exceed this, the function RAISES rather
-- than quietly returning a short array — the whole point of this migration.
create or replace function public.readings_buckets(
  p_device_id      text,
  p_since          timestamptz,
  p_bucket_seconds int
)
returns table (
  ts           timestamptz,
  power_w      numeric,
  voltage      numeric,
  current      numeric,
  sample_count int,
  online_count int
)
language plpgsql
stable
security invoker
as $$
declare
  max_buckets constant int := 900;
  span_seconds numeric;
  would_return numeric;
begin
  if p_bucket_seconds is null or p_bucket_seconds < 60 then
    raise exception 'p_bucket_seconds must be at least 60 (got %)', p_bucket_seconds
      using errcode = '22023';
  end if;

  span_seconds := extract(epoch from (now() - p_since));
  would_return := ceil(span_seconds / p_bucket_seconds);
  if would_return > max_buckets then
    raise exception
      'readings_buckets would return % buckets, over the % cap; use a larger p_bucket_seconds',
      would_return, max_buckets
      using errcode = '22023';
  end if;

  return query
    select to_timestamp(
             floor(extract(epoch from r.ts) / p_bucket_seconds) * p_bucket_seconds
           )                                        as ts,
           avg(r.power_w) filter (where r.online)   as power_w,
           avg(r.voltage) filter (where r.online)   as voltage,
           avg(r.current) filter (where r.online)   as current,
           count(*)::int                            as sample_count,
           count(*) filter (where r.online)::int    as online_count
      from readings r
     where r.device_id = p_device_id
       and r.ts >= p_since
     group by 1
     order by 1;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which would include the
-- `anon` role. RLS would still block the rows (security invoker, and phase5 left anon with
-- no select policy on readings), but defence in depth: revoke first, then grant only to
-- the one role that is meant to call this.
revoke execute on function public.readings_buckets(text, timestamptz, int) from public;
grant  execute on function public.readings_buckets(text, timestamptz, int) to authenticated;
