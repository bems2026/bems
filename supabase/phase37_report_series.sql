-- phase37 — the SERIES behind the reports' charts.
--
-- RM-072. `period_reports` and `period_building_reports` (phase27) hold one row per period: a
-- total, a peak, a coverage pair. That is everything the Reports page shows today and none of
-- what a chart needs. A chart needs the SHAPE — energy day by day, demand hour by hour, the
-- load sorted high to low — and none of that is stored anywhere.
--
-- WHY THIS IS SQL AND NOT A LOOP IN THE BROWSER. Three reasons, and the first one has already
-- cost this project a bug:
--
--   1. PostgREST caps a response at 1000 rows and says nothing. `phase9_history_buckets.sql`
--      records what that looked like: a "7 day" chart that held 17h39m of data and "rendered
--      with axes and a plausible curve, and wrong". A month of `building_totals` is 44,640 rows.
--      Every function here returns a bounded count — at most 31 days, exactly 24 hours, at most
--      744 cells, exactly p_points — and the one that could exceed the cap RAISES instead.
--
--   2. Gap days. `generate_series` over the period's local days LEFT JOIN the aggregate makes a
--      row for every day whether or not anything was observed. `server/baselineReport.mjs` found
--      the alternative the hard way: "2026-08-18 sat between the 17th and the 19th and simply was
--      not there", and it patches that up afterwards with a fill loop. Here the query SHAPE
--      enforces it — a day cannot be forgotten because it is never separately constructed. An
--      outage disappearing from a document is the quietest failure this system has.
--
--   3. The energy expression is subtle and already exists. See `report_daily_series` below.
--
-- SECURITY INVOKER, DELIBERATELY. These read `building_totals`, `readings` and their hourly
-- rollups. A `security definer` function would run as its owner and hand every reading to any
-- caller that could execute it, quietly undoing `phase5_lockdown_rls.sql`. Invoker means RLS
-- applies as it would to a direct select, which is the whole point. Contrast
-- `phase35_policy_room_target.sql`, which IS definer — it writes one key of a row nobody may
-- update, and that is a different job.
--
-- SAFE TO RE-RUN: every function is `create or replace`.

-- ---------------------------------------------------------------------------------------------
-- The window. Extracted so that nothing re-derives it.
--
-- `generate_period_report` (phase27) computes exactly this inline, and the daily series MUST
-- agree with it: a chart whose bars sum to something other than the total printed above them is
-- worse than no chart. Rather than copy the expression a third time, both meanings live here.
-- The truncation is not a convenience — a caller passing mid-period must get the whole period,
-- or two callers produce two different answers for the same seven days.
-- ---------------------------------------------------------------------------------------------
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
             end;
  ws timestamptz;
  we timestamptz;
begin
  if ls is null then
    raise exception 'unknown period %, expected week or month', p_period
      using errcode = 'invalid_parameter_value';
  end if;

  ws := ls::timestamp at time zone p_tz;
  we := case p_period
          when 'week'  then (ls::timestamp + interval '1 week')  at time zone p_tz
          when 'month' then (ls::timestamp + interval '1 month') at time zone p_tz
        end;

  -- From the two bounds, never a constant: a month is not 30 days, and a week spanning a DST
  -- change is not 168 hours. Asia/Manila has no DST, which is exactly why this would go
  -- unnoticed when the replication framework reaches a timezone that does.
  return query select ls, ws, we, (extract(epoch from (we - ws)) / 60)::int;
