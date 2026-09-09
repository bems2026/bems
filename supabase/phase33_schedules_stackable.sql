-- Phase 33: many schedules per device, each naming its own socket — RM-059.
--
-- WHAT THIS UNDOES AND WHY. supabase/phase6_schedules_unique_fix.sql added
-- `unique (device_id)` on the reasoning that "this app never actually varies `socket` for
-- schedules ... there is no per-socket scheduling anywhere in the UI". That was true when it
-- was written and it is the blocker now. One row per device means one rule per device: writing
-- a second window silently REPLACED the first, because the client upserts
-- `onConflict: 'device_id'`. And an outlet's two sockets could never be scheduled apart, even
-- though the Control page has always treated them as two independent relays and
-- shared/commands.mjs has always insisted an outlet command must name a socket.
--
-- IDENTITY BECOMES `id` ALONE. Deliberately NOT `unique (device_id, socket)`, which is the same
-- one-rule-per-thing blocker moved down one level. The cost is that supabase-js `upsert()` has
-- no ON CONFLICT target on this table any more, and that is a feature: writes become
-- insert / update-by-id / delete-by-id, none of which needs one. The whole class of problem
-- phase6 was fighting is retired rather than re-solved.
--
-- WHAT THE CLASS RULE IS NOT. "An outlet_dual schedule must name a socket" cannot be a CHECK —
-- a CHECK may not read `devices.class`. The domain check below is join-free and catches 0 and 3;
-- the class rule is enforced in server/schedulePlan.mjs's `unfireableRows`, which can say WHY a
-- row will never fire instead of returning a constraint name at somebody.
--
-- Apply once, by hand, in the Supabase SQL editor, in file order.
--
-- RE-RUNNING IS SAFE. Every constraint is dropped before it is added, every column and index is
-- guarded, each policy is dropped before it is created, and the data migration is one
-- `not exists`-guarded DO block that selects nothing on a second pass.
-- test/migration-idempotency.test.mjs holds this file to that claim.
--
-- ############################################################################
-- DEPLOY ORDER IS LOAD-BEARING. Ship the frontend and restart the daemons FIRST,
-- then apply this file.
--
-- Both directions fail loudly, so this is a choice rather than a rescue:
--   * new code on the OLD schema fails narrowly — inserting a second rule for a device
--     violates schedules_device_id_unique and returns 409, while editing one still works;
--   * old code on the NEW schema fails on `ON CONFLICT (device_id)` with "there is no unique
--     or exclusion constraint matching the ON CONFLICT specification" — the exact error
--     phase6's header quotes — and that breaks EVERY schedule save from a kiosk still serving
--     the old ./dist.
-- The second is far worse, so the frontend goes first. See CLAUDE.md: deploying is two
-- separate acts and neither is implied by a commit.
-- ############################################################################

-- ---------------------------------------------------------------------------
-- 1. Identity. This must run BEFORE the split in step 5, or the second row for
--    a device violates the very constraint the split exists to escape.
-- ---------------------------------------------------------------------------
alter table schedules drop constraint if exists schedules_device_id_unique;
drop index if exists schedules_device_id_no_socket_uidx;  -- phase6's superseded partial index

-- ---------------------------------------------------------------------------
-- 2. The socket domain. Join-free, so it says nothing about class.
--    0 is the value that matters: it is invalid AND falsy, which is exactly the case
--    test/socket-fanout.test.mjs exists to keep out of the fan-out path.
-- ---------------------------------------------------------------------------
alter table schedules drop constraint if exists schedules_socket_domain_check;
alter table schedules
  add constraint schedules_socket_domain_check
  check (socket is null or socket in (1, 2));

-- ---------------------------------------------------------------------------
-- 3. A stack needs a name and a stable order.
--    `label` so five rules on one device read as a day rather than as five times.
--    `created_at` so the list has a tiebreak that does not move when a row is edited —
--    ordering by `updated_at` would reshuffle the list every time somebody touched a row.
--    Nullable first, backfilled, then defaulted and NOT NULL: phase20's ordering, for the same
--    reason, which is that imposing NOT NULL first fails on the rows already present.
-- ---------------------------------------------------------------------------
alter table schedules add column if not exists label text;
alter table schedules drop constraint if exists schedules_label_len_check;
alter table schedules
  add constraint schedules_label_len_check
  check (label is null or char_length(label) <= 60);

alter table schedules add column if not exists created_at timestamptz;
update schedules set created_at = coalesce(updated_at, now()) where created_at is null;
alter table schedules alter column created_at set default now();
alter table schedules alter column created_at set not null;

-- ---------------------------------------------------------------------------
-- 4. Attribution, enforced going forward without breaking what exists.
--
--    server/schedulePlan.mjs skips any row with no `updated_by`, because
--    commands.requested_by is NOT NULL and inventing a user to satisfy it would put a fiction
--    in the one table meant to be trustworthy. That skip matters MORE now than it did: with one
--    row per device an unattributed row was a whole device going quiet, which somebody noticed.
--    With a stack it is one rule of five going quiet, which nobody does.
--
--    NOT VALID: enforced on every new and updated row, tolerant of any legacy row that already
--    carries a null. Once those are fixed or gone, run
--      alter table schedules validate constraint schedules_updated_by_present;
-- ---------------------------------------------------------------------------
alter table schedules drop constraint if exists schedules_updated_by_present;
alter table schedules
  add constraint schedules_updated_by_present check (updated_by is not null) not valid;

