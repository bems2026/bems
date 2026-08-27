-- RM-028: the spatial hierarchy, and where each device sits in it.
--
-- REQUIRES supabase/phase19_sites.sql (every node belongs to a site).
--
-- WHAT THIS REPLACES: `devices.room` is nullable text and `device_config.room` is text with the
-- comment "this building has no fixed room list". So an office, a lab and a floor could not be
-- grouped, rolled up, or scoped — the exact three things a second site needs, and the reason
-- "how much did the lab use?" has never been an answerable question here.
--
-- ONE SELF-REFERENCING TABLE, NOT ONE TABLE PER LEVEL. A `buildings`/`floors`/`rooms` trio fixes
-- the depth at schema time, so a site that is a single room and a site that is a campus cannot
-- both fit without a migration. A kind-tagged node tree bends instead: adding a level is a row.
-- This is the single most important decision in the file.
--
-- NO ltree AND NO MATERIALIZED PATH. Both are the right answer at a scale this is nowhere near —
-- the tree will hold tens of nodes, not millions — and both add a thing to keep correct on every
-- write. Same discipline docs/adr-001-timeseries-store.md applies to reaching for a second
-- datastore: reach for it when something is measured to be slow, not before.
--
-- Apply once, by hand, in the Supabase SQL editor. Rehearse with supabase/rehearse.sh first.
--
-- RE-RUNNING IS SAFE, and as of 2026-08-27 that is true rather than merely asserted. This header
-- previously claimed "every statement is guarded" while four `create policy` statements had no
-- guard at all — PostgreSQL has no `create policy if not exists`. The operator hit `42710` on a
-- re-run, and because the SQL editor stops at the first error and those policies sit ABOVE the
-- `revoke ... from anon` further down, the re-run aborted before reaching the security fix it
-- was being run for. The file appeared to have been re-applied and had not been.
--
-- A false claim of idempotency is worse than an honest warning, because it is acted on. Each
-- policy is now dropped before it is created, and `test/migration-idempotency.test.mjs` fails
-- any migration that makes this claim without earning it.

