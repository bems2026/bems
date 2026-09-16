-- =============================================================================================
-- phase43 — the readings policies' auth check evaluated once per statement, not once per row
-- RM-091a
--
-- WHY. The two policies that let a signed-in reader see `readings` and `readings_hourly` compare
-- `auth.role()` directly. A function called bare in a policy is evaluated for EVERY ROW a query
-- touches; wrapped as `(select auth.role())` the planner evaluates it once per statement and reuses
-- the answer. phase40 (RM-086) measured exactly this on the totals tables: a report query that took
-- 3.5 s as the service role was cancelled by the signed-in statement timeout on every attempt, and
-- phase40 fixed those two policies and no others.
--
-- WHAT MADE IT MATTER NOW. RM-094's Circuits tab and RM-098's every-reading CSV read `readings` for a
-- whole week or month as the signed-in reader:
--   * `report_device_daily_energy` (phase42) for a month of every measuring device — read back on
--     2026-09-17 as the service role, which bypasses RLS, at 2.8–2.9 s. That is before a single policy
--     check; signed in, it pays one `auth.role()` call per reading.
--   * `readings_archive` for each branch meter's hourly power, and the export's paged reads and exact
--     counts.
-- A signed-in request that runs past the database's statement timeout is cancelled, and the chart or
-- the export says it could not be loaded — correct, and useless.
--
-- WHAT DOES NOT CHANGE. The same rows are visible, to the same role; the comparison is unchanged, only
-- how often it runs. No table, grant, function or other policy is touched.
--
-- APPLY: paste into the Supabase SQL editor. Re-running is safe — each policy is dropped before it is
-- created, and `supabase/rehearse.sh` applies the file twice.
--
-- READ BACK: the signed-in timing probe recorded under RM-091a in ROADMAP.md, before and after.
-- =============================================================================================

drop policy if exists readings_select_authenticated on readings;
create policy readings_select_authenticated on readings
  for select using ((select auth.role()) = 'authenticated');

drop policy if exists readings_hourly_select_authenticated on readings_hourly;
create policy readings_hourly_select_authenticated on readings_hourly
  for select using ((select auth.role()) = 'authenticated');

notify pgrst, 'reload schema';
