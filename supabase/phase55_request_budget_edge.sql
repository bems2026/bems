-- RM-159: one request per upload, and how big each table is.
--
-- WHY. Log ingestion went past the Free plan's 1 GB (1.10 GB on 2026-10-04), and every request to the
-- project is a line in that log: the log grows with the number of requests, not with their size. The
-- edge uploads its archive every five minutes, and each upload was three requests or four: readings,
-- building totals, anomalies when there were any, and the health row. 864 a day, plus as many again on
-- the ticks an anomaly sent an upload early. This phase changes no table and no row. It adds two
-- functions:
--
--   1. ingest_upload(readings, building_totals, anomalies, health). One upload in one request. Each
--      stream is upserted on its own key with exactly the columns the edge sends
--      (server/archiveDb.mjs STREAMS), which is what PostgREST's `resolution=merge-duplicates` did with
--      the same rows; the health row keeps a field the payload leaves out, as merge-duplicates did. It
--      is one statement-level transaction: a row the database refuses refuses the whole upload, and
--      the edge then sends that upload the old way, stream by stream, which finds and sets the row aside
--      (server/archiveUpload.mjs). Until this function exists the edge uploads the old way too, and asks
--      for the function again an hour later, so pasting this needs no restart.
--   2. usage_by_table(). The largest tables and their indexes, for `npm run preflight` and the capacity
--      projection in docs/adr/ADR-0015.
--
-- Both are the service role's alone: the ingest daemon and preflight run with it, and nothing in the
-- browser needs either.
--
-- Apply once, by hand, in the Supabase SQL editor. Safe to paste twice. Rehearse with
-- supabase/rehearse.sh first. No table is created, so the editor has no row-security question to ask.

