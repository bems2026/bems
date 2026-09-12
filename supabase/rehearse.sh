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

# WAIT ON A REAL QUERY, NOT `pg_isready`. The postgres image runs initdb against a temporary
# server first, and `pg_isready` answers yes to THAT one — so the loop broke, the server then
# shut down to restart for real, and the check immediately after it failed under `set -e`. The
# whole run died at "starting throwaway postgres" with no further output. Observed 2026-09-01,
# intermittently, on runs whose only difference was timing.
#
# A `select 1` over the real socket cannot be answered by the initdb server, and requiring two
# consecutive successes covers the window where it is on its way down.
ready=0
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" psql -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    ready=$((ready + 1))
    [ "$ready" -ge 2 ] && break
  else
    ready=0
  fi
  sleep 1
done
if [ "$ready" -lt 2 ]; then
  echo "postgres never became ready" >&2
  exit 1
fi

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

-- SUPABASE'S OWN DEFAULT PRIVILEGES, reproduced — and this is what makes the privilege
-- assertions in this file mean anything.
--
-- A real Supabase project hands ALL privileges on every new table in `public` to `anon`,
-- `authenticated` and `service_role`. Bare `create role` does not, so until this line a
-- migration that only GRANTED looked correct in the container and left a privilege it never
-- took away on the live project. RM-072q found exactly that: phase38's header said "no UPDATE
-- path" while `authenticated` kept the default one, and neither the schema text test (which
-- reads the grant and is satisfied) nor a service-role probe (which bypasses RLS anyway) could
-- see it.
--
-- With this line the container is the environment the SQL actually lands in, so "revoke before
-- you grant" is enforced here rather than remembered.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL

echo "== applying every migration in order =="
# Filename order is the apply order, and has been since phase4. Globbed rather than listed by
# hand, so a new phase file is rehearsed automatically instead of being forgotten.
for f in "$HERE/schema.sql" $(ls "$HERE"/phase*.sql | sort -V); do
  printf '   %-46s' "$(basename "$f")"
  psql < "$f" >/dev/null
  echo "ok"
done

# RE-APPLYING PHASE37 OVER A DIFFERENT SHAPE.
#
# The loop above proves every file applies to an EMPTY database. That is not the case that broke:
# phase37 was applied, then gained a column, and re-applying it failed with
# `42P13: cannot change return type of existing function` — because `create or replace` cannot
# change a function's OUT parameters. A hand-applied migration gets pasted twice precisely when
# it has changed, so applying to an empty database is the one situation that never happens twice.
#
# This puts a deliberately wrong-shaped function in the way and re-applies the file over it.
echo "== re-applying phase37 over an older function shape =="
psql <<'SQL' >/dev/null
drop function if exists public.report_daily_series(text, date, text);
-- Same name and argument types, different OUT columns: exactly what an earlier version of the
-- file left behind, and what `create or replace` alone refuses to overwrite.
create function public.report_daily_series(p_period text, p_start date, p_tz text)
returns table (local_day date, something_else int)
language sql stable as $stub$ select null::date, null::int $stub$;
SQL
psql < "$HERE/phase37_report_series.sql" >/dev/null
echo "   ok — a shape change re-applies cleanly"

# And plainly twice in a row, which is the ordinary case.
psql < "$HERE/phase37_report_series.sql" >/dev/null
echo "   ok — and again, unchanged"

echo "== seeding =="
psql <<'SQL'
insert into devices (id, display_name, class) values
  ('mtr_hist', 'Historical Meter', 'meter'),
  ('mtr_now',  'Recent Meter',     'meter'),
  -- phase31: the hourly average is time-weighted, and the fixture above cannot tell whether
  -- it is. Every sample there is exactly a minute apart, so a weighted mean and a plain one
  -- agree to the last digit and the rehearsal would pass a broken weighting.
  ('mtr_uneven', 'Uneven Cadence Meter', 'meter'),
  ('mtr_nulls',  'Online With No Power', 'meter')
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

-- phase31 FIXTURE A — unequal gaps, inside hour 0, with an exactly computable answer.
--   00:00:00  100 W   weight 60  (no predecessor: the nominal-interval default)
--   00:00:30  100 W   weight 30
--   00:01:00  100 W   weight 30
--   00:02:00  400 W   weight 60
--   00:32:00 1000 W   weight 300 (a 1,800 s gap, CAPPED)
-- weighted = (6000 + 3000 + 3000 + 24000 + 300000) / 480 = 700 exactly.
-- A plain mean would be 340; an uncapped weight would be 927.27. All three differ, so the
-- assertion below distinguishes the fix from both of the ways it could be got wrong.
insert into readings (device_id, ts, voltage, current, power_w, energy_kwh_today, online)
values ('mtr_uneven', timestamptz '2026-06-01 00:00:00+00', 220, 1.0,  100, 0.01, true),
       ('mtr_uneven', timestamptz '2026-06-01 00:00:30+00', 220, 1.0,  100, 0.01, true),
       ('mtr_uneven', timestamptz '2026-06-01 00:01:00+00', 220, 1.0,  100, 0.01, true),
       ('mtr_uneven', timestamptz '2026-06-01 00:02:00+00', 220, 1.0,  400, 0.01, true),
       ('mtr_uneven', timestamptz '2026-06-01 00:32:00+00', 220, 1.0, 1000, 0.01, true);

