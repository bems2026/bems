-- RM-165: energy a held meter counted but did not report, recovered as an estimate.
--
-- REQUIRES supabase/phase19_sites.sql (every row belongs to a site).
--
-- WHY (E-260). From 15 to 28 October 2026 the site network had no internet and the circuit meters repeated one
-- reading each until it returned. Their lifetime registers kept counting, and stepped up when they resumed —
-- the aircon meter by 32.97 kWh — but the reports bank each day's own register, which sat still, so that energy
-- was in no day. Ingest (and the one-shot `npm run held-energy:backfill`) spreads each step over the held days
-- by the meter's usual weekday and weekend use (`server/heldEnergy.mjs`) and writes the parts here. The
-- Reports page adds them to each circuit's day, labelled as estimated; nothing else reads them.
--
-- WRITTEN BY THE EDGE ONLY. The service role bypasses row security, so there is no insert or update policy:
-- signed-in accounts read, nobody else writes.
--
-- Apply once, by hand, in the Supabase SQL editor. Rehearse with supabase/rehearse.sh first.
--
-- RE-RUNNING IS SAFE: `create table if not exists`, and every policy is dropped before it is created.

create table if not exists energy_estimates (
  site_id    text not null references sites(id) on delete cascade,
  device_id  text not null,
  local_day  date not null,
  -- The hold this part belongs to: one hold, one set of days. A second hold on the same day is its own row.
  held_from  timestamptz not null,
  held_to    timestamptz not null,
  kwh        numeric not null check (kwh >= 0 and kwh <= 240),
  basis      text not null,
  created_at timestamptz not null default now(),
  primary key (site_id, device_id, local_day, held_from)
);

comment on table energy_estimates is
  'kWh a held meter counted but did not report, spread over the held days by its usual use. An estimate, always shown as one. RM-165.';
comment on column energy_estimates.basis is
  'What the estimate was made from, in words: the hold, the register step, and how it was spread.';

alter table energy_estimates enable row level security;

drop policy if exists energy_estimates_select_authenticated on energy_estimates;
create policy energy_estimates_select_authenticated on energy_estimates
  for select using (auth.role() = 'authenticated');

-- Order matters: revoke first, then grant, or the grant is undone.
revoke all on energy_estimates from public, anon, authenticated;
grant select on energy_estimates to authenticated;
