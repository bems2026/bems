#!/usr/bin/env bash
# Rehearse every migration against a real PostgreSQL before it touches the live project.
#
# WHY THIS EXISTS:
# this repo has no migration runner. Every phase file is pasted into the Supabase SQL editor
# by hand, and one of them (phase6_schedules_config.sql) already needed a follow-up fix file
# after a partial unique index turned out not to work as an ON CONFLICT target — a mistake
# that survived review because nothing had ever executed the SQL. The schema guard tests in
# `test/phase*-schema.test.mjs` are file-TEXT tests: they check intent, not syntax, and would
# happily pass a file Postgres refuses to parse.
#
# The Phase 9 set was rehearsed this way before shipping, in an ad-hoc container that was
# then thrown away. This is that procedure kept, so the next set does not depend on someone
# remembering how it was done.
#
#     ./supabase/rehearse.sh          # needs docker; nothing else
#
# Touches nothing outside its own throwaway container. Safe to run at any time, including
# while the live system is running — it never reads the live project and never needs a key.
#
# TWO FIXTURE WINDOWS, ON PURPOSE:
# `readings_buckets` sizes its own guard against `now() - p_since`, so it can only be
# exercised on data near the present. Everything else is easier to reason about on a fixed
# historical month. Seeding both, rather than one compromise window, keeps every assertion
# an exact equality instead of a range that would pass through a real regression.

set -euo pipefail

CONTAINER="ibems-rehearse-$$"
PGPASSWORD="rehearse-only-not-a-real-secret"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== starting throwaway postgres =="
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PGPASSWORD" postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U postgres >/dev/null

# ON_ERROR_STOP so any failing statement fails the whole run, loudly.
psql() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"; }

echo "== stubbing what Supabase provides and a bare Postgres does not =="
psql <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
-- The RLS policies only ever compare this to 'authenticated', so this is enough to prove
-- they parse and attach to the right tables.
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(current_setting('request.jwt.claim.role', true), 'authenticated') $$;
-- auth.uid() is used by phase9_command_outcome.sql's own-row-while-in-flight policy. The
-- full set of Supabase-provided symbols the migrations rely on is exactly three:
-- auth.role(), auth.uid() and auth.users. Missing one stops the run at that file, which is
-- how this stub was found to be short in the first place.
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
SQL

echo "== applying every migration in order =="
# Filename order is the apply order, and has been since phase4. Globbed rather than listed by
# hand, so a new phase file is rehearsed automatically instead of being forgotten.
for f in "$HERE/schema.sql" $(ls "$HERE"/phase*.sql | sort -V); do
  printf '   %-46s' "$(basename "$f")"
  psql < "$f" >/dev/null
  echo "ok"
done

echo "== seeding =="
psql <<'SQL'
insert into devices (id, display_name, class) values
  ('mtr_hist', 'Historical Meter', 'meter'),
  ('mtr_now',  'Recent Meter',     'meter')
on conflict (id) do nothing;

-- WINDOW A — fixed history, June 2026. Two hours of per-minute readings; the SECOND hour is
-- entirely offline, which is the live failure shape: a meter still reporting its last value
-- while disconnected. 2026-06-01 00:00Z is 08:00 Asia/Manila, so all of it lands on one
-- local day and the report's daily-maximum logic has an unambiguous answer.
insert into readings (device_id, ts, voltage, current, power_w, energy_kwh_today, online)
select 'mtr_hist',
       timestamptz '2026-06-01 00:00:00+00' + (n || ' minutes')::interval,
       220, 1.0,
       case when n < 60 then 100 + n else 746.5 end,   -- 746.5 = the real frozen value
       n * 0.01,
       (n < 60)
  from generate_series(0, 119) n;

-- site_id is NOT NULL since phase20. The seed runs after every migration, so leaving it out
-- fails here rather than at anything this rehearsal is trying to prove.
insert into building_totals (ts, site_id, energy_kwh_today, energy_kwh_week, energy_kwh_month,
                             total_power_w, avg_voltage, phase_current_red,
                             phase_current_yellow, phase_current_blue)
select timestamptz '2026-06-01 00:00:00+00' + (n || ' minutes')::interval,
       'mmsu-nberic-care',
       n * 0.01, n * 0.02, n * 0.03, 500 + n, 220, 2.5, 2.0,
       null   -- no Blue-phase meter exists; this must survive as NULL, never become 0
  from generate_series(0, 119) n;

-- A SECOND SITE, seeded only here. Nothing in production has one yet, and that is exactly why
-- it belongs in the rehearsal: phase20 exists to make a second deployment possible, and the
-- assertions below are the only place that claim is actually exercised rather than asserted
-- about the text of a file.
insert into sites (id, display_name, timezone, utc_offset_minutes)
values ('rehearsal-second-site', 'A Second Building', 'Asia/Manila', 480)
on conflict (id) do nothing;

insert into anomalies (device_id, ts, value, baseline_mean, baseline_stddev, z_score,
                       iqr_lower, iqr_upper, method, sample_count)