-- phase31 FIXTURE B — online with a NULL reading, which a light switch is every minute of
-- every hour. The null sample's weight must not enter the denominator:
--   weighted = (100 x 60) / 60 = 100.  Counting the null row's weight would give 50.
insert into readings (device_id, ts, voltage, current, power_w, energy_kwh_today, online)
values ('mtr_nulls', timestamptz '2026-06-01 00:00:00+00', 220, 1.0, null, 0.01, true),
       ('mtr_nulls', timestamptz '2026-06-01 00:01:00+00', 220, 1.0,  100, 0.01, true);

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
  n int; n2 int; v numeric; rolled int; deleted int; ok boolean; site_of text; txt text; backfill_month date;
  n_bldg  uuid := gen_random_uuid();
  n_floor uuid := gen_random_uuid();
  n_room  uuid := gen_random_uuid();
  n_desk  uuid := gen_random_uuid();
  site_of_node uuid;
  n3 int; v2 numeric;
  t_floor uuid := gen_random_uuid();
  t_lab   uuid := gen_random_uuid();
  t_empty uuid := gen_random_uuid();
  p_room  uuid := gen_random_uuid();
  p_other uuid := gen_random_uuid();
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
  -- Three device-hours now: mtr_hist plus phase31's two fixtures, all inside hour 0.
  assert rolled = 3, format('rollup: expected 3 device-hours rolled, got %s', rolled);
  assert deleted = 67, format('rollup: expected 67 raw rows pruned (60 + 5 + 2), got %s', deleted);

  select online_sample_count into n from readings_hourly where device_id = 'mtr_hist';
  assert n = 60, format('rollup: expected 60 online samples in the bucket, got %s', n);

  -- ---- phase31: the hourly average is weighted by the time each sample represents --------
  select power_w_avg into v from readings_hourly where device_id = 'mtr_uneven';
  assert v = 700, format(
    'phase31: expected the time-weighted average 700, got %s (a plain mean gives 340; an uncapped weight gives 927.27)', v);

  -- The maximum is deliberately NOT weighted — a maximum has no weight.
  select power_w_max into v from readings_hourly where device_id = 'mtr_uneven';
  assert v = 1000, format('phase31: power_w_max must stay a plain max, got %s', v);

  select power_w_avg into v from readings_hourly where device_id = 'mtr_nulls';
  assert v = 100, format(
    'phase31: a null reading must not contribute weight to the denominator; expected 100, got %s (50 means it did)', v);

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

  -- WHAT THE ORDERING GUARANTEE BECAME. Until phase22 this block asserted the opposite: that a
  -- writer sending NO site_id still succeeded, stamped by phase20's transitional default. That
  -- was the entire safety argument for applying phase20 by hand to a running system whose
  -- daemons predated RM-027's Task 6, and the rehearsal proved it before it mattered.
  --
  -- Task 6 shipped, phase22 drops the default, and the property is now deliberately false. The
  -- invariant worth pinning has inverted: a writer that forgets its site is REFUSED rather than
  -- silently attributed to whichever site happened to be the default. In a shared project that
  -- silent attribution is the worse failure — wrong data recorded confidently beats a write that
  -- fails loudly, and only one of the two gets noticed.
  begin
    insert into building_totals (ts, total_power_w)
    values (timestamptz '2026-06-09 00:00:00+00', 42);
    assert false, 'site scoping: a totals write with no site_id must be refused once the default is gone';
  exception when not_null_violation then
    null;  -- expected
  end;

  -- The singleton health row keeps its site through an upsert that does not mention one: the
  -- row already carries it from phase20's backfill, and ON CONFLICT DO UPDATE touches only the
  -- columns it names. Worth asserting because `updateHealth` writes exactly this shape.
  update ingestion_health set buffered_row_count = 0 where id = 1;
  select site_id into strict site_of from ingestion_health where id = 1;
  assert site_of = 'mmsu-nberic-care',
    format('site scoping: the health row lost its site through an update, now %L', site_of);

  -- A site id that does not exist must be refused, or a typo silently orphans a row.
  begin
    insert into building_totals (ts, site_id, total_power_w)
    values (timestamptz '2026-06-05 00:00:00+00', 'no-such-site', 1);
    assert false, 'site scoping: an unknown site_id must be refused by the foreign key';
  exception when foreign_key_violation then
    null;  -- expected
  end;

  -- ---- the space tree (phase 21) --------------------------------------------------------
  -- The point of RM-028 is a hierarchy that BENDS. These assertions are about the shape staying
  -- open and about the two ways a self-referencing table can hurt you: a cycle, and a delete
  -- taking more than it should.
  insert into space_nodes (id, site_id, parent_id, kind, name)
  values (n_bldg, 'mmsu-nberic-care', null,   'building', 'NBERIC'),
         (n_floor, 'mmsu-nberic-care', n_bldg, 'floor',    'Ground'),
         (n_room,  'mmsu-nberic-care', n_floor,'room',     'CARE Office'),
         (n_desk,  'mmsu-nberic-care', n_room, 'sub_area', 'Desk Row A');

  -- A subtree is the node plus everything beneath it, depth-annotated from the root asked for.
  select count(*) into n from space_subtree(n_bldg);
  assert n = 4, format('space tree: subtree of the building should be 4 nodes, got %s', n);

  select depth into n from space_subtree(n_bldg) where id = n_desk;
  assert n = 3, format('space tree: the sub-area is 3 levels under the building, got %s', n);

  -- Asking from halfway down returns only that branch, re-based to depth 0. This is what makes
  -- "this floor's devices" answerable without loading the whole site.
  select count(*) into n from space_subtree(n_room);
  assert n = 2, format('space tree: subtree of the room should be 2 nodes, got %s', n);

  -- A DEPTH THAT IS NOT FIXED BY THE SCHEMA is the whole design decision. Four levels here;
  -- a site that is one room is equally legal, and neither needed a migration.
  select count(distinct kind) into n from space_subtree(n_bldg);
  assert n = 4, format('space tree: four different kinds should coexist, got %s', n);

  -- Two rooms called the same thing under one floor are indistinguishable in a picker.
  begin
    insert into space_nodes (site_id, parent_id, kind, name)
    values ('mmsu-nberic-care', n_floor, 'room', 'care office');  -- differs only in case
    assert false, 'space tree: a duplicate sibling name must be refused, case-insensitively';
  exception when unique_violation then
    null;  -- expected
  end;

  -- THE CYCLE GUARD, and it is the reason the RPC carries a depth limit at all. parent_id is
  -- user-editable and nothing stops A -> B -> A. An unbounded recursive CTE against a cycle does
  -- not raise — it runs until something gives out, which on the Pi means taking the database
  -- with it. This assertion is really "does this terminate at all".
  update space_nodes set parent_id = n_desk where id = n_bldg;
  select count(*) into n from space_subtree(n_bldg);
  assert n <= 200, format('space tree: a cycle must terminate, got %s rows', n);
  -- ...and terminate BECAUSE of the depth cap, not by luck. The walk uses UNION ALL, so a cycle
  -- has nothing to deduplicate it: reaching exactly the cap is the evidence that the limit is
  -- what stopped it. Worth pinning, because the neuter-check for this guard is a hang rather
  -- than a red test, and a hang is the one failure nobody wants to discover on the Pi.
  select max(depth) into n from space_subtree(n_bldg);
  assert n = 32, format('space tree: the cycle should stop at the depth cap, reached %s', n);
  update space_nodes set parent_id = null where id = n_bldg;   -- put it back

  -- Deleting a floor takes its rooms. The alternative is nodes stranded with a dangling parent,
  -- invisible to every subtree query and impossible to find in the UI.
  insert into device_config (device_id, space_node_id) values ('mtr_now', n_desk)
    on conflict (device_id) do update set space_node_id = excluded.space_node_id;
  delete from space_nodes where id = n_floor;
  select count(*) into n from space_nodes where id in (n_room, n_desk);
  assert n = 0, format('space tree: deleting a floor must take its subtree, %s survived', n);

  -- ...but it must NOT take the device's metadata with it. A device outliving its room is
  -- ordinary; rooms get restructured while the hardware stays screwed to the wall. Cascading
  -- here would silently discard a load-shed tier somebody chose deliberately.
  select count(*) into n from device_config where device_id = 'mtr_now';
  assert n = 1, 'space tree: deleting a room must not delete the device metadata in it';
  select space_node_id into site_of_node from device_config where device_id = 'mtr_now';
  assert site_of_node is null, 'space tree: the placement should be cleared, not dangling';

  -- ---- node_totals (phase 22) -----------------------------------------------------------
  -- The arithmetic is the easy half. These assertions are mostly about the honesty rule: a
  -- meter that stops reporting keeps its last value in `readings`, so anything that averages
  -- offline rows charts a frozen figure as though it were measured (RM-024, EX-107).
  insert into space_nodes (id, site_id, parent_id, kind, name)
  values (t_floor, 'mmsu-nberic-care', null,    'floor', 'Totals Floor'),
         (t_lab,   'mmsu-nberic-care', t_floor, 'room',  'Totals Lab'),
         (t_empty, 'mmsu-nberic-care', t_floor, 'room',  'Totals Empty Room');

  insert into device_config (device_id, space_node_id) values ('mtr_now', t_lab)
    on conflict (device_id) do update set space_node_id = excluded.space_node_id;

  -- Four samples in one minute: two observed at 100 and 300, two OFFLINE carrying a frozen 999.
  -- If offline rows counted, the average would be 599.5 and the peak 999 — both plausible, both
  -- never measured. That is the exact failure this rule exists to prevent.
  insert into readings (device_id, ts, power_w, online) values
    ('mtr_now', h0 + interval '400 minutes', 100, true),
    ('mtr_now', h0 + interval '401 minutes', 300, true),
    ('mtr_now', h0 + interval '402 minutes', 999, false),
    ('mtr_now', h0 + interval '403 minutes', 999, false);

  select avg_power_w, peak_power_w, sample_count, online_sample_count, device_count
    into v, v2, n, n2, n3
    from node_totals(t_lab, h0 + interval '399 minutes', h0 + interval '410 minutes');
  assert v = 200, format('node_totals: average must ignore offline rows, got %s', v);
  assert v2 = 300, format('node_totals: peak must ignore the frozen 999, got %s', v2);
  assert n = 4,  format('node_totals: all 4 rows should be counted as considered, got %s', n);
  assert n2 = 2, format('node_totals: only 2 were observed, got %s', n2);
  assert n3 = 1, format('node_totals: one device is placed in the lab, got %s', n3);

  -- A FLOOR MUST INCLUDE ITS ROOMS. A subtree walk that stopped at the node clicked would read
  -- zero at every site that has floors, and would look like a working feature.
  select avg_power_w into v from node_totals(t_floor, h0 + interval '399 minutes', h0 + interval '410 minutes');
  assert v = 200, format('node_totals: a floor must include its rooms, got %s', v);

  -- THE SINGLE MOST IMPORTANT ASSERTION IN THIS BLOCK. A room with no devices, and a window
  -- with no observed samples, must report NULL — not 0. `sum()` over no rows is already NULL in
  -- Postgres; a coalesce anywhere in that function would turn "we saw nothing" into "it drew
  -- nothing", which is the never-zero rule violated at a new layer.
  select avg_power_w, peak_power_w, device_count into v, v2, n3
    from node_totals(t_empty, h0 + interval '399 minutes', h0 + interval '410 minutes');
  assert v is null,  format('node_totals: an empty room must report NULL power, got %s', v);
  assert v2 is null, format('node_totals: an empty room must report NULL peak, got %s', v2);
  assert n3 = 0,     format('node_totals: an empty room has no devices, got %s', n3);

  -- ...and a room WITH a device but no observed samples in the window is the same answer for a
  -- different reason. Worth separating: this is the "everything went offline" case, and it must
  -- not be distinguishable from zero draw by accident.
  select avg_power_w, online_sample_count into v, n2
    from node_totals(t_lab, h0 + interval '402 minutes', h0 + interval '404 minutes');
  assert n2 = 0, format('node_totals: that window holds only offline rows, got %s observed', n2);
  assert v is null, format('node_totals: all-offline must report NULL, not 0, got %s', v);

  -- The window is half-open: `since` inclusive, `until` exclusive. Asserted because an
  -- off-by-one here double-counts the boundary sample in adjacent windows.
  select sample_count into n from node_totals(t_lab, h0 + interval '400 minutes', h0 + interval '401 minutes');
  assert n = 1, format('node_totals: a one-minute window holds exactly its start sample, got %s', n);

  -- Deleting the room clears the placement (phase21, on delete set null), so the device stops
  -- being counted anywhere rather than lingering in a subtree that no longer exists.
  delete from space_nodes where id = t_floor;
  select device_count into n3 from node_totals(t_lab, h0 + interval '399 minutes', h0 + interval '410 minutes');
  assert n3 = 0, format('node_totals: a deleted subtree counts nothing, got %s', n3);


  -- ---- plan coordinates (phase 23) -------------------------------------------------------
  -- The arithmetic here is trivial; every assertion is about a plan that would still LOOK like
  -- a plan while being wrong. Half a placement, a coordinate outside the frame, or a position
  -- carried into a room the device has never been in all render as confidently as a surveyed
  -- one — which is why they are rejected in the database rather than checked in the renderer.
  insert into space_nodes (id, site_id, parent_id, kind, name)
  values (p_room,  'mmsu-nberic-care', null, 'room', 'Plan Room'),
         (p_other, 'mmsu-nberic-care', null, 'room', 'Plan Room Two');

  insert into device_config (device_id, space_node_id, plan_x, plan_y) values ('mtr_now', p_room, 0.25, 0.75)
    on conflict (device_id) do update
      set space_node_id = excluded.space_node_id, plan_x = excluded.plan_x, plan_y = excluded.plan_y;

  select plan_x, plan_y into v, v2 from device_config where device_id = 'mtr_now';
  assert v = 0.25 and v2 = 0.75, format('plan coords: expected 0.25/0.75 to survive the write, got %s/%s', v, v2);

  -- Half a placement: the renderer would have to invent the missing axis, and whatever it
  -- invented would look exactly as deliberate as a position somebody chose.
  ok := true;
  begin
    update device_config set plan_y = null where device_id = 'mtr_now';
    ok := false;
  exception when check_violation then null; end;
  assert ok, 'plan coords: one axis without the other must be rejected';

  -- Outside 0..1 is not a position in this room.
  ok := true;
  begin
    update device_config set plan_x = 1.5 where device_id = 'mtr_now';
    ok := false;
  exception when check_violation then null; end;
  assert ok, 'plan coords: a coordinate outside the frame must be rejected';

  -- A position with no room to be a position in.
  ok := true;
  begin
    insert into device_config (device_id, space_node_id, plan_x, plan_y) values ('mtr_hist', null, 0.5, 0.5);
    ok := false;
  exception when check_violation then null; end;
  assert ok, 'plan coords: coordinates without a space node must be rejected';

  -- THE QUIET ONE. Moving a device to another room must discard where it was in the old one.
  -- Carried over, it would appear in the new room at a spot nobody chose, drawn with exactly
  -- the same confidence as a position an operator dragged it to. This is the shape the device
  -- editor's whole-row upsert actually produces: every column resent, including the position
  -- surveyed for the room being left.
  update device_config set space_node_id = p_other where device_id = 'mtr_now';
  select plan_x, plan_y into v, v2 from device_config where device_id = 'mtr_now';
  assert v is null and v2 is null, format('plan coords: a move must clear the position, got %s/%s', v, v2);

  -- ...but a move that CHOOSES a position for the new room keeps it. Placing a device and
  -- positioning it in one statement is what an import and a provisioning script both look like,
  -- and the first rehearsal of this file caught the trigger clearing exactly that. The two
  -- cases differ in one observable way: a carried-over payload has not changed the coordinates.
  update device_config set space_node_id = p_room, plan_x = 0.4, plan_y = 0.6 where device_id = 'mtr_now';
  select space_node_id, plan_x, plan_y into site_of_node, v, v2 from device_config where device_id = 'mtr_now';
  assert site_of_node = p_room, 'plan coords: the move itself should have happened';
  assert v = 0.4 and v2 = 0.6, format('plan coords: a move that sets its own position must keep it, got %s/%s', v, v2);

  -- ...and a write that does NOT move the device must keep them, or dragging a pin would clear
  -- the very thing it just set. The trigger fires on every update; only a move may act.
  update device_config set space_node_id = p_room, plan_x = 0.1, plan_y = 0.2 where device_id = 'mtr_now';
  select plan_x, plan_y into v, v2 from device_config where device_id = 'mtr_now';
  assert v = 0.1 and v2 = 0.2, format('plan coords: a same-room write must keep the position, got %s/%s', v, v2);

  -- Deleting the room is a move too — phase21's `on delete set null` performs an UPDATE. This
  -- is the case that makes the trigger necessary rather than merely tidy: without it, the
  -- "coordinates need a node" constraint would reject that update and the room could not be
  -- deleted at all.
  delete from space_nodes where id = p_room;
  select space_node_id, plan_x, plan_y into site_of_node, v, v2 from device_config where device_id = 'mtr_now';
  assert site_of_node is null, 'plan coords: deleting the room should clear the placement';
  assert v is null and v2 is null, format('plan coords: deleting the room must clear the position too, got %s/%s', v, v2);


  -- ---- set_acu_min_setpoint (phase 26) -------------------------------------------------
  -- The function exists so an administrative decision stops being a code change. These check
  -- that it changes the ONE key it is allowed to and leaves the rest of the policy alone —
  -- which is the whole argument for a definer function over an UPDATE policy.
  -- Seeded here rather than assumed: phase19's insert does not carry `dispatch`, so an
  -- assertion that it survives would have passed against a key that was never there.
  update sites set policy = policy || '{"dispatch":"local-first"}'::jsonb where id = 'mmsu-nberic-care';

  perform set_acu_min_setpoint('mmsu-nberic-care', 24);
  select (policy ->> 'acu_min_setpoint_c')::int into n from sites where id = 'mmsu-nberic-care';
  assert n = 24, format('setpoint: expected the floor to become 24, got %s', n);

  -- THE ASSERTION THIS FUNCTION EXISTS FOR. `dispatch` decides whether commands may leave the
  -- building for the vendor cloud. If a setpoint change could disturb it, the function would be
  -- no safer than the UPDATE policy phase19 refused to grant.
  select policy ->> 'dispatch' into txt from sites where id = 'mmsu-nberic-care';
  assert txt = 'local-first', format('setpoint: dispatch must be untouched, got %s', txt);

  select policy_updated_at is not null into ok from sites where id = 'mmsu-nberic-care';
  assert ok, 'setpoint: a policy change must be stamped with when it happened';

  -- NULL removes the key rather than storing a JSON null: "no policy floor" and "a floor of
  -- null" would read the same to `policy ->> ...` but not to anything asking whether the key
  -- is present, and the site file's own convention is absence.
  perform set_acu_min_setpoint('mmsu-nberic-care', null);
  select policy ? 'acu_min_setpoint_c' into ok from sites where id = 'mmsu-nberic-care';
  assert not ok, 'setpoint: null must REMOVE the key, not store a null under it';
  select policy ->> 'dispatch' into txt from sites where id = 'mmsu-nberic-care';
  assert txt = 'local-first', 'setpoint: removing the floor must not remove the dispatch mode';

  -- Out of range is refused. The hardware bound in shared/commands.mjs is the real authority;
  -- this is a sanity check on a number a person typed into a settings field.
  begin
    perform set_acu_min_setpoint('mmsu-nberic-care', 12);
    assert false, 'setpoint: 12 is below the hardware minimum and must be refused';
  exception when check_violation then
    null;  -- expected
  end;
  begin
    perform set_acu_min_setpoint('mmsu-nberic-care', 31);
    assert false, 'setpoint: 31 is above the hardware maximum and must be refused';
  exception when check_violation then
    null;  -- expected
  end;

  -- A typo in a site id must not silently succeed against zero rows, which is what a bare
  -- UPDATE would have done.
  begin
    perform set_acu_min_setpoint('no-such-site', 25);
    assert false, 'setpoint: an unknown site must raise, not update nothing quietly';
  exception when no_data_found then
    null;  -- expected
  end;

  -- Put it back, so anything after this sees the site as seeded.
  perform set_acu_min_setpoint('mmsu-nberic-care', 25);


  -- ---- generate_period_report (phase 27) -----------------------------------------------
  --
  -- The migration's own backfill loop is a NO-OP here and correctly so: it runs while the
  -- migrations are applying, and `generate_monthly_report` is not called until this assertion
  -- block, so there are no months to backfill yet. (On the live database there are, which is the
  -- case it exists for.) The loop body is therefore exercised here instead — the same statement
  -- the migration runs, over the month generated above.
  --
  -- Finding this took the second assertion below rather than the first: an empty join satisfies
  -- "no rows disagree" perfectly.
  -- BOTH are regenerated here, deliberately. `generate_monthly_report` was called much earlier
  -- in this block, and the sections between then and now seed more devices and more rows — so
  -- comparing its output against a fresh run of the new function compared two different
  -- INSTANTS, not two functions. It read "backfilled 2 month rows against 1", which looks like a
  -- disagreement and was an experiment with a moving fixture.
  for backfill_month in select distinct month from monthly_building_reports order by month loop
    perform generate_monthly_report(backfill_month);
    perform generate_period_report('month', backfill_month);
  end loop;
  --
  -- THE ASSERTION THIS WHOLE FILE RESTS ON. phase27 generalises phase12's aggregation rather
  -- than copying it, and backfills every existing month through the new function. If the two
  -- disagree by so much as a rounding, the backfill has quietly rewritten history — and every
  -- number on the Reports page would still look entirely plausible.
  --
  -- Compared row for row and column for column, not just on the headline figure.
  select count(*) into n
    from monthly_reports m
    join period_reports p
      on p.period = 'month' and p.period_start = m.month and p.device_id = m.device_id
   where m.energy_kwh            is distinct from p.energy_kwh
      or m.peak_power_w          is distinct from p.peak_power_w
      or m.avg_power_w           is distinct from p.avg_power_w
      or m.online_sample_count   is distinct from p.online_sample_count
      or m.expected_sample_count is distinct from p.expected_sample_count;
  assert n = 0, format('period report: %s device row(s) disagree with the phase12 report', n);

  -- ...and every row is actually there. A join that matched nothing would satisfy the check
  -- above vacuously, which is exactly how a backfill that ran zero times would pass.
  select count(*) into n from monthly_reports;
  select count(*) into n2 from period_reports where period = 'month';
  assert n = n2 and n > 0,
    format('period report: backfilled %s month rows against %s in phase12', n2, n);

  select count(*) into n
    from monthly_building_reports m
    join period_building_reports p
      on p.period = 'month' and p.period_start = m.month
   where m.energy_kwh         is distinct from p.energy_kwh
      or m.peak_total_power_w is distinct from p.peak_total_power_w
      or m.avg_voltage        is distinct from p.avg_voltage
      or m.command_count      is distinct from p.command_count
      or m.anomaly_count      is distinct from p.anomaly_count
      or m.online_sample_count is distinct from p.online_sample_count;
  assert n = 0, format('period report: %s building row(s) disagree with the phase12 report', n);

  -- ---- and now the thing this was all for: a week ---------------------------------------
  -- 2026-06-01 was a Monday, so the seeded fixtures fall in the week beginning that day.
  perform generate_period_report('week', date '2026-06-03');

  -- Truncated, not taken as given. A caller passing a Wednesday must get that WEEK, or two
  -- callers would write two different rows for the same seven days.
  select count(*) into n from period_reports where period = 'week' and period_start = date '2026-06-01';
  assert n > 0, 'period report: a mid-week date must resolve to that week''s Monday';
  select count(*) into n from period_reports where period = 'week' and period_start = date '2026-06-03';
  assert n = 0, 'period report: nothing may be stored under the date that was passed in';

  -- A week is 7 * 24 * 60 minutes, and the expectation is derived from the window rather than
  -- assumed — the same reason phase12 derives a month's length instead of assuming 30 days.
  select expected_sample_count into n from period_reports
   where period = 'week' and period_start = date '2026-06-01' and device_id = 'mtr_hist';
  assert n = 10080, format('period report: a week is 10080 minutes, got %s', n);

  -- The week and the month over the same fixtures see the same samples, because every seeded
  -- reading falls inside both. Energy too: it is a sum of daily maxima, and the days are shared.
  select online_sample_count into n from period_reports
   where period = 'week' and period_start = date '2026-06-01' and device_id = 'mtr_hist';
  assert n = 60, format('period report: expected the week to see 60 observed samples, got %s', n);
  select energy_kwh into v from period_reports
   where period = 'week' and period_start = date '2026-06-01' and device_id = 'mtr_hist';
  assert v = 0.59, format('period report: expected week energy 0.59 from daily maxima, got %s', v);

  -- A FROZEN METER MUST NOT BE COUNTED TWICE. `building_totals` has no `online` column, so a
  -- meter that goes offline keeps reporting its last value and there is nothing to filter it out
  -- with. Two days here carry an IDENTICAL month counter — the frozen signature measured on the
  -- live building — and the week's energy must treat the second as zero consumption rather than
  -- as another day of it.
  --
  -- Seeded straight into the hourly rollup so this is about the energy expression and not about
  -- the raw/rollup seam, which the assertions above already cover.
  insert into building_totals_hourly (hour, total_power_w_avg, total_power_w_max, avg_voltage_avg,
    phase_current_red_avg, phase_current_yellow_avg, phase_current_blue_avg,
    energy_kwh_today_max, energy_kwh_week_max, energy_kwh_month_max, sample_count)
  values
    -- Wed 2026-06-10 local: the counter reaches 10.
    (timestamptz '2026-06-10 04:00:00+00', 100, 120, 230, 1, 1, null, 10, 10, 10, 60),
    -- Thu 2026-06-11: byte-identical. The meter froze.
    (timestamptz '2026-06-11 04:00:00+00', 100, 120, 230, 1, 1, null, 10, 10, 10, 60),
    -- Fri 2026-06-12: it comes back and the counter advances by 4.
    (timestamptz '2026-06-12 04:00:00+00', 100, 120, 230, 1, 1, null, 4, 14, 14, 60)
  on conflict (hour) do nothing;

  perform generate_period_report('week', date '2026-06-08');
  select energy_kwh into v from period_building_reports
   where period = 'week' and period_start = date '2026-06-08';
  -- 14, not 24. Summing the DAILY counter's maxima would give 10 + 10 + 4 = 24, counting the
  -- frozen day as a second full day of consumption. Increments of the month counter give
  -- 10 + 0 + 4 = 14, which is what the building actually used.
  assert v = 14, format('period report: a frozen day must add nothing to a week, got %s (24 means the freeze was counted)', v);

  -- A WEEK IS AN INCREMENT, NOT A RUNNING TOTAL. An earlier version of this block asserted that
  -- a week's energy must DIFFER from the month's, which was right for the daily-maxima design it
  -- was written against and is wrong for increments: a month whose data all falls inside one week
  -- legitimately reports the same figure for both. Asserting inequality there would have been
  -- asserting that the two disagree, which is not a property worth having.
  --
  -- What is worth having is the frozen-day check above, which is the failure this expression
  -- actually had, and this: the LATER week must report only what the counter gained during it,
  -- never the month-to-date it inherited.
  select energy_kwh into v from period_building_reports
   where period = 'week' and period_start = date '2026-06-08';
  assert v is not null, 'period report: a week must report some building energy';
  assert v < 24, format('period report: %s means the week absorbed the frozen day or the running total', v);

  -- Regenerating is an upsert, not a duplicate key. A report rebuilt after more of its period
  -- has been rolled up is built from MORE data, so the newer answer replaces the older one.
  perform generate_period_report('week', date '2026-06-01');
  select count(*) into n from period_reports
   where period = 'week' and period_start = date '2026-06-01' and device_id = 'mtr_hist';
  assert n = 1, format('period report: regenerating must upsert, found %s rows', n);

  -- A week and a month starting on the same day are different rows, not one overwriting the
  -- other. This is what the `period` column is for, and a primary key that omitted it would
  -- silently make the second generation clobber the first.
  select count(*) into n from period_reports
   where period_start = date '2026-06-01' and device_id = 'mtr_hist';
  assert n = 2, format('period report: week and month must coexist for one start date, got %s', n);

  -- An unknown period raises rather than writing a row nothing will ever read.
  begin
    perform generate_period_report('fortnight', date '2026-06-01');
    assert false, 'period report: an unknown period must raise';
  exception when invalid_parameter_value then
    null;  -- expected
  end;
  begin
    insert into period_reports (period, period_start, device_id, online_sample_count, expected_sample_count)
    values ('fortnight', date '2026-06-01', 'mtr_hist', 0, 0);
    assert false, 'period report: the check constraint must refuse an unknown period';
  exception when check_violation then
    null;  -- expected
  end;

  raise notice 'all assertions passed';
