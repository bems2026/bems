-- Architecture plan Phase 8: rolling-window anomaly detection on device power readings.
--
-- WHY A SIBLING TABLE, WRITTEN THE SAME WAY readings/building_totals/ingestion_health ARE:
-- server/ingest.mjs's tick() computes this in-memory (server/anomalyStats.mjs — rolling
-- z-score/IQR against each device's own recent power_w history, no ML, no training data,
-- see that file's header) and upserts flagged ticks here via the service-role key, same as
-- every other table this daemon owns. Nothing in the browser ever writes to this table.
--
-- WHY (device_id, ts, metric) AS THE PRIMARY KEY, NOT gen_random_uuid():
-- server/ingest.mjs's writeOrBuffer() retries a buffered write verbatim on the next
-- successful tick, via upsert's ON CONFLICT semantics (supabase/phase7_device_config.sql's
-- header explains why that requires an UNCONDITIONAL unique constraint). A random UUID
-- primary key would insert a fresh duplicate row on every retry instead of no-op'ing. `ts`
-- is the exact reading timestamp this anomaly was computed from — already unique per
-- (device_id, ts) in `readings` (schema.sql:34-44) — so this composes naturally rather than
-- inventing a new id scheme. `metric` is carried even though `power_w` is the only value
-- computed today, so a future second metric (e.g. current) can share this table without a
-- migration.
--
-- Apply once, by hand, in the Supabase SQL editor. No migration runner in this repo; same
-- convention as phase4_/.../phase7_*.sql.

create table if not exists anomalies (
  device_id        text not null references devices(id),
  ts               timestamptz not null,
  metric           text not null default 'power_w' check (metric in ('power_w')),
  value            numeric not null,
  baseline_mean    numeric not null,
  baseline_stddev  numeric not null,
  z_score          numeric not null,
  iqr_lower        numeric not null,
  iqr_upper        numeric not null,
  method           text not null check (method in ('zscore', 'iqr', 'both')),
  sample_count     int not null,
  created_at       timestamptz not null default now(),
  primary key (device_id, ts, metric)
);
create index if not exists anomalies_device_id_ts_idx on anomalies (device_id, ts desc);

alter table anomalies enable row level security;

-- Same access model as readings/building_totals/ingestion_health: read-only from the
-- browser, written only by ibems-server via the service-role key, which bypasses RLS
-- entirely. No insert/update policy for `authenticated` on purpose. No anon policy either —
-- phase5_lockdown_rls.sql dropped every one of those and none comes back.
create policy anomalies_select_authenticated on anomalies
  for select using (auth.role() = 'authenticated');
