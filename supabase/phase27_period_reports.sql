-- RM-041: reports gain a WEEK, and stop being able to only mean a month.
--
-- REQUIRES supabase/phase12_monthly_reports.sql (whose tables this generalises) and the phase9
-- rollups it reads through.
--
-- WHY NOT A SECOND COPY OF EVERYTHING. The obvious move is `weekly_reports`,
-- `weekly_building_reports` and `generate_weekly_report` — a near-identical twin of phase12. It
-- is 140 lines of duplicated seam handling, and the seam is the subtle part: the aggregation
-- reads the hourly rollup UNION the not-yet-rolled-up raw rows, excluding raw hours the rollup
-- already covers, so a partly-pruned period reports the same figures as an unpruned one. Two
-- copies of that logic drift, and the drift is silent — the numbers stay plausible.
--
-- Reading phase12's function, the ONLY month-specific things in it are `date_trunc('month')`,
-- `interval '1 month'`, and the tables it writes to. Everything else is already a function of a
-- half-open window. So this file keeps the shape and parameterises the window.
--
-- WHY NEW TABLES RATHER THAN A `period` COLUMN ON THE OLD ONES. `monthly_reports` is keyed
-- `(month, device_id)` and holds live rows. Adding a discriminator means dropping and rebuilding
-- a primary key on a table with data, and leaves a column called `month` holding the first day
-- of a week — a name that lies. New tables cost a backfill, which is cheap and verifiable,
-- because the generator recomputes from `readings_hourly` and produces the same answer it did
-- the first time (phase12's own header makes that claim; the rehearsal now checks it).
--
-- PHASE 12 IS LEFT ENTIRELY ALONE. Its tables, its function and its grants all stay. They are
-- what the deployment is running today, and rewriting a working aggregation nobody asked to
-- change, on a live building, to gain a feature that does not need it, is not a trade worth
-- making. Once the app reads only these tables and a month has passed, dropping the old pair is
-- a follow-up — recorded in ROADMAP.md as RM-042.
--
-- Apply once, by hand, in the Supabase SQL editor. Rehearse with supabase/rehearse.sh first.
--
-- RE-RUNNING IS SAFE. Every create is guarded, each policy is dropped before it is created
-- (`create policy` has no `if not exists` — the scar phase21 left), and the function is
-- `create or replace`. `test/migration-idempotency.test.mjs` fails any file that makes this
-- promise without earning it.

-- =============================================================================
-- period_reports — one row per device per period.
-- =============================================================================
create table if not exists period_reports (
  -- 'week' or 'month'. Text rather than an enum: adding 'quarter' should not need a migration
  -- on a type that other objects depend on, and the check below is as strict as an enum is.
  period                text    not null,
  -- The first local day of the period, in the report timezone. For a week that is its Monday.
  period_start          date    not null,
  device_id             text    not null references devices(id),
  energy_kwh            numeric,            -- sum of daily maxima; NULL when never observed
  peak_power_w          numeric,
  avg_power_w           numeric,            -- weighted by each hour's own online sample count
  online_sample_count   int     not null,
  expected_sample_count int     not null,   -- one per minute for every minute of the period
  generated_at          timestamptz not null default now(),
  primary key (period, period_start, device_id)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'period_reports_period_known') then
    alter table period_reports add constraint period_reports_period_known
      check (period in ('week', 'month'));
  end if;
end $$;

create index if not exists period_reports_lookup_idx on period_reports (period, period_start desc);

-- =============================================================================
-- period_building_reports — one row per period, building-wide.
-- =============================================================================
create table if not exists period_building_reports (
  period                   text not null,
  period_start             date not null,
  -- The bridge's own counter, which is authoritative for the building in a way no sum of
  -- per-device meters is: not every load is individually metered.
  energy_kwh               numeric,
  peak_total_power_w       numeric,
  avg_voltage              numeric,
  phase_current_red_avg    numeric,
  phase_current_yellow_avg numeric,
  -- Stays NULL, never 0 — no Blue-phase meter is installed. See schema.sql:59.
  phase_current_blue_avg   numeric,
  command_count            int not null default 0,
  command_count_manual     int not null default 0,
  command_count_schedule   int not null default 0,
  command_count_autoshed   int not null default 0,
  anomaly_count            int not null default 0,
  online_sample_count      int not null default 0,
  expected_sample_count    int not null default 0,
  generated_at             timestamptz not null default now(),
  primary key (period, period_start)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'period_building_reports_period_known') then
    alter table period_building_reports add constraint period_building_reports_period_known
      check (period in ('week', 'month'));
  end if;
end $$;

alter table period_reports          enable row level security;
alter table period_building_reports enable row level security;

-- Read-only from the browser, exactly as phase12 has it: reports are generated server-side by
-- the service role, which bypasses RLS. No anon policy.
drop policy if exists period_reports_select_authenticated on period_reports;
create policy period_reports_select_authenticated on period_reports
  for select to authenticated using (true);

drop policy if exists period_building_reports_select_authenticated on period_building_reports;
create policy period_building_reports_select_authenticated on period_building_reports
  for select to authenticated using (true);

-- =============================================================================
-- generate_period_report — idempotent. Recomputes and replaces both rows for one period.
-- =============================================================================
--
-- `on conflict do update`, unlike the rollups in phase9/phase11: those keep the first value
-- because a later recomputation would be built from a fragment. This is the opposite case — a
-- report regenerated after more of its period has been rolled up is built from MORE data, not
-- less, so the newer answer is the better one. `generated_at` records which.
--
-- WEEKS START ON MONDAY, because `date_trunc('week')` does and because ISO-8601 does. The
-- caller passes any date within the week and gets that week; passing a Wednesday does not
-- produce a Wednesday-to-Tuesday period.
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
  -- The counter resets at local midnight, so the day's consumption is its high-water mark.
  daily as (
    select device_id,
           (hour at time zone p_tz)::date as local_day,
           max(energy_kwh_today_max)      as day_kwh
      from hours
     group by 1, 2
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
    online_sample_count, expected_sample_count, generated_at
  )
  select p_period,
         local_start,
         d.device_id,
         (select sum(day_kwh) from daily where daily.device_id = d.device_id),
         d.peak_power_w,
         d.avg_power_w,
         d.online_sample_count,
         expected,
         now()
    from per_device d
  on conflict (period, period_start, device_id) do update set
    energy_kwh            = excluded.energy_kwh,
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
-- Backfill: every month phase12 already reported, recomputed through the new function.
-- =============================================================================
--
-- Safe and checkable. The generator reads `readings_hourly`, which retention does NOT prune
-- (only raw `readings` are), so recomputing a settled month produces the figures it produced the
-- first time — the claim phase12's own header makes, and which the rehearsal now verifies by
-- comparing the two tables row for row.
--
-- Runs inside this migration so the app never sees a period table that is missing history the
-- old one has, which would look like data loss on the first load after the deploy.
do $$
declare
  m date;
begin
  for m in select distinct month from monthly_building_reports order by month loop
    perform generate_period_report('month', m);
  end loop;
end $$;