values ('mtr_hist', timestamptz '2024-01-01 00:00:00+00', 900, 100, 10, 80, 0, 200, 'zscore', 30),
       ('mtr_hist', timestamptz '2026-06-01 00:30:00+00', 900, 100, 10, 80, 0, 200, 'zscore', 30);

-- WINDOW B — the last two whole hours, for readings_buckets alone. Hour -2 online, hour -1
-- entirely offline.
insert into readings (device_id, ts, voltage, current, power_w, energy_kwh_today, online)
select 'mtr_now',
       date_trunc('hour', now()) - interval '2 hours' + (n || ' minutes')::interval,
       220, 1.0,
       case when n < 60 then 200 else 746.5 end,
       n * 0.01,
       (n < 60)
  from generate_series(0, 119) n;
SQL

echo "== exercising the functions =="
psql <<'SQL'
do $$
declare
  base   timestamptz := date_trunc('hour', now()) - interval '2 hours';
  h0     timestamptz := timestamptz '2026-06-01 00:00:00+00';
  n int; n2 int; v numeric; rolled int; deleted int; ok boolean; site_of text;
begin
  -- ---- readings_buckets (phase 9) ------------------------------------------------------
  select power_w into v from readings_buckets('mtr_now', base, 3600) order by ts limit 1;
  assert v = 200, format('readings_buckets: expected the online hour to average 200, got %s', v);

  select power_w into v from readings_buckets('mtr_now', base, 3600) order by ts offset 1 limit 1;
  assert v is null,
    format('readings_buckets: an all-offline hour must be NULL, not the frozen 746.5 — got %s', v);

  begin
    perform readings_buckets('mtr_now', now() - interval '400 days', 3600);
    raise exception 'readings_buckets: should have RAISED for an over-cap request';
  exception when sqlstate '22023' then null;
  end;

  -- ---- roll_up_and_prune_readings (phase 9) --------------------------------------------
  select r.rolled, r.deleted into rolled, deleted
    from roll_up_and_prune_readings(h0 + interval '1 hour') r;
  assert rolled = 1, format('rollup: expected 1 hour rolled, got %s', rolled);
  assert deleted = 60, format('rollup: expected 60 raw rows pruned, got %s', deleted);

  select online_sample_count into n from readings_hourly where device_id = 'mtr_hist';
  assert n = 60, format('rollup: expected 60 online samples in the bucket, got %s', n);

  -- ---- readings_archive (phase 10) -----------------------------------------------------
  -- The seam: hour 0 now lives ONLY in readings_hourly, hour 1 ONLY in readings. One series,
  -- no gap, and — the thing that would silently double a reported total — no duplicate.
  select count(*) into n from readings_archive('mtr_hist', h0, h0 + interval '2 hours', 3600);
  assert n = 2, format('archive: expected 2 buckets across the seam, got %s', n);

  select count(*) into n from (
    select ts from readings_archive('mtr_hist', h0, h0 + interval '2 hours', 3600)
    group by ts having count(*) > 1) d;
  assert n = 0, format('archive: %s duplicated bucket(s) at the seam', n);

  select power_w into v from readings_archive('mtr_hist', h0, h0 + interval '2 hours', 3600)
   order by ts offset 1 limit 1;
  assert v is null, format('archive: the offline hour must stay a gap, got %s', v);

  begin
    perform readings_archive('mtr_hist', h0, h0 + interval '2 hours', 900);
    raise exception 'archive: should have RAISED for a sub-hour bucket';
  exception when sqlstate '22023' then null;
  end;

  -- ---- building totals retention (phase 11) --------------------------------------------
  select r.rolled, r.deleted into rolled, deleted
    from roll_up_and_prune_building_totals(h0 + interval '1 hour') r;
  assert rolled = 1, format('totals rollup: expected 1 hour rolled, got %s', rolled);
  assert deleted = 60, format('totals rollup: expected 60 rows pruned, got %s', deleted);

  select phase_current_blue_avg is null into ok from building_totals_hourly;
  assert ok, 'totals rollup: phase_current_blue must stay NULL, never 0';

  select energy_kwh_month_max into v from building_totals_hourly;
  assert v = 1.77, format('totals rollup: the month counter must be a MAX (1.77), got %s', v);

  -- ---- prune_anomalies (phase 11) ------------------------------------------------------
  select r.deleted into deleted from prune_anomalies(timestamptz '2025-01-01 00:00:00+00') r;
  assert deleted = 1, format('prune_anomalies: expected 1 old row removed, got %s', deleted);
  select count(*) into n from anomalies;
  assert n = 1, format('prune_anomalies: the in-window row must survive, %s left', n);

  -- ---- generate_monthly_report (phase 12) ----------------------------------------------
  perform generate_monthly_report(date '2026-06-01');

  -- Energy is the sum of DAILY MAXIMA of a counter that resets — not an average, and not a
  -- sum of raw values. Only online samples count, so the high-water mark is minute 59.
  select energy_kwh into v from monthly_reports where device_id = 'mtr_hist';
  assert v = 0.59, format('report: expected energy 0.59 from daily maxima, got %s', v);

  select online_sample_count, expected_sample_count into n, rolled
    from monthly_reports where device_id = 'mtr_hist';
  assert n = 60, format('report: expected 60 observed samples, got %s', n);
  assert rolled = 43200, format('report: June is 30 days = 43200 minutes, got %s', rolled);

  select anomaly_count into n from monthly_building_reports where month = date '2026-06-01';
  assert n = 1, format('report: expected 1 anomaly counted, got %s', n);

  -- 3.57, not the 1.77 in building_totals_hourly: hour 0 has been rolled up and pruned while
  -- hour 1 is still raw, and the month counter's high-water mark across BOTH is 119 * 0.03.
  -- So this assertion is really about the seam — it only holds if the report reads the
  -- rollup and the raw table together, which is the thing most likely to silently regress.
  select energy_kwh into v from monthly_building_reports where month = date '2026-06-01';
  assert v = 3.57, format('report: building energy should span the seam (3.57), got %s', v);

  -- ---- site scoping (phase 19/20) ------------------------------------------------------
  -- The whole point of RM-027: a second deployment can hold its own settings row. Before
  -- phase20 this insert was refused by `check (id = 1)`, which is what made the system
  -- single-building by construction rather than by choice.
  insert into dsm_thresholds (id, site_id, max_total_kw)
  values (2, 'rehearsal-second-site', 9.9);
  select count(*) into n from dsm_thresholds;
  assert n = 2, format('site scoping: two sites must be able to hold thresholds, got %s', n);

  -- ...but still only ONE row per site. Dropping the singleton without replacing it would let
  -- a duplicate appear, and the app's .eq(site_id).maybeSingle() would begin throwing.
  begin
    insert into dsm_thresholds (id, site_id, max_total_kw)
    values (3, 'rehearsal-second-site', 1.1);
    assert false, 'site scoping: a second row for the SAME site must be refused';
  exception when unique_violation then
    null;  -- expected
  end;

  -- The backfill reached every pre-existing row rather than only the ones the app writes.
  select count(*) into n from building_totals where site_id is null;
  assert n = 0, format('site scoping: %s building_totals rows were left unstamped', n);

  -- NOT 120, and the reason is worth keeping: the seed inserts 120 minutes of totals, but the
  -- rollup exercised above already folded hour 0 into `building_totals_hourly` and PRUNED those
  -- 60 raw rows. Asserting 120 here couples this check to the retention behaviour of an
  -- unrelated earlier step, which is exactly how it failed on 2026-08-27. Compare against the
  -- table's own count instead, so this stays true whatever the rollup does.
  select count(*) into n from building_totals;
  select count(*) into n2 from building_totals where site_id = 'mmsu-nberic-care';
  assert n = n2, format('site scoping: %s of %s totals rows are not stamped to this site', n - n2, n);
  assert n > 0, 'site scoping: no totals rows survived, so this assertion proved nothing';

  -- THE ORDERING GUARANTEE, exercised rather than asserted in prose.
  -- These two inserts are shaped exactly like the ones the daemons ALREADY RUNNING on the Pi
  -- send — no site_id at all. They must succeed and be stamped by the column default, because
  -- this file gets applied by hand against a live system whose code has not been redeployed
  -- yet. If this ever fails, applying the migration takes ingestion down within 60 seconds.
  insert into building_totals (ts, total_power_w)
  values (timestamptz '2026-06-09 00:00:00+00', 42);
  select site_id into strict site_of
    from building_totals where ts = timestamptz '2026-06-09 00:00:00+00';
  assert site_of = 'mmsu-nberic-care',
    format('site scoping: a pre-Task-6 totals insert was stamped %L, not the default', site_of);

  -- id 1, not an arbitrary one: `updateHealth` in `server/ingest.mjs` upserts the singleton row
  -- and nothing else, so a test that invents a new id proves something the system never does —
  -- and trips `unique (site_id)`, because with a default only one row per site can exist. That
  -- constraint pair is correct; the first version of this assertion simply modelled the wrong
  -- writer.
  insert into ingestion_health (id, buffered_row_count)
  values (1, 0)
  on conflict (id) do update set buffered_row_count = excluded.buffered_row_count;
  select site_id into strict site_of from ingestion_health where id = 1;
  assert site_of = 'mmsu-nberic-care',
    format('site scoping: a pre-Task-6 health upsert was stamped %L, not the default', site_of);

  -- A site id that does not exist must be refused, or a typo silently orphans a row.
  begin
    insert into building_totals (ts, site_id, total_power_w)
    values (timestamptz '2026-06-05 00:00:00+00', 'no-such-site', 1);
    assert false, 'site scoping: an unknown site_id must be refused by the foreign key';
  exception when foreign_key_violation then
    null;  -- expected
  end;

  raise notice 'all assertions passed';
end $$;
SQL

echo
echo "== REHEARSAL PASSED =="
echo "Every migration applied in order against PostgreSQL 16, and all six functions behaved"
echo "as designed against realistic data — including the live offline failure shape."