end;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Resolution — what the numbers below are actually made of.
--
-- `building_totals` is pruned at 30 days (`phase11_totals_retention.sql`) and rolled into hourly
-- buckets. So a p95 for August read in September is computed partly from minute samples and
-- partly from hourly means; read in October it is entirely from hourly means, which is a
-- DIFFERENT STATISTIC — an average of averages cannot reach the peaks the samples had, so it
-- reads systematically low. Nothing about that transition is visible: no error, no gap, no
-- event. The same query returns a quieter answer every month.
--
-- Coverage already gets rendered beside every figure it qualifies. This is the same rule applied
-- to a dimension nothing currently tracks, so every function below returns it and every consumer
-- is expected to show it.
-- ---------------------------------------------------------------------------------------------
create or replace function public.report_resolution(
  p_win_start timestamptz,
  p_win_end   timestamptz
)
returns text
language sql
stable
security invoker
as $fn$
  /*
   * RESOLUTION IS ABOUT WHERE THE SURVIVING DATA CAME FROM, NOT HOW MUCH OF IT THERE IS.
   *
   * The first version compared the count of raw hours against the window's ELAPSED hours, which
   * conflated two different facts: August 2026 is entirely raw minute samples and is also dark
   * for its first sixteen days, and that version reported it as 'mixed' — a resolution downgrade
   * describing a coverage gap. Reading it back against the live project is what showed it;
   * fixtures cannot, because a fixture is never half a real month.
   *
   * Coverage already answers "how much", beside every figure. This answers only "made of what",
   * and NULL is a real answer: with nothing observed, resolution is not a claim anyone can make.
   */
  select case
           when raw_hours = 0 and rolled_hours = 0 then null
           when rolled_hours = 0 then 'minute'
           when raw_hours = 0    then 'hour'
           else 'mixed'
         end
    from (
      select (select count(distinct date_trunc('hour', ts))
                from building_totals
               where ts >= p_win_start and ts < p_win_end) as raw_hours,
             (select count(*)
                from building_totals_hourly b
               where b.hour >= p_win_start and b.hour < p_win_end
                 and not exists (select 1 from building_totals t2
                                  where t2.ts >= b.hour and t2.ts < b.hour + interval '1 hour')) as rolled_hours
    ) s;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Daily energy, peak and coverage — one row per local day, gaps included.
--
-- ENERGY IS THE DAILY INCREMENT OF THE MONOTONIC MONTH COUNTER, not the daily counter's
-- high-water mark. phase27 records the measurement that settled this, and it is worth not
-- re-learning: `building_totals` has no `online` column, so a meter that stops reporting keeps
-- repeating its last value and there is nothing to filter it out with. On the week of
-- 2026-08-17, 18 August's counters were byte-identical to the 17th's, and summing daily maxima
-- produced 34.219 kWh against a month counter that had advanced by about 19.5. Differences of a
-- monotonic counter do not have that failure mode: a frozen day advances the counter by nothing
-- and so contributes nothing.
--
-- The window is extended one day backwards so the FIRST day of the period has a predecessor to
-- difference against — without it, day one silently reports its whole month-to-date as its own
-- consumption. phase27 does the same for the same reason.
-- ---------------------------------------------------------------------------------------------
create or replace function public.report_daily_series(
  p_period text,
  p_start  date,
  p_tz     text default 'Asia/Manila'
)
returns table (
  local_day           date,
  energy_kwh          numeric,
  peak_power_w        numeric,
  avg_power_w         numeric,
  sample_count        int,
  expected_samples    int,
  first_seen_minute   int,
  last_seen_minute    int,
  resolution          text
)
language plpgsql
stable
security invoker
as $fn$
declare
  w record;
  -- Computed ONCE, into a local. Called inline in a select list it runs per OUTPUT ROW — 744 of
  -- them for a month's matrix, each a scan of `building_totals` counting distinct hours. That is
  -- what made report_hour_matrix time out against the live project at 744 cells while returning
  -- a week's 168 in milliseconds: not the row count, the repetition.
  res text;