-- 1. One upload in one request -------------------------------------------------------------------
create or replace function public.ingest_upload(
  p_readings        jsonb default '[]'::jsonb,
  p_building_totals jsonb default '[]'::jsonb,
  p_anomalies       jsonb default '[]'::jsonb,
  p_health          jsonb default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  n_readings int := 0;
  n_totals   int := 0;
  n_anoms    int := 0;
begin
  insert into readings (device_id, ts, voltage, current, power_w, energy_kwh_today, online, total_energy_kwh,
                        warn_power_w, power_type, net_state, fault, capabilities)
  select r.device_id, r.ts, r.voltage, r.current, r.power_w, r.energy_kwh_today, r.online, r.total_energy_kwh,
         r.warn_power_w, r.power_type, r.net_state, r.fault, r.capabilities
    from jsonb_populate_recordset(null::readings, coalesce(p_readings, '[]'::jsonb)) r
  on conflict (device_id, ts) do update set
    voltage = excluded.voltage, current = excluded.current, power_w = excluded.power_w,
    energy_kwh_today = excluded.energy_kwh_today, online = excluded.online,
    total_energy_kwh = excluded.total_energy_kwh, warn_power_w = excluded.warn_power_w,
    power_type = excluded.power_type, net_state = excluded.net_state, fault = excluded.fault,
    capabilities = excluded.capabilities;
  get diagnostics n_readings = row_count;

  insert into building_totals (ts, site_id, energy_kwh_today, energy_kwh_week, energy_kwh_month,
                               energy_kwh_today_integrated, energy_kwh_week_integrated, energy_kwh_month_integrated,
                               total_power_w, avg_voltage, phase_current_red, phase_current_yellow, phase_current_blue)
  select b.ts, b.site_id, b.energy_kwh_today, b.energy_kwh_week, b.energy_kwh_month,
         b.energy_kwh_today_integrated, b.energy_kwh_week_integrated, b.energy_kwh_month_integrated,
         b.total_power_w, b.avg_voltage, b.phase_current_red, b.phase_current_yellow, b.phase_current_blue
    from jsonb_populate_recordset(null::building_totals, coalesce(p_building_totals, '[]'::jsonb)) b
  on conflict (ts) do update set
    site_id = excluded.site_id, energy_kwh_today = excluded.energy_kwh_today,
    energy_kwh_week = excluded.energy_kwh_week, energy_kwh_month = excluded.energy_kwh_month,
    energy_kwh_today_integrated = excluded.energy_kwh_today_integrated,
    energy_kwh_week_integrated = excluded.energy_kwh_week_integrated,
    energy_kwh_month_integrated = excluded.energy_kwh_month_integrated,
    total_power_w = excluded.total_power_w, avg_voltage = excluded.avg_voltage,
    phase_current_red = excluded.phase_current_red, phase_current_yellow = excluded.phase_current_yellow,
    phase_current_blue = excluded.phase_current_blue;
  get diagnostics n_totals = row_count;

  insert into anomalies (device_id, ts, metric, value, baseline_mean, baseline_stddev, z_score, iqr_lower,
                         iqr_upper, method, sample_count)
  select a.device_id, a.ts, a.metric, a.value, a.baseline_mean, a.baseline_stddev, a.z_score, a.iqr_lower,
         a.iqr_upper, a.method, a.sample_count
    from jsonb_populate_recordset(null::anomalies, coalesce(p_anomalies, '[]'::jsonb)) a
  on conflict (device_id, ts, metric) do update set
    value = excluded.value, baseline_mean = excluded.baseline_mean, baseline_stddev = excluded.baseline_stddev,
    z_score = excluded.z_score, iqr_lower = excluded.iqr_lower, iqr_upper = excluded.iqr_upper,
    method = excluded.method, sample_count = excluded.sample_count;
  get diagnostics n_anoms = row_count;

  -- The health row, as merge-duplicates wrote it: a field the payload leaves out keeps its value. The
  -- edge sends `last_success_at` only on success and the scrub's reason only when it refused something,
  -- so both stay put in between (server/healthRow.mjs).
  if p_health is not null then
    insert into ingestion_health (id, site_id, buffered_row_count, last_error, last_success_at,
                                  scrub_rejected_count, scrub_last_reason, scrub_last_at)
    select h.id, h.site_id, coalesce(h.buffered_row_count, 0), h.last_error, h.last_success_at,
           coalesce(h.scrub_rejected_count, 0), h.scrub_last_reason, h.scrub_last_at
      from jsonb_populate_record(null::ingestion_health, p_health) h
    on conflict (id) do update set
      site_id              = excluded.site_id,
      buffered_row_count   = excluded.buffered_row_count,
      last_error           = excluded.last_error,
      last_success_at      = case when p_health ? 'last_success_at' then excluded.last_success_at else ingestion_health.last_success_at end,
      scrub_rejected_count = case when p_health ? 'scrub_rejected_count' then excluded.scrub_rejected_count else ingestion_health.scrub_rejected_count end,
      scrub_last_reason    = case when p_health ? 'scrub_last_reason' then excluded.scrub_last_reason else ingestion_health.scrub_last_reason end,
      scrub_last_at        = case when p_health ? 'scrub_last_at' then excluded.scrub_last_at else ingestion_health.scrub_last_at end;
  end if;

  return jsonb_build_object('readings', n_readings, 'building_totals', n_totals, 'anomalies', n_anoms,
                            'health', p_health is not null);
end;
$$;

revoke all on function public.ingest_upload(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_upload(jsonb, jsonb, jsonb, jsonb) to service_role;

-- 2. How big each table is ----------------------------------------------------------------------------
--
-- `usage_bytes()` (phase50) gives the whole database against its 500 MB; this says which tables hold
-- it, so growth can be projected per table rather than guessed.
create or replace function public.usage_by_table(p_limit int default 12)
returns table (table_name text, total_bytes bigint, table_bytes bigint, index_bytes bigint, rows_estimate bigint)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select c.relname::text,
         pg_total_relation_size(c.oid),
         pg_relation_size(c.oid),
         pg_indexes_size(c.oid),
         greatest(c.reltuples, 0)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
   order by pg_total_relation_size(c.oid) desc
   limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

revoke all on function public.usage_by_table(int) from public, anon, authenticated;
grant execute on function public.usage_by_table(int) to service_role;

notify pgrst, 'reload schema';
