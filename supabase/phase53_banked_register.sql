-- =============================================================================
-- Phase 53 — RM-155. A circuit's energy is banked across a fall in its meter's register.
--
-- WHAT WAS WRONG. phase42's rule reads each hour's HIGHEST `energy_kwh_today` and credits its rise over
-- the hour before. When the register falls inside an hour — a restart, or the channel swap of
-- 2026-09-23 — what the circuit used between that top and the fall is lost: the next hours' highest
-- readings are lower, so nothing is credited until the register climbs past the old top. Measured
-- read-only on 2026-10-01 over every raw minute the cloud held (E-235): on 23 Sep at 11:20
-- `mtr_co_yellow` fell from 5.322 to 0.290 kWh and counted on from there. The rule stored 11.21 kWh for
-- that day; the circuit's own power integrates to 14.22; banked, the register gives 13.91. That one fall
-- is most of why the week of 21 Sep reads 77.88 kWh on its circuits and 80.53 on the building's counter.
--
-- THE RULE. Inside one device's local day, over its online readings in time order: the first counts from
-- local midnight; each later one adds what the register rose by since the one before it; a fall adds
-- nothing, and counting goes on from the lower value. That is the register BANKED across the fall, the
-- way the bridge's own accumulator banks it (node-red-bridge/energyAccumulator.mjs). A register that never
-- falls banks to exactly itself, so a healthy day keeps its figure to the last digit. phase42's cap is
-- untouched and still judges every hour, so a jump is clipped exactly as before.
--
-- Banking needs the order of the readings, and an hour's highest reading has thrown the order away. So
-- each hour is reduced to three numbers: the register at its first reading, at its last, and what it rose
-- by between them. An hour joins the one before through that one's last reading. Raw minutes are reduced
-- inside the report functions; the rollup now keeps the same three in `readings_hourly`, so an hour
-- pruned after this file banks exactly as it did while raw. An hour rolled up before this file kept only
-- its highest reading; read as its first and its last alike, with nothing risen inside it, it banks to
-- exactly phase42's rule.
--
-- NOT A RATE CHECK ON EACH READING. The bridge's accumulator also refuses any step faster than the
-- branch could draw. Tried against the same minutes and rejected: these registers report in bursts
-- (0.238 kWh in 3.4 minutes, then nothing), and the check took 0.82 kWh of real energy out of 24 Sep,
-- a day nothing fell. The hourly cap stays the guard against a jump. A register that dips and comes
-- back inside an hour is counted twice for the dip; the largest seen was 0.04 kWh (29 Sep, 02:14).
--
-- WHAT THIS FILE DOES.
--   1. `readings_hourly` gains `energy_kwh_today_first`, `energy_kwh_today_last` and `energy_kwh_gain`;
--      `period_reports` gains `energy_kwh_before`, written only by step 5.
--   2. `register_gain(numeric[])`: what an ordered run of readings rose by, a fall adding nothing.
--   3. Before anything is replaced, every stored period that still holds raw minutes is counted with
--      the functions as they stand, and kept in a setting of this session (`ibems.phase53_before`), not a
--      table — see NO TABLE below.
--   4. `report_device_daily_energy` and `report_hour_energy` bank the register, and
--      `roll_up_and_prune_readings` keeps the three numbers. Each is phase47's text with only the lines
--      that carry the register changed; test/phase53-banked-register-schema.test.mjs holds that.
--   5. A stored device row is restated only when it still equals what step 3 counted — so it was built
--      from these readings by the old rule — and banking changes it. `energy_kwh_before` keeps the figure
--      it first had. Coverage, peak, average and `generated_at` are never touched (RM-073); building rows
--      are the bridge's counter and are not touched either.
--
-- `counter_kwh` from report_device_daily_energy is now the banked register: the counter's own high-water
-- mark on any day it never fell. `removed_kwh` is still that less the credited energy on a day an hour
-- was clipped, which is now exactly the jump that was not counted.
--
-- Expected on the live project: `mtr_co_yellow` restated for 23 Sep (11.21 -> 13.91 kWh), 26 Sep
-- (+0.02) and 29 Sep (+0.03), and for any stored week or month that holds those days; nothing else.
-- The four circuits' week of 21 Sep then reads about 80.60 kWh against the counter's 80.53.
--
-- NO TABLE. The first version kept step 3 in a temporary table and dropped it at the end. The SQL editor
-- stops on a script that creates a table without row level security, and its "Run and enable RLS" appends
-- an `alter table … enable row level security` after the script — after the drop — so the paste failed and
-- rolled back whole (2026-10-01; nothing was applied). This file creates no table and drops nothing.
--
-- SAFE TO RE-RUN. Columns are added `if not exists`; every function keeps its signature and OUT columns;
-- a second paste counts step 3 with the new functions, so nothing changes and nothing is restated. No
-- policy, trigger or constraint is created, and `readings` is not altered. It applies the same as one
-- transaction (as the SQL editor runs it) or statement by statement. Apply by hand in the Supabase
-- SQL editor; rehearsed by `supabase/rehearse.sh`, which applies it twice. APPLY BEFORE ABOUT 2026-10-07,
-- when the rollup prunes 23 Sep's minutes and that fall can no longer be banked from the cloud.
-- =============================================================================

