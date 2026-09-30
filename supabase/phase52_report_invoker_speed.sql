-- RM-151: the Reports page's five building functions run with their owner's rights, because row
-- security made them 6-8 times slower for the people allowed to call them.
--
-- WHAT WAS MEASURED (2026-09-30, E-229):
--
--   - A month (August 2026) called as the service role: each function answered in 0.55-0.84 s.
--   - The same calls signed in, from the browser, one at a time: 3.6-5.4 s each.
--   - pg_stat_statements: 370-518 signed-in calls per function, averaging 1.7-2.2 s, with maxima of
--     7.8-7.97 s, just under the signed-in role's 8 s limit. Those that crossed it were cancelled,
--     and cancelled statements are not counted there.
--   - A plain signed-in read of the same month's hourly rows: 0.23-0.32 s including the network.
--
-- The page asks for five of these at once, so signed-in they crossed 8 s together:
-- "canceling statement due to statement timeout".
--
-- WHY. Each function asks, hour by hour, whether raw minutes exist for that hour:
--
--     not exists (select 1 from building_totals t2
--                  where t2.ts >= b.hour and t2.ts < b.hour + interval '1 hour')
--
-- Under row-level security PostgreSQL may use a condition as an index bound only if every function in
-- it is leakproof. `timestamptz + interval` is not, because it can raise an overflow error. So,
-- signed in, only `t2.ts >= b.hour` bounds the index scan, and every probe reads from its hour to the
-- end of the raw table. For August that is about 370 probes across 20,000 raw rows each. The service
-- role bypasses row security, keeps both bounds, and reads one hour per probe.
--
-- THE CHANGE. The five functions run as their owner (`security definer`), which reads without
-- row-level security, with a fixed search path. Access is unchanged:
--
--   - EXECUTE on each stays granted to `authenticated` alone, revoked from public and anon, and
--     re-asserted below.
--   - The two totals tables' policies admit exactly `authenticated`.
--   - So whoever can call a function could already read every row it reads.
--
-- The functions' bodies are not touched. This file only alters their security and search path, so the
-- byte-for-byte guards on phase37, 40, 44 and 47 still hold.
--
-- ORDER MATTERS. `create or replace function` resets a function to security invoker. Pasting phase37,
-- 40, 44 or 47 again would undo this file, so paste this one again after any of them.
-- test/phase52-report-invoker-speed-schema.test.mjs fails any LATER migration that redefines one of
-- these five without `security definer`.
--
-- Apply once, by hand, in the Supabase SQL editor. Safe to paste twice. Rehearse with
-- supabase/rehearse.sh first.

alter function public.report_daily_series(text, date, text)          security definer;
alter function public.report_demand_summary(text, date, text)        security definer;
alter function public.report_hour_profile(text, date, text, text)    security definer;
alter function public.report_hour_matrix(text, date, text)           security definer;
alter function public.report_demand_curve(text, date, text, int)     security definer;

-- A definer's search path is fixed, so no caller can put a lookalike table in front of the real one.
-- pg_temp goes last for the same reason.
alter function public.report_daily_series(text, date, text)          set search_path = public, pg_temp;
alter function public.report_demand_summary(text, date, text)        set search_path = public, pg_temp;
alter function public.report_hour_profile(text, date, text, text)    set search_path = public, pg_temp;
alter function public.report_hour_matrix(text, date, text)           set search_path = public, pg_temp;
alter function public.report_demand_curve(text, date, text, int)     set search_path = public, pg_temp;

revoke execute on function public.report_daily_series(text, date, text)          from public, anon;
revoke execute on function public.report_demand_summary(text, date, text)        from public, anon;
revoke execute on function public.report_hour_profile(text, date, text, text)    from public, anon;
revoke execute on function public.report_hour_matrix(text, date, text)           from public, anon;
revoke execute on function public.report_demand_curve(text, date, text, int)     from public, anon;
grant  execute on function public.report_daily_series(text, date, text)          to authenticated;
grant  execute on function public.report_demand_summary(text, date, text)        to authenticated;
grant  execute on function public.report_hour_profile(text, date, text, text)    to authenticated;
grant  execute on function public.report_hour_matrix(text, date, text)           to authenticated;
grant  execute on function public.report_demand_curve(text, date, text, int)     to authenticated;

notify pgrst, 'reload schema';
