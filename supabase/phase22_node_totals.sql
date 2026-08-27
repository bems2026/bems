-- RM-030: what a space actually used.
--
-- REQUIRES supabase/phase21_space_tree.sql (the subtree walk and the placement column).
--
-- WHAT THIS ADDS: "how much did the lab use?" has never been answerable here. `readings` is per
-- device and `building_totals` is per building, with nothing in between, because nothing knew
-- what a lab was. RM-028 gave rooms structure; this is what makes them add up.
--
-- A NEW READ PATH, NOT A MIGRATION OF THE OLD ONE. `building_totals` holds months of real rows
-- and RM-009's rollup functions were built against its shape. Nothing here touches it.
--
-- THE HARD PART IS HONESTY, NOT ARITHMETIC. Every expensive failure in this project has been the
-- same shape: a figure that looks plausible and was never observed. A meter that stops reporting
-- keeps its last value in `readings`, so a naive average charts a frozen number as though it were
-- measured. RM-024 and EX-107 settled the rule and it applies here unchanged — only online
-- samples count, and a scope with none reports NULL rather than 0.
--
-- Apply once, by hand, in the Supabase SQL editor. Rehearse with supabase/rehearse.sh first.

-- =============================================================================
-- node_totals(node, since, until) — one row summarising a space and everything under it.
-- =============================================================================
create or replace function public.node_totals(
  p_node_id uuid,
  p_since   timestamptz,
  p_until   timestamptz default now()
)
returns table (
  -- Devices placed anywhere in this subtree, whether or not they meter anything.
  device_count        int,
  -- Of those, the ones that produced any reading in the window at all.
  reporting_count     int,
  -- Rows considered, and rows that were actually observed. BOTH are returned on purpose: the
  -- figures alone cannot distinguish a quiet room from an unplugged one, and the Reports page
  -- already refuses to quote a bare total for a sparse month (EX-033). A caller that ignores
  -- these is making the same mistake one layer up.
  sample_count        bigint,
  online_sample_count bigint,
  -- NULL when nothing was observed. Never 0 — see the header.
  avg_power_w         numeric,
  peak_power_w        numeric
)
language sql
stable
security invoker
as $$
  with scope as (
    -- The whole subtree, not just the node clicked. A floor's total that ignored its rooms
    -- would read 0 at every site that has floors, and would look like a working feature.
    select id from public.space_subtree(p_node_id)
  ),
  placed as (
    select dc.device_id
      from device_config dc
      join scope s on s.id = dc.space_node_id
  ),
  windowed as (
    select r.device_id, r.power_w, r.online
      from readings r
      join placed p on p.device_id = r.device_id
     where r.ts >= p_since
       and r.ts <  p_until
  )
  select
    (select count(*)::int from placed),
    (select count(distinct device_id)::int from windowed),
    (select count(*) from windowed),
    (select count(*) from windowed where online is true),
    -- `avg`/`max` over zero rows are NULL in Postgres, and that is exactly the wanted answer.
    -- A coalesce to 0 anywhere here would report a reading nobody took.
    (select avg(power_w) from windowed where online is true and power_w is not null),
    (select max(power_w) from windowed where online is true and power_w is not null);
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default. `from public, anon` rather
-- than `from public` alone: revoking from PUBLIC does NOT remove a grant held directly by a
-- role, which is what phase21 was measured doing on the live project — anon could still call
-- `space_subtree` after a public-only revoke. `supabase/rehearse.sh` cannot catch that
-- difference, because a bare PostgreSQL has none of Supabase's default privileges. Naming the
-- role is the only form that is correct whatever granted it.
revoke execute on function public.node_totals(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function public.node_totals(uuid, timestamptz, timestamptz) to authenticated;

-- =============================================================================
-- Retire phase20's transitional site_id defaults.
-- =============================================================================
-- They existed so phase20 could be applied by hand to a RUNNING system whose daemons did not
-- yet send a site_id — without them, every `building_totals` insert and `ingestion_health`
-- upsert would have failed within a minute and presented as a Supabase outage. That was the
-- whole point, and it worked: rows written by the old code came back correctly stamped.
--
-- RM-027's Task 6 made every writer explicit (`1018bc5`), so the net is no longer holding
-- anything up. Dropping it now matters because a default is actively wrong in the shared-project
-- future this track is building toward: a second Pi that forgot to send its site_id would have
-- its rows silently attributed to this one, which is a worse failure than the outage the default
-- prevented — wrong data attributed confidently, rather than a write that fails loudly.
--
-- The columns stay NOT NULL. This removes the fallback, not the requirement.
alter table dsm_thresholds   alter column site_id drop default;
alter table ingestion_health alter column site_id drop default;
alter table building_totals  alter column site_id drop default;

-- DELIBERATELY NOT widening `building_totals`' primary key to (site_id, ts), which phase20's
-- header floated for this phase. The reasoning there was that RM-030 would be touching the
-- rollups anyway — it is not. `node_totals` is a new read path over `readings` and does not go
-- near `roll_up_and_prune_building_totals` or `building_totals_hourly`. Changing a primary key
-- underneath working rollup functions, for no benefit this phase can demonstrate, is exactly
-- the kind of change that should wait for a phase that has a reason to test it.
