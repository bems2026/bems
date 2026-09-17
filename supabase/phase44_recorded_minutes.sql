-- =============================================================================
-- Phase 44 — RM-073 and RM-111. A report's Recorded figure counts minutes that hold a reading, once each.
--
-- WHAT WAS WRONG, TWICE OVER.
--   1. RM-073. `online_sample_count` in the stored reports counted ROWS. `building_totals` has no
--      `online` column, and a meter that stops observing keeps writing rows with no power in them:
--      2026-08-18 is 1,414 rows and not one reading (RM-072g). The page has printed two figures side by
--      side ever since phase37 — for the week of 2026-08-17 the heading says "Complete · 98%" and the
--      Recorded tile beside it says "16%, 1,640 of 10,080 minutes". The tile is right.
--   2. RM-111. A row is not always its own minute. Every ingest restart runs a cycle at once, seconds
--      after the scheduled tick already wrote that minute, under a different `ts`. The week of
--      2026-09-07 holds 10,082 rows in 10,074 distinct minutes, and read "10,082 of 10,080 minutes".
--
-- DECIDED BY THE OPERATOR on 2026-09-17: restate the stored figures, with a note in the report.
--
-- WHAT THIS FILE DOES.
--   1. `period_building_reports` and `period_reports` gain `online_sample_count_before` and
--      `coverage_restated_at`, set only by step 5.
--   2. `report_recorded_minutes_building` and `report_recorded_minutes_devices` count, for a window, the
--      distinct minutes that hold a reading: a building minute with `total_power_w`, a device minute
--      online. A rolled-up hour counts its samples — only when its building average holds a reading —
--      and never more than 60.
--   3. `report_demand_summary` (phase37) counts one observation per minute, so the page's Recorded tile
--      is the same number.
--   4. `generate_period_report` and the legacy `generate_monthly_report` (phase42) store those counts.
--      Nothing else in them changes.
--   5. Every stored period is counted again; a row that differs is restated, keeping what it said.
--
-- Expected on the live project (previewed read-only on 2026-09-17, building rows):
--   August 2026           21,421 -> 12,055 of 44,640   48.0% -> 27.0%
--   week of 2026-08-10        10 ->      0 of 10,080    0.1% ->  0.0%
--   week of 2026-08-17     9,900 ->  1,640 of 10,080   98.2% -> 16.3%   ("Complete" -> "Mostly missing")
--   week of 2026-08-24    10,071 ->  8,975 of 10,080   99.9% -> 89.0%
--   week of 2026-08-31    10,080 -> 10,025 of 10,080  100.0% -> 99.5%
--   week of 2026-09-07    10,082 -> 10,074 of 10,080  100.0% -> 99.9%
-- plus device rows, most by a restart's few minutes. Energy figures do not move.
--
-- SAFE TO RE-RUN. Columns are added `if not exists`; the two new functions are dropped by signature
-- first; the summary and generators keep their signatures and OUT columns; the restatement skips any row
-- already restated or already right. No policy, trigger or constraint is created. Apply by hand in the
-- Supabase SQL editor; rehearsed by `supabase/rehearse.sh`, which applies it twice.
-- =============================================================================

-- =============================================================================
-- The stored reports' coverage columns: what they said before this file, and when it changed them.
-- Set only by the restatement at the end of this file. A report generated afterwards is counted
-- correctly from the start and carries neither.
-- =============================================================================
alter table period_building_reports add column if not exists online_sample_count_before int;
alter table period_building_reports add column if not exists coverage_restated_at timestamptz;
alter table period_reports add column if not exists online_sample_count_before int;
alter table period_reports add column if not exists coverage_restated_at timestamptz;

-- =============================================================================
-- report_recorded_minutes_building — the minutes of a window that hold a building reading.
--
-- A raw hour counts its DISTINCT minutes that carry `total_power_w`. A rolled-up hour counts its
-- samples when its average holds a reading, and never more than 60. A raw hour wins over a rolled one
-- for the same hour, which only happens while retention is part-way through it. That is the rule
-- `report_demand_summary` below uses, so the figure stored with a report and the Recorded figure the
-- page prints beside it are the same number.
-- =============================================================================
drop function if exists public.report_recorded_minutes_building(timestamptz, timestamptz);

