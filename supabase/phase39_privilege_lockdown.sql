-- phase39 — `authenticated` holds exactly what its policies permit, and nothing else.
--
-- RM-074. Measured in `supabase/rehearse.sh` once that reproduced Supabase's own default
-- privileges: **every table in this schema granted `authenticated`
-- `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`** — `commands`, `readings`,
-- `building_totals`, `sites`, every one. Not because anyone granted them: because
-- `alter default privileges ... grant all on tables to anon, authenticated, service_role` is
-- what a Supabase project does to every new table in `public`, and a `grant` is additive, so a
-- migration that only granted what it wanted never took the rest away.
--
-- WHY THIS IS MOSTLY HARMLESS, AND EXACTLY WHERE IT IS NOT.
--
-- Postgres needs BOTH the table privilege and a matching row policy, so an UPDATE or DELETE that
-- no policy permits already affects nothing. That is the design, and it is why this has been
-- invisible. **TRUNCATE is the exception: row security does not filter it at all.** Measured as a
-- genuinely switched `authenticated` role against a seeded row, `truncate commands` emptied the
-- table — and `commands` is the safety-critical audit trail, deliberately exempt from every
-- retention pass precisely so it cannot be lost. Any signed-in account could drop all of it in
-- one statement. `REFERENCES` and `TRIGGER` are likewise outside RLS's reach.
--
-- THE RULE, AND WHY IT CANNOT BREAK A WORKING PAGE.
--
-- `authenticated` gets exactly the commands that table has a POLICY for. Every table below has
-- RLS enabled — verified, not assumed — so any command without a policy is already refused.
-- Removing its grant therefore changes no behaviour that works today; it removes the privileges
-- RLS was never covering in the first place. The grants below are transcribed from a survey of
-- `pg_policies` against `information_schema.role_table_grants`, not from reading the migrations,
-- because the policies are the thing actually in force.
--
-- `service_role` is untouched. It bypasses RLS by design, the daemons run as it, and narrowing
-- it is a different question with a different blast radius.
--
-- SAFE TO RE-RUN: revoke-then-grant is idempotent.

-- --- read-only to the browser: written by the daemons through the service role ---------------
revoke all on readings                 from public, anon, authenticated;
revoke all on readings_hourly          from public, anon, authenticated;
revoke all on building_totals          from public, anon, authenticated;
revoke all on building_totals_hourly   from public, anon, authenticated;
revoke all on anomalies                from public, anon, authenticated;
revoke all on ingestion_health         from public, anon, authenticated;
revoke all on devices                  from public, anon, authenticated;
revoke all on sites                    from public, anon, authenticated;
revoke all on monthly_reports          from public, anon, authenticated;
revoke all on monthly_building_reports from public, anon, authenticated;
revoke all on period_reports           from public, anon, authenticated;
revoke all on period_building_reports  from public, anon, authenticated;
revoke all on acu_loop_state           from public, anon, authenticated;

grant select on readings                 to authenticated;
grant select on readings_hourly          to authenticated;
grant select on building_totals          to authenticated;
grant select on building_totals_hourly   to authenticated;
grant select on anomalies                to authenticated;
grant select on ingestion_health         to authenticated;
grant select on devices                  to authenticated;
grant select on sites                    to authenticated;
grant select on monthly_reports          to authenticated;
grant select on monthly_building_reports to authenticated;
grant select on period_reports           to authenticated;
grant select on period_building_reports  to authenticated;
grant select on acu_loop_state           to authenticated;

-- --- the audit trail --------------------------------------------------------------------------
--
-- INSERT and UPDATE, because the app writes a command row before dispatch and completes it
-- after (`commands_complete_own_inflight`). **No DELETE and no TRUNCATE**: this table is exempt
-- from every retention pass on purpose, and the whole value of an audit trail is that the thing
-- being audited cannot remove it.
revoke all on commands from public, anon, authenticated;
grant select, insert, update on commands to authenticated;

-- --- operator-editable configuration ------------------------------------------------------------
--
-- Each of these is written from the browser and each has the policies to match. `device_config`,
-- `site_ui_prefs` and `socket_config` are upserted and never deleted — a device's configuration
-- row outlives any particular edit — so they get no DELETE.
revoke all on device_config  from public, anon, authenticated;
revoke all on site_ui_prefs  from public, anon, authenticated;
revoke all on socket_config  from public, anon, authenticated;
grant select, insert, update on device_config to authenticated;
grant select, insert, update on site_ui_prefs to authenticated;
grant select, insert, update on socket_config to authenticated;

-- Schedules and the space tree are genuinely removable by an operator.
revoke all on schedules   from public, anon, authenticated;
revoke all on space_nodes from public, anon, authenticated;
grant select, insert, update, delete on schedules   to authenticated;
grant select, insert, update, delete on space_nodes to authenticated;

-- The DSM row is seeded per site and edited, never created or removed from the browser.
revoke all on dsm_thresholds from public, anon, authenticated;
grant select, update on dsm_thresholds to authenticated;

-- --- the closed-loop aircon rules ---------------------------------------------------------------
--
-- SELECT and DELETE only. Writes go through `upsert_acu_rule` and `set_acu_rule_enabled`
-- (phase36), which are `security definer` precisely so a rule cannot be written around their
-- validation — granting INSERT or UPDATE here would reopen the door those functions are.
revoke all on acu_rules from public, anon, authenticated;
grant select, delete on acu_rules to authenticated;

-- --- phase38's two are already correct, and are restated so this file is the whole picture -----
revoke all on energy_tariffs   from public, anon, authenticated;
revoke all on emission_factors from public, anon, authenticated;
grant select, insert, delete on energy_tariffs   to authenticated;
grant select, insert, delete on emission_factors to authenticated;
