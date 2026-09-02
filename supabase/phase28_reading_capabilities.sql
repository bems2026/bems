-- Phase 28: store what a device reports beyond volts, amps and watts.
--
-- WHY: `readings` has carried the lowest common denominator since Stage 3 — voltage, current,
-- power_w, energy_kwh_today, online. That was the right shape when every device was reduced to
-- "how much is it drawing". It is now the reason four kinds of question cannot be asked of the
-- history at all:
--
--   * "Which branch tripped its power warning, and when?"  (`power_type`, `warn_power_w`)
--   * "What is this meter's lifetime total?"               (`total_energy_kwh`)
--   * "Did this outlet report a fault before it went dark?" (`fault`)
--   * "Was the device on the cloud or the local network when it stopped answering?" (`net_state`)
--
-- Every one of those is a leading indicator, and all four were already on the wire — the devices
-- have always reported them and nothing read them. See `shared/deviceCapabilities.mjs`.
--
-- ALL NULLABLE, NO BACKFILL. Rows written before this migration genuinely do not know these
-- values, and inventing them would be worse than admitting it. NULL reads as "not recorded",
-- which is distinct from a real 0 — the same rule the bridge follows when it omits a metered
-- field rather than zeroing it.
--
-- WHY A `capabilities` JSONB AS WELL AS COLUMNS. The four above are promoted to real columns
-- because they are the ones worth indexing and asking aggregate questions of. The rest —
-- countdowns, child lock, relay_status, calibration coefficients, the per-channel increments —
-- are worth KEEPING but not worth a column each, and a schema that grew a column per vendor dp
-- would need a migration every time a device model changed. The jsonb is the long tail; the
-- columns are the questions.
--
-- NOT INDEXED YET, deliberately. `readings` is the highest-volume table here and is already
-- pruned on a retention pass (phase 9/11). An index earns its place when a query is slow, not
-- when a column is added — and the natural query for all four is scoped by `(device_id, ts)`,
-- which the existing index already serves.
--
-- NO RLS CHANGE NEEDED: `readings`' existing policies are per-table, not per-column, so these
-- inherit them (authenticated select; the ingestion daemon writes with its own key).
--
-- Apply once, by hand, in the Supabase SQL editor. Re-runnable.
--
-- NOTE ON SEQUENCING: `server/shapeRows.mjs` does NOT write these columns yet. PostgREST rejects
-- an insert naming a column that does not exist, so widening the daemon before this migration is
-- applied would stop ingestion outright — on a table that is the history of a real building.
-- Apply this first, confirm with the probe below, then widen the daemon.

alter table readings add column if not exists total_energy_kwh numeric;
alter table readings add column if not exists warn_power_w numeric;
alter table readings add column if not exists power_type text;
alter table readings add column if not exists net_state text;
alter table readings add column if not exists fault integer;
alter table readings add column if not exists capabilities jsonb;

-- `power_type` and `net_state` are closed sets defined by the vendor's own device model, so a
-- value outside them means the catalogue and the hardware have drifted — which is the thing
-- worth catching. Unlike `commands.status`, which is deliberately free text because adding a
-- status must never need a migration on a safety-critical table, nothing here is safety-critical
-- and both vocabularies come from a spec that `npm run tuya:spec` already checks.
alter table readings drop constraint if exists readings_power_type_check;
alter table readings
  add constraint readings_power_type_check
  check (power_type is null or power_type in ('normal','warn'));

alter table readings drop constraint if exists readings_net_state_check;
alter table readings
  add constraint readings_net_state_check
  check (net_state is null or net_state in ('cloud_net','local_net','no_net'));

comment on column readings.total_energy_kwh is
  'The meter''s own lifetime accumulator, as it reports it. Monotonic except across a device '
  'reset, which is why it is stored raw rather than differenced here. NULL for devices that do '
  'not report one (every outlet, every switch) and for rows written before phase 28.';

comment on column readings.warn_power_w is
  'The over-power alarm threshold currently set ON THE DEVICE, in watts. Stored per reading '
  'rather than as configuration because it can be changed from the device''s own app as well as '
  'from here, so the only honest record is what it was at the time of the reading.';

comment on column readings.power_type is
  'The device''s own verdict on whether it is over its warn_power_w threshold: normal or warn. '
  'This is the device speaking, not a threshold this system evaluates — the two can disagree, '
  'and when they do the device is the one wired to the circuit.';

comment on column readings.net_state is
  'How the device believed it was reaching the world: cloud_net, local_net, or no_net. A device '
  'that goes dark having last reported no_net was already in trouble; one that goes dark from '
  'cloud_net more likely lost the local segment. That distinction is what decides whether '
  'somebody has to drive to the office.';

comment on column readings.fault is
  'The outlet''s fault bitmap (dp 26), raw. Bits, low to high: ov_cr, ov_vol, ov_pwr, ls_cr, '
  'ls_vol, ls_pow — over/under current, voltage and power. 0 means the device reports no fault; '
  'NULL means it does not report this at all.';

comment on column readings.capabilities is
  'Every other decoded capability, keyed by its vendor code and already in canonical units. The '
  'long tail that is worth keeping but not worth a column each: countdowns, child lock, '
  'relay_status, calibration coefficients, per-channel energy increments. Declared per product '
  'in shared/deviceCapabilities.mjs and checked against the vendor model by `npm run tuya:spec`.';
