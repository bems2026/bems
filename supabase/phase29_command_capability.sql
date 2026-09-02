-- Phase 29: let a command name a CAPABILITY, not just on/off.
--
-- WHY: `commands.action` is CHECK-constrained to ('on','off') — deliberately, and the comment in
-- `schema.sql` explains it well: absolute only, never toggle, because a toggle computed from
-- unconfirmed state double-fires into a flip-back. That reasoning is about the VALUE, and it
-- still holds. What the constraint also does, incidentally, is make a relay the only thing this
-- system can command at all. Setting a child lock, a countdown or an over-power alarm threshold
-- has no representation here, so those controls can be rendered but not sent.
--
-- WHAT IS AND IS NOT BEING OPENED. Four capabilities become writable — `child_lock`,
-- `countdown_1`/`countdown_2`, `warn_power1`/`warn_power2`, and `sync_response`. Four others that
-- the VENDOR marks writable stay refused: `relay_status`, `switch_inching`, `cycle_time` and
-- `random_time`. Each of those installs unattended switching INSIDE the device — a relay that
-- turns itself off after a delay, comes back on after a power cut, or runs its own cycle — where
-- the Supabase scheduler cannot see it, this audit table cannot record it, and no operator can
-- override it. `CLAUDE.md` already says the same thing about Node-RED's own cron arrays, which
-- are kept empty for exactly this reason; writing these dps would reinstate that hazard one layer
-- lower. The refusal is enforced in `shared/deviceCapabilities.mjs` (`writable: false`) and by the
-- CHECK below, so the two cannot drift apart quietly.
--
-- NULLABLE AND BACKWARD-COMPATIBLE. `action` keeps its constraint for relay commands; a
-- capability command sets `action = 'set'` and carries the code and value in the new columns.
-- Every existing row and every existing reader is unaffected: a relay command still looks exactly
-- as it did, which matters because `server/reports.mjs` and the Control page's command log both
-- read this table and neither should have to learn a second shape to keep working.
--
-- WHY THE VOCABULARY IS PINNED HERE. Unlike `status` two columns over — free text on purpose, so
-- adding a status never needs a migration on a safety-critical table — `capability` is a closed
-- set defined by the capability catalogue, and a value outside it means the database and the
-- dispatch code have drifted. That is precisely the thing worth catching, on the one table that
-- records every relay that moved.
--
-- Apply once, by hand, in the Supabase SQL editor. Re-runnable.

alter table commands add column if not exists capability text;
alter table commands add column if not exists capability_value jsonb;

-- `set` joins the existing pair rather than replacing it. A relay command keeps `on`/`off` and
-- nothing that reads this table today has to change.
alter table commands drop constraint if exists commands_action_check;
alter table commands
  add constraint commands_action_check
  check (action in ('on','off','set'));

-- The allowlist, and it is deliberately NOT every capability the vendor marks writable.
-- Widening it means opening a device to switching itself unattended — see the header.
alter table commands drop constraint if exists commands_capability_check;
alter table commands
  add constraint commands_capability_check
  check (
    capability is null
    or capability in ('child_lock','countdown_1','countdown_2','warn_power1','warn_power2','sync_response')
  );

-- The two halves must arrive together or neither means anything: a capability with no value is
-- an instruction with no content, and a value with no capability has nowhere to go. Likewise
-- `action = 'set'` is exactly the capability case, so the three are constrained as one fact.
alter table commands drop constraint if exists commands_capability_shape_check;
alter table commands
  add constraint commands_capability_shape_check
  check (
    (action = 'set' and capability is not null and capability_value is not null)
    or (action in ('on','off') and capability is null and capability_value is null)
  );

comment on column commands.capability is
  'For action = ''set'': which device capability was written, by its vendor code. Restricted to '
  'the four this system is willing to write. relay_status, switch_inching, cycle_time and '
  'random_time are vendor-writable and deliberately refused: each installs unattended switching '
  'inside the device, where the scheduler cannot see it and this table cannot record it.';

comment on column commands.capability_value is
  'The value written, as JSON so a boolean, a number and an enum string can share one column '
  'without a type per capability. The accepted range for each is declared in '
  'shared/deviceCapabilities.mjs and checked against the vendor device model by `npm run tuya:spec`.';