create function public.report_recorded_minutes_building(
  p_win_start timestamptz,
  p_win_end   timestamptz
)
returns int
language sql
stable
security invoker
as $fn$
  with raw_hours as (
    select date_trunc('hour', t.ts) as hour,
           count(distinct date_trunc('minute', t.ts)) filter (where t.total_power_w is not null) as minutes
      from public.building_totals t
     where t.ts >= p_win_start and t.ts < p_win_end
     group by 1
  ),
  rolled_hours as (
    select b.hour,
           case when b.total_power_w_avg is null then 0 else least(coalesce(b.sample_count, 0), 60) end as minutes
      from public.building_totals_hourly b
     where b.hour >= p_win_start and b.hour < p_win_end
       and not exists (select 1 from raw_hours r where r.hour = b.hour)
  )
  select coalesce(sum(x.minutes), 0)::int
    from (select r.minutes from raw_hours r union all select h.minutes from rolled_hours h) x;
$fn$;

revoke execute on function public.report_recorded_minutes_building(timestamptz, timestamptz) from public, anon;
grant  execute on function public.report_recorded_minutes_building(timestamptz, timestamptz) to service_role;

-- =============================================================================
-- report_recorded_minutes_devices — the same, per device: distinct minutes a device was online.
--
-- `readings` carries `online`, so a device's usable minute is an online one, as phase27 always meant.
-- What was wrong for devices was only the row count: a restart's second row in a minute counted twice,
-- and a rolled-up hour could claim 61. A device with nothing in the window returns no row, and the
-- generators store 0 for it.
-- =============================================================================
drop function if exists public.report_recorded_minutes_devices(timestamptz, timestamptz);

