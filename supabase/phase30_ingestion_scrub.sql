-- =============================================================================
-- phase30 — what the ingestion scrub refused.
--
-- `server/scrubTelemetry.mjs` is the first thing between the bridge and this database with an
-- opinion about what it is storing. Before it, `shapeRows.splitLatestPayload` was seven
-- `?? null` assignments: no type check, no finiteness check, no range check, no timestamp
-- check. That is how 3,625 kWh for one day on a circuit averaging 36 W landed in `readings`
-- on 2026-09-03 and had to be repaired by hand.
--
-- WHY COLUMNS AND NOT JUST A LOG LINE. A guard that discards silently is the same failure
-- shape as the radio survey that printed a clean band it had never measured: the reassuring
-- output and the broken output look identical, so nobody can tell the difference until it
-- matters. `ingestion_health` is the one row an operator opens to ask "is this working?", and
-- until now it could not answer "…and is it quietly throwing data away?".
--
-- WHY BOTH A COUNT AND A REASON. The count is per tick, so a steady trickle shows up as a
-- number that keeps being non-zero. The reason is sticky — it survives every clean tick after
-- it — because a single rejection an hour ago is exactly the case a per-tick counter erases,
-- and it is the case worth seeing.
--
-- The daemon writes these on EVERY tick (0 when nothing was refused), so a stale non-zero
-- count is not a thing this can leave behind. Nothing reads these columns yet; the ingestion
-- journal carries the same information, and this is the copy that outlives the journal's
-- rotation.
--
-- Idempotent, like every phase file here: safe to re-run, and safe to apply to a running
-- system before the daemon that writes it is deployed.
-- =============================================================================

alter table ingestion_health add column if not exists scrub_rejected_count int not null default 0;
alter table ingestion_health add column if not exists scrub_last_reason    text;
alter table ingestion_health add column if not exists scrub_last_at        timestamptz;

comment on column ingestion_health.scrub_rejected_count is
  'Telemetry fields refused by server/scrubTelemetry.mjs on the most recent ingest tick. Not an error count: a refusal is the guard working.';
comment on column ingestion_health.scrub_last_reason is
  'The most recent refusal, e.g. "lo_yel2.energy_kwh_today=3625.108 outside [0, 100]". Sticky — it is not cleared by a clean tick.';
comment on column ingestion_health.scrub_last_at is
  'When scrub_last_reason was recorded, so a sticky reason can be told from a current one.';

-- No RLS change. `ingestion_health` already grants select to `authenticated` and is written
-- only by the service-role key, which bypasses RLS entirely — see schema.sql. Three more
-- columns on that table inherit both facts.