alter table readings_hourly add column if not exists energy_kwh_today_first numeric;
alter table readings_hourly add column if not exists energy_kwh_today_last  numeric;
alter table readings_hourly add column if not exists energy_kwh_gain        numeric;
alter table period_reports  add column if not exists energy_kwh_before      numeric;

-- =============================================================================
-- register_gain — what an ordered run of register readings rose by, reading to reading. A fall adds
-- nothing, and the next rise counts from the lower value. NULL for no readings; 0 for one.
-- =============================================================================
create or replace function public.register_gain(p_values numeric[])
returns numeric
language sql
immutable
parallel safe
as $fn$
  select case when cardinality(p_values) > 0 then
           coalesce((select sum(greatest(p_values[i] - p_values[i - 1], 0))
                       from generate_subscripts(p_values, 1) as g(i)
                      where i > array_lower(p_values, 1)), 0)
         end
$fn$;

revoke execute on function public.register_gain(numeric[]) from public, anon;
grant  execute on function public.register_gain(numeric[]) to authenticated, service_role;

-- =============================================================================
-- Step 3: what every stored period that can change was built from, counted by the functions as they
-- stand — before any of them is replaced. Only a period whose window still holds raw minutes can change:
-- an hour already rolled up banks to the rule it was stored by.
-- =============================================================================
do $$
declare
  r record;
  snap jsonb := '[]'::jsonb;
begin
  for r in
    select distinct p.period, p.period_start
      from period_reports p
      cross join lateral public.report_window(p.period, p.period_start) w
     where exists (select 1 from readings x where x.ts >= w.win_start and x.ts < w.win_end)
     order by 1, 2
  loop
    snap := snap || coalesce((
      select jsonb_agg(jsonb_build_object('period', r.period, 'period_start', r.period_start,
                                          'device_id', g.device_id, 'energy_kwh', g.e))
        from (select x.device_id, sum(x.energy_kwh) as e
                from public.report_device_daily_energy(r.period, r.period_start) x
               group by x.device_id) g
    ), '[]'::jsonb);
  end loop;
  -- For this session, not this transaction: the same whether the paste runs as one or statement by statement.
  perform set_config('ibems.phase53_before', snap::text, false);
end $$;

-- =============================================================================
-- roll_up_and_prune_readings — phase47's, keeping the register's first and last reading of each hour and
-- what it rose by between them. Nothing else changes.
-- =============================================================================
create or replace function public.roll_up_and_prune_readings(p_before timestamptz)
returns table (rolled int, deleted int)
language plpgsql
volatile
security invoker
as $$
declare
  cutoff timestamptz := date_trunc('hour', p_before);
  n_rolled int;
  n_deleted int;