create function public.report_recorded_minutes_devices(
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
           count(distinct date_trunc('minute', r.ts)) filter (where r.online) as minutes
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
-- report_demand_summary — phase37's, counting minutes. Same signature and OUT columns, so it is replaced
-- in place and keeps phase37's grants; they are restated below all the same.
-- =============================================================================
create or replace function public.report_demand_summary(
  p_period text,
  p_start  date,
  p_tz     text default 'Asia/Manila'
)
returns table (
  n                   int,
  p50_w               numeric,
  p95_w               numeric,
  p99_w               numeric,
  max_w               numeric,
  min_w               numeric,
  observed_minutes    int,
  usable_minutes      int,
  expected_minutes    int,
  longest_gap_minutes numeric,
  resolution          text
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
  /*
   * OBSERVATIONS ARE INTERVALS, NOT INSTANTS, and both figures below depend on that.
   *
   * A raw row covers the minute it was sampled in; an hourly bucket covers its whole hour and
   * carries the count of minutes actually seen inside it. Modelling them as bare timestamps —
   * which is what the first version of this did — gets two things wrong, and both are the
   * reassuring direction:
   *
   *   - `observed_minutes` counted an hourly bucket as ONE minute. A fully observed month that
   *     had been rolled up would report ~744 observed against 43,200 expected: 1.7% coverage
   *     for a month with no gaps at all. The Reports page renders coverage beside every figure,
   *     so this would have qualified every true number in the document as untrustworthy.
   *
   *   - `longest_gap_minutes` was computed from raw rows alone, so once part of a window had
   *     been pruned the gap was measured only across the part that survived. The rehearsal
   *     caught this: a fixture that is dark for eight days reported a one-minute gap, because
   *     the dark stretch lay entirely in the rolled-up half. Small and reassuring and wrong.
   *
   * The gap is therefore a FLOOR: between two adjacent hourly buckets it is the whole hours
   * between them, and the up-to-two partial hours at each end are not counted. `resolution`
   * says which granularity produced it, the same way coverage qualifies every other figure.
   */
  with obs as (
    -- phase44 (RM-111): one observation per MINUTE, not per row. An ingest restart writes a second row
    -- into the minute the last scheduled tick already wrote, and a row-per-observation summary counted
    -- both. Two rows in one minute are that minute's average, and it is usable if either holds a reading.
    select date_trunc('minute', t.ts) as start_at, date_trunc('minute', t.ts) + interval '1 minute' as end_at, 1 as minutes,
           case when count(t.total_power_w) = 0 then 0 else 1 end as usable, avg(t.total_power_w) as v
      from building_totals t
     where t.ts >= w.win_start and t.ts < w.win_end
     group by date_trunc('minute', t.ts)
    union all
    select b.hour, b.hour + interval '1 hour', least(coalesce(b.sample_count, 0), 60),
           case when b.total_power_w_avg is null then 0 else least(coalesce(b.sample_count, 0), 60) end,
           b.total_power_w_avg
      from building_totals_hourly b
     where b.hour >= w.win_start and b.hour < w.win_end
       -- Range, not date_trunc equality: an index on `ts` can serve this and cannot serve a
       -- function of the column, so the equality form scans building_totals once per bucket.
       and not exists (select 1 from building_totals t2
                        where t2.ts >= b.hour and t2.ts < b.hour + interval '1 hour')
  ),
  samples as (
    select v from obs where v is not null
  ),
  /*
   * BOUNDED BY THE WINDOW, NOT BY THE FIRST OBSERVATION INSIDE IT.
   *
   * Without the two sentinels below, a period that BEGINS dark reports no gap for that darkness:
   * the first observation has no predecessor, so the stretch before it is never differenced.
   * Read back against the live project, August 2026 reported a NINE MINUTE longest gap while
   * being dark for its first sixteen days — the most reassuring possible summary of an outage,
   * and one no fixture would have produced. The same omission hid a trailing dark stretch.
   *
   * The window's start is a zero-length observation, and so is its end — or now, if the period
   * has not finished, because hours that have not happened yet are not a gap.
   */
  bounded as (
    select w.win_start as start_at, w.win_start as end_at
    union all
    -- Only a USABLE observation closes a gap. A run of rows carrying nothing but a frozen
    -- counter is exactly as dark as no rows at all, and 2026-08-18 is 1,414 of them.
    select start_at, end_at from obs where usable > 0
    union all
    select least(w.win_end, now()), least(w.win_end, now())
  ),
  gaps as (
    select greatest(extract(epoch from (start_at - prev_end)) / 60, 0) as gap_min
      from (select start_at, lag(end_at) over (order by start_at) as prev_end from bounded) o
     where prev_end is not null
  )
  select (select count(*)::int from samples),
         (select percentile_cont(0.50) within group (order by v)::numeric from samples),
         (select percentile_cont(0.95) within group (order by v)::numeric from samples),
         (select percentile_cont(0.99) within group (order by v)::numeric from samples),
         (select max(v) from samples),
         (select min(v) from samples),
         (select coalesce(sum(minutes), 0)::int from obs),
         (select coalesce(sum(usable), 0)::int from obs),
         w.expected_minutes,
         -- NULL, never 0, when nothing at all was observed: at that point the gap is the whole
         -- window and calling it zero would be the most reassuring possible way to report it.
         (select case when (select count(*) from obs where usable > 0) = 0 then null
                       else max(gap_min)::numeric end from gaps),
         res;
end;
$fn$;

revoke execute on function public.report_demand_summary(text, date, text) from public, anon;
grant  execute on function public.report_demand_summary(text, date, text) to authenticated;

-- =============================================================================
-- generate_period_report — phase42's, with its two coverage counts taken from the helpers above.
-- Nothing else in it changes; test/phase44-recorded-minutes-schema.test.mjs holds that.
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
    raise exception 'unknown period %, expected week or month', p_period
      using errcode = 'invalid_parameter_value';
  end if;

  win_start := local_start::timestamp at time zone p_tz;
  win_end := case p_period
               when 'week'  then (local_start::timestamp + interval '1 week')  at time zone p_tz
               when 'month' then (local_start::timestamp + interval '1 month') at time zone p_tz
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

-- This function WRITES. Revoke the default PUBLIC execute before granting it to the one role
-- that owns server-side writes; nothing in the browser generates a report.
revoke execute on function public.generate_period_report(text, date, text) from public;
grant  execute on function public.generate_period_report(text, date, text) to service_role;

-- =============================================================================
-- generate_monthly_report — the legacy generator, changed the same way so the two tables keep agreeing
-- until RM-042 retires it.
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
           avg(r.power_w) filter (where r.online),
           max(r.power_w) filter (where r.online),
           max(r.energy_kwh_today) filter (where r.online),
           count(*) filter (where r.online)::int
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

-- This function WRITES. Revoke the default PUBLIC execute before granting it to the one role
-- that owns server-side writes; nothing in the browser generates a report.
revoke execute on function public.generate_monthly_report(date, text) from public;
grant  execute on function public.generate_monthly_report(date, text) to service_role;

-- =============================================================================
-- The one-time restatement of stored coverage — RM-073, decided by the operator on 2026-09-17.
--
-- Every stored period is counted again with the helpers above. A row whose count differs gets its old
-- count kept in `online_sample_count_before`, the new one in `online_sample_count`, and the time in
-- `coverage_restated_at`. The Reports page and the PDF print that note beside the figure. Nothing
-- else in any row changes: not energy, peak, average, `generated_at`, or phase42's corrections.
--
-- A row already restated is skipped, and a row that already holds the right count is left alone, so a
-- second paste changes nothing. The legacy monthly tables get the same counts, with no note columns:
-- nothing reads them for display, and they must keep agreeing with the period tables until RM-042.
-- =============================================================================
do $$
declare
  p record;
  w record;
  building_minutes int;
  n int;
  n_building int := 0;
  n_devices int := 0;
  n_legacy int := 0;
begin
  for p in
    select b.period, b.period_start from period_building_reports b
    union
    select r.period, r.period_start from period_reports r
    order by 1, 2
  loop
    select rw.win_start, rw.win_end into w from public.report_window(p.period, p.period_start) rw;
    building_minutes := public.report_recorded_minutes_building(w.win_start, w.win_end);

    update period_building_reports b
       set online_sample_count_before = b.online_sample_count,
           online_sample_count        = building_minutes,
           coverage_restated_at       = now()
     where b.period = p.period
       and b.period_start = p.period_start
       and b.coverage_restated_at is null
       and b.online_sample_count is distinct from building_minutes;
    get diagnostics n = row_count;
    n_building := n_building + n;

    with m as materialized (
      select d.device_id as dev, d.minutes from public.report_recorded_minutes_devices(w.win_start, w.win_end) d
    )
    update period_reports r
       set online_sample_count_before = r.online_sample_count,
           online_sample_count        = coalesce((select m.minutes from m where m.dev = r.device_id), 0),
           coverage_restated_at       = now()
     where r.period = p.period
       and r.period_start = p.period_start
       and r.coverage_restated_at is null
       and r.online_sample_count is distinct from coalesce((select m.minutes from m where m.dev = r.device_id), 0);
    get diagnostics n = row_count;
    n_devices := n_devices + n;

    if p.period = 'month' then
      update monthly_building_reports mb
         set online_sample_count = building_minutes
       where mb.month = p.period_start
         and mb.online_sample_count is distinct from building_minutes;
      get diagnostics n = row_count;
      n_legacy := n_legacy + n;

      with m as materialized (
        select d.device_id as dev, d.minutes from public.report_recorded_minutes_devices(w.win_start, w.win_end) d
      )
      update monthly_reports mr
         set online_sample_count = coalesce((select m.minutes from m where m.dev = mr.device_id), 0)
       where mr.month = p.period_start
         and mr.online_sample_count is distinct from coalesce((select m.minutes from m where m.dev = mr.device_id), 0);
      get diagnostics n = row_count;
      n_legacy := n_legacy + n;
    end if;
  end loop;
  raise notice 'phase44: restated % building row(s), % device row(s); % legacy monthly row(s) recounted',
    n_building, n_devices, n_legacy;
end $$;

-- So the API sees the new columns now, rather than after its next schema reload.
notify pgrst, 'reload schema';
