-- =============================================================================
-- Phase 47 — FI-027's second half. A held minute is not a recorded minute, and its watts are not a
-- measurement.
--
-- WHAT WAS WRONG. Since RM-133 (2026-09-22) a row the bridge flagged frozen carries
-- `capabilities.measurement_frozen`, and since RM-134 a row that stored a figure nobody re-read carries
-- `capabilities.scrub.rule = 'held_reading'`. The reports read neither. A device's Recorded minutes counted
-- every ONLINE row, and its average and peak power, its hourly power series and its typical day averaged
-- the held watts as though the meter had measured them. On 2026-09-22 L.O Yellow held 39.8 W for 6 h 37 min
-- while the circuit drew nothing; its daily report would have called all of it recorded.
--
-- DECIDED BY THE OPERATOR on 2026-09-22: a held minute is not recorded, its power is left out of every
-- power figure, and its ENERGY IS UNTOUCHED — energy comes from the meter's own register, which counts
-- what the circuit used whatever the bridge was showing (0.002 kWh across that hold). Stored reports are
-- restated with a note, the way phase44 restated RM-073.
--
-- WHAT THIS FILE DOES.
--   1. `reading_measured(online, capabilities)`, the one rule, used everywhere below.
--   2. `readings_hourly.held_sample_count`, and the rollup (phase31) keeps held rows out of its power
--      figures and its `online_sample_count` and counts them there — so the distinction survives the
--      30-day prune, and every reader of a rolled hour needs no change.
--   3. The six report functions that read per-device `readings` use the rule where they read `online`,
--      except on the energy register: report_hour_profile (phase37), report_device_daily_energy (phase42),
--      report_recorded_minutes_devices and generate_monthly_report (phase44), report_hour_energy and
--      generate_period_report (phase46). Signatures and OUT columns are unchanged, so each is replaced in
--      place.
--   4. Every stored device report whose Recorded minutes change under the rule is restated: its new count,
--      the average and peak power from measured samples, the first figure it ever said kept in
--      `online_sample_count_before`, and `coverage_restated_at`. Energy, `generated_at` and the building
--      rows are not touched.
--
-- WHAT IS DELIBERATELY NOT CHANGED.
--   - The building rows. `building_totals` carries no per-branch flag, and a minute in which one branch
--     was held still holds the building's reading; the held branch is named on the page (RM-079).
--   - The Analytics history functions, `readings_buckets` (phase9) and `readings_archive` (phase10). The
--     30-day buckets already sit near the statement timeout (FI-034), and they are the charts' series,
--     not a report's figure. Their rolled hours follow the rule through step 2; their raw hours do not
--     yet. Recorded in ROADMAP FI-027.
--   - The phase42 cap's behaviour on normal days. A held hour now carries no power of its own, so a
--     counter jump inside one is credited nothing rather than its held watts, and a day with no measured
--     power is never clipped. Both are the rule; neither moved a figure on this building's data.
--
-- Expected on the live project (read-only, 2026-09-22): no row carries `measurement_frozen`; 396 rows of
-- `mtr_lo_yellow`, 07:45:56–14:20:46 on 2026-09-22, carry `scrub.rule = 'held_reading'`. No stored report
-- covers that day yet (the daily settles at ~01:00 on the 23rd, the week on the 28th, September in
-- October), so step 4 restates nothing unless the 22nd's daily has already been generated.
--
-- SAFE TO RE-RUN. The predicate and the six report functions are `create or replace` with unchanged
-- signatures; the column is `if not exists`; the restatement touches only rows whose count differs, and
-- keeps the first figure a row ever said. No policy, trigger or table rewrite. Apply by hand in the
-- Supabase SQL editor; rehearsed by `supabase/rehearse.sh`, which applies it twice.
-- =============================================================================

