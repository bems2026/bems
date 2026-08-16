-- Phase 5 — drop Phase 4's temporary anon-read policies now that real auth exists.
-- After this, only the `authenticated` role can read devices/readings/building_totals;
-- an unauthenticated request gets nothing (matches supabase/schema.sql's original,
-- always-authenticated-only policies for these tables — Phase 4 only ever added anon
-- alongside them, never replaced them).
drop policy if exists devices_select_anon on devices;
drop policy if exists readings_select_anon on readings;
drop policy if exists building_totals_select_anon on building_totals;
