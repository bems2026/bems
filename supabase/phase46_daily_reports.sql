-- =============================================================================
-- Phase 46 — RM-124. A Daily period: one local day, reported and charted hour by hour.
--
-- WHAT WAS MISSING. The Reports page offered weeks and months. The operator asked for a day —
-- which hours the building and each circuit drew in — and every series function here already
-- takes `(p_period, p_start, p_tz)` and derives its window from `report_window`, so a day is one
-- more branch there, one more branch in the generator, and the two check constraints that name
-- the periods. The hourly bars need one new function, below.
--
-- WHAT THIS FILE DOES.
--   1. `report_window` accepts 'day': `p_start` itself, one day long, 1440 expected minutes. Every
--      series function (`report_daily_series`, `report_hour_profile`, `report_hour_matrix`,
--      `report_demand_curve`, `report_demand_summary`, `report_device_daily_energy`) therefore
--      answers for a day unchanged.
--   2. `period_reports` and `period_building_reports` admit period = 'day'.
--   3. `generate_period_report` accepts 'day'. Its text is phase44's, byte for byte, plus the day
--      branches — `test/phase46-daily-reports-schema.test.mjs` holds it to that, so no week or
--      month figure can have moved. A day's building energy is its own daily counter's high-water
--      mark: the week's increment rule falls back to the whole month-to-date when the previous day
--      has no rows, and within one day the daily counter has no next day to double-count into.
--   4. `report_hour_energy` — per device, per local hour of the window: the energy CREDITED to that
--      hour by phase42's rule (the counter's rise, capped by what the circuit could have drawn,
--      the measured power instead when the counter proves impossible), with the hour's average
--      and highest power and its recorded minutes. The page sums the building's branch meters for
--      its 24 bars and draws each circuit's own, so the bars and the headline agree by
--      construction. Every hour of every device in the window is a row, unobserved ones with NULL
--      energy — phase37's rule. It raises above 900 rows rather than let PostgREST truncate.
--
-- The `hrs`, `dayed`, `peaks`, `stepped`, `judged`, `capped` and `credited` steps are phase42's,
-- with the hour carried through to the output. The three constants of the cap are the same; if
-- one moves, move it in both files.
--
-- SAFE TO RE-RUN. Constraints are dropped `if exists` and re-added; every function is
-- `create or replace` with an unchanged signature and OUT list, except `report_hour_energy`,
-- which is dropped by signature first. No policy or trigger is created. Apply by hand in the
-- Supabase SQL editor; rehearsed by `supabase/rehearse.sh`, which applies it twice.
-- =============================================================================

-- 2. The stored-report tables admit a day. Text rather than an enum (phase27's reasoning), so
--    this is a drop-and-add of the check, not a type change.
alter table period_reports drop constraint if exists period_reports_period_known;
alter table period_reports add constraint period_reports_period_known
  check (period in ('day', 'week', 'month'));

alter table period_building_reports drop constraint if exists period_building_reports_period_known;
alter table period_building_reports add constraint period_building_reports_period_known
  check (period in ('day', 'week', 'month'));

-- 1. report_window — phase37's, with the day branch.
create or replace function public.report_window(
  p_period text,
  p_start  date,
  p_tz     text default 'Asia/Manila'
)
returns table (
  local_start      date,
  win_start        timestamptz,
  win_end          timestamptz,
  expected_minutes int
)
language plpgsql
stable
security invoker
as $fn$
declare
  ls date := case p_period
               when 'week'  then date_trunc('week',  p_start::timestamp)::date
               when 'month' then date_trunc('month', p_start::timestamp)::date
               when 'day'   then p_start
             end;
  ws timestamptz;
  we timestamptz;
begin
  if ls is null then
    raise exception 'unknown period %, expected day, week or month', p_period
      using errcode = 'invalid_parameter_value';
  end if;

  ws := ls::timestamp at time zone p_tz;
  we := case p_period
          when 'week'  then (ls::timestamp + interval '1 week')  at time zone p_tz
          when 'month' then (ls::timestamp + interval '1 month') at time zone p_tz
          when 'day'   then (ls::timestamp + interval '1 day')   at time zone p_tz
        end;

  -- From the two bounds, never a constant: a month is not 30 days, and a week spanning a DST
  -- change is not 168 hours. Asia/Manila has no DST, which is exactly why this would go
  -- unnoticed when the replication framework reaches a timezone that does.
  return query select ls, ws, we, (extract(epoch from (we - ws)) / 60)::int;
end;
$fn$;

-- phase37's grants, restated because `create or replace function` does not reset them.
revoke execute on function public.report_window(text, date, text) from public, anon;
grant  execute on function public.report_window(text, date, text) to authenticated, service_role;

-- 4. report_hour_energy — phase42's credit, per hour.
drop function if exists public.report_hour_energy(text, date, text, text[]);
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
           avg(r.power_w) filter (where r.online),
           max(r.power_w) filter (where r.online),
           max(r.energy_kwh_today) filter (where r.online),
           (count(*) filter (where r.online))::int,
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

-- Read by the Reports page, so signed-in readers may run it — RLS still applies, it is
-- `security invoker`. `anon` is named in the revoke (phase37's note).
revoke execute on function public.report_hour_energy(text, date, text, text[]) from public, anon;
grant  execute on function public.report_hour_energy(text, date, text, text[]) to authenticated, service_role;

-- 3. generate_period_report — phase44's, with the day branches.
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
           avg(r.power_w) filter (where r.online),
           max(r.power_w) filter (where r.online),
           max(r.energy_kwh_today) filter (where r.online),
           count(*) filter (where r.online)::int
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

-- This function WRITES. phase27's grant, restated because `create or replace` keeps the old
-- grants only by accident of them being unchanged; saying it makes it not an accident.
revoke execute on function public.generate_period_report(text, date, text) from public;
grant  execute on function public.generate_period_report(text, date, text) to service_role;
