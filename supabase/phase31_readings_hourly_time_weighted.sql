-- =============================================================================
-- phase31 — the hourly rollup's average is weighted by the time each sample represents.
--
-- WHAT WAS WRONG. `roll_up_and_prune_readings` used a plain `avg(r.power_w)`. That is the right
-- answer only if every sample stands for the same amount of time, and on this fleet they do not.
-- Measured over 2026-09-05, the gaps between consecutive readings are 60 s x3,498, 58 s x423,
-- 61 s x318, 59 s x317, **30 s x313** and 92 s x271. And `r.ts` is the device's ARRIVAL time
-- (`shared/buildLatest.mjs` publishes it from `<ctx>_last_time`), so that spread is real meter
-- cadence, not jitter in the ingest loop.
--
-- HOW MUCH IT MATTERS — measured before writing this, because "unequal intervals" alone does not
-- prove the two disagree. Over 109 device-hours on 2026-09-05, plain against time-weighted:
--
--     median divergence   0.131%      <- most hours are genuinely fine
--     p95                 8.38%
--     worst              38.35%       <- co5, 06:00: 37.3 W reported, 51.5 W actual
--
-- So the typical hour is unaffected and the tail is badly wrong, in exactly the case that
-- produces it: a device whose reporting cadence tracks its load. A plain mean over-weights the
-- closely-spaced samples, and those cluster where the load is changing.
--
-- WHY NOW. `readings_hourly` is EMPTY — retention has not rolled anything up yet — so this
-- lands before a single bucket exists and there is nothing to backfill or to leave computed two
-- different ways. That window closes the first time raw rows age past the retention horizon.
--
-- THE WEIGHT, AND ITS TWO BOUNDS:
--   * A sample's weight is the elapsed time since the device's previous sample — a trailing
--     interval, via `lag()`, the same pattern `phase15` uses.
--   * Capped at 300 s. A device that goes quiet for six hours and comes back must not have its
--     first reading weighted six hours. NOTE the deliberate difference from
--     `MAX_INTEGRATION_GAP_MS` in `node-red-bridge/dpParserPlan.mjs`, which is the same number
--     for the same reason but SKIPS the interval rather than capping it: that code accumulates
--     energy, where inventing a gap fabricates kWh, and this one averages, where dropping the
--     sample would lose the only reading a sparse hour has. Same hazard, opposite correct
--     response.
--   * Defaulted to 60 s when there is no previous sample — the first row of a batch, and the
--     first row a device ever produced. The nominal poll interval is the honest guess, and it
--     applies to at most one sample per device per rollup.
--
-- THE DENOMINATOR IS FILTERED PER COLUMN, which is the subtlety and is not new: `phase10`'s
-- `readings_archive` already does exactly this one level up, for the same reason it states —
-- "an unmetered device can be online with a null reading, and counting its samples would dilute
-- the average with weight it never carried". A light switch is online with a null `power_w`
-- every minute of every hour.
--
-- WHAT IS NOT CHANGED. `power_w_max` and `energy_kwh_today_max` stay as they are: a maximum has
-- no weight. `sample_count` and `online_sample_count` stay counts, because that is what they
-- mean and `phase10` weights hours by them.
--
-- KNOWN AND DELIBERATELY LEFT: `phase10`'s hour-to-day rollup weights each hour by
-- `online_sample_count`, a COUNT. An hour covered by 60 samples and one covered by 30 slower
-- ones both span an hour, so that weighting is a proxy rather than a measurement. Correcting it
-- would mean carrying a `covered_seconds` column on `readings_hourly`; it is recorded here
-- rather than done, because nothing has yet shown the proxy is wrong enough to matter and an
-- unused column is a worse answer than a written-down question.
--
-- Idempotent — `create or replace`. Apply once, by hand, in the Supabase SQL editor; same
-- convention as every other phase file here. Rehearsed by `supabase/rehearse.sh`.
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
    energy_kwh_today_max, sample_count, online_sample_count
  )
  with spaced as (
    select r.device_id,
           r.ts,
           r.power_w,
           r.voltage,
           r.current,
           r.energy_kwh_today,
           r.online,
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
         sum(s.power_w * s.weight_s) filter (where s.online)
           / nullif(sum(s.weight_s) filter (where s.online and s.power_w is not null), 0),
         max(s.power_w)              filter (where s.online),
         sum(s.voltage * s.weight_s) filter (where s.online)
           / nullif(sum(s.weight_s) filter (where s.online and s.voltage is not null), 0),
         sum(s.current * s.weight_s) filter (where s.online)
           / nullif(sum(s.weight_s) filter (where s.online and s.current is not null), 0),
         max(s.energy_kwh_today)     filter (where s.online),
         count(*)::int,
         count(*) filter (where s.online)::int
    from spaced s
   group by 1, 2
  on conflict (device_id, hour) do nothing;
  get diagnostics n_rolled = row_count;

  delete from readings r where r.ts < cutoff;
  get diagnostics n_deleted = row_count;

  return query select n_rolled, n_deleted;
end;
$$;

-- Unchanged from phase9, restated because `create or replace function` does not reset grants
-- and a future reader should not have to go two files back to learn that this one DELETES.
revoke execute on function public.roll_up_and_prune_readings(timestamptz) from public;
grant  execute on function public.roll_up_and_prune_readings(timestamptz) to service_role;
