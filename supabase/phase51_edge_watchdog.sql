-- RM-150 (F-034): something that notices when the edge stops recording, and runs somewhere else.
--
-- WHY. Every notice this system sends comes from the edge itself: the fleet alarm, the archive alarm,
-- the aircon loop, the weekly backup. If the edge loses power, its card fails, its internet drops or
-- ingest stops, recording stops and nothing says so. The gap surfaces when someone next opens the
-- dashboard or reads a report's coverage (finding F-034, High).
--
-- WHAT THIS DOES. The database checks the edge, every ten minutes, with the two extensions Supabase
-- provides for it:
--
--   - pg_cron runs `edge_watchdog_check()`.
--   - It reads `ingestion_health.last_success_at`. Since RM-149 the edge writes it with every upload,
--     at least every 5 minutes, so a gap of 15 minutes is a real silence, not a slow tick.
--   - On silence, pg_net posts one notice to the site's ntfy topic, the same one the edge uses. It
--     reminds every 6 hours while the silence lasts, and posts once more when uploads resume.
--
-- The topic lives in `edge_watchdog`, which only the service role and the database owner can read.
-- `npm run watchdog:setup -- --apply` on the edge writes it there from server/.env, so nobody types
-- it, and sends one test notice through this path.
--
-- COST. 144 runs a day, and one request out only when something changes. Run history older than 7
-- days is deleted daily, for this project's jobs only.
--
-- Apply once, by hand, in the Supabase SQL editor. Safe to paste twice. Rehearse with
-- supabase/rehearse.sh first.

-- 1. The two extensions ------------------------------------------------------------------------
--
-- Supabase's own statements for each. A database without them (the rehearsal's container) carries
-- on to the check below, which says plainly what is missing.
do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    raise notice 'phase51: pg_net could not be created here (%), checking for it below', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    raise notice 'phase51: pg_cron could not be created here (%), checking for it below', sqlerrm;
  end;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null then
    raise exception 'phase51: net.http_post is missing. Enable pg_net under Database, Extensions, then paste this again.';
  end if;
  if to_regprocedure('cron.schedule(text, text, text)') is null then
    raise exception 'phase51: cron.schedule is missing. Enable pg_cron under Database, Extensions, then paste this again.';
  end if;
end $$;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- 2. Where to send, and what was last sent --------------------------------------------------------
create table if not exists public.edge_watchdog (
  site_id        text primary key references public.sites(id),
  ntfy_server    text not null default 'https://ntfy.sh' check (ntfy_server ~ '^https?://'),
  ntfy_topic     text not null check (char_length(ntfy_topic) between 1 and 64),
  -- The edge writes the health row at least every 5 minutes (RM-149). Less than 10 would fire
  -- between two healthy writes.
  stale_after    interval not null default interval '15 minutes' check (stale_after >= interval '10 minutes'),
  remind_every   interval not null default interval '6 hours' check (remind_every >= interval '1 hour'),
  state          text not null default 'ok' check (state in ('ok', 'silent')),
  alerted_at     timestamptz,
  checked_at     timestamptz,
  updated_at     timestamptz not null default now()
);

-- The topic is the one thing here worth keeping to ourselves: anyone who knows it can read the
-- notices and post to it. RLS on and no policy means the browser's roles see nothing at all.
alter table public.edge_watchdog enable row level security;
revoke all on public.edge_watchdog from anon, authenticated;
grant select, insert, update on public.edge_watchdog to service_role;

-- 3. The check ---------------------------------------------------------------------------------
--
-- Edge-triggered, as the fleet alarm is: one notice when the silence starts, one reminder per
-- `remind_every`, one when it ends. A level-triggered alarm would post every ten minutes until
-- somebody muted the topic, which is how alarms end up switched off.
create or replace function public.edge_watchdog_check()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
  last_ok timestamptz;
  last_err text;
  tz text;
  silent boolean;
  sent integer := 0;