end $$;

-- ---- phase37: the series behind the charts -------------------------------------------------
--
-- Its own block, with its own declarations, so it cannot collide with the variables above.
--
-- The fixtures it reads were seeded for other assertions, which is what makes them worth
-- reading: 2026-06-01 carries 120 minutes split across the raw/rollup seam, and 2026-06-10..12
-- carry the frozen-meter signature measured on the live building. June therefore has four
-- observed days out of thirty, which is the shape a real month here actually has.
do $$
declare
  rows_n     int;
  observed_n int;
  v          numeric;
  month_kwh  numeric;
  daily_sum  numeric;
  txt        text;
begin
  -- Regenerate the month first. The backfill loop above ran BEFORE 2026-06-10..12 were seeded,
  -- so the stored row predates half the fixture — comparing against it as-is would compare two
  -- different instants, which is the trap the phase27 block above already documents paying for.
  perform generate_period_report('month', date '2026-06-01');

  -- ---- report_daily_series ------------------------------------------------------------------

  select count(*) into rows_n from report_daily_series('month', date '2026-06-01', 'Asia/Manila');
  assert rows_n = 30, format('daily series: June has 30 days, got %s rows', rows_n);

  -- THE ASSERTION THIS FUNCTION EXISTS FOR. A chart whose bars sum to something other than the
  -- total printed above them is worse than no chart, and the two are computed by different
  -- expressions in different functions — the month takes `max(energy_kwh_month_max)`, the daily
  -- series sums per-day increments of the same counter. They must agree, and nothing but this
  -- checks that they do.
  select sum(energy_kwh) into daily_sum from report_daily_series('month', date '2026-06-01', 'Asia/Manila');
  select energy_kwh into month_kwh from period_building_reports
   where period = 'month' and period_start = date '2026-06-01';
  assert daily_sum = month_kwh,
    format('daily series: the days sum to %s but the month reports %s', daily_sum, month_kwh);

  -- A FROZEN DAY CONTRIBUTES NOTHING. 2026-06-11's counter is byte-identical to the 10th's.
  -- Summing the daily counter's maxima instead of its increments would score it as another full
  -- day of consumption — the defect phase27 measured on the live building.
  select energy_kwh into v from report_daily_series('month', date '2026-06-01', 'Asia/Manila')
   where local_day = date '2026-06-11';
  assert v = 0, format('daily series: the frozen day must add 0, got %s', v);

  -- AN UNOBSERVED DAY IS A ROW WITH NO ENERGY, NOT AN ABSENT ROW AND NOT A ZERO. This is the
  -- one server/baselineReport.mjs found in its first real output: "2026-06-18 sat between the
  -- 17th and the 19th and simply was not there" — the quietest possible way to lose an outage
  -- from a document going to a university.
  select count(*) into observed_n from report_daily_series('month', date '2026-06-01', 'Asia/Manila')
   where sample_count > 0;
  assert observed_n = 4, format('daily series: 4 of June was observed, got %s', observed_n);

  select energy_kwh into v from report_daily_series('month', date '2026-06-01', 'Asia/Manila')
   where local_day = date '2026-06-20';
  assert v is null, format('daily series: an unobserved day must be NULL, got %s', v);

  select peak_power_w into v from report_daily_series('month', date '2026-06-01', 'Asia/Manila')
   where local_day = date '2026-06-20';
  assert v is null, 'daily series: an unobserved day has no peak, and 0 W is a different claim';

  -- The COUNT may be zero, because nobody observed it zero times and that is true.
  select sample_count into rows_n from report_daily_series('month', date '2026-06-01', 'Asia/Manila')
   where local_day = date '2026-06-20';
  assert rows_n = 0, format('daily series: sample_count is a count and must be 0, got %s', rows_n);

  -- A whole day in the past would have held 1440 samples. Derived, never assumed.
  select expected_samples into rows_n from report_daily_series('month', date '2026-06-01', 'Asia/Manila')
   where local_day = date '2026-06-20';
  assert rows_n = 1440, format('daily series: a past day expects 1440 minutes, got %s', rows_n);

  -- 2026-06-01 was observed 08:00-09:59 local. A day marked partial without saying WHICH hours
  -- it saw is a caveat the reader cannot act on.
  select first_seen_minute into rows_n from report_daily_series('month', date '2026-06-01', 'Asia/Manila')
   where local_day = date '2026-06-01';
  assert rows_n = 480, format('daily series: first sight was 08:00 local = minute 480, got %s', rows_n);

  -- ---- report_hour_profile ------------------------------------------------------------------

  select count(*) into rows_n from report_hour_profile('month', date '2026-06-01', 'Asia/Manila');
  assert rows_n = 24, format('hour profile: always 24 hours, got %s', rows_n);

  -- Hour 09 local is 01:00 UTC, which is still raw: 60 minute-samples.
  select n into rows_n from report_hour_profile('month', date '2026-06-01', 'Asia/Manila')
   where local_hour = 9;
  assert rows_n = 60, format('hour profile: hour 09 local should hold 60 samples, got %s', rows_n);

  -- Hour 03 local was never observed. NOT 0 W: the building did not draw nothing at 03:00,
  -- nobody was watching at 03:00, and collapsing those two is the error the system refuses.
  select n into rows_n from report_hour_profile('month', date '2026-06-01', 'Asia/Manila')
   where local_hour = 3;
  assert rows_n = 0, format('hour profile: hour 03 was unobserved, got n = %s', rows_n);
  select p50_w into v from report_hour_profile('month', date '2026-06-01', 'Asia/Manila')
   where local_hour = 3;
  assert v is null, format('hour profile: an unobserved hour has no median, got %s', v);

  -- ---- report_hour_matrix -------------------------------------------------------------------

  select count(*) into rows_n from report_hour_matrix('month', date '2026-06-01', 'Asia/Manila');
  assert rows_n = 720, format('hour matrix: June is 30 x 24 = 720 cells, got %s', rows_n);

  select count(*) into rows_n from report_hour_matrix('month', date '2026-06-01', 'Asia/Manila')
   where sample_count > 0;
  assert rows_n > 0 and rows_n < 720,
    format('hour matrix: some cells observed and some not, got %s of 720', rows_n);

  -- A week is 168 cells, which is also the check that the window really narrows.
  select count(*) into rows_n from report_hour_matrix('week', date '2026-06-01', 'Asia/Manila');
  assert rows_n = 168, format('hour matrix: a week is 7 x 24 = 168 cells, got %s', rows_n);

  -- ---- report_demand_curve ------------------------------------------------------------------

  select count(*) into rows_n from report_demand_curve('month', date '2026-06-01', 'Asia/Manila');
  assert rows_n = 101, format('duration curve: 101 points by default, got %s', rows_n);

  -- It is a DURATION curve, so it must fall: fraction 0 is the peak, fraction 1 the minimum.
  -- Ascending would be a chart that reads exactly backwards and looks entirely plausible.
  select count(*) into rows_n from (
    select power_w, lag(power_w) over (order by pct) as prev
      from report_demand_curve('month', date '2026-06-01', 'Asia/Manila')
  ) s where prev is not null and power_w > prev;
  assert rows_n = 0, format('duration curve: %s point(s) rise; the curve must be non-increasing', rows_n);

  -- Its first point is the period's peak, which is the same figure the period report holds.
  select power_w into v from report_demand_curve('month', date '2026-06-01', 'Asia/Manila') where pct = 0;
  select peak_total_power_w into month_kwh from period_building_reports
   where period = 'month' and period_start = date '2026-06-01';
  assert v = month_kwh, format('duration curve: peak %s disagrees with the report''s %s', v, month_kwh);

  begin
    perform report_demand_curve('month', date '2026-06-01', 'Asia/Manila', 1);
    assert false, 'duration curve: p_points below 2 must raise rather than divide by zero';
  exception when invalid_parameter_value then
    null;  -- expected
  end;

  -- ---- report_demand_summary ----------------------------------------------------------------

  select expected_minutes into rows_n from report_demand_summary('month', date '2026-06-01', 'Asia/Manila');
  assert rows_n = 43200, format('demand summary: June is 30 days = 43200 minutes, got %s', rows_n);

  -- AN OBSERVATION IS AN INTERVAL, NOT AN INSTANT, and this is the assertion that says so.
  -- The fixture holds 60 raw minutes (hour 1 of 06-01), plus four hourly buckets of 60 samples
  -- each — hour 0 of 06-01 after the rollup pruned it, and 06-10, 06-11, 06-12. That is 300
  -- observed minutes. Counting each hourly bucket as a single sample instead gives 64, which is
  -- what the first version of this function returned: a month with no gaps at all would have
  -- reported 1.7% coverage, qualifying every true figure in the document as untrustworthy.
  select observed_minutes into rows_n from report_demand_summary('month', date '2026-06-01', 'Asia/Manila');
  assert rows_n = 300,
    format('demand summary: expected 300 observed minutes, got %s (64 means an hourly bucket was counted as one minute)', rows_n);

  -- The gap that matters: the fixture is observed for two hours on the 1st and then dark until
  -- the 10th. A coverage percentage cannot tell that apart from an evenly-scattered outage, and
  -- this is the figure that can.
  --
  -- It also has to survive the rollup. Measured across raw rows alone — which is how this was
  -- first written — the dark stretch is invisible here, because it lies entirely in the half of
  -- the window that has been pruned into hourly buckets. The rehearsal caught that as a
  -- one-minute gap over a fixture that is dark for eight days.
  select longest_gap_minutes into v from report_demand_summary('month', date '2026-06-01', 'Asia/Manila');
  assert v is not null, 'demand summary: something was observed, so the gap is measurable';
  assert v > 1440,
    format('demand summary: the fixture is dark for over eight days, got a %s minute gap (a small number means the rolled-up half was skipped)', v);

  -- AND THE DARKNESS AT THE ENDS COUNTS. The fixture's last observation is midday on 06-12 and
  -- June runs to the 30th, so the longest stretch nobody was watching is that trailing one — over
  -- 26,000 minutes. Measured only BETWEEN observations, as this was first written, the answer is
  -- the eight-day stretch in the middle instead, and a period that begins or ends dark reports
  -- none of it. Against the live project that version called August 2026 a NINE MINUTE gap while
  -- it sat dark for its first sixteen days.
  assert v > 20000,
    format('demand summary: expected the trailing dark stretch (>20000 min), got %s — the window edges are not being counted', v);

  select p95_w into v from report_demand_summary('month', date '2026-06-01', 'Asia/Manila');
  assert v is not null, 'demand summary: p95 must be computable from the seeded samples';

  -- ---- report_window and report_resolution --------------------------------------------------

  -- Truncated, not taken as given, exactly as generate_period_report is. A mid-month date must
  -- resolve to the month, or the chart and the report describe two different windows.
  select local_start::text into txt from report_window('month', date '2026-06-17', 'Asia/Manila');
  assert txt = '2026-06-01', format('window: a mid-month date must truncate to the 1st, got %s', txt);
  select local_start::text into txt from report_window('week', date '2026-06-03', 'Asia/Manila');
  assert txt = '2026-06-01', format('window: a Wednesday must truncate to its Monday, got %s', txt);

  begin
    perform report_window('fortnight', date '2026-06-01', 'Asia/Manila');
    assert false, 'window: an unknown period must raise rather than return an empty window';
  exception when invalid_parameter_value then
    null;  -- expected
  end;

  -- RESOLUTION SAYS WHAT THE DATA IS MADE OF, NOT HOW MUCH OF IT THERE IS. All three states
  -- exist in this fixture, which is why all three are asserted: an earlier version compared raw
  -- hours against the window's ELAPSED hours, so a month that was entirely raw but half dark
  -- reported 'mixed' — a resolution downgrade describing a coverage gap. It took reading the
  -- live project back to see it, because a fixture is never half a real month.

  -- June holds both: hour 0 of the 1st was rolled up and pruned, hour 1 is still raw.
  select resolution into txt from report_daily_series('month', date '2026-06-01', 'Asia/Manila') limit 1;
  assert txt = 'mixed', format('resolution: June has raw and rolled-up hours, expected mixed, got %s', txt);

  -- The week of the 8th holds only the three hourly buckets seeded for the frozen-meter case.
  select report_resolution(
           (date '2026-06-08'::timestamp at time zone 'Asia/Manila'),
           (date '2026-06-15'::timestamp at time zone 'Asia/Manila')) into txt;
  assert txt = 'hour', format('resolution: that week is hourly buckets only, got %s', txt);

  -- NULL, not 'hour'. With nothing observed at all, resolution is not a claim anyone can make —
  -- the same rule that makes an unobserved hour NULL rather than 0 W.
  select report_resolution(timestamptz '2020-01-01 00:00:00+00', timestamptz '2020-02-01 00:00:00+00') into txt;
  assert txt is null, format('resolution: an empty window has no resolution to report, got %s', txt);

  raise notice 'phase37: all assertions passed';
