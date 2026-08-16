-- Phase 4 ONLY — temporary anon-read policies, so the frontend can read Supabase-backed
-- history before Phase 5's auth exists (there's no `authenticated` role to grant yet;
-- the browser talks to Supabase with the anon key, which maps to Postgres role `anon`).
--
-- These are additive to supabase/schema.sql's `authenticated`-only select policies — not
-- a replacement. Phase 5 DROPs these three policies once login exists, per the
-- architecture plan ("RLS temporarily open for select... locked down in Phase 5").
--
-- Apply once via SQL Editor (or the Management API, same as schema.sql):
create policy devices_select_anon on devices
  for select using (auth.role() = 'anon');
create policy readings_select_anon on readings
  for select using (auth.role() = 'anon');
create policy building_totals_select_anon on building_totals
  for select using (auth.role() = 'anon');

-- Deliberately NOT extending anon-read to commands/schedules/dsm_thresholds/
-- ingestion_health here — those aren't consumed by the frontend until Phase 6, and there's
-- no reason to widen their exposure before that's actually needed.

-- --- Phase 5 cleanup (run this later, not now) -------------------------------
-- drop policy devices_select_anon on devices;
-- drop policy readings_select_anon on readings;
-- drop policy building_totals_select_anon on building_totals;
