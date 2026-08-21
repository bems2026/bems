-- Architecture plan Phase 9b: bounded retention for `readings`, with an hourly rollup so
-- long-range history survives the pruning. Closes ROADMAP RM-006.
--
-- THE PROBLEM:
-- server/ingest.mjs writes one row per device per 60s tick, forever, and nothing has ever
-- deleted one. Measured on the live Pi on 2026-08-21: 130,367 rows after 4.7 days of
-- operation, ~27,700 rows/day for 20 devices. Left alone that is ~10M rows and roughly the
-- whole Supabase storage allowance within the year — and when that ceiling is reached,
-- ingest's writes start FAILING, which means the history record itself stops. Unbounded
-- growth in the table the entire Analytics page reads is not a tidiness problem.
--
-- THE POLICY (chosen by the operator, 2026-08-21 — recorded here because ROADMAP.md §5 Q6
-- had it as explicitly unanswered, and the right window is a reporting decision, not a
-- technical one): keep 30 days of per-minute resolution, and roll everything older into
-- permanent hourly buckets. Steady state is ~830k rows in `readings` and ~175k rows/year in
-- `readings_hourly`, both bounded, with a year-scale energy record still defensible.
--
-- WHY ROLLUP AND PRUNE ARE ONE FUNCTION:
-- a function body is a single transaction. If the delete could commit without the rollup,
-- the data would be gone with nothing to show for it. Bundling them makes that
-- unrepresentable — either both happen or neither does.
--
-- WHY p_before IS TRUNCATED TO AN HOUR BOUNDARY:
-- rolling up a partial hour and deleting its rows would leave the rest of that hour to be
-- aggregated on the next run, producing a bucket computed from half its samples. Truncating
-- means an hour is only ever rolled up once it is complete and entirely behind the cutoff.
--
-- WHY `on conflict do nothing` AND NOT `do update`:
-- given the truncation above plus atomicity, a conflict should be unreachable. If one ever
-- does occur it means raw rows for an already-rolled-up hour came back — in which case the
-- ORIGINAL bucket was computed from the complete hour and the new one would be computed
-- from a fragment. Keeping the first value is the safe direction to be wrong in.
--
-- Apply once, by hand, in the Supabase SQL editor. No migration runner in this repo; same
-- convention as phase4_/.../phase8_*.sql.

create table if not exists readings_hourly (
  device_id            text        not null references devices(id),
  hour                 timestamptz not null,
  power_w_avg          numeric,
  power_w_max          numeric,
  voltage_avg          numeric,
  current_avg          numeric,
  -- The daily counter's high-water mark within the hour. Averaging a counter that resets at
  -- midnight would be meaningless; the max is what lets a daily total be recovered later.
  energy_kwh_today_max numeric,
  sample_count         int         not null,
  online_sample_count  int         not null,
  primary key (device_id, hour)
);
create index if not exists readings_hourly_device_id_hour_idx on readings_hourly (device_id, hour desc);

alter table readings_hourly enable row level security;

-- Same access model as readings/building_totals/anomalies: read-only from the browser,
-- written only by ibems-server via the service-role key, which bypasses RLS entirely. No
-- insert/update policy for `authenticated` on purpose, and no anon policy —
-- phase5_lockdown_rls.sql dropped every one of those and none comes back.
create policy readings_hourly_select_authenticated on readings_hourly
  for select using (auth.role() = 'authenticated');

-- Roll every completed hour older than p_before into readings_hourly, then delete those raw
-- rows. Returns what it actually did so server/retention.mjs can log real numbers rather
-- than assert success — the same "verify the affected-row count, never trust a bare 200"
-- discipline that writeScheduleContext needed in 2e4c0c2.
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
    energy_kwh_today_max, sample_count, online_sample_count
  )
  select r.device_id,
         date_trunc('hour', r.ts),
         avg(r.power_w)          filter (where r.online),
         max(r.power_w)          filter (where r.online),
         avg(r.voltage)          filter (where r.online),
         avg(r.current)          filter (where r.online),
         max(r.energy_kwh_today) filter (where r.online),
         count(*)::int,
         count(*) filter (where r.online)::int
    from readings r
   where r.ts < cutoff
   group by 1, 2
  on conflict (device_id, hour) do nothing;
  get diagnostics n_rolled = row_count;

  delete from readings r where r.ts < cutoff;
  get diagnostics n_deleted = row_count;

  return query select n_rolled, n_deleted;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default. This function DELETES data — revoke that
-- default before granting it to the one role that owns ingestion writes.
revoke execute on function public.roll_up_and_prune_readings(timestamptz) from public;
grant  execute on function public.roll_up_and_prune_readings(timestamptz) to service_role;