begin
  select * into w from public.report_window(p_period, p_start, p_tz);
  res := public.report_resolution(w.win_start, w.win_end);

  return query
  -- The CTE columns are named explicitly and none of them reuses an OUT parameter's name.
  -- `returns table (…)` declares real PL/pgSQL variables, so a CTE column called
  -- `sample_count` makes every later reference ambiguous — and the error names the line the
  -- reference is on rather than the declaration that shadowed it.
  with hours_ext (bucket, avg_w_h, max_w_h, month_max, n_obs) as (
    select b.hour, b.total_power_w_avg, b.total_power_w_max, b.energy_kwh_month_max, b.sample_count
      from building_totals_hourly b
     where b.hour >= w.win_start - interval '1 day' and b.hour < w.win_end
    union all
    select date_trunc('hour', t.ts),
           avg(t.total_power_w), max(t.total_power_w), max(t.energy_kwh_month), count(*)::int
      from building_totals t
     where t.ts >= w.win_start - interval '1 day' and t.ts < w.win_end
       -- The rollup wins the seam. `phase10_history_archive.sql` explains why an overlap is
       -- possible at all and why counting it twice would be worse than dropping it.
       and not exists (select 1 from building_totals_hourly b2 where b2.hour = date_trunc('hour', t.ts))
     group by 1
  ),
  by_day as (
    select (bucket at time zone p_tz)::date as d,
           max(month_max)                   as day_max,
           max(max_w_h)                     as peak_w,
           sum(avg_w_h * n_obs)
             / nullif(sum(n_obs) filter (where avg_w_h is not null), 0) as avg_w,
           sum(n_obs)::int                  as n
      from hours_ext
     group by 1
  ),
  incremented as (
    select d, day_max, peak_w, avg_w, n,
           lag(day_max) over (order by d) as prev_max
      from by_day
  ),
  -- Minute-of-day of the first and last observation, so a partial day can say WHICH hours it
  -- saw rather than only that it was partial. `baselineReport.mjs` prints exactly this, and a
  -- day marked "partial" without it is a caveat the reader cannot act on.
  seen as (
    select (t.ts at time zone p_tz)::date as d,
           min(extract(hour from t.ts at time zone p_tz) * 60 + extract(minute from t.ts at time zone p_tz))::int as first_min,
           max(extract(hour from t.ts at time zone p_tz) * 60 + extract(minute from t.ts at time zone p_tz))::int as last_min
      from building_totals t
     where t.ts >= w.win_start and t.ts < w.win_end
     group by 1
    union all
    select (b.hour at time zone p_tz)::date,
           min(extract(hour from b.hour at time zone p_tz) * 60)::int,
           max(extract(hour from b.hour at time zone p_tz) * 60 + 59)::int
      from building_totals_hourly b
     where b.hour >= w.win_start and b.hour < w.win_end
     group by 1
  ),
  seen_day as (
    select d, min(first_min) as first_min, max(last_min) as last_min from seen group by 1
  ),
  -- EVERY day of the period, observed or not. This is the line that makes an outage impossible
  -- to lose: `days` is generated from the calendar, and the data is joined onto it.
  days as (
    select generate_series(
             (w.win_start at time zone p_tz)::date,
             (w.win_end   at time zone p_tz)::date - 1,
             interval '1 day'
           )::date as d
  )
  select days.d,
         case
           when i.day_max is null then null
           -- Nothing before it in the window: its whole counter is the best estimate available.
           when i.prev_max is null then i.day_max
           when i.day_max >= i.prev_max then i.day_max - i.prev_max
           -- The counter went backwards, so a new month began that day and its own value is the
           -- month-to-date, which for day one of a month is the day.
           else i.day_max
         end,
         i.peak_w,
         i.avg_w,
         coalesce(i.n, 0),
         -- What a gapless day would have held. The last day of a period still in progress is
         -- judged against the minutes elapsed, not the 1440 it has not reached yet.
         greatest(
           least(
             1440,
             (extract(epoch from (least(w.win_end, now()) - (days.d::timestamp at time zone p_tz))) / 60)::int
           ),
           0
         ),
         s.first_min,
         s.last_min,
         res
    from days
    left join incremented i on i.d = days.d
    left join seen_day   s on s.d = days.d
   order by days.d;
