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
  n int; n2 int; v numeric; rolled int; deleted int; ok boolean; site_of text; txt text;
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

  raise notice 'all assertions passed';
end $$;
SQL

echo
echo "== REHEARSAL PASSED =="
echo "Every migration applied in order against PostgreSQL 16, and all six functions behaved"
echo "as designed against realistic data — including the live offline failure shape."