begin
  insert into readings_hourly (
    device_id, hour, power_w_avg, power_w_max, voltage_avg, current_avg,
    energy_kwh_today_max, sample_count, online_sample_count, held_sample_count,
    energy_kwh_today_first, energy_kwh_today_last, energy_kwh_gain
  )
  with spaced as (
    select r.device_id,
           r.ts,
           r.power_w,
           r.voltage,
           r.current,
           r.energy_kwh_today,
           r.online,
           public.reading_measured(r.online, r.capabilities) as measured,
           -- How much time this sample stands for. See the header for both bounds.
           least(
             coalesce(
               extract(epoch from (
                 r.ts - lag(r.ts) over (partition by r.device_id order by r.ts)
               )),
               60
             ),
             300
           )::numeric as weight_s
      from readings r
     where r.ts < cutoff
  )
  select s.device_id,
         date_trunc('hour', s.ts),
         -- Time-weighted. The denominator counts only the weight of samples that actually
         -- carried a value for THIS column — see the header's note on phase10.
         sum(s.power_w * s.weight_s) filter (where s.measured)
           / nullif(sum(s.weight_s) filter (where s.measured and s.power_w is not null), 0),
         max(s.power_w)              filter (where s.measured),
         sum(s.voltage * s.weight_s) filter (where s.measured)
           / nullif(sum(s.weight_s) filter (where s.measured and s.voltage is not null), 0),
         sum(s.current * s.weight_s) filter (where s.measured)
           / nullif(sum(s.weight_s) filter (where s.measured and s.current is not null), 0),
         max(s.energy_kwh_today)     filter (where s.online),
         count(*)::int,
         count(*) filter (where s.measured)::int,
         count(*) filter (where s.online and not s.measured)::int,
         -- RM-155: the register as banking reads an hour, in time order: first, last, and what it rose by.
         (array_agg(s.energy_kwh_today order by s.ts)      filter (where s.online and s.energy_kwh_today is not null))[1],
         (array_agg(s.energy_kwh_today order by s.ts desc) filter (where s.online and s.energy_kwh_today is not null))[1],
         public.register_gain(array_agg(s.energy_kwh_today order by s.ts) filter (where s.online and s.energy_kwh_today is not null))
    from spaced s
   group by 1, 2
  on conflict (device_id, hour) do nothing;
  get diagnostics n_rolled = row_count;

  delete from readings r where r.ts < cutoff;
  get diagnostics n_deleted = row_count;

  return query select n_rolled, n_deleted;
end;
$$;

revoke execute on function public.roll_up_and_prune_readings(timestamptz) from public;
grant  execute on function public.roll_up_and_prune_readings(timestamptz) to service_role;

-- =============================================================================
-- report_device_daily_energy — phase47's, with the register banked. Nothing else changes: the cap, the
-- clip, the peak, the average, the minutes and the resolution are the same lines.
-- =============================================================================
create or replace function public.report_device_daily_energy(
  p_period     text,
  p_start      date,
  p_tz         text   default 'Asia/Manila',
  -- NULL reads every device. The page passes the ones it charts; the generators pass nothing.
  p_device_ids text[] default null
)
returns table (
  device_id        text,
  local_day        date,
  -- Bounded. NULL when no hour of the day carried a counter.
  energy_kwh       numeric,
  -- The counter's own high-water mark: what a report summed before this file.
  counter_kwh      numeric,
  -- counter - energy on a day an hour was clipped; NULL when none was.
  removed_kwh      numeric,
  clipped_hours    int,
  peak_power_w     numeric,
  avg_power_w      numeric,
  online_minutes   int,
  -- The day's minutes inside the window, and only those already past.
  expected_minutes int,
  -- 'minute' | 'hour' | 'mixed', from where the day's hours came; NULL for a day with none.
  resolution       text
)
language plpgsql
stable
security invoker
as $fn$
declare
  w_start timestamptz;
  w_end   timestamptz;
