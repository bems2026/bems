-- Architecture plan Phase 12: periodic energy reports.
--
-- WHAT THIS IS FOR:
-- the project needs a monthly record of what the building consumed that can be handed to
-- someone who will never open this dashboard. Computed in Postgres and stored, rather than
-- assembled in the browser on demand, for three reasons: the raw rows it is derived from are
-- pruned at 30 days (phase9/phase11), so a report computed later could not be reproduced; a
-- stored row is a stable artefact that can be re-downloaded and compared month to month; and
-- the aggregation stays next to the data instead of pulling a month of rows over the Pi's
-- uplink.
--
-- WHY TWO TABLES:
-- per-device figures have a real foreign key to `devices`; building-wide figures have no
-- device at all. Squeezing both into one table means a sentinel device_id that no FK can
-- reference and every reader has to remember to filter out. Two tables, two unconditional
-- primary keys, no sentinel.
--
-- COVERAGE IS NOT OPTIONAL — the most important column here:
-- a device that was offline for half a month still produces a real, small, confident-looking
-- kWh number. Quoting it without saying how much of the month was actually observed is the
-- same class of error as the truncated chart Phase 9 fixed: a plausible answer that is
-- silently wrong. Every row carries `online_sample_count` and `expected_sample_count`, and
-- nothing may present the energy figure without also presenting the ratio. Right now this
-- matters acutely: the field devices have been offline since 2026-08-20 (ROADMAP RM-001), so
-- every month generated today is mostly gap.
--
-- WHY energy IS A SUM OF DAILY MAXIMA:
-- `energy_kwh_today` is a cumulative counter that resets at local midnight, not a rate. The
-- month's consumption is therefore the sum over days of each day's high-water mark — never
-- an average, never a sum of raw values. `readings_hourly.energy_kwh_today_max` preserves
-- exactly what this needs past the prune.
--
-- WHY THE TIMEZONE IS A PARAMETER WITH A REAL DEFAULT:
-- the counter resets at the site's local midnight, so grouping days in UTC would split every
-- device-day across two report-days and undercount the last day of the month. The site is in
-- Batac City (the frontend already hardcodes `en-PH` and that city), so 'Asia/Manila' is the
-- honest default rather than a neutral-looking wrong one.
--
-- Apply once, by hand, in the Supabase SQL editor. No migration runner in this repo; same
-- convention as phase4_/.../phase11_*.sql.

-- =============================================================================
-- monthly_reports — one row per device per month.
-- =============================================================================
create table if not exists monthly_reports (
  month                 date    not null,   -- first day of the month, in the report timezone
  device_id             text    not null references devices(id),
  energy_kwh            numeric,            -- sum of daily maxima; NULL when never observed
  peak_power_w          numeric,
  avg_power_w           numeric,            -- weighted by each hour's own online sample count
  online_sample_count   int     not null,
  expected_sample_count int     not null,   -- one per minute for every minute of the month
  generated_at          timestamptz not null default now(),
  primary key (month, device_id)
);
create index if not exists monthly_reports_month_idx on monthly_reports (month desc);

-- =============================================================================
-- monthly_building_reports — one row per month, building-wide.
-- =============================================================================
create table if not exists monthly_building_reports (
  month                    date not null primary key,
  -- The bridge's own month counter, which is authoritative for the building in a way no
  -- sum of per-device meters is: not every load is individually metered.
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
  generated_at             timestamptz not null default now()
);

alter table monthly_reports          enable row level security;
alter table monthly_building_reports enable row level security;

-- Read-only from the browser, written only by ibems-server via the service-role key, which
-- bypasses RLS entirely. No insert/update policy for `authenticated` on purpose, and no anon
-- policy — phase5_lockdown_rls.sql dropped every one of those and none comes back.
create policy monthly_reports_select_authenticated on monthly_reports
  for select using (auth.role() = 'authenticated');
create policy monthly_building_reports_select_authenticated on monthly_building_reports
  for select using (auth.role() = 'authenticated');

-- =============================================================================
-- generate_monthly_report — idempotent. Recomputes and replaces both rows for one month.
--
-- `on conflict do update`, unlike the rollups in phase9/phase11: those keep the first value
-- because a later recomputation would be built from a fragment. This is the opposite case —
-- a report regenerated after more of its month has been rolled up is built from MORE data,
-- not less, so the newer answer is the better one. `generated_at` records which.
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
  insert into monthly_reports (
    month, device_id, energy_kwh, peak_power_w, avg_power_w,
    online_sample_count, expected_sample_count, generated_at
  )
  select p_month,
         d.device_id,
         (select sum(day_kwh) from daily where daily.device_id = d.device_id),
         d.peak_power_w,
         d.avg_power_w,
         d.online_sample_count,
         expected,
         now()
    from per_device d
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
