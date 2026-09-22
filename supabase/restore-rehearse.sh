#!/usr/bin/env bash
# Restore a backup into a throwaway PostgreSQL and prove it came back whole — RM-006d.
#
# WHY THIS EXISTS:
# `npm run backup` (server/backup.mjs) has exported nineteen tables since 2026-09-13, and
# docs/backup-policy.md describes how to load them back. Until 2026-09-22 nobody had. A backup
# that has never been restored is a belief, not a backup: the paging could drop a row per page,
# a numeric could come back as text, a jsonb rule could be reordered into something the scheduler
# no longer recognises, and the first time anyone would learn any of it is mid-incident.
#
#     ./supabase/restore-rehearse.sh                 # exports a fresh backup, then restores it
#     ./supabase/restore-rehearse.sh /path/to/backup # restores an existing export
#
# The fresh export is a scratch copy and is deleted with the container. To keep a backup, take
# it with `npm run backup` first and pass its directory.
#
# The fresh export needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server/.env), and reads the
# live project exactly as `npm run backup` does — reads only, paged. The restore itself touches
# nothing outside its own container: it is the same `postgres:16-alpine` rehearse.sh uses, with
# the same stub of what Supabase provides, and every migration applied in order first.
#
# WHAT IT PROVES, table by table, in BACKUP_TABLES order (which is a restore order — every table
# after every table it references):
#   1. every file loads through the real schema, foreign keys and check constraints included;
#   2. the row count equals manifest.json's;
#   3. every exported row, re-read from the restored table as JSON, equals the exported JSON —
#      the type round trip (numeric, timestamptz, jsonb, arrays) checked on EVERY row, not a
#      spot-checked three.
#
# WHAT IT DOES THAT A REAL RESTORE WOULD ALSO HAVE TO DO, and says so:
#   - `auth.users` is not exported. Rows that name a user (updated_by, set_by, override_by …)
#     are foreign keys to it, and on acu_rules the column is NOT NULL. The rehearsal recreates
#     each referenced id as a placeholder account before loading the table, and counts them.
#     In a real restore these are the operator accounts to recreate first.
#   - `space_nodes` references itself and the file is ordered by id, not by depth, so it is
#     loaded parents-first in rounds until every row is in.
#
# WHAT IT DOES NOT PROVE: that PostgREST accepts the same rows (the documented restore path goes
# through the API; this one goes through psql), and that a frontend renders them. Those are
# steps 2 and 6 of the checklist in docs/backup-policy.md and still want a scratch Supabase
# project.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CONTAINER="ibems-restore-$$"
PGPASSWORD="rehearse-only-not-a-real-secret"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; [ -n "${SCRATCH:-}" ] && rm -rf "$SCRATCH"; }
trap cleanup EXIT

# --- the backup ---------------------------------------------------------------------------------
if [ $# -ge 1 ]; then
  BACKUP="$(cd "$1" && pwd)"
  echo "== restoring the export in $BACKUP =="
else
  SCRATCH="$(mktemp -d)"
  BACKUP="$SCRATCH/backup"
  echo "== exporting a fresh backup with npm run backup =="
  # The daemons get server/.env from their unit file; here node reads it, so nothing is sourced
  # into this shell and no value is ever echoed.
  (cd "$ROOT" && node --env-file="$ROOT/server/.env" server/backup.mjs --out="$BACKUP")
fi
[ -f "$BACKUP/manifest.json" ] || { echo "no manifest.json in $BACKUP" >&2; exit 1; }
EXPORTED_AT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).exported_at)' "$BACKUP/manifest.json")"
echo "   exported at $EXPORTED_AT"

# The restore order is the export order, read from the module that owns it rather than copied.
TABLES="$(cd "$ROOT" && node -e 'import("./server/backup.mjs").then((m) => console.log(m.BACKUP_TABLES.map((t) => t.table).join(" ")))')"

# --- the throwaway database ----------------------------------------------------------------------
echo "== starting throwaway postgres =="
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PGPASSWORD" postgres:16-alpine >/dev/null
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
psql() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"; }

echo "== stubbing what Supabase provides and a bare Postgres does not =="
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
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
-- JSON text is compared below, so the session must render timestamps the way PostgREST does.
alter database postgres set timezone to 'UTC';
SQL

echo "== applying every migration in order =="
ERR="$(mktemp)"
for f in "$HERE/schema.sql" $(ls "$HERE"/phase*.sql | sort -V); do
  # The migrations' own NOTICEs (drop-if-exists on an empty database) are not this run's news.
  psql < "$f" >/dev/null 2>"$ERR" || { echo "   $(basename "$f") FAILED:" >&2; cat "$ERR" >&2; rm -f "$ERR"; exit 1; }
done
rm -f "$ERR"
echo "   $(ls "$HERE"/phase*.sql | wc -l | tr -d ' ') phase files plus schema.sql applied"

# --- the load, table by table ------------------------------------------------------------------
# Each file goes in through COPY as one jsonb per line — CSV with a quote and delimiter no JSON
# can contain, so backslashes inside strings survive (text format would eat them) — and is then
# turned into rows by jsonb_populate_record against the table's own type. That is what makes the
# round trip below mean something: the row is built by the column types, not by string matching.
psql -c 'create table _restore_log (tbl text primary key, loaded int, placeholders int, mismatched int, rounds int)' >/dev/null

# THE MIGRATIONS SEED ROWS. Found by this rehearsal on 2026-09-22: applying the migrations to an
# empty database leaves a sites row, and the first load failed on its primary key. A restore is
# "make the database equal to the backup", so every backed-up table is emptied before its file is
# loaded — cascade, because the unexported tables that reference them (readings, acu_loop_state …)
# are empty in a fresh project anyway. What was seeded is printed, so the doc can say it.
echo "== emptying what the migrations seeded =="
for t in $TABLES; do
  seeded="$(psql -tAc "select count(*) from public.$t")"
  [ "$seeded" != "0" ] && echo "   $t: $seeded seeded row(s) replaced by the backup's"