end $$;

-- ---- phase37: a row is not an observation ---------------------------------------------------
--
-- The fixtures above have no rows that carry nothing, so they cannot exercise the distinction
-- that reading the live project turned up: on 2026-08-18 `building_totals` held 1,414 rows with
-- `total_power_w` NULL and the month counter frozen at the previous day's value. The meters
-- wrote rows; they observed nothing. Counting rows reports that day as 98% covered with a
-- confident 0 kWh bar beside it, which is the most quotable figure in the document and the least
-- true. This block seeds that exact shape.
do $$
declare
  rows_n  int;
  usable  int;
  v       numeric;
begin
  -- 2026-06-20 is dark in every fixture above. Fill it with the frozen signature: real rows,
  -- real timestamps, no power, no voltage, and a counter that does not move.
  insert into building_totals (ts, site_id, energy_kwh_today, energy_kwh_week, energy_kwh_month,
                               total_power_w, avg_voltage, phase_current_red,
                               phase_current_yellow, phase_current_blue)
  select timestamptz '2026-06-19 16:00:00+00' + (n || ' minutes')::interval,
         'mmsu-nberic-care', 14, 14, 14, null, null, null, null, null
    from generate_series(0, 599) n
  on conflict (ts) do nothing;

  select sample_count, usable_sample_count
    into rows_n, usable
    from report_daily_series('month', date '2026-06-01', 'Asia/Manila')
   where local_day = date '2026-06-20';

  assert rows_n = 600,
    format('usable: the day holds 600 rows, got sample_count %s', rows_n);
  assert usable = 0,
    format('usable: none of those rows carries a reading, expected usable_sample_count 0, got %s', usable);

  -- And the figures that depend on a reading stay absent rather than becoming zero.
  select peak_power_w into v from report_daily_series('month', date '2026-06-01', 'Asia/Manila')
   where local_day = date '2026-06-20';
  assert v is null, format('usable: a day with no readings has no peak, got %s', v);
  select avg_power_w into v from report_daily_series('month', date '2026-06-01', 'Asia/Manila')
   where local_day = date '2026-06-20';
  assert v is null, format('usable: a day with no readings has no average, got %s', v);

  -- The matrix agrees, cell by cell.
  select sum(sample_count)::int, sum(usable_sample_count)::int into rows_n, usable
    from report_hour_matrix('month', date '2026-06-01', 'Asia/Manila')
   where local_day = date '2026-06-20';
  assert rows_n = 600 and usable = 0,
    format('usable: the matrix should show 600 rows and 0 usable for that day, got %s and %s', rows_n, usable);

  -- ONLY A USABLE OBSERVATION CLOSES A GAP. Dropping 600 rows carrying nothing into the middle
  -- of a dark stretch must not shorten it — that is the whole point, and it is the shape that
  -- made 2026-08-18 look like a well-covered day.
  select observed_minutes, usable_minutes into rows_n, usable
    from report_demand_summary('month', date '2026-06-01', 'Asia/Manila');
  assert rows_n > usable,
    format('usable: %s observed minutes against %s usable — the frozen rows are not being told apart', rows_n, usable);
  select longest_gap_minutes into v from report_demand_summary('month', date '2026-06-01', 'Asia/Manila');
  assert v > 20000,
    format('usable: rows carrying nothing must not close the gap, got %s', v);

  raise notice 'phase37: a row is not an observation — assertions passed';
