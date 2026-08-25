-- Phase 18: record WHICH PATH a command actually took to reach the hardware.
--
-- WHY: `dispatchCommand` has always returned `via` — 'local', 'cloud', or 'none' — but it was
-- only ever folded into the free-text `note` ("…; via cloud fallback — …"). That makes the
-- single most operationally useful signal in this table unqueryable: you cannot ask "which
-- devices have needed the cloud fallback this week", which is exactly the question that
-- identifies a device going bad before it goes dark.
--
-- WHY IT MATTERS MORE THAN IT LOOKS: a command that only landed through the vendor cloud means
-- the device stopped answering on the LAN. The relay did move, so the operator sees success —
-- but the device needs attention, and today that fact is buried in prose. On 2026-08-25 the
-- fallback was found to have never once worked (see RM-018); now that it does, its use is a
-- leading indicator worth counting.
--
-- NULLABLE, and no backfill. Every row written before this migration genuinely does not know
-- its path — inventing one would be worse than admitting it. NULL reads as "not recorded",
-- distinct from 'none', which is a positive claim that both paths were tried and both failed.
--
-- The CHECK is narrow on purpose, unlike `status` two columns over, which is deliberately free
-- text because adding a status must never need a migration on a safety-critical table. `via` is
-- different: it is a closed set defined by the dispatch code itself (server/dispatchLight.mjs),
-- and a value outside it would mean the two have drifted — which is the thing worth catching.
--
-- Apply once, by hand, in the Supabase SQL editor. Re-runnable.

alter table commands add column if not exists via text;

alter table commands drop constraint if exists commands_via_check;

alter table commands
  add constraint commands_via_check
  check (via is null or via in ('local','cloud','none'));

comment on column commands.via is
  'Which path the dispatch actually took: local (the Node-RED bridge on the LAN), cloud (the '
  'vendor fallback, meaning the device stopped answering locally and needs attention), or none '
  '(both were tried and both failed). NULL for rows written before phase 18, and for dry runs, '
  'where no path was attempted at all.';
