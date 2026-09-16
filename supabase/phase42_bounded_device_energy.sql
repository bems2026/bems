-- =============================================================================
-- Phase 42 — RM-091. A meter's counter may not add more energy than its circuit could draw.
--
-- WHAT WAS WRONG. A period's per-device energy was the sum of each local day's highest
-- `energy_kwh_today` (phase27, and phase12 for the legacy monthly table). On 2026-09-08 L.O Yellow's
-- register jumped 0.111 -> 67.391 kWh at 02:36 while the circuit drew 49 W, and ended the day at
-- 77.502. RM-052 repaired the bridge; the stored readings kept the jump, and the weekly report for
-- 2026-09-07, generated on 2026-09-16, gives that lighting circuit 81.406 kWh. Its highest draw all
-- week was 251.2 W, and 251.2 W for all 168 hours is 42.2 kWh.
--
-- THE RULE. For each device and local day, over the hours that carry a counter, in time order:
--
--   rise   = this hour's highest counter value - the previous such hour's (0 at local midnight)
--   span   = hours since that previous hour; for the first, from local midnight to this hour's end
--   cap    = the day's highest power (kW) x (span + 1) x 1.10 + 0.005 kWh
--   credit = 0 when the counter fell (a restart, or a repaired base: the next rise counts from there);
--            the hour's own average power x span when the rise is over the cap, and never more than
--            the cap — 0 when that hour carried no power reading;
--            the rise itself otherwise
--
-- A healthy counter rises only by what was drawn, so its credits sum to its high-water mark and the
-- rule changes nothing. Replayed read-only over every stored device-day on 2026-09-16 — 250 of them,
-- outlets and aircon included — it changed exactly one: 2026-09-08 L.O Yellow, 77.502 -> 0.713 kWh,
-- where the circuit's own power readings integrate to 0.708. The same rule, with the same constants
-- and the same six fixture days, is `src/lib/boundedEnergy.ts`.
--
-- Power is credited only for an hour whose counter has already proven impossible. RM-077 showed that
-- integrating power overcounts while a meter is frozen, which is why it is used for nothing else.
--
-- WHAT THIS FILE DOES.
--   1. `period_reports` gains `energy_removed_kwh` (what the bound took out of a figure) and
--      `energy_restated_at` (set only by step 4).
--   2. `report_device_daily_energy` — one row per device per local day of a period, gap days included,
--      with the bounded energy, the counter, what was removed, peak, average and minutes. The Reports
--      page reads it for its per-circuit charts, so it is granted to signed-in readers.
--   3. `generate_period_report` and `generate_monthly_report` sum it for per-device energy. Nothing else
--      in either changes; their building halves are the earlier files' text, byte for byte.
--   4. A one-time correction of stored `period_reports` rows whose figure demonstrably contains a
--      removed jump: the stored figure must still equal the sum of the counters it was built from. It
--      subtracts what was removed and records when. It never touches coverage, `generated_at`, the
--      building rows or the legacy monthly tables (RM-073: restating coverage is an undecided matter;
--      RM-047b left August's outlet rows as generated on purpose).
--
-- Expected on the live project: one row corrected — the week of 2026-09-07, `mtr_lo_yellow`,
-- 81.406 -> about 4.617 kWh, with about 76.789 removed. The four branches then sum to about 61.51 kWh
-- against the building's own 61.73.
--
-- SAFE TO RE-RUN. Columns are added `if not exists`; the new function is dropped by signature first; the
-- generators keep their signatures and OUT columns; the correction skips any row already corrected. No
-- policy, trigger or constraint is created. Apply by hand in the Supabase SQL editor; rehearsed by
-- `supabase/rehearse.sh`, which applies it twice. APPLY BEFORE ABOUT 2026-10-03, when September's
-- monthly report is generated and would otherwise carry the jump.
-- =============================================================================

alter table period_reports add column if not exists energy_removed_kwh numeric;
alter table period_reports add column if not exists energy_restated_at timestamptz;

-- =============================================================================
-- report_device_daily_energy — the rule, per device per local day.
--
-- Hours come from the same place phase27's do: the hourly rollup UNION the raw readings it has not yet
-- rolled up, the rollup winning the seam, online samples only. So a period that has been partly pruned
-- answers exactly as one that has not, and this function and the generators cannot disagree about
-- which hours exist.
--
-- EVERY DAY OF THE PERIOD, FOR EVERY DEVICE SEEN IN IT — devices x calendar days, then the data joined
-- on. A day nothing was recorded on is a row with energy NULL and no minutes, never a row of zeros and
-- never a missing row (phase37's rule, for the same reason).
--
-- Columns are qualified everywhere and the CTEs name their own columns, because the OUT parameters
-- below share names with table columns and PL/pgSQL would otherwise read an unqualified `device_id` as
-- ambiguous (42702 — phase37 paid for that once).
-- =============================================================================
drop function if exists public.report_device_daily_energy(text, date, text, text[]);

create function public.report_device_daily_energy(
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
           avg(r.power_w) filter (where r.online),
           max(r.power_w) filter (where r.online),
           max(r.energy_kwh_today) filter (where r.online),
           (count(*) filter (where r.online))::int,
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

-- Read by the Reports page, so signed-in readers may run it — and RLS still applies to them, because it
-- is `security invoker`. `anon` is named in the revoke: revoking from PUBLIC does not take back a grant
-- Supabase gave `anon` directly (phase37's note). The generators run as service_role and call it.
revoke execute on function public.report_device_daily_energy(text, date, text, text[]) from public, anon;
grant  execute on function public.report_device_daily_energy(text, date, text, text[]) to authenticated, service_role;

-- It reads its window through `report_window`, which phase37 granted to `authenticated` only. A real
-- Supabase project also grants every new function to service_role by default; a rehearsal container
-- does not, and saying it here costs nothing and removes the difference.
grant  execute on function public.report_window(text, date, text) to service_role;

-- =============================================================================
-- generate_period_report — phase27's, with its per-device energy summed from the function above.
-- Everything else in it, the building half above all, is phase27's text unchanged, and
-- test/phase42-bounded-device-energy-schema.test.mjs holds it to that.
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
         d.online_sample_count,
         expected,
         -- What the bound took out, kept beside the figure. Below 1 Wh it is rounding, not a correction.
         case when bd.removed_kwh > 0.001 then bd.removed_kwh end,
         now()
    from per_device d
    left join bounded bd on bd.dev = d.device_id
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
         coalesce((select sum(sample_count)::int from totals_hours), 0),
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
-- generate_monthly_report — phase12's, changed the same way, so the legacy table the ingest daemon still
-- writes cannot carry a jump the period table refuses. Its building half is phase12's text unchanged.
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
         d.online_sample_count,
         expected,
         now()
    from per_device d
    left join bounded bd on bd.dev = d.device_id
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
         coalesce((select sum(sample_count)::int from totals_hours), 0),
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
-- The one-time correction of stored rows.
--
-- ONLY A ROW THAT DEMONSTRABLY CONTAINS A REMOVED JUMP. Three conditions, all required:
--   - the rule removes more than 1 Wh from that device in that period;
--   - the stored figure still equals the sum of the counters it was built from (within 0.01 kWh), so
--     the thing being subtracted is provably in it — a row generated from other data is left alone;
--   - the row has not been corrected already, which is what makes a second paste change nothing.
--
-- It subtracts what was removed rather than recomputing the row, so nothing else about the row is
-- restated: coverage, peak, average and `generated_at` stay exactly as generated (RM-073).
-- =============================================================================
do $$
declare
  r record;
  n int;
  total int := 0;
begin
  for r in select distinct p.period, p.period_start from period_reports p order by 1, 2 loop
    with found as materialized (
      select x.device_id        as dev,
             sum(x.removed_kwh) as removed,
             sum(x.counter_kwh) as counters
        from public.report_device_daily_energy(r.period, r.period_start) x
       group by x.device_id
    )
    update period_reports p
       set energy_kwh         = p.energy_kwh - f.removed,
           energy_removed_kwh = f.removed,
           energy_restated_at = now()
      from found f
     where p.period = r.period
       and p.period_start = r.period_start
       and p.device_id = f.dev
       and f.removed > 0.001
       and p.energy_removed_kwh is null
       and p.energy_kwh is not null
       and abs(p.energy_kwh - f.counters) <= 0.01
       and p.energy_kwh - f.removed >= 0;
    get diagnostics n = row_count;
    total := total + n;
  end loop;
  raise notice 'phase42: corrected % stored period_reports row(s)', total;
end $$;

-- So the API sees the new function and columns now, rather than after its next schema reload.
notify pgrst, 'reload schema';
