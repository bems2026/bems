-- Phase 13: per-device function declaration.
--
-- WHY THIS IS CONFIGURATION AND NOT A PROPERTY OF THE CLASS:
-- Until now, which page a device appeared on was decided by its class in frontend code —
-- Analytics rendered `meter` and `outlet_dual`, Control and Automation rendered the classes
-- with an on/off state. That put a *site* decision inside a page. A light switch has control
-- but no metering here; somewhere else the identical relay might feed a metered circuit, and
-- two identical outlets can differ in whether either is worth charting. None of that is a
-- fact about the hardware, so none of it belongs in a class table.
--
-- `functions` therefore lives beside room, category and load_shed_group: the operator's own
-- description of what a device is for. NULL means "nobody has said", which falls through to
-- the class default in src/lib/deviceFunctions.ts. An empty array is a real answer — "this
-- device serves no role here" — and is honoured rather than treated as unset. The two must
-- stay distinguishable, which is why this is a nullable array and not a NOT NULL DEFAULT '{}'.
--
-- Apply once, by hand, in the Supabase SQL editor. No migration runner in this repo; same
-- convention as phase4_/phase5_/phase6_*.sql. This one is re-runnable: `add column if not
-- exists` and a named constraint added only when absent.

alter table device_config
  add column if not exists functions text[];

-- Validate elementwise rather than against a fixed list of whole arrays: the set of allowed
-- functions is small and closed, but the number of valid *combinations* is 2^n, and spelling
-- those out is how a constraint drifts from the code it mirrors. `<@` says every element is
-- drawn from the allowed set, which is the actual rule.
--
-- NULL passes (unconfigured), '{}' passes (deliberately none). Duplicates are not rejected
-- here because coerceFunctions() de-duplicates on the way in and a duplicate changes no
-- behaviour downstream — a CHECK that can only fire on a hand-edited row, to reject something
-- harmless, is not worth the re-apply hazard.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'device_config_functions_valid'
  ) then
    alter table device_config
      add constraint device_config_functions_valid
      check (functions is null or functions <@ array['control','monitoring','scheduling']::text[]);
  end if;
end $$;

-- No RLS change. device_config's existing policies are per-table, not per-column, so the
-- authenticated-select / authenticated-insert / authenticated-update grants from
-- phase7_device_config.sql already cover this column. Adding a policy here would create a
-- second, competing rule for the same table — the failure phase6_schedules_unique_fix.sql
-- exists to remember.

comment on column device_config.functions is
  'Operator-declared roles: any of control, monitoring, scheduling. NULL = not configured, use the class default. {} = deliberately no role.';