-- ---------------------------------------------------------------------------
-- 5. THE DATA MIGRATION.
--
--    Every outlet schedule today is `socket: null` and MEANS both sockets, because
--    server/scheduler.mjs runs it through shared/commands.mjs's fanOutCommand. Preserving that
--    behaviour exactly means turning each one into two rows — one per socket.
--
--    ONE DO BLOCK, so it is a single statement and therefore atomic. A hand-applied file has no
--    transaction around it, and an insert that succeeded while the delete did not would leave a
--    whole-outlet row AND its two per-socket children. At the next matching minute that is four
--    dispatches to two relays: idempotent at the relay, but it lies in the audit trail and it
--    doubles traffic to a fleet whose inbound socket-table exhaustion is a documented fault.
--
--    The socket numbers come from `devices.sockets`, never from a hard-coded 2 — the runtime
--    path already refuses that shortcut and the migration must not take it either.
-- ---------------------------------------------------------------------------
do $$
declare
  split_rows int;
  dropped_rows int;
begin
  insert into schedules (device_id, socket, rule, enabled, updated_by, updated_at, created_at, label)
  select s.device_id,
         g.n,
         s.rule,
         s.enabled,
         s.updated_by,
         s.updated_at,                       -- preserved: this is a migration, not an edit
         coalesce(s.created_at, s.updated_at, now()),
         coalesce(s.label, 'Socket ' || g.n)
    from schedules s
    join devices d
      on d.id = s.device_id
     and d.class = 'outlet_dual'
    cross join lateral generate_series(1, coalesce(jsonb_array_length(d.sockets), 0)) as g(n)
   where s.socket is null
     and not exists (
           select 1 from schedules x
            where x.device_id = s.device_id
              and x.socket = g.n
              and x.rule = s.rule            -- a partially-applied previous run must not duplicate
         );
  get diagnostics split_rows = row_count;

  delete from schedules s
   using devices d
   where d.id = s.device_id
     and d.class = 'outlet_dual'
     and s.socket is null;
  get diagnostics dropped_rows = row_count;

  raise notice 'phase33: split % whole-outlet schedule row(s) into per-socket rows, removed % whole-outlet row(s)',
    split_rows, dropped_rows;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Indexes.
--
--    NOT for the daemon. Once the `socket=is.null` filter is gone, server/scheduler.mjs reads
--    the WHOLE table every refresh; that is a sequential scan by definition and at this row
--    count Postgres would choose one whatever we built. Shipping a partial index labelled as a
--    daemon optimisation that the planner never uses would be a lie in an index name.
--    This one serves the Automation page's per-device list, which is the read that will grow.
-- ---------------------------------------------------------------------------
create index if not exists schedules_device_id_socket_idx on schedules (device_id, socket);

--    Duplicate hygiene, and explicitly NOT the safety guard — server/schedulePlan.mjs's
--    per-target collapse is that. coalesce() rather than the bare columns because NULLs are
--    DISTINCT in a unique index: two switch rows with socket NULL and identical rules would
--    both be accepted otherwise, and so would two rules that each omit an `on` time.
create unique index if not exists schedules_dedupe_uidx
  on schedules (
    device_id,
    coalesce(socket, 0),
    coalesce(rule->>'on',   ''),
    coalesce(rule->>'off',  ''),
    coalesce(rule->>'days', '')
  );

-- ---------------------------------------------------------------------------
-- 7. DELETE. schema.sql granted select/insert/update and no delete, because there was one row
--    per device and clearing it was a write of nulls. A stack is a list, and a list needs
--    removal.
--
--    HARD delete, not a tombstone. `enabled = false` already means DISARMED — a distinct state
--    an operator can see and toggle — and reusing it for deletion collapses two different
--    things into one. The list is meant to read as the flow of the device's day; tombstones
--    destroy exactly that reading.
--
--    Deleting a rule does not erase what it did: `commands` keeps every firing with its source,
--    its actor and the rule id in `note`. That is what makes a hard delete safe here and would
--    not make it safe on `commands`, which deliberately has no delete policy at all.
-- ---------------------------------------------------------------------------
drop policy if exists schedules_delete_authenticated on schedules;
create policy schedules_delete_authenticated on schedules
  for delete using (auth.role() = 'authenticated');

comment on column schedules.socket is
  'Which socket this rule addresses. NULL for a switch or the aircon, which have one target; '
  '1 or 2 for an outlet_dual. A NULL on an outlet still fans out to both sockets at dispatch '
  '(shared/commands.mjs fanOutCommand) so a hand-written row behaves sanely, but nothing this '
  'app writes leaves it NULL for an outlet after phase 33.';

comment on column schedules.label is
  'Operator name for one rule in a device''s stack — "Morning", "After lunch". Optional: an '
  'unnamed rule is displayed by its times.';
