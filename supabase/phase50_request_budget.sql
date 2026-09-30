-- RM-149: the hosted database's request budget, and how close the project is to its caps.
--
-- WHY. After RM-148 the database stands at 129 of the Free plan's 500 MB (E-224), and the quota still
-- near its limit is log ingestion: 0.97 of 1 GB on 2026-09-30. Every request to the project is a line
-- in that log, so the log grows with the number of requests, not with their size. This phase touches
-- no rows and changes no table. It adds two read-only functions:
--
--   1. scheduler_snapshot(site). The scheduler re-reads its configuration every minute so a change
--      made in the app takes effect without a restart. That was seven requests a minute, about
--      10,000 a day, the largest single source of lines. This returns the same rows in one.
--      server/scheduler.mjs falls back to the seven reads while this function is absent.
--   2. usage_bytes(). The database size the plan's quota counts (pg_database_size) and the bytes held
--      in file storage, so `npm run preflight` can warn well before either cap. Above 500 MB a Free
--      project turns read-only, and the edge's own writes then fail.
--
-- Both are the service role's alone: the daemons and preflight run with it, and nothing in the
-- browser needs either.
--
-- Apply once, by hand, in the Supabase SQL editor, then restart ibems-scheduler. Safe to paste
-- twice. Rehearse with supabase/rehearse.sh first.

-- 1. The scheduler's configuration in one request ----------------------------------------------
--
-- Each key is exactly what one of the scheduler's reads returned, column for column, so both paths
-- feed the same code. `dsm` is this site's row or null. `acu_commands` is the newest fifty commands
-- to any aircon a rule names, newest first: the manual/schedule hold reads the first per aircon.
create or replace function public.scheduler_snapshot(p_site_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'schedules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'device_id', s.device_id, 'socket', s.socket, 'rule', s.rule,
               'enabled', s.enabled, 'updated_by', s.updated_by, 'label', s.label))
        from schedules s), '[]'::jsonb),
    'dsm', (
      select jsonb_build_object(
               'max_phase_current', t.max_phase_current, 'max_total_kw', t.max_total_kw,
               'auto_shed', t.auto_shed, 'updated_by', t.updated_by)
        from dsm_thresholds t
       where t.site_id = p_site_id),
    'device_config', coalesce((
      select jsonb_agg(jsonb_build_object('device_id', c.device_id, 'load_shed_group', c.load_shed_group))
        from device_config c), '[]'::jsonb),
    'socket_config', coalesce((
      select jsonb_agg(jsonb_build_object('device_id', c.device_id, 'socket', c.socket, 'load_shed_group', c.load_shed_group))
        from socket_config c), '[]'::jsonb),
    'acu_rules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'acu_device_id', r.acu_device_id, 'sensor_device_id', r.sensor_device_id,
               'target_c', r.target_c, 'deadband_c', r.deadband_c, 'step_c', r.step_c,
               'min_step_interval_s', r.min_step_interval_s, 'manual_hold_s', r.manual_hold_s,
               'days', r.days, 'window_start', r.window_start, 'window_end', r.window_end,
               'enabled', r.enabled, 'label', r.label, 'override_reason', r.override_reason,
               'updated_by', r.updated_by))
        from acu_rules r), '[]'::jsonb),
    'acu_loop_state', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rule_id', l.rule_id, 'commanded_c', l.commanded_c, 'last_step_at', l.last_step_at,
               'last_direction', l.last_direction, 'alert_kind', l.alert_kind, 'alert_since', l.alert_since))
        from acu_loop_state l), '[]'::jsonb),
    'acu_commands', coalesce((
      select jsonb_agg(jsonb_build_object('device_id', x.device_id, 'source', x.source, 'requested_at', x.requested_at)
                       order by x.requested_at desc)
        from (select c.device_id, c.source, c.requested_at
                from commands c
               where c.device_id in (select r.acu_device_id from acu_rules r)
               order by c.requested_at desc
               limit 50) x), '[]'::jsonb)
  );
$$;

revoke all on function public.scheduler_snapshot(text) from public, anon, authenticated;
grant execute on function public.scheduler_snapshot(text) to service_role;

-- 2. How close the project is to its caps --------------------------------------------------------
--
-- `database` is what the plan's database quota counts. `storage` sums every object in every bucket,
-- which is what the file-storage quota counts; the sealed days and the weekly backups live there.
create or replace function public.usage_bytes()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'database', pg_database_size(current_database()),
    'storage', coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o), 0)
  );
$$;

revoke all on function public.usage_bytes() from public, anon, authenticated;
grant execute on function public.usage_bytes() to service_role;

notify pgrst, 'reload schema';
