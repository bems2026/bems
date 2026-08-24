-- Phase 15: per-device connectivity summary — uptime and flap count over a window.
--
-- WHY THIS EXISTS:
-- On 2026-08-24 the field devices began dropping off the 2.4 GHz network and rejoining. A
-- 65-second capture of their discovery broadcasts found 13 hosts announcing where there had
-- been 17 half an hour earlier, and every one of the 13 broadcasting at full rate — devices
-- were disassociating cleanly, not fading. None of that was visible from the dashboard, which
-- shows only whether a device is online *right now*. Diagnosing it took a packet capture on the
-- Pi, which is not a thing an operator should need.
--
-- The data to answer it already existed: `readings.online` is `boolean not null` and has been
-- written every 60s per device since ingestion started. Nothing was reading it that way. This
-- is a read-path addition only — no new table, no new column, no change to what is stored.
--
-- WHY AN RPC RATHER THAN A CLIENT QUERY:
-- 20 devices x 1440 samples/day is ~28,800 rows for a 24h window, and PostgREST caps results
-- at db-max-rows (1000 on this project) while reporting nothing — the exact trap
-- phase9_history_buckets.sql was written to escape. Counting transitions also needs `lag()`,
-- which has no PostgREST equivalent. Both reasons point the same way: aggregate in Postgres and
-- return one bounded row per device.
--
-- WHY security invoker (stated because it is load-bearing):
-- RLS on `readings` is what keeps this behind a login. A security definer function would run as
-- its owner and hand the same data to anyone who could call it. Same reasoning as
-- phase9_history_buckets.sql; see that file's fuller note.
--
-- Apply once, by hand, in the Supabase SQL editor. Re-runnable: create or replace.

create or replace function public.device_connectivity(p_window_hours int default 24)
returns table (
  device_id        text,
  samples          bigint,
  online_samples   bigint,
  transitions      bigint,
  last_change      timestamptz,
  currently_online boolean,
  expected_samples int
)
language sql
stable
security invoker
as $$
  with windowed as (
    select
      r.device_id,
      r.ts,
      r.online,
      -- The previous sample for this device, in time order. NULL for the first sample in the
      -- window, which is why the transition count below uses `is distinct from` rather than
      -- `<>`: a NULL predecessor must not silently count as a change.
      lag(r.online) over (partition by r.device_id order by r.ts) as prev_online
    from readings r
    where r.ts >= now() - make_interval(hours => greatest(1, least(p_window_hours, 168)))
  )
  select
    w.device_id,
    count(*)                                                       as samples,
    count(*) filter (where w.online)                               as online_samples,
    count(*) filter (where w.prev_online is not null
                       and w.online is distinct from w.prev_online) as transitions,
    max(w.ts) filter (where w.prev_online is not null
                       and w.online is distinct from w.prev_online) as last_change,
    (array_agg(w.online order by w.ts desc))[1]                    as currently_online,
    -- How many rows the window SHOULD hold, at ingestion's 60s cadence. Returned rather than
    -- assumed by the caller, because `samples` is not the window length: `readings` is keyed
    -- (device_id, ts) and ingestion upserts, so a device carrying a stalled device-reported
    -- timestamp (outlets do — see shared/buildLatest.mjs) overwrites its own row instead of
    -- adding one. Without this, its uptime percentage is computed over a different denominator
    -- than a meter's and the two are not comparable.
    (greatest(1, least(p_window_hours, 168)) * 60)::int              as expected_samples
  from windowed w
  group by w.device_id
  order by w.device_id;
$$;

-- The window is clamped to 1..168 hours inside the function rather than validated at the
-- caller. A week of per-minute rows is ~200k per device and the raw retention window is 30
-- days, so an unclamped caller could ask for something that scans far more than it needs;
-- clamping in one place means every caller inherits the bound.

-- Postgres grants EXECUTE on a new function to PUBLIC, which includes `anon`. RLS would still
-- block the rows (security invoker, and phase 5 left anon with no select policy on readings),
-- but defence in depth: revoke first, then grant only to authenticated.
revoke execute on function public.device_connectivity(int) from public;
grant  execute on function public.device_connectivity(int) to authenticated;

comment on function public.device_connectivity(int) is
  'Per-device uptime and flap count over the last N hours (clamped 1..168), read from readings.online. Read-path only; stores nothing.';