end;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Demand by hour of the building's day — always exactly 24 rows.
--
-- An hour nobody observed comes back with n = 0 and NULL statistics. Never 0 W. The building did
-- not draw nothing at 03:00; nobody was watching at 03:00, and those are different claims —
-- `baselineReport.mjs` says so in the report it prints, and this is that rule in the query.
--
-- Percentiles come from the minute samples where they still exist. Where they have been pruned,
-- the hourly mean stands in for the hour — which flattens the distribution, because an average
-- cannot reach the peaks the samples had. That is what `resolution` is for.
-- ---------------------------------------------------------------------------------------------
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
           and r.online
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

-- ---------------------------------------------------------------------------------------------
-- Day x hour matrix for the heatmap — every cell present, observed or not.
--
-- Bounded and CHECKED: 31 x 24 = 744 for a month, 168 for a week, both comfortably under
-- PostgREST's 1000-row cap. The guard exists anyway, because the cap is silent and the first
-- period longer than a month would cross it without a word. `readings_buckets` (phase9) takes
-- the same posture and for the same reason: raise, never truncate.
-- ---------------------------------------------------------------------------------------------
create or replace function public.report_hour_matrix(
  p_period text,
  p_start  date,
  p_tz     text default 'Asia/Manila'
)
returns table (
  local_day     date,
  local_hour    int,
  avg_power_w   numeric,
  max_power_w   numeric,
  sample_count  int,
  resolution    text
)
language plpgsql
stable
security invoker
as $fn$
declare
  w record;
  res text;
  cells int;
begin
  select * into w from public.report_window(p_period, p_start, p_tz);
  res := public.report_resolution(w.win_start, w.win_end);

  cells := ((w.win_end at time zone p_tz)::date - (w.win_start at time zone p_tz)::date) * 24;
  if cells > 900 then
    raise exception 'report_hour_matrix would return % cells, over the 900 cap; PostgREST truncates at 1000 silently', cells
      using errcode = 'program_limit_exceeded';
  end if;

  return query
  -- Explicit column names, none of them an OUT parameter's — see report_daily_series above.
  with hours_ext (bucket, avg_w, max_w, n_obs) as (
    select b.hour, b.total_power_w_avg, b.total_power_w_max, b.sample_count
      from building_totals_hourly b
     where b.hour >= w.win_start and b.hour < w.win_end
    union all
    select date_trunc('hour', t.ts), avg(t.total_power_w), max(t.total_power_w), count(*)::int
      from building_totals t
     where t.ts >= w.win_start and t.ts < w.win_end
       and not exists (select 1 from building_totals_hourly b2 where b2.hour = date_trunc('hour', t.ts))
     group by 1
  ),
  observed as (
    select (bucket at time zone p_tz)::date              as d,
           extract(hour from bucket at time zone p_tz)::int as h,
           avg_w, max_w, n_obs
      from hours_ext
  ),
  grid as (
    select d::date, h
      from generate_series(
             (w.win_start at time zone p_tz)::date,
             (w.win_end   at time zone p_tz)::date - 1,
             interval '1 day'
           ) d,
           generate_series(0, 23) h
  )
  select grid.d, grid.h, o.avg_w, o.max_w, coalesce(o.n_obs, 0),
         res
    from grid
    left join observed o on o.d = grid.d and o.h = grid.h
   order by grid.d, grid.h;
