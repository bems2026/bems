-- phase38 — what a kilowatt-hour costs, and what it emits.
--
-- RM-072q. This system has measured energy honestly for months and has never been able to say
-- what any of it cost. Milestone 1 asks for a "benchmarking summary"; a reviewer reading that
-- phrase expects money, and the gap between what they expect and what exists is the widest one
-- left in the reporting.
--
-- TWO TABLES, NOT TWO KEYS IN `sites.policy`. `set_acu_min_room_target` (phase35) is a
-- `security definer` function because the `sites` row ALSO decides whether commands may leave
-- the building for a vendor cloud, and RLS is row-level — a policy narrow enough to permit the
-- setpoint and refuse the dispatch mode cannot be written, so the function is the narrow door.
-- A dedicated table has no such collision. Plain `authenticated` RLS, the same as
-- `device_config` and `schedules`, and no function to maintain.
--
-- TIME-VARYING, NOT A SCALAR. A single current rate would price August 2026 at whatever the
-- rate is on the day somebody opens the report. Electricity rates move; a report of a past month
-- priced at today's rate is wrong in a way that is invisible and grows. Because
-- `report_daily_series` (phase37) gives a figure per day, cost is computed per day at the rate
-- in force THAT day, and the report names every rate it used.
--
-- NO ROW IS A REAL STATE. An unset tariff is not a rate of zero. Every consumer must render
-- "not set" rather than a currency figure — `src/lib/energyCost.ts` returns `null`, and
-- `src/lib/reportPdf/docDefinition.test.ts` walks the whole document tree asserting no currency
-- symbol appears when none is configured. That is the same rule as an unobserved hour being an
-- em dash rather than 0 W, applied to the most quotable number a report can carry.
--
-- SAFE TO RE-RUN.

-- ---------------------------------------------------------------------------------------------
-- What a kilowatt-hour costs.
-- ---------------------------------------------------------------------------------------------
create table if not exists energy_tariffs (
  id             uuid primary key default gen_random_uuid(),
  site_id        text not null references sites(id),
  -- The date this rate began applying. A period spanning a change is priced per day across both.
  effective_from date not null,
  -- ISO 4217, so the UI never has to guess which currency a bare number is in. Not defaulted:
  -- the replication framework exists to stand this up for another institution, and a default of
  -- 'PHP' would be the kind of assumption RM-033 spent a track removing.
  currency       text not null check (char_length(currency) = 3),
  rate_per_kwh   numeric not null check (rate_per_kwh > 0 and rate_per_kwh <= 1000),
  -- REQUIRED, and the reason this table exists rather than a number in a config file. A cost
  -- figure without provenance is exactly what a funder cannot check, so an empty source is a
  -- constraint violation rather than a default.
  source         text not null check (btrim(source) <> ''),
  set_by         uuid references auth.users(id) default auth.uid(),
  -- A SNAPSHOT, and deliberately so. `set_by` is the authoritative id — it comes from
  -- `auth.uid()` and the client cannot forge it — but a uuid in a footnote tells a funder
  -- nothing. This records who it was AT THE TIME, which is what provenance means: not who that
  -- account belongs to now, and not a live join that would rewrite an old report's footnote
  -- when somebody's address changes.
  set_by_email   text,
  set_at         timestamptz not null default now(),
  unique (site_id, effective_from)
);

-- ---------------------------------------------------------------------------------------------
-- What a kilowatt-hour emits.
--
-- 2.0 kgCO2e/kWh is a sanity ceiling rather than a judgement: no grid on earth reaches ~1.1, so
-- anything above 2 is a misplaced decimal. Deliberately not tighter — a dirty grid is a real
-- thing and this check exists to catch a typo, not to second-guess a published figure.
-- ---------------------------------------------------------------------------------------------
create table if not exists emission_factors (
  id                uuid primary key default gen_random_uuid(),
  site_id           text not null references sites(id),
  effective_from    date not null,
  kg_co2e_per_kwh   numeric not null check (kg_co2e_per_kwh > 0 and kg_co2e_per_kwh <= 2.0),
  source            text not null check (btrim(source) <> ''),
  set_by            uuid references auth.users(id) default auth.uid(),
  set_by_email      text,
  set_at            timestamptz not null default now(),
  unique (site_id, effective_from)
);

create index if not exists energy_tariffs_site_from_idx  on energy_tariffs  (site_id, effective_from desc);
create index if not exists emission_factors_site_from_idx on emission_factors (site_id, effective_from desc);

-- ---------------------------------------------------------------------------------------------
-- RLS.
--
-- SELECT, INSERT and DELETE — deliberately no UPDATE. A tariff row is a historical claim: "from
-- this date, the rate was this, and here is where that came from". Editing one in place rewrites
-- what a past report was priced at with nothing to show it happened. Correcting a wrong entry is
-- a delete and a re-insert, which leaves `set_by`/`set_at` telling the truth about both acts.
--
-- `anon` is named explicitly in the revoke rather than merely left out of the grant: revoking
-- from PUBLIC does not remove a privilege Supabase granted `anon` directly, which
-- phase5_lockdown_rls.sql learned once already.
-- ---------------------------------------------------------------------------------------------
alter table energy_tariffs   enable row level security;
alter table emission_factors enable row level security;

drop policy if exists energy_tariffs_select_authenticated on energy_tariffs;
drop policy if exists energy_tariffs_insert_authenticated on energy_tariffs;
drop policy if exists energy_tariffs_delete_authenticated on energy_tariffs;
create policy energy_tariffs_select_authenticated on energy_tariffs for select to authenticated using (true);
create policy energy_tariffs_insert_authenticated on energy_tariffs for insert to authenticated with check (true);
create policy energy_tariffs_delete_authenticated on energy_tariffs for delete to authenticated using (true);

drop policy if exists emission_factors_select_authenticated on emission_factors;
drop policy if exists emission_factors_insert_authenticated on emission_factors;
drop policy if exists emission_factors_delete_authenticated on emission_factors;
create policy emission_factors_select_authenticated on emission_factors for select to authenticated using (true);
create policy emission_factors_insert_authenticated on emission_factors for insert to authenticated with check (true);
create policy emission_factors_delete_authenticated on emission_factors for delete to authenticated using (true);

-- REVOKED FROM `authenticated` TOO, AND THAT IS THE LOAD-BEARING LINE.
--
-- A grant is additive. Supabase's own `alter default privileges` hands ALL privileges on new
-- tables in `public` to `anon`, `authenticated` and `service_role`, so granting
-- `select, insert, delete` here adds nothing that was not already there — `authenticated` would
-- keep the UPDATE this file's header says it does not have, and the comment would be the only
-- thing enforcing it.
--
-- Caught by reading the live project back: an UPDATE succeeded where the design says none is
-- possible. The reading was done with the service-role key, which bypasses RLS anyway and so
-- proves nothing on its own — but it was enough to ask the question, and the answer was that
-- nothing had ever taken the default grant away. `supabase/rehearse.sh` now asserts the exact
-- privilege set against `information_schema`, which is the only check that could have caught it.
--
-- This is the same shape as phase5's lesson about `anon`, one role along.
revoke all on energy_tariffs   from public, anon, authenticated;
revoke all on emission_factors from public, anon, authenticated;

grant select, insert, delete on energy_tariffs   to authenticated;
grant select, insert, delete on emission_factors to authenticated;
