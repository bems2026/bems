-- Architecture plan Phase 9c: let a command's own outcome be attached to its audit row.
--
-- WHY THIS IS NEEDED:
-- server/auditedDispatch.mjs writes the `commands` row BEFORE dispatching (status
-- 'dispatching') and PATCHes the outcome on afterwards, so that "hardware moved with no
-- audit row" is unrepresentable rather than merely detectable. server/scheduler.mjs does
-- that PATCH with the service-role key, which bypasses RLS. server/proxy.mjs cannot: it
-- deliberately holds only the anon key and writes with the CALLER's own token, so RLS
-- applies — and schema.sql grants `authenticated` select and insert on `commands`, but no
-- update. Without this policy every proxy-issued command would be stranded at
-- 'dispatching' forever.
--
-- Worse, it would be stranded SILENTLY: PostgREST reports an RLS-blocked update as a
-- success with an empty result, not an error — the identical trap that made a
-- schedule/threshold save report "saved" while writing nothing, fixed in 2e4c0c2 by
-- checking the affected-row count. `updateAudit` now asks for the updated row back and
-- treats an empty result as a failure, so this policy being wrong could never again be
-- invisible.
--
-- WHY THE POLICY IS THIS NARROW:
-- an audit trail whose rows any signed-in user may rewrite is not an audit trail. This
-- grants exactly one transition and nothing else — your own row, only while it is still
-- in flight, and only to a terminal outcome:
--
--   * `requested_by = auth.uid()`  — you may only complete a command you issued
--   * `status = 'dispatching'`     — history that has already settled stays settled
--   * the WITH CHECK clause        — you may not park it back in flight, invent a new
--                                    status, or reassign it to another user
--
-- Note what remains impossible: editing device_id, action, source, requested_at, or the
-- attribution — and deleting a row at all, since no delete policy exists on this table
-- and none is added here.
--
-- Apply once, by hand, in the Supabase SQL editor. No migration runner in this repo; same
-- convention as phase4_/.../phase8_*.sql.

create policy commands_complete_own_inflight on commands
  for update
  using (
    auth.role() = 'authenticated'
    and requested_by = auth.uid()
    and status = 'dispatching'
  )
  with check (
    requested_by = auth.uid()
    and status in ('dispatched', 'failed')
  );