end;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Load duration curve — demand sorted high to low, decimated to a fixed number of points.
--
-- Sorting the whole sample set IS the computation, and there are 44,640 of them in a month.
-- Shipping those to a Raspberry Pi's browser to sort is the anti-pattern phase9 exists to
-- prevent. `percentile_cont` over an array returns a fixed row count no matter how many samples
-- underlie it.
--
-- What it is for: it answers "how many hours a period does this building actually sit near its
-- peak", which is the question a load-shedding tier is an answer to. A peak that is reached for
-- twenty minutes a month and one that is held all afternoon justify very different settings, and
-- a single `max` cannot tell them apart.
-- ---------------------------------------------------------------------------------------------
create or replace function public.report_demand_curve(
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
begin
  if p_points < 2 or p_points > 501 then
    raise exception 'p_points must be between 2 and 501, got %', p_points
      using errcode = 'invalid_parameter_value';
  end if;

  select * into w from public.report_window(p_period, p_start, p_tz);
  res := public.report_resolution(w.win_start, w.win_end);

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
       and not exists (select 1 from building_totals t2 where date_trunc('hour', t2.ts) = b.hour)
  ),
  fractions as (
    select i::numeric / (p_points - 1) as f from generate_series(0, p_points - 1) i
  )
  select round(fractions.f * 100, 2),
         -- Descending, so the curve starts at the peak and falls: fraction 0 is the highest
         -- sample, fraction 1 the lowest. That is the convention a duration curve is read in.
         (select percentile_cont(fractions.f) within group (order by s.v desc)::numeric from samples s),
         res
    from fractions
   order by fractions.f;
end;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- One-row demand summary — the numbers `baselineReport.mjs` leads with.
--
-- `longest_gap_minutes` is the figure worth singling out. It is what separates "a healthy month
-- with a few restarts" from "three weeks up and a week dark", and a coverage percentage cannot
-- tell those apart. It comes back NULL — never 0 — once the raw rows behind it have been pruned,
-- because at that point the gap is unmeasurable rather than absent, and reporting 0 would be a
-- claim the data cannot support.
-- ---------------------------------------------------------------------------------------------
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
    select t.ts as start_at, t.ts + interval '1 minute' as end_at, 1 as minutes, t.total_power_w as v
      from building_totals t
     where t.ts >= w.win_start and t.ts < w.win_end
    union all
    select b.hour, b.hour + interval '1 hour', coalesce(b.sample_count, 0), b.total_power_w_avg
      from building_totals_hourly b
     where b.hour >= w.win_start and b.hour < w.win_end
       and not exists (select 1 from building_totals t2 where date_trunc('hour', t2.ts) = b.hour)
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
    select start_at, end_at from obs
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
         w.expected_minutes,
         -- NULL, never 0, when nothing at all was observed: at that point the gap is the whole
         -- window and calling it zero would be the most reassuring possible way to report it.
         (select case when (select count(*) from obs) = 0 then null else max(gap_min)::numeric end from gaps),
         res;
end;
$fn$;

-- ---------------------------------------------------------------------------------------------
-- Grants.
--
-- These READ, so unlike phase27's writer they go to `authenticated` rather than `service_role`.
-- `anon` is named explicitly in the revoke and not merely left out of the grant: revoking from
-- PUBLIC does not remove a privilege Supabase has granted `anon` directly, which
-- `phase5_lockdown_rls.sql` learned once already and this file is not going to learn again.
-- ---------------------------------------------------------------------------------------------
revoke execute on function public.report_window(text, date, text)                    from public, anon;
revoke execute on function public.report_resolution(timestamptz, timestamptz)        from public, anon;
revoke execute on function public.report_daily_series(text, date, text)              from public, anon;
revoke execute on function public.report_hour_profile(text, date, text, text)        from public, anon;
revoke execute on function public.report_hour_matrix(text, date, text)               from public, anon;
revoke execute on function public.report_demand_curve(text, date, text, int)         from public, anon;
revoke execute on function public.report_demand_summary(text, date, text)            from public, anon;

grant execute on function public.report_window(text, date, text)                     to authenticated;
grant execute on function public.report_resolution(timestamptz, timestamptz)         to authenticated;
grant execute on function public.report_daily_series(text, date, text)               to authenticated;
grant execute on function public.report_hour_profile(text, date, text, text)         to authenticated;
grant execute on function public.report_hour_matrix(text, date, text)                to authenticated;
grant execute on function public.report_demand_curve(text, date, text, int)          to authenticated;
grant execute on function public.report_demand_summary(text, date, text)             to authenticated;