-- =============================================================================
-- space_nodes — the tree itself.
-- =============================================================================
create table if not exists space_nodes (
  id         uuid primary key default gen_random_uuid(),

  -- Deleting a site takes its whole tree. There is no such thing as a node without a site, and
  -- leaving orphans behind would let a second deployment inherit the first one's rooms.
  site_id    text not null references sites(id) on delete cascade,

  -- NULL parent = a root of this site's tree. Deliberately not forced to a single root: a site
  -- may legitimately have two buildings, or one room and no building at all.
  -- Cascade, so deleting a floor takes its rooms rather than stranding them at depth 1 with a
  -- dangling parent.
  parent_id  uuid references space_nodes(id) on delete cascade,

  -- Constrained because a typo here silently creates a level nothing queries. Ordered
  -- coarse-to-fine as a reading aid only — NOTHING enforces that a room sits inside a floor.
  -- A site with one room and no building is a real case (a lab in a shared building), and a
  -- constraint forbidding it would be the rigidity this table exists to remove.
  kind       text not null check (kind in ('building','floor','wing','zone','room','sub_area')),

  name       text not null check (char_length(name) between 1 and 60),

  -- Display order among siblings. The operator's judgement, not the database's.
  sort_order int  not null default 0,

  -- Area, occupancy, whatever a later site needs. jsonb rather than columns because these are
  -- descriptive facts about a building, and a new one must never require a migration.
  attrs      jsonb not null default '{}'::jsonb,

  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- Two rooms called "Lab" under the same floor are indistinguishable to whoever has to pick one
-- from a list. Case-insensitive, because "Lab" and "lab" are the same room to a human.
-- coalesce(parent_id, ...) because NULL never equals NULL, so roots would otherwise be exempt
-- from the very check they most need.
create unique index if not exists space_nodes_sibling_name
  on space_nodes (site_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Every read starts "the nodes of this site" or "the subtree under this node".
create index if not exists space_nodes_site_parent_idx on space_nodes (site_id, parent_id, sort_order);

alter table space_nodes enable row level security;

-- Same access model as device_config: one admin role, no per-row ownership. The tree is
-- operator-maintained from the app, so unlike `devices` this one does grant writes.
-- DELETE is granted here and is NOT granted on device_config, and the difference is real:
-- clearing device metadata is a write of NULLs, whereas removing a room is a genuine deletion.
-- No anon policy — phase5 dropped every one of those and none comes back.
drop policy if exists space_nodes_select_authenticated on space_nodes;
create policy space_nodes_select_authenticated on space_nodes
  for select using (auth.role() = 'authenticated');
drop policy if exists space_nodes_insert_authenticated on space_nodes;
create policy space_nodes_insert_authenticated on space_nodes
  for insert with check (auth.role() = 'authenticated');
drop policy if exists space_nodes_update_authenticated on space_nodes;
create policy space_nodes_update_authenticated on space_nodes
  for update using (auth.role() = 'authenticated');
drop policy if exists space_nodes_delete_authenticated on space_nodes;
create policy space_nodes_delete_authenticated on space_nodes
  for delete using (auth.role() = 'authenticated');

-- =============================================================================
-- space_subtree(root) — a node and everything beneath it, depth-annotated.
--
-- WHY security invoker (the default, stated explicitly because it is load-bearing): RLS on
-- space_nodes is what keeps the tree behind a login. A security definer function would hand it
-- to anyone able to call it. Same reasoning as readings_buckets in phase9.
--
-- WHY THE DEPTH LIMIT: `parent_id` is user-editable, and nothing in a self-referencing table
-- prevents A -> B -> A. An unbounded recursive CTE against a cycle does not error — it runs
-- until something gives out. 32 is far past any real building and cheap to raise.
-- =============================================================================
create or replace function public.space_subtree(p_root uuid)
returns table (
  id         uuid,
  site_id    text,
  parent_id  uuid,
  kind       text,
  name       text,
  sort_order int,
  attrs      jsonb,
  depth      int
)
language sql
stable
security invoker
as $$
  with recursive walk as (
    select n.id, n.site_id, n.parent_id, n.kind, n.name, n.sort_order, n.attrs, 0 as depth
      from space_nodes n
     where n.id = p_root
    union all
    select c.id, c.site_id, c.parent_id, c.kind, c.name, c.sort_order, c.attrs, w.depth + 1
      from space_nodes c
      join walk w on c.parent_id = w.id
     where w.depth < 32
  )
  select * from walk;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, which includes `anon`. RLS
-- would still block the rows, but defence in depth: revoke first, then grant only to
-- authenticated. The order matters — granting before revoking undoes the grant.
-- `from public, anon` rather than `from public` alone. MEASURED against the live project on
-- 2026-08-27: with only the public revoke, `anon` could still call this (HTTP 200), while
-- `readings_buckets` — same pattern, same file shape — correctly answered 404. Revoking from
-- PUBLIC does not remove a grant held directly by a role, and Supabase manages these roles
-- itself, so naming `anon` is the only version that is correct whatever granted it.
--
-- Nothing leaked: the function is `security invoker` and RLS returns `anon` zero rows either
-- way. This is the defence-in-depth the comment above already claimed, actually delivered.
--
-- `supabase/rehearse.sh` cannot catch this and never will — a bare PostgreSQL has none of
-- Supabase's default privileges, so the rehearsal proves migrations APPLY and functions BEHAVE,
-- and says nothing about who ends up holding EXECUTE. Only a probe against the real project can.
revoke execute on function public.space_subtree(uuid) from public, anon;
grant  execute on function public.space_subtree(uuid) to authenticated;

-- =============================================================================
-- Placement — which node a device sits in.
-- =============================================================================
-- ON DELETE SET NULL, not cascade. A device outliving the room it was in is ordinary: rooms get
-- renamed, merged and restructured while the hardware stays screwed to the wall. Cascading would
-- silently discard that device's notes, category and load-shed tier along with the room, and the
-- shed tier is a safety-relevant value somebody chose deliberately.
alter table device_config add column if not exists space_node_id uuid references space_nodes(id) on delete set null;

create index if not exists device_config_space_node_idx on device_config (space_node_id);

-- `device_config.room` is deliberately KEPT and not dropped. It becomes the denormalised label:
-- the tree is the truth, and the text column is what a row can still show if the tree has not
-- been built yet at a fresh site. Same additive discipline phase7_device_config.sql argues for
-- in its own header — dropping a column that holds real operator input is not reversible by
-- re-running a file.