begin
  -- The window is `report_window`'s, never re-derived here. It raises for an unknown period.
  select rw.win_start, rw.win_end into w_start, w_end
    from public.report_window(p_period, p_start, p_tz) rw;

  return query
  with hrs (dev, bucket, avg_w, max_w, e_first, e_last, e_gain, n_on, from_raw) as (
    -- An hour rolled up before phase53 kept only its highest reading. Read as its first and its last alike,
    -- with nothing risen inside it, it banks to exactly phase42's rule.
    select h.device_id, h.hour, h.power_w_avg, h.power_w_max,
           coalesce(h.energy_kwh_today_first, h.energy_kwh_today_max),
           coalesce(h.energy_kwh_today_last,  h.energy_kwh_today_max),
           coalesce(h.energy_kwh_gain, 0),
           h.online_sample_count, false
      from readings_hourly h
     where h.hour >= w_start and h.hour < w_end
       and (p_device_ids is null or h.device_id = any(p_device_ids))
    union all
    select r.device_id,
           date_trunc('hour', r.ts),
           avg(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           max(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           (array_agg(r.energy_kwh_today order by r.ts)      filter (where r.online and r.energy_kwh_today is not null))[1],
           (array_agg(r.energy_kwh_today order by r.ts desc) filter (where r.online and r.energy_kwh_today is not null))[1],
           public.register_gain(array_agg(r.energy_kwh_today order by r.ts) filter (where r.online and r.energy_kwh_today is not null)),
           (count(*) filter (where public.reading_measured(r.online, r.capabilities)))::int,
           true
      from readings r
     where r.ts >= w_start and r.ts < w_end
       and (p_device_ids is null or r.device_id = any(p_device_ids))
       -- The rollup wins the seam, exactly as in phase27.
       and not exists (
             select 1 from readings_hourly h2
              where h2.device_id = r.device_id and h2.hour = date_trunc('hour', r.ts))
     group by r.device_id, date_trunc('hour', r.ts)
  ),
  -- RM-155: the register BANKED across a fall, per device and local day, over the hours that carry it:
  -- each hour adds what it rose by inside itself, plus any rise from the hour before's last reading to
  -- its first. A fall adds nothing and counting goes on from the lower value. A register that never
  -- falls banks to exactly its highest reading, so `e_max` below is what it always was.
  registers as (
    select q.dev, q.bucket,
           sum(greatest(q.e_first - coalesce(q.prev_last, 0), 0) + q.e_gain)
             over (partition by q.dev, q.d order by q.bucket) as e_banked
      from (
        select x.dev, x.bucket, x.e_first, x.e_gain,
               (x.bucket at time zone p_tz)::date as d,
               lag(x.e_last) over (partition by x.dev, (x.bucket at time zone p_tz)::date order by x.bucket) as prev_last
          from hrs x
         where x.e_last is not null
      ) q
  ),
  dayed as (
    select x.dev, x.bucket, x.avg_w, x.max_w, bk.e_banked as e_max, x.n_on, x.from_raw,
           (x.bucket at time zone p_tz)::date as d
      from hrs x
      left join registers bk on bk.dev = x.dev and bk.bucket = x.bucket
  ),
  -- The most the device drew that day. The cap is built from it, so an hour of low draw inside a
  -- busy day is not judged by its own quiet minutes.
  peaks as (
    select y.dev, y.d, max(y.max_w) as day_peak_w
      from dayed y
     group by y.dev, y.d
  ),
  -- Rise by rise, inside one device's one local day, over the hours that carry a counter.
  stepped as (
    select s.dev, s.d, s.bucket, s.avg_w, s.e_max,
           lag(s.e_max)  over win as prev_e,
           lag(s.bucket) over win as prev_bucket
      from dayed s
     where s.e_max is not null
    window win as (partition by s.dev, s.d order by s.bucket)
  ),
  judged as (
    select j.dev, j.d, j.avg_w,
           j.e_max - coalesce(j.prev_e, 0) as rise,
           -- From the previous counted hour; for the first, from local midnight to this hour's end,
           -- which is `bucket - (midnight - 1 hour)`.
           extract(epoch from (j.bucket - coalesce(j.prev_bucket, (j.d::timestamp at time zone p_tz) - interval '1 hour'))) / 3600.0 as span_h,
           pk.day_peak_w
      from stepped j
      join peaks pk on pk.dev = j.dev and pk.d = j.d
  ),
  capped as (
    select c.dev, c.d, c.avg_w, c.rise, c.span_h, c.day_peak_w,
           (c.day_peak_w / 1000.0) * (c.span_h + 1) * 1.10 + 0.005 as cap_kwh
      from judged c
  ),
  credited as (
    select k.dev, k.d,
           case
             -- The counter fell: a restart or a repaired base. Nothing to credit; the next rise
             -- counts from here.
             when k.rise <= 0 then 0
             -- More than the circuit could have drawn: its measured power instead, never above the cap.
             when k.day_peak_w > 0 and k.rise > k.cap_kwh
               then least(k.cap_kwh, coalesce(k.avg_w, 0) / 1000.0 * k.span_h)
             else k.rise
           end as credit,
           coalesce(k.rise > 0 and k.day_peak_w > 0 and k.rise > k.cap_kwh, false) as clipped
      from capped k
  ),
  per_day as (
    select p.dev, p.d,
           sum(p.credit) as e,
           (count(*) filter (where p.clipped))::int as n_clip
      from credited p
     group by p.dev, p.d
  ),
  day_stats as (
    select t.dev, t.d,
           max(t.e_max) as counter,
           max(t.max_w) as peak_w,
           sum(t.avg_w * t.n_on) / nullif(sum(t.n_on) filter (where t.avg_w is not null), 0) as avg_w,
           sum(t.n_on)::int as n_on,
           case when bool_and(t.from_raw) then 'minute'
                when bool_or(t.from_raw)  then 'mixed'
                else 'hour' end as res
      from dayed t
     group by t.dev, t.d
  ),
  devs as (
    select distinct z.dev from dayed z
  ),
  days as (
    select generate_series(
             (w_start at time zone p_tz)::date,
             (w_end   at time zone p_tz)::date - 1,
             interval '1 day'
           )::date as d
  )
  select v.dev,
         dd.d,
         pd.e,
         ds.counter,
         case when pd.n_clip > 0 then greatest(ds.counter - pd.e, 0) end,
         coalesce(pd.n_clip, 0),
         ds.peak_w,
         ds.avg_w,
         coalesce(ds.n_on, 0),
         greatest(
           (extract(epoch from (least(((dd.d + 1)::timestamp at time zone p_tz), w_end, now())
                                - (dd.d::timestamp at time zone p_tz))) / 60)::int,
           0
         ),
         ds.res
    from devs v
   cross join days dd
    left join per_day   pd on pd.dev = v.dev and pd.d = dd.d
    left join day_stats ds on ds.dev = v.dev and ds.d = dd.d
   order by v.dev, dd.d;
end;
$fn$;

revoke execute on function public.report_device_daily_energy(text, date, text, text[]) from public, anon;
grant  execute on function public.report_device_daily_energy(text, date, text, text[]) to authenticated, service_role;

-- =============================================================================
-- report_hour_energy — phase47's, with the register banked, so a day's hours still sum to its figure.
-- =============================================================================
create or replace function public.report_hour_energy(
  p_period     text,
  p_start      date,
  p_tz         text   default 'Asia/Manila',
  -- NULL reads every device. The page passes the ones it charts.
  p_device_ids text[] default null
)
returns table (
  device_id       text,
  local_day       date,
  local_hour      int,
  -- Credited by phase42's rule. NULL when the hour carried no counter.
  energy_kwh      numeric,
  -- True when the counter's rise was over the cap and the measured power was credited instead.
  clipped         boolean,
  avg_power_w     numeric,
  max_power_w     numeric,
  online_minutes  int,
  -- 'minute' | 'hour', from where the hour's figures came; NULL for an hour with none.
  resolution      text
)
language plpgsql
stable
security invoker
as $fn$
declare
  w_start timestamptz;
  w_end   timestamptz;
  n_devs  int;
  n_hours int;
begin
  select rw.win_start, rw.win_end into w_start, w_end
    from public.report_window(p_period, p_start, p_tz) rw;

  n_hours := ((w_end at time zone p_tz)::date - (w_start at time zone p_tz)::date) * 24;
  select count(distinct d.id) into n_devs
    from devices d
   where p_device_ids is null or d.id = any(p_device_ids);
  if n_hours * greatest(n_devs, 1) > 900 then
    raise exception 'report_hour_energy would return % rows, over the 900 cap; PostgREST truncates at 1000 silently — ask for a day, or fewer devices', n_hours * n_devs
      using errcode = 'program_limit_exceeded';
  end if;

  return query
  with hrs (dev, bucket, avg_w, max_w, e_first, e_last, e_gain, n_on, from_raw) as (
    -- An hour rolled up before phase53 kept only its highest reading. Read as its first and its last alike,
    -- with nothing risen inside it, it banks to exactly phase42's rule.
    select h.device_id, h.hour, h.power_w_avg, h.power_w_max,
           coalesce(h.energy_kwh_today_first, h.energy_kwh_today_max),
           coalesce(h.energy_kwh_today_last,  h.energy_kwh_today_max),
           coalesce(h.energy_kwh_gain, 0),
           h.online_sample_count, false
      from readings_hourly h
     where h.hour >= w_start and h.hour < w_end
       and (p_device_ids is null or h.device_id = any(p_device_ids))
    union all
    select r.device_id,
           date_trunc('hour', r.ts),
           avg(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           max(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           (array_agg(r.energy_kwh_today order by r.ts)      filter (where r.online and r.energy_kwh_today is not null))[1],
           (array_agg(r.energy_kwh_today order by r.ts desc) filter (where r.online and r.energy_kwh_today is not null))[1],
           public.register_gain(array_agg(r.energy_kwh_today order by r.ts) filter (where r.online and r.energy_kwh_today is not null)),
           (count(*) filter (where public.reading_measured(r.online, r.capabilities)))::int,
           true
      from readings r
     where r.ts >= w_start and r.ts < w_end
       and (p_device_ids is null or r.device_id = any(p_device_ids))
       and not exists (
             select 1 from readings_hourly h2
              where h2.device_id = r.device_id and h2.hour = date_trunc('hour', r.ts))
     group by r.device_id, date_trunc('hour', r.ts)
  ),
  -- RM-155: the register BANKED across a fall, per device and local day, over the hours that carry it:
  -- each hour adds what it rose by inside itself, plus any rise from the hour before's last reading to
  -- its first. A fall adds nothing and counting goes on from the lower value. A register that never
  -- falls banks to exactly its highest reading, so `e_max` below is what it always was.
  registers as (
    select q.dev, q.bucket,
           sum(greatest(q.e_first - coalesce(q.prev_last, 0), 0) + q.e_gain)
             over (partition by q.dev, q.d order by q.bucket) as e_banked
      from (
        select x.dev, x.bucket, x.e_first, x.e_gain,
               (x.bucket at time zone p_tz)::date as d,
               lag(x.e_last) over (partition by x.dev, (x.bucket at time zone p_tz)::date order by x.bucket) as prev_last
          from hrs x
         where x.e_last is not null
      ) q
  ),
  dayed as (
    select x.dev, x.bucket, x.avg_w, x.max_w, bk.e_banked as e_max, x.n_on, x.from_raw,
           (x.bucket at time zone p_tz)::date as d
      from hrs x
      left join registers bk on bk.dev = x.dev and bk.bucket = x.bucket
  ),
  peaks as (
    select y.dev, y.d, max(y.max_w) as day_peak_w
      from dayed y
     group by y.dev, y.d
  ),
  stepped as (
    select s.dev, s.d, s.bucket, s.avg_w, s.e_max,
           lag(s.e_max)  over win as prev_e,
           lag(s.bucket) over win as prev_bucket
      from dayed s
     where s.e_max is not null
    window win as (partition by s.dev, s.d order by s.bucket)
  ),
  judged as (
    select j.dev, j.d, j.bucket, j.avg_w,
           j.e_max - coalesce(j.prev_e, 0) as rise,
           extract(epoch from (j.bucket - coalesce(j.prev_bucket, (j.d::timestamp at time zone p_tz) - interval '1 hour'))) / 3600.0 as span_h,
           pk.day_peak_w
      from stepped j
      join peaks pk on pk.dev = j.dev and pk.d = j.d
  ),
  capped as (
    select c.dev, c.d, c.bucket, c.avg_w, c.rise, c.span_h, c.day_peak_w,
           (c.day_peak_w / 1000.0) * (c.span_h + 1) * 1.10 + 0.005 as cap_kwh
      from judged c
  ),
  credited as (
    select k.dev, k.d, k.bucket,
           case
             when k.rise <= 0 then 0
             when k.day_peak_w > 0 and k.rise > k.cap_kwh
               then least(k.cap_kwh, coalesce(k.avg_w, 0) / 1000.0 * k.span_h)
             else k.rise
           end as credit,
           coalesce(k.rise > 0 and k.day_peak_w > 0 and k.rise > k.cap_kwh, false) as clipped
      from capped k
  ),
  devs as (
    select distinct z.dev from dayed z
  ),
  grid as (
    select gd::date as d, gh as h
      from generate_series(
             (w_start at time zone p_tz)::date,
             (w_end   at time zone p_tz)::date - 1,
             interval '1 day'
           ) gd,
           generate_series(0, 23) gh
  )
  select v.dev,
         g.d,
         g.h,
         cr.credit,
         coalesce(cr.clipped, false),
         o.avg_w,
         o.max_w,
         coalesce(o.n_on, 0),
         case when o.dev is null then null when o.from_raw then 'minute' else 'hour' end
    from devs v
   cross join grid g
    left join dayed o
      on o.dev = v.dev and o.d = g.d and extract(hour from o.bucket at time zone p_tz)::int = g.h
    left join credited cr
      on cr.dev = v.dev and cr.d = g.d and extract(hour from cr.bucket at time zone p_tz)::int = g.h
   order by v.dev, g.d, g.h;
end;
$fn$;

revoke execute on function public.report_hour_energy(text, date, text, text[]) from public, anon;
grant  execute on function public.report_hour_energy(text, date, text, text[]) to authenticated, service_role;

-- =============================================================================
-- Step 5: the restatement — in phase42's and phase47's pattern.
--
-- ONLY A ROW BUILT BY THE OLD RULE THAT BANKING CHANGES. Both conditions required:
--   - the stored figure still equals what step 3 counted from these readings (within 0.5 Wh), so it was
--     built from them by the rule being replaced — a row generated from other data is left alone;
--   - banking moves it by more than 0.5 Wh.
-- `energy_kwh_before` keeps what the row first said, however often this runs; `energy_removed_kwh` is
-- written as the generator would now write it.
-- =============================================================================
do $$
declare
  r record;
  n int;
  total int := 0;
  snap jsonb := coalesce(nullif(current_setting('ibems.phase53_before', true), '')::jsonb, '[]'::jsonb);
begin
  for r in
    select distinct b.period, b.period_start
      from jsonb_to_recordset(snap) as b(period text, period_start date, device_id text, energy_kwh numeric)
     order by 1, 2
  loop
    with banked as materialized (
      select x.device_id        as dev,
             sum(x.energy_kwh)  as e,
             sum(x.removed_kwh) as removed
        from public.report_device_daily_energy(r.period, r.period_start) x
       group by x.device_id
    )
    update period_reports p
       set energy_kwh_before  = coalesce(p.energy_kwh_before, p.energy_kwh),
           energy_kwh         = f.e,
           energy_removed_kwh = case when f.removed > 0.001 then f.removed end,
           energy_restated_at = now()
      from banked f
      join jsonb_to_recordset(snap) as b(period text, period_start date, device_id text, energy_kwh numeric)
        on b.period = r.period and b.period_start = r.period_start and b.device_id = f.dev
     where p.period = r.period
       and p.period_start = r.period_start
       and p.device_id = f.dev
       and p.energy_kwh is not null
       and f.e is not null
       and abs(p.energy_kwh - b.energy_kwh) <= 0.0005
       and abs(f.e - b.energy_kwh) > 0.0005;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  raise notice 'phase53: restated % stored period_reports row(s)', total;
  perform set_config('ibems.phase53_before', '', false);
end $$;

-- So the API sees the new columns now, rather than after its next schema reload.
notify pgrst, 'reload schema';