end $$;

-- ---- phase38: a rate cannot be edited out from under a report ------------------------------
--
-- The privilege set, asserted against information_schema rather than against the file's text.
-- A `grant` is additive, and Supabase's own default privileges hand ALL on new public tables to
-- `anon`, `authenticated` and `service_role` — so a migration that only grants adds nothing and
-- leaves the UPDATE it believes it withheld. Nothing but this query can see that: the schema
-- text test reads the grant and is satisfied, and a service-role probe bypasses RLS anyway.
do $$
declare
  privs text;
begin
  foreach privs in array array['energy_tariffs', 'emission_factors'] loop
    declare
      got text;
    begin
      select string_agg(distinct privilege_type, ',' order by privilege_type)
        into got
        from information_schema.role_table_grants
       where table_name = privs and grantee = 'authenticated';
      assert got = 'DELETE,INSERT,SELECT',
        format('%s: authenticated holds "%s", expected exactly DELETE,INSERT,SELECT — an UPDATE here lets a rate be edited out from under a report that was priced by it', privs, got);

      select string_agg(distinct privilege_type, ',' order by privilege_type)
        into got
        from information_schema.role_table_grants
       where table_name = privs and grantee in ('anon', 'PUBLIC');
      assert got is null, format('%s: anon/PUBLIC hold "%s" and should hold nothing', privs, got);
    end;
  end loop;

  -- And the constraints that make a figure checkable.
  begin
    insert into energy_tariffs (site_id, effective_from, currency, rate_per_kwh, source)
    values ('mmsu-nberic-care', date '1999-01-01', 'PHP', 11.43, '   ');
    assert false, 'phase38: a rate with a blank source must be refused';
  exception when check_violation then null;
  end;

  begin
    insert into emission_factors (site_id, effective_from, kg_co2e_per_kwh, source)
    values ('mmsu-nberic-care', date '1999-01-01', 12, 'misplaced decimal');
    assert false, 'phase38: an emission factor above 2.0 must be refused';
  exception when check_violation then null;
  end;

  raise notice 'phase38: privileges and constraints — assertions passed';