done
psql -c "truncate $(echo "$TABLES" | sed 's/ /, /g') cascade" >/dev/null

echo "== loading $(echo "$TABLES" | wc -w | tr -d ' ') tables in restore order =="
placeholders_total=0
for t in $TABLES; do
  file="$BACKUP/$t.ndjson"
  [ -f "$file" ] || { echo "   $t: no file" >&2; exit 1; }
  expected="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tables[process.argv[2]] ?? "missing")' "$BACKUP/manifest.json" "$t")"
  printf '   %-28s' "$t"
  { cat <<SQL; cat "$file"; cat <<'EOSQL'; } | psql >/dev/null
set restore.tbl = '$t';
create table _in (n bigserial, doc jsonb);
copy _in (doc) from stdin with (format csv, quote e'\x01', delimiter e'\x02');
SQL
\.
do $$
declare
  tbl text := current_setting('restore.tbl');
  fk record;
  made int := 0;
  n int;
  loaded int := 0;
  rounds int := 0;
  self_fk text;
  bad int;
begin
  -- Accounts first: every column of this table that references auth.users gets a placeholder
  -- row per distinct id the file names, so the foreign key holds and NOT NULL columns load.
  for fk in
    select kcu.column_name as col
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.table_schema
     where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public' and tc.table_name = tbl
       and ccu.table_schema = 'auth' and ccu.table_name = 'users'
  loop
    execute format('insert into auth.users (id) select distinct (doc->>%L)::uuid from _in where doc->>%L is not null on conflict do nothing', fk.col, fk.col);
    get diagnostics n = row_count;
    made := made + n;
  end loop;

  -- A table that references itself (space_nodes.parent_id) loads parents first, in rounds.
  select kcu.column_name into self_fk
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.table_schema
   where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public' and tc.table_name = tbl
     and ccu.table_schema = 'public' and ccu.table_name = tbl
   limit 1;

  if self_fk is null then
    execute format('insert into public.%I select r.* from _in i, lateral jsonb_populate_record(null::public.%I, i.doc) r order by i.n', tbl, tbl);
    get diagnostics loaded = row_count;
  else
    loop
      rounds := rounds + 1;
      execute format(
        'insert into public.%I select r.* from _in i, lateral jsonb_populate_record(null::public.%I, i.doc) r '
        || 'where ((i.doc->>%L) is null or exists (select 1 from public.%I p where p.id::text = i.doc->>%L)) '
        || 'and not exists (select 1 from public.%I q where q.id::text = i.doc->>''id'') order by i.n',
        tbl, tbl, self_fk, tbl, self_fk, tbl);
      get diagnostics n = row_count;
      loaded := loaded + n;
      exit when n = 0 or rounds > 64;
    end loop;
  end if;

  -- THE ROUND TRIP: every row re-read from the table as JSON must equal the JSON that was
  -- exported. jsonb equality is by value, so 12.50 = 12.5 and key order does not matter; a
  -- numeric that became text, a timestamp that shifted, or a dropped key does not pass.
  execute format('select count(*) from _in i where not exists (select 1 from public.%I t where to_jsonb(t) = i.doc)', tbl) into bad;

  insert into _restore_log values (tbl, loaded, made, bad, rounds);
end $$;
drop table _in;
EOSQL
  IFS='|' read -r loaded made bad rounds <<<"$(psql -tAc "select loaded, placeholders, mismatched, rounds from _restore_log where tbl = '$t'")"
  count="$(psql -tAc "select count(*) from public.$t")"
  placeholders_total=$((placeholders_total + made))
  note=""
  [ "$made" -gt 0 ] && note="$note, $made placeholder account(s) recreated first"
  [ "$rounds" -gt 1 ] && note="$note, parents first in $rounds rounds"
  if [ "$count" != "$expected" ]; then
    echo "loaded $count rows, manifest says $expected — FAILED"
    exit 1
  fi
  if [ "$bad" != "0" ]; then
    echo "$count rows, count matches, but $bad row(s) do not read back as exported — FAILED"
    psql -c "select to_jsonb(t) from public.$t t limit 1"
    exit 1
  fi
  echo "$count rows, count matches, every row reads back as exported$note"
done

# --- the checks a restored database must also pass ------------------------------------------------
echo "== the restored database, queried as the app would =="
psql <<'SQL'
do $$
declare
  sites_n int; devices_n int; hours_n int; reports_n int; win record;
begin
  select count(*) into sites_n from sites;
  select count(*) into devices_n from devices;
  select count(*) into hours_n from readings_hourly;
  select count(*) into reports_n from period_reports;
  assert sites_n >= 1, 'no sites row came back';
  assert devices_n >= 1, 'no devices came back';
  -- The report functions run against restored history: a shape that survived the load but
  -- not the functions' expectations would fail here, not in front of a person.
  select * into win from report_window('week', (select max(period_start) from period_reports where period = 'week'), 'Asia/Manila') limit 1;
  raise notice 'restored: % site(s), % device(s), % hourly row(s), % period report row(s)', sites_n, devices_n, hours_n, reports_n;
end $$;
SQL

echo
echo "== RESTORE REHEARSAL PASSED =="
echo "The export of $EXPORTED_AT loaded through every migration in order into PostgreSQL 16,"
echo "every table's count matched manifest.json, and every row read back equal to what was"
echo "exported. $placeholders_total placeholder account id(s) had to exist first — in a real"
echo "restore those are the operator accounts to recreate before loading."
