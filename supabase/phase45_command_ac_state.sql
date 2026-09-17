-- =============================================================================
-- Phase 45 — the aircon's full commanded state on the audit row. 2026-09-17.
--
-- WHY. The IR blaster was re-paired on 2026-09-17 as a Lasco "Smart IR" hub, and the aircon became
-- commandable as a whole state: power, mode, setpoint, fan and swing. An IR aircon cannot say what it
-- is doing, so the audit row is the only record of what it was asked to do — and `commands` could say
-- the setpoint (`target_c`, phase36) and nothing else. A row reading "on, 24" for a unit left in dry
-- mode with the fan on high is a row that misleads whoever reads it.
--
-- WHAT. Three nullable columns, written by `server/auditedDispatch.mjs` on the OUTCOME patch — the row
-- is recorded before dispatch (record-first), and the mode, fan and swing a command left out are only
-- filled in by the dispatcher from the last commanded state (`shared/acState.mjs`). Until this file is
-- applied the daemon retries the patch without them, and the same state is in the row's `note`, so
-- nothing is lost by applying it late.
--
--   ac_mode   cool | heat | auto | fan | dry
--   ac_fan    auto | low | medium | high
--   ac_swing  boolean
--
-- The vocabularies are `AC_MODES` and `AC_FANS` in shared/acState.mjs;
-- test/phase45-command-ac-state-schema.test.mjs holds the constraint lists to them.
--
-- The three travel together and only on an ON command: an OFF carries no state worth a column (its
-- `note` still says what was remembered), and a relay or capability command has none at all.
--
-- NO BACKFILL. A row written before this file does not know its mode, and inventing one would be
-- worse than the gap — the reasoning phase18 gave for `via` and phase36 for `target_c`.
--
-- SAFE TO RE-RUN. Columns are added `if not exists`; each constraint is dropped before it is added.
-- No grant: new columns follow the table privileges phase39 set. Apply by hand in the Supabase SQL
-- editor; rehearsed by `supabase/rehearse.sh`, which applies it twice.
-- =============================================================================

alter table commands add column if not exists ac_mode text;
alter table commands add column if not exists ac_fan text;
alter table commands add column if not exists ac_swing boolean;

alter table commands drop constraint if exists commands_ac_mode_check;
alter table commands
  add constraint commands_ac_mode_check
  check (ac_mode is null or ac_mode in ('cool', 'heat', 'auto', 'fan', 'dry'));

alter table commands drop constraint if exists commands_ac_fan_check;
alter table commands
  add constraint commands_ac_fan_check
  check (ac_fan is null or ac_fan in ('auto', 'low', 'medium', 'high'));

-- All three or none, and only on an ON command.
alter table commands drop constraint if exists commands_ac_state_shape_check;
alter table commands
  add constraint commands_ac_state_shape_check
  check (
    (ac_mode is null) = (ac_fan is null)
    and (ac_fan is null) = (ac_swing is null)
    and (ac_mode is null or action = 'on')
  );

comment on column commands.ac_mode is
  'The aircon mode this ON command sent: cool, heat, auto, fan or dry. Resolved by the dispatcher from '
  'the command and the last commanded state, so it is what was SENT rather than what was typed. NULL for '
  'every other command and for rows written before phase45.';
comment on column commands.ac_fan is
  'The aircon fan speed this ON command sent: auto, low, medium or high. NULL as ac_mode.';
comment on column commands.ac_swing is
  'Whether this ON command sent swing on. NULL as ac_mode.';
