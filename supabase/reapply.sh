#!/usr/bin/env bash
# Prove the migrations are RE-RUNNABLE, by executing them twice against one database.
#
# WHY `rehearse.sh` IS NOT THIS.
# Its sibling applies each file once against a fresh database, so every `drop ... if exists`
# finds nothing, every `if not exists` guard takes the same branch it would on an empty
# schema, and no data migration has anything to re-migrate. It proves the files PARSE and
# their end state is right. It cannot prove they are safe to run a second time.
#
# That matters here because there is no migration runner. Files are pasted into the SQL
# editor by hand, so "did this one already go in?" is answered by a person's memory, and the
# recovery from a wrong answer is to run it again. Several phase headers say "RE-RUNNING IS
# SAFE"; until this script that was a claim with no test behind it, which is the same shape
# of defect as the file-TEXT schema guards `rehearse.sh`'s own header warns about.
#
#     ./supabase/reapply.sh          # needs docker; nothing else
#
# Touches nothing outside its own throwaway container. Never reads the live project, never
# needs a key, safe to run while the live system is up.
#
# THE SECOND PASS IS THE INTERESTING ONE. By then every constraint, policy, index and column
# exists, and the seeded pre-phase33 whole-outlet row has already been split. A file that
# splits it again yields a parent AND its children — three schedule rows for two relays,
# which dispatches four commands and is exactly the fault phase33's atomic DO block exists
# to prevent.
set -euo pipefail

CONTAINER="ibems-reapply-$$"
PGPASSWORD="rehearse-only-not-a-real-secret"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== starting throwaway postgres =="
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PGPASSWORD" postgres:16-alpine >/dev/null

# Two consecutive successes, because the entrypoint starts a throwaway server for its own
# init step and a single probe can land on that one and then lose it.
ready=0
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" psql -U postgres -d postgres -tAc 'select 1' >/dev/null 2>&1; then
    ready=$((ready + 1)); [ "$ready" -ge 2 ] && break
  else ready=0; fi
  sleep 1
done
[ "$ready" -ge 2 ] || { echo "postgres never became ready" >&2; exit 1; }

psql() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"; }

# Supabase supplies auth.uid()/auth.role() and the three roles the RLS policies name. Stand
# in for them so the policies can be created at all.
psql <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.role() returns text language sql stable as
  $$ select coalesce(current_setting('request.jwt.claim.role', true), 'authenticated') $$;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
SQL

echo "== pass 1: every migration in order =="
for f in "$HERE/schema.sql" $(ls "$HERE"/phase*.sql | sort -V); do
  psql < "$f" >/dev/null 2>&1 || { echo "FAILED (pass 1): $(basename "$f")"; exit 1; }
done
echo "   all applied"

# Real data, so phase33's split has something to do on the re-run rather than passing
# vacuously against an empty table.
echo "== seeding a whole-outlet schedule and a device tier =="
psql <<'SQL'
insert into auth.users (id) values ('11111111-1111-1111-1111-111111111111') on conflict do nothing;
insert into sites (id, display_name, timezone, utc_offset_minutes, policy)
  values ('mmsu-nberic-care','CARE','Asia/Manila',480,'{"acu_min_setpoint_c":24}'::jsonb)
  on conflict (id) do nothing;
insert into devices (id, display_name, class, sockets) values
  ('co1','Outlet 1','outlet_dual','["CO1_1","CO1_2"]'::jsonb),
  ('l1','Light 1','switch',null)
  on conflict (id) do nothing;
-- A pre-phase33 whole-outlet row, exactly the shape the live table held.
insert into schedules (device_id, socket, rule, enabled, updated_by)
  values ('co1', null, '{"on":"08:00","off":"18:00","days":"1111100"}'::jsonb, true,
          '11111111-1111-1111-1111-111111111111');
insert into schedules (device_id, socket, rule, enabled, updated_by)
  values ('l1', null, '{"on":"07:00","off":"19:00","days":"1111111"}'::jsonb, true,
          '11111111-1111-1111-1111-111111111111');
insert into device_config (device_id, load_shed_group) values ('co1','group_2')
  on conflict (device_id) do update set load_shed_group = excluded.load_shed_group;
SQL

echo "== applying phase33..36 a SECOND time, against a database that already has them =="
for f in phase33_schedules_stackable phase34_socket_config phase35_policy_room_target phase36_acu_rules; do
  printf '   %-42s' "$f"
  if out=$(psql < "$HERE/$f.sql" 2>&1); then echo "ok"; else
    echo "FAILED"; echo "$out" | tail -20; exit 1
  fi
done

# EXPECTED: co1|1, co1|2, l1|null -- three rows. Five would mean the parent survived its
# own split; two would mean the second pass re-split an already-split row.
echo "== what the data looks like after two passes =="
psql -c "select device_id, socket, enabled from schedules order by device_id, socket nulls first;"
psql -c "select device_id, socket, load_shed_group from socket_config order by device_id, socket;"
psql -tAc "select 'sites.policy = ' || policy::text from sites where id='mmsu-nberic-care';"
psql -tAc "select 'care_acu_trigger_c still present: ' || count(*)::text from information_schema.columns where table_name='dsm_thresholds' and column_name='care_acu_trigger_c';"

echo
echo "== SECOND PASS PASSED =="