-- =============================================================================
-- reading_measured — the one rule: a row is a MEASUREMENT when the device was online AND it is neither
-- flagged frozen by the bridge (RM-079 / RM-133, stored since 2026-09-22) nor restated as a held reading
-- (RM-134's scrub). Immutable, so the planner inlines it into every aggregate below.
-- =============================================================================
create or replace function public.reading_measured(p_online boolean, p_capabilities jsonb)
returns boolean
language sql
immutable
parallel safe
as $fn$
  select coalesce(p_online, false)
     and coalesce(p_capabilities ->> 'measurement_frozen', '') <> 'true'
     and coalesce(p_capabilities #>> '{scrub,rule}', '') <> 'held_reading'
$fn$;

revoke execute on function public.reading_measured(boolean, jsonb) from public, anon;
grant  execute on function public.reading_measured(boolean, jsonb) to authenticated, service_role;

-- =============================================================================
-- readings_hourly — the rollup keeps the distinction once raw rows are pruned. From here on a rolled hour's
-- `online_sample_count` counts the samples that were MEASUREMENTS, which is what every reader of it uses
-- it for (minutes, and the weight of the hour's power average); `held_sample_count` counts the online
-- samples that were held. Hours rolled before phase47 carry NULL here: no row was flagged before
-- 2026-09-22, so there was nothing to count.
-- =============================================================================
alter table readings_hourly add column if not exists held_sample_count int;

-- =============================================================================
-- roll_up_and_prune_readings — phase31's, with held rows out of the power, voltage and current figures and
-- out of `online_sample_count`, and counted in `held_sample_count`. The register maximum keeps every
-- online row: a held row's energy register is the device's own count.
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
    energy_kwh_today_max, sample_count, online_sample_count, held_sample_count
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
         count(*) filter (where s.online and not s.measured)::int
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
-- report_hour_profile — phase37_report_series's, with the rule where it read `r.online`,
-- except on the energy register. Nothing else changes; test/phase47-held-minutes-schema.test.mjs
-- holds that.
-- =============================================================================
create or replace function public.report_hour_profile(
  p_period    text,
  p_start     date,
  p_tz        text default 'Asia/Manila',
  p_device_id text default null
)
returns table (
  local_hour   int,
  n            int,
  p50_w        numeric,
  p95_w        numeric,
  max_w        numeric,
  mean_w       numeric,
  resolution   text
)
language plpgsql
stable
security invoker
as $fn$
declare
  w record;
  res text;
begin
  select * into w from public.report_window(p_period, p_start, p_tz);
  res := public.report_resolution(w.win_start, w.win_end);

  return query
  with samples as (
    select extract(hour from ts at time zone p_tz)::int as h, power_w as v
      from (
        select r.ts, r.power_w
          from readings r
         where p_device_id is not null
           and r.device_id = p_device_id
           and r.ts >= w.win_start and r.ts < w.win_end
           -- Per-device rows DO carry `online`, so a frozen device can be excluded here in a
           -- way `building_totals` never permits.
           and public.reading_measured(r.online, r.capabilities)
        union all
        select h2.hour, h2.power_w_avg
          from readings_hourly h2
         where p_device_id is not null
           and h2.device_id = p_device_id
           and h2.hour >= w.win_start and h2.hour < w.win_end
           and h2.online_sample_count > 0
           and not exists (select 1 from readings r2
                            where r2.device_id = p_device_id
                              and r2.ts >= h2.hour and r2.ts < h2.hour + interval '1 hour')
        union all
        select t.ts, t.total_power_w
          from building_totals t
         where p_device_id is null
           and t.ts >= w.win_start and t.ts < w.win_end
        union all
        select b.hour, b.total_power_w_avg
          from building_totals_hourly b
         where p_device_id is null
           and b.hour >= w.win_start and b.hour < w.win_end
           -- Range, not date_trunc: an index on `ts` can serve this and cannot serve a
           -- function of it.
           and not exists (select 1 from building_totals t2
                            where t2.ts >= b.hour and t2.ts < b.hour + interval '1 hour')
      ) u(ts, power_w)
     where power_w is not null
  ),
  hours as (select generate_series(0, 23) as h)
  select hours.h,
         count(s.v)::int,
         -- Cast back to numeric. `percentile_cont` has no numeric overload: it takes the
         -- sort expression as double precision whatever it was, so an uncast result is a
         -- float in a column declared numeric, and the function fails at RETURN QUERY with
         -- a message that names the column position rather than this line.
         percentile_cont(0.5)  within group (order by s.v)::numeric,
         percentile_cont(0.95) within group (order by s.v)::numeric,
         max(s.v),
         avg(s.v),
         res
    from hours
    left join samples s on s.h = hours.h
   group by hours.h
   order by hours.h;
end;
$fn$;

revoke execute on function public.report_hour_profile(text, date, text, text)        from public, anon;
grant execute on function public.report_hour_profile(text, date, text, text)         to authenticated;

-- =============================================================================
-- report_device_daily_energy — phase42_bounded_device_energy's, with the rule where it read `r.online`,
-- except on the energy register. Nothing else changes; test/phase47-held-minutes-schema.test.mjs
-- holds that.
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
  with hrs (dev, bucket, avg_w, max_w, e_max, n_on, from_raw) as (
    select h.device_id, h.hour, h.power_w_avg, h.power_w_max, h.energy_kwh_today_max, h.online_sample_count, false
      from readings_hourly h
     where h.hour >= w_start and h.hour < w_end
       and (p_device_ids is null or h.device_id = any(p_device_ids))
    union all
    select r.device_id,
           date_trunc('hour', r.ts),
           avg(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           max(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           max(r.energy_kwh_today) filter (where r.online),
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
  dayed as (
    select x.dev, x.bucket, x.avg_w, x.max_w, x.e_max, x.n_on, x.from_raw,
           (x.bucket at time zone p_tz)::date as d
      from hrs x
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
-- report_recorded_minutes_devices — phase44_recorded_minutes's, with the rule where it read `r.online`,
-- except on the energy register. Nothing else changes; test/phase47-held-minutes-schema.test.mjs
-- holds that.
-- =============================================================================
create or replace function public.report_recorded_minutes_devices(
  p_win_start timestamptz,
  p_win_end   timestamptz
)
returns table (device_id text, minutes int)
language sql
stable
security invoker
as $fn$
  with raw_hours as (
    select r.device_id as dev,
           date_trunc('hour', r.ts) as hour,
           count(distinct date_trunc('minute', r.ts)) filter (where public.reading_measured(r.online, r.capabilities)) as minutes
      from public.readings r
     where r.ts >= p_win_start and r.ts < p_win_end
     group by 1, 2
  ),
  rolled_hours as (
    select h.device_id as dev,
           h.hour,
           least(coalesce(h.online_sample_count, 0), 60) as minutes
      from public.readings_hourly h
     where h.hour >= p_win_start and h.hour < p_win_end
       and not exists (select 1 from raw_hours r where r.dev = h.device_id and r.hour = h.hour)
  )
  select x.dev, sum(x.minutes)::int
    from (select r.dev, r.minutes from raw_hours r union all select h.dev, h.minutes from rolled_hours h) x
   group by x.dev;
$fn$;

revoke execute on function public.report_recorded_minutes_devices(timestamptz, timestamptz) from public, anon;
grant  execute on function public.report_recorded_minutes_devices(timestamptz, timestamptz) to service_role;

-- =============================================================================
-- generate_monthly_report — phase44_recorded_minutes's, with the rule where it read `r.online`,
-- except on the energy register. Nothing else changes; test/phase47-held-minutes-schema.test.mjs
-- holds that.
-- =============================================================================
create or replace function public.generate_monthly_report(
  p_month date,
  p_tz    text default 'Asia/Manila'
)
returns table (device_rows int, building_rows int)
language plpgsql
volatile
security invoker
as $fn$
declare
  month_start timestamptz := (date_trunc('month', p_month::timestamp) at time zone p_tz);
  month_end   timestamptz := ((date_trunc('month', p_month::timestamp) + interval '1 month') at time zone p_tz);
  -- One sample per device per minute is the ingest cadence, so this is what full coverage
  -- would have looked like. Derived from the month's real length, not assumed to be 30 days.
  expected int := (extract(epoch from (month_end - month_start)) / 60)::int;
  n_devices int;
  n_building int;
begin
  -- Per-device. Hours come from the archive view of both tables, so a month that has been
  -- partly pruned reports exactly the same figures as one that has not.
  with hours as (
    select h.device_id, h.hour, h.power_w_avg, h.power_w_max,
           h.energy_kwh_today_max, h.online_sample_count
      from readings_hourly h
     where h.hour >= month_start and h.hour < month_end
    union all
    select r.device_id,
           date_trunc('hour', r.ts),
           avg(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           max(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           max(r.energy_kwh_today) filter (where r.online),
           count(*) filter (where public.reading_measured(r.online, r.capabilities))::int
      from readings r
     where r.ts >= month_start and r.ts < month_end
       -- The rollup wins the seam; see phase10_history_archive.sql's header for why an
       -- overlap is possible at all and why double-counting it would be worse.
       and not exists (
             select 1 from readings_hourly h2
              where h2.device_id = r.device_id and h2.hour = date_trunc('hour', r.ts))
     group by 1, 2
  ),
  -- RM-091: each day's energy with the counter bounded by what the device could draw. MATERIALIZED and
  -- joined, never a subquery per device row, so the readings are read once for the whole period.
  bounded as materialized (
    select b.device_id        as dev,
           sum(b.energy_kwh)  as energy_kwh,
           sum(b.removed_kwh) as removed_kwh
      from public.report_device_daily_energy('month', p_month, p_tz) b
     group by b.device_id
  ),
  -- RM-073: the minutes that hold a reading, counted once each — never rows. See phase44's header.
  recorded as materialized (
    select m.device_id as dev, m.minutes
      from public.report_recorded_minutes_devices(month_start, month_end) m
  ),
  per_device as (
    select h.device_id,
           max(h.power_w_max) as peak_power_w,
           sum(h.power_w_avg * h.online_sample_count)
             / nullif(sum(h.online_sample_count) filter (where h.power_w_avg is not null), 0) as avg_power_w,
           sum(h.online_sample_count)::int as online_sample_count
      from hours h
     group by 1
  )
  insert into monthly_reports (
    month, device_id, energy_kwh, peak_power_w, avg_power_w,
    online_sample_count, expected_sample_count, generated_at
  )
  select p_month,
         d.device_id,
         bd.energy_kwh,
         d.peak_power_w,
         d.avg_power_w,
         coalesce(rm.minutes, 0),
         expected,
         now()
    from per_device d
    left join bounded bd on bd.dev = d.device_id
    left join recorded rm on rm.dev = d.device_id
  on conflict (month, device_id) do update set
    energy_kwh            = excluded.energy_kwh,
    peak_power_w          = excluded.peak_power_w,
    avg_power_w           = excluded.avg_power_w,
    online_sample_count   = excluded.online_sample_count,
    expected_sample_count = excluded.expected_sample_count,
    generated_at          = excluded.generated_at;
  get diagnostics n_devices = row_count;

  -- Building-wide.
  with totals_hours as (
    select b.hour, b.total_power_w_avg, b.total_power_w_max, b.avg_voltage_avg,
           b.phase_current_red_avg, b.phase_current_yellow_avg, b.phase_current_blue_avg,
           b.energy_kwh_month_max, b.sample_count
      from building_totals_hourly b
     where b.hour >= month_start and b.hour < month_end
    union all
    select date_trunc('hour', t.ts),
           avg(t.total_power_w), max(t.total_power_w), avg(t.avg_voltage),
           avg(t.phase_current_red), avg(t.phase_current_yellow), avg(t.phase_current_blue),
           max(t.energy_kwh_month),
           count(*)::int
      from building_totals t
     where t.ts >= month_start and t.ts < month_end
       and not exists (
             select 1 from building_totals_hourly b2
              where b2.hour = date_trunc('hour', t.ts))
     group by 1
  )
  insert into monthly_building_reports (
    month, energy_kwh, peak_total_power_w, avg_voltage,
    phase_current_red_avg, phase_current_yellow_avg, phase_current_blue_avg,
    command_count, command_count_manual, command_count_schedule, command_count_autoshed,
    anomaly_count, online_sample_count, expected_sample_count, generated_at
  )
  select p_month,
         (select max(energy_kwh_month_max) from totals_hours),
         (select max(total_power_w_max) from totals_hours),
         (select avg(avg_voltage_avg) from totals_hours),
         (select avg(phase_current_red_avg) from totals_hours),
         (select avg(phase_current_yellow_avg) from totals_hours),
         (select avg(phase_current_blue_avg) from totals_hours),
         (select count(*)::int from commands c where c.requested_at >= month_start and c.requested_at < month_end),
         (select count(*)::int from commands c where c.requested_at >= month_start and c.requested_at < month_end and c.source = 'ibems-app'),
         (select count(*)::int from commands c where c.requested_at >= month_start and c.requested_at < month_end and c.source = 'schedule'),
         (select count(*)::int from commands c where c.requested_at >= month_start and c.requested_at < month_end and c.source = 'dsm_autoshed'),
         (select count(*)::int from anomalies a where a.ts >= month_start and a.ts < month_end),
         public.report_recorded_minutes_building(month_start, month_end),
         expected,
         now()
  on conflict (month) do update set
    energy_kwh               = excluded.energy_kwh,
    peak_total_power_w       = excluded.peak_total_power_w,
    avg_voltage              = excluded.avg_voltage,
    phase_current_red_avg    = excluded.phase_current_red_avg,
    phase_current_yellow_avg = excluded.phase_current_yellow_avg,
    phase_current_blue_avg   = excluded.phase_current_blue_avg,
    command_count            = excluded.command_count,
    command_count_manual     = excluded.command_count_manual,
    command_count_schedule   = excluded.command_count_schedule,
    command_count_autoshed   = excluded.command_count_autoshed,
    anomaly_count            = excluded.anomaly_count,
    online_sample_count      = excluded.online_sample_count,
    expected_sample_count    = excluded.expected_sample_count,
    generated_at             = excluded.generated_at;
  get diagnostics n_building = row_count;

  return query select n_devices, n_building;
end;
$fn$;

revoke execute on function public.generate_monthly_report(date, text) from public;
grant  execute on function public.generate_monthly_report(date, text) to service_role;

-- =============================================================================
-- report_hour_energy — phase46_daily_reports's, with the rule where it read `r.online`,
-- except on the energy register. Nothing else changes; test/phase47-held-minutes-schema.test.mjs
-- holds that.
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
  with hrs (dev, bucket, avg_w, max_w, e_max, n_on, from_raw) as (
    select h.device_id, h.hour, h.power_w_avg, h.power_w_max, h.energy_kwh_today_max, h.online_sample_count, false
      from readings_hourly h
     where h.hour >= w_start and h.hour < w_end
       and (p_device_ids is null or h.device_id = any(p_device_ids))
    union all
    select r.device_id,
           date_trunc('hour', r.ts),
           avg(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           max(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           max(r.energy_kwh_today) filter (where r.online),
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
  dayed as (
    select x.dev, x.bucket, x.avg_w, x.max_w, x.e_max, x.n_on, x.from_raw,
           (x.bucket at time zone p_tz)::date as d
      from hrs x
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
-- generate_period_report — phase46_daily_reports's, with the rule where it read `r.online`,
-- except on the energy register. Nothing else changes; test/phase47-held-minutes-schema.test.mjs
-- holds that.
-- =============================================================================
create or replace function public.generate_period_report(
  p_period text,
  p_start  date,
  p_tz     text default 'Asia/Manila'
)
returns table (device_rows int, building_rows int)
language plpgsql
volatile
security invoker
as $fn$
declare
  -- Truncated, never trusted as given: a caller passing mid-period must get the whole period,
  -- or two callers would write two different rows for the same seven days.
  local_start date := case p_period
                        when 'week'  then date_trunc('week',  p_start::timestamp)::date
                        when 'month' then date_trunc('month', p_start::timestamp)::date
                        when 'day'   then p_start
                      end;
  win_start timestamptz;
  win_end   timestamptz;
  -- One sample per device per minute is the ingest cadence, so this is what full coverage would
  -- have looked like. Derived from the period's real length — which is why this is computed from
  -- the two bounds rather than from a constant: a month is not 30 days, and a week that spans a
  -- DST change is not 168 hours.
  expected int;
  n_devices int;
  n_building int;
begin
  if local_start is null then
    raise exception 'unknown period %, expected day, week or month', p_period
      using errcode = 'invalid_parameter_value';
  end if;

  win_start := local_start::timestamp at time zone p_tz;
  win_end := case p_period
               when 'week'  then (local_start::timestamp + interval '1 week')  at time zone p_tz
               when 'month' then (local_start::timestamp + interval '1 month') at time zone p_tz
               when 'day'   then (local_start::timestamp + interval '1 day')   at time zone p_tz
             end;
  expected := (extract(epoch from (win_end - win_start)) / 60)::int;

  -- Per-device. Hours come from the archive view of both tables, so a period that has been
  -- partly pruned reports exactly the same figures as one that has not.
  with hours as (
    select h.device_id, h.hour, h.power_w_avg, h.power_w_max,
           h.energy_kwh_today_max, h.online_sample_count
      from readings_hourly h
     where h.hour >= win_start and h.hour < win_end
    union all
    select r.device_id,
           date_trunc('hour', r.ts),
           avg(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           max(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
           max(r.energy_kwh_today) filter (where r.online),
           count(*) filter (where public.reading_measured(r.online, r.capabilities))::int
      from readings r
     where r.ts >= win_start and r.ts < win_end
       -- The rollup wins the seam; see phase10_history_archive.sql's header for why an overlap
       -- is possible at all and why double-counting it would be worse.
       and not exists (
             select 1 from readings_hourly h2
              where h2.device_id = r.device_id and h2.hour = date_trunc('hour', r.ts))
     group by 1, 2
  ),
  -- RM-091: each day's energy with the counter bounded by what the device could draw. MATERIALIZED and
  -- joined, never a subquery per device row, so the readings are read once for the whole period.
  bounded as materialized (
    select b.device_id        as dev,
           sum(b.energy_kwh)  as energy_kwh,
           sum(b.removed_kwh) as removed_kwh
      from public.report_device_daily_energy(p_period, local_start, p_tz) b
     group by b.device_id
  ),
  -- RM-073: the minutes that hold a reading, counted once each — never rows. See phase44's header.
  recorded as materialized (
    select m.device_id as dev, m.minutes
      from public.report_recorded_minutes_devices(win_start, win_end) m
  ),
  per_device as (
    select h.device_id,
           max(h.power_w_max) as peak_power_w,
           sum(h.power_w_avg * h.online_sample_count)
             / nullif(sum(h.online_sample_count) filter (where h.power_w_avg is not null), 0) as avg_power_w,
           sum(h.online_sample_count)::int as online_sample_count
      from hours h
     group by 1
  )
  insert into period_reports (
    period, period_start, device_id, energy_kwh, peak_power_w, avg_power_w,
    online_sample_count, expected_sample_count, energy_removed_kwh, generated_at
  )
  select p_period,
         local_start,
         d.device_id,
         bd.energy_kwh,
         d.peak_power_w,
         d.avg_power_w,
         coalesce(rm.minutes, 0),
         expected,
         -- What the bound took out, kept beside the figure. Below 1 Wh it is rounding, not a correction.
         case when bd.removed_kwh > 0.001 then bd.removed_kwh end,
         now()
    from per_device d
    left join bounded bd on bd.dev = d.device_id
    left join recorded rm on rm.dev = d.device_id
  on conflict (period, period_start, device_id) do update set
    energy_kwh            = excluded.energy_kwh,
    energy_removed_kwh    = excluded.energy_removed_kwh,
    peak_power_w          = excluded.peak_power_w,
    avg_power_w           = excluded.avg_power_w,
    online_sample_count   = excluded.online_sample_count,
    expected_sample_count = excluded.expected_sample_count,
    generated_at          = excluded.generated_at;
  get diagnostics n_devices = row_count;

  -- Building-wide.
  -- Extended one day EARLIER than the period, then narrowed. The extra day is the baseline for
  -- the energy increments below and is used for nothing else — every other figure here is
  -- strictly period-scoped, which is what the narrowing exists to keep true.
  with totals_hours_ext as (
    select b.hour, b.total_power_w_avg, b.total_power_w_max, b.avg_voltage_avg,
           b.phase_current_red_avg, b.phase_current_yellow_avg, b.phase_current_blue_avg,
           b.energy_kwh_month_max, b.energy_kwh_today_max, b.sample_count
      from building_totals_hourly b
     where b.hour >= win_start - interval '1 day' and b.hour < win_end
    union all
    select date_trunc('hour', t.ts),
           avg(t.total_power_w), max(t.total_power_w), avg(t.avg_voltage),
           avg(t.phase_current_red), avg(t.phase_current_yellow), avg(t.phase_current_blue),
           max(t.energy_kwh_month),
           max(t.energy_kwh_today),
           count(*)::int
      from building_totals t
     where t.ts >= win_start - interval '1 day' and t.ts < win_end
       and not exists (
             select 1 from building_totals_hourly b2
              where b2.hour = date_trunc('hour', t.ts))
     group by 1
  ),
  totals_hours as (
    select * from totals_hours_ext where hour >= win_start
  ),
  -- The building's DAILY counter, folded to one high-water mark per local day. Same technique
  -- phase12 uses per device, applied building-wide — see the energy expression below for why a
  -- week needs it and a month does not.
  /*
   * A WEEK'S ENERGY, FROM INCREMENTS OF THE MONOTONIC MONTH COUNTER.
   *
   * The obvious version — sum the DAILY counter's per-day maxima, the technique phase12 uses per
   * device — is wrong here, and production said so before this shipped. `building_totals` has NO
   * `online` column (schema.sql:50), so unlike the per-device path there is nothing to filter
   * frozen samples out with: a meter that goes offline keeps reporting its last value, and that
   * value is then counted again as the next day's consumption. MEASURED on the week of
   * 2026-08-17: 18 August's counters were byte-identical to 17 August's, and summing daily
   * maxima produced 34.219 kWh against a month counter that had advanced by about 19.5 over the
   * same week. A week cannot exceed the month-to-date total containing it.
   *
   * Differences of a monotonic counter do not have that failure mode: a frozen day advances the
   * counter by nothing and so contributes nothing. It is the same property that makes phase12's
   * `max(energy_kwh_month_max)` correct for a MONTH — a max over a monotonic series is already
   * freeze-robust — which is why the month expression below is left exactly as phase12 had it.
   */
  building_daily as (
    select (hour at time zone p_tz)::date as local_day,
           max(energy_kwh_month_max)      as day_max
      from totals_hours_ext
     group by 1
  ),
  building_increments as (
    select local_day,
           day_max,
           lag(day_max) over (order by local_day) as prev_max
      from building_daily
  )
  insert into period_building_reports (
    period, period_start, energy_kwh, peak_total_power_w, avg_voltage,
    phase_current_red_avg, phase_current_yellow_avg, phase_current_blue_avg,
    command_count, command_count_manual, command_count_schedule, command_count_autoshed,
    anomaly_count, online_sample_count, expected_sample_count, generated_at
  )
  select p_period,
         local_start,
         -- ENERGY IS COMPUTED DIFFERENTLY PER PERIOD, and this is the one place in the file
         -- where week and month genuinely differ rather than just differing in their window.
         --
         -- A MONTH uses the bridge's own month counter, exactly as phase12 does. That counter is
         -- authoritative for the building in a way no sum of per-device meters is, because not
         -- every load is individually metered — and using anything else here would break the
         -- backfill's agreement with phase12, which the rehearsal checks row for row.
         --
         -- A WEEK cannot use it: `energy_kwh_month_max` over a week is the high-water mark the
         -- MONTH counter had reached by that week's end — a running month-to-date total, not the
         -- week's own energy. Presented as "energy this week" it would be wrong by however much
         -- the month had already accumulated, and it would look entirely plausible.
         --
         -- So a week sums the counter's daily INCREMENTS instead. See `building_increments`
         -- above for why increments and not the daily counter's maxima — the short version is
         -- that a frozen meter repeats its last reading and there is no `online` column here to
         -- exclude it with. Increments are also independent of whatever day the meter's own week
         -- counter rolls over on, which nothing here has established.
         case p_period
           when 'month' then (select max(energy_kwh_month_max) from totals_hours)
           when 'week'  then (
             select sum(case
                          -- Nothing before it in the window, so its whole counter is the best
                          -- estimate available — the same assumption a month makes.
                          when prev_max is null then day_max
                          when day_max >= prev_max then day_max - prev_max
                          -- The counter went backwards: a new month started that day.
                          else day_max
                        end)
               from building_increments
              where local_day >= (win_start at time zone p_tz)::date
                and local_day <  (win_end   at time zone p_tz)::date)
           -- A DAY is its own daily counter's high-water mark (phase46, RM-124). Not the week's
           -- increment rule: that falls back to the whole month-to-date when the previous day has
           -- no rows, which over seven days is a small error and over one day is the entire month.
           -- The week avoids daily maxima only because a frozen meter's last reading would be
           -- counted again on the NEXT day; inside a single day there is no next day to count it
           -- in, and the bridge's daily figure is what the dashboard showed that day.
           when 'day'   then (select max(energy_kwh_today_max) from totals_hours)
         end,
         (select max(total_power_w_max) from totals_hours),
         (select avg(avg_voltage_avg) from totals_hours),
         (select avg(phase_current_red_avg) from totals_hours),
         (select avg(phase_current_yellow_avg) from totals_hours),
         (select avg(phase_current_blue_avg) from totals_hours),
         (select count(*)::int from commands c where c.requested_at >= win_start and c.requested_at < win_end),
         (select count(*)::int from commands c where c.requested_at >= win_start and c.requested_at < win_end and c.source = 'ibems-app'),
         (select count(*)::int from commands c where c.requested_at >= win_start and c.requested_at < win_end and c.source = 'schedule'),
         (select count(*)::int from commands c where c.requested_at >= win_start and c.requested_at < win_end and c.source = 'dsm_autoshed'),
         (select count(*)::int from anomalies a where a.ts >= win_start and a.ts < win_end),
         public.report_recorded_minutes_building(win_start, win_end),
         expected,
         now()
  on conflict (period, period_start) do update set
    energy_kwh               = excluded.energy_kwh,
    peak_total_power_w       = excluded.peak_total_power_w,
    avg_voltage              = excluded.avg_voltage,
    phase_current_red_avg    = excluded.phase_current_red_avg,
    phase_current_yellow_avg = excluded.phase_current_yellow_avg,
    phase_current_blue_avg   = excluded.phase_current_blue_avg,
    command_count            = excluded.command_count,
    command_count_manual     = excluded.command_count_manual,
    command_count_schedule   = excluded.command_count_schedule,
    command_count_autoshed   = excluded.command_count_autoshed,
    anomaly_count            = excluded.anomaly_count,
    online_sample_count      = excluded.online_sample_count,
    expected_sample_count    = excluded.expected_sample_count,
    generated_at             = excluded.generated_at;
  get diagnostics n_building = row_count;

  return query select n_devices, n_building;
end;
$fn$;

revoke execute on function public.generate_period_report(text, date, text) from public;
grant  execute on function public.generate_period_report(text, date, text) to service_role;

-- =============================================================================
-- The restatement — decided by the operator on 2026-09-22, in phase44's pattern.
--
-- Every stored device report is counted again with the rule. A row whose Recorded minutes differ gets the
-- new count, its average and peak power from measured samples only (the generators' own expressions, over
-- the same hours), the first figure it ever said kept in `online_sample_count_before` (a row phase44
-- already restated keeps phase44's), and `coverage_restated_at`. Energy, `energy_removed_kwh`,
-- `generated_at` and the building rows are not touched. The legacy monthly table gets the same figures,
-- with no note columns, so it keeps agreeing until RM-042 retires it.
--
-- A row already right is left alone, so a second paste changes nothing.
-- =============================================================================
do $$
declare
  p record;
  w record;
  n int;
  n_rows int := 0;
  n_legacy int := 0;
begin
  create temp table phase47_recount (dev text primary key, minutes int, avg_w numeric, peak_w numeric) on commit drop;
  for p in
    select distinct r.period, r.period_start from period_reports r order by 1, 2
  loop
    select rw.win_start, rw.win_end into w from public.report_window(p.period, p.period_start) rw;

    truncate phase47_recount;
    insert into phase47_recount (dev, minutes, avg_w, peak_w)
    select coalesce(m.dev, pw.dev), coalesce(m.minutes, 0), pw.avg_w, pw.peak_w
      from (select d.device_id as dev, d.minutes
              from public.report_recorded_minutes_devices(w.win_start, w.win_end) d) m
      full join (
        select x.dev,
               sum(x.avg_w * x.n) / nullif(sum(x.n) filter (where x.avg_w is not null), 0) as avg_w,
               max(x.max_w) as peak_w
          from (
            select h.device_id as dev, h.power_w_avg as avg_w, h.power_w_max as max_w, h.online_sample_count as n
              from readings_hourly h
             where h.hour >= w.win_start and h.hour < w.win_end
            union all
            select r.device_id,
                   avg(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
                   max(r.power_w) filter (where public.reading_measured(r.online, r.capabilities)),
                   count(*) filter (where public.reading_measured(r.online, r.capabilities))::int
              from readings r
             where r.ts >= w.win_start and r.ts < w.win_end
               and not exists (
                     select 1 from readings_hourly h2
                      where h2.device_id = r.device_id and h2.hour = date_trunc('hour', r.ts))
             group by r.device_id, date_trunc('hour', r.ts)
          ) x
         group by x.dev
      ) pw on pw.dev = m.dev;

    update period_reports r
       set online_sample_count_before = coalesce(r.online_sample_count_before, r.online_sample_count),
           online_sample_count        = coalesce(c.minutes, 0),
           avg_power_w                = c.avg_w,
           peak_power_w               = c.peak_w,
           coverage_restated_at       = now()
      from phase47_recount c
     where r.period = p.period
       and r.period_start = p.period_start
       and c.dev = r.device_id
       and r.online_sample_count is distinct from coalesce(c.minutes, 0);
    get diagnostics n = row_count;
    n_rows := n_rows + n;

    if p.period = 'month' then
      update monthly_reports mr
         set online_sample_count = coalesce(c.minutes, 0),
             avg_power_w         = c.avg_w,
             peak_power_w        = c.peak_w
        from phase47_recount c
       where mr.month = p.period_start
         and c.dev = mr.device_id
         and mr.online_sample_count is distinct from coalesce(c.minutes, 0);
      get diagnostics n = row_count;
      n_legacy := n_legacy + n;
    end if;
  end loop;
  raise notice 'phase47: restated % device row(s); % legacy monthly row(s) recounted', n_rows, n_legacy;
end $$;

-- So the API sees the new column now, rather than after its next schema reload.
notify pgrst, 'reload schema';