begin
  for w in select * from edge_watchdog loop
    last_ok := null;
    last_err := null;
    select h.last_success_at, h.last_error into last_ok, last_err
      from ingestion_health h
     where h.site_id = w.site_id;
    select s.timezone into tz from sites s where s.id = w.site_id;
    silent := last_ok is null or now() - last_ok > w.stale_after;

    if silent and (w.state = 'ok' or w.alerted_at is null or now() - w.alerted_at >= w.remind_every) then
      perform net.http_post(
        url := w.ntfy_server,
        body := jsonb_build_object(
          'topic', w.ntfy_topic,
          'title', case when w.state = 'ok' then 'iBEMS: the edge has gone silent' else 'iBEMS: the edge is still silent' end,
          'message', case
            when last_ok is null then 'The database has no successful upload from the edge on record.'
            else format('No successful upload from the edge for %s min, since %s.',
                        floor(extract(epoch from now() - last_ok) / 60)::int,
                        to_char(last_ok at time zone coalesce(tz, 'UTC'), 'YYYY-MM-DD HH24:MI'))
          end
            || coalesce(' Its last error: ' || left(last_err, 200) || '.', '')
            || ' If the edge is running it keeps every reading and uploads them when it can. Check its power and its internet.',
          'priority', 4,
          'tags', jsonb_build_array('warning')));
      update edge_watchdog set state = 'silent', alerted_at = now(), checked_at = now() where site_id = w.site_id;
      sent := sent + 1;
    elsif not silent and w.state = 'silent' then
      perform net.http_post(
        url := w.ntfy_server,
        body := jsonb_build_object(
          'topic', w.ntfy_topic,
          'title', 'iBEMS: the edge is recording again',
          'message', format('Uploads resumed; the last at %s.', to_char(last_ok at time zone coalesce(tz, 'UTC'), 'YYYY-MM-DD HH24:MI')),
          'priority', 3,
          'tags', jsonb_build_array('white_check_mark')));
      update edge_watchdog set state = 'ok', alerted_at = null, checked_at = now() where site_id = w.site_id;
      sent := sent + 1;
    else
      update edge_watchdog set checked_at = now() where site_id = w.site_id;
    end if;
  end loop;
  return sent;
end;
$$;

-- 4. A test notice, and whether it arrived at the server -----------------------------------------
create or replace function public.edge_watchdog_ping(p_site_id text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  w edge_watchdog;
begin
  select * into w from edge_watchdog where site_id = p_site_id;
  if not found then
    raise exception 'edge_watchdog_ping: no watchdog row for site %', p_site_id;
  end if;
  return net.http_post(
    url := w.ntfy_server,
    body := jsonb_build_object(
      'topic', w.ntfy_topic,
      'title', 'iBEMS: the edge watchdog is armed',
      'message', format('The database will post here if the edge goes %s minutes without a successful upload.',
                        (extract(epoch from w.stale_after) / 60)::int),
      'priority', 3,
      'tags', jsonb_build_array('white_check_mark')));
end;
$$;

-- pg_net sends after the transaction commits, so the answer is read in a second call.
create or replace function public.edge_watchdog_ping_result(p_request_id bigint)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('status_code', r.status_code, 'error', r.error_msg)
    from net._http_response r
   where r.id = p_request_id;
$$;

revoke all on function public.edge_watchdog_check() from public, anon, authenticated;
revoke all on function public.edge_watchdog_ping(text) from public, anon, authenticated;
revoke all on function public.edge_watchdog_ping_result(bigint) from public, anon, authenticated;
grant execute on function public.edge_watchdog_check() to service_role;
grant execute on function public.edge_watchdog_ping(text) to service_role;
grant execute on function public.edge_watchdog_ping_result(bigint) to service_role;

-- 5. The schedule, and its housekeeping --------------------------------------------------------
--
-- Scheduling a name that exists replaces it, so pasting this twice leaves one job of each.
select cron.schedule('ibems-edge-watchdog', '*/10 * * * *', $cron$select public.edge_watchdog_check()$cron$);
select cron.schedule(
  'ibems-cron-cleanup',
  '17 3 * * *',
  $cron$delete from cron.job_run_details
         where end_time < now() - interval '7 days'
           and jobid in (select jobid from cron.job where jobname like 'ibems-%')$cron$);

notify pgrst, 'reload schema';