end $$;

-- ---- phase39: authenticated holds exactly what its policies permit ---------------------------
--
-- THE PRIVILEGE INVARIANT, stated once as a rule rather than as a list of tables — so a table
-- added next year is covered without anybody remembering to add it here.
--
-- For every RLS-enabled table in `public`, the commands `authenticated` is granted must equal
-- the commands that table has a policy for. Postgres needs both, so a privilege with no policy
-- is dead weight RLS happens to be covering — EXCEPT `TRUNCATE`, `REFERENCES` and `TRIGGER`,
-- which row security does not filter at all. RM-074 measured the cost of that: `truncate
-- commands` succeeded as a genuinely switched `authenticated` role and emptied the audit trail.
--
-- This check is only meaningful because this script now reproduces Supabase's own default
-- privileges (see the top of the file). Against a bare `create role` it would pass vacuously.
do $$
declare
  r record;
  bad int := 0;
begin
  for r in
    select c.relname as t,
           coalesce((select string_agg(distinct p.cmd, ',' order by p.cmd)
                       from pg_policies p where p.tablename = c.relname), '') as pol,
           coalesce((select string_agg(distinct g.privilege_type, ',' order by g.privilege_type)
                       from information_schema.role_table_grants g
                      where g.table_name = c.relname and g.grantee = 'authenticated'), '') as grants
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     order by c.relname
  loop
    -- A policy written for ALL would need expanding to the four commands; none exists, and
    -- guessing at one silently is worse than stopping.
    assert position('ALL' in r.pol) = 0,
      format('%s has an ALL policy; this invariant does not know how to expand it', r.t);

    if r.pol is distinct from r.grants then
      bad := bad + 1;
      raise warning 'PRIVILEGE DRIFT %: policies allow [%], authenticated is granted [%]', r.t, r.pol, r.grants;
    end if;
  end loop;

  assert bad = 0,
    format('%s table(s) grant authenticated more than their policies permit — every extra is a TRUNCATE, REFERENCES or TRIGGER that row security does not filter', bad);

  -- And nothing at all for anon or PUBLIC, anywhere.
  select count(*) into bad
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'PUBLIC');
  assert bad = 0, format('anon/PUBLIC hold %s table privilege(s) in public and should hold none', bad);

  raise notice 'phase39: authenticated holds exactly what its policies permit';
end $$;
SQL

echo
echo "== REHEARSAL PASSED =="
echo "Every migration applied in order against PostgreSQL 16, and every function behaved as"
echo "designed against realistic data — including the live offline failure shape, and"
echo "phase37's daily series summing to the same figure the month report prints."
