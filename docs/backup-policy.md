# Backup and restore policy — Supabase

Answers ROADMAP **RM-006d**, the half of RM-006 the Phase 9 retention work did not cover, and
ROADMAP §5 question 4 ("Is there a backup of the Supabase project?").

> **Status: a restore has been performed; one half of the check was deliberately not exercised.**
> The acceptance criterion is *"a documented, verified backup, and a restore that has actually been
> tried."* On 2026-09-22 `npm run restore:rehearse` took that day's export (19 tables, 12,960 rows)
> into a throwaway PostgreSQL 16 with every migration applied. Every table's count matched the
> manifest, and every row read back equal to what was exported. **Not exercised:** a scratch
> Supabase project with a frontend rendering the restored history (steps 2, 6 and 7 below), which is
> recorded as a decision in `ROADMAP.md` §0. This database backup does **not** cover the edge
> server's own credentials; see "Secrets are not exported" below.
>
> *Corrected 2026-09-24. This banner still said "no restore has been performed" after the rehearsal
> ran (ROADMAP RM-006d).*

---

## What is at risk

Two different things, with two different answers.

**Recomputable.** `readings` and `building_totals` are pruned at 30 days by design
(`server/retention.mjs`). Their permanent form is `readings_hourly` and
`building_totals_hourly`. Losing the raw tables costs at most 30 days of per-minute detail;
losing the rollups costs the entire history.

**Irreplaceable.** Everything else:

| Table | Why it cannot be rebuilt |
|---|---|
| `readings_hourly`, `building_totals_hourly` | The permanent archive. The raw rows behind it are already deleted. |
| `commands` | The audit trail for every attempt to move a relay, attributed to a real user. Nothing prunes it. |
| `device_config` | Operator-typed room, category, shed group, display names, notes. Hand-entered; no other copy. |
| `schedules`, `dsm_thresholds` | Operator-configured automation. Losing these silently disarms the building. |
| `anomalies` | Derived, but from readings that are themselves gone after 30 days. |
| `monthly_reports`, `monthly_building_reports` | Stored precisely because they cannot be recomputed once their source rows are pruned. |
| `period_reports`, `period_building_reports` | What the Reports page reads, and the record of what was reported. A report regenerated later reflects the data as it stands later, which can differ — RM-047b's outlet correction is exactly such a case. |
| `energy_tariffs`, `emission_factors` | An operator-entered rate and the source it cites. The provenance behind every peso and kilogram in a report exists nowhere else. |
| `sites`, `site_ui_prefs`, `socket_config`, `space_nodes`, `acu_rules` | Hand-entered site configuration: the building's identity and policy, what each socket feeds, the space tree, and the aircon rules. |

**The two lists are checked, not maintained.** `server/backupCoverage.test.mjs` reads every
migration and fails on any table that is neither in `BACKUP_TABLES` nor in `NOT_BACKED_UP` with a
written reason. It exists because this table drifted: on 2026-09-13 the export still named the
monthly tables a fortnight after the Reports page moved to the period ones, and had never named
the tariffs or the site configuration at all.

## What Supabase itself provides

**Confirm this against the project's actual plan before relying on it.** It was not verifiable
from off-site when this document was written, and it is the one input here that changes the
whole answer:

- Free tier: **no** point-in-time recovery and **no** automated daily backups. If the project
  is on the free tier, the only backup is the one described below.
- Paid tiers add daily backups and, higher up, PITR.

If the project is on a paid tier with daily backups, this procedure is a *second* copy held
somewhere Supabase does not control — which is still worth having, and is the copy that
survives an accidental `delete` propagating into a backup, or losing access to the account.

## Taking a backup

```bash
node server/backup.mjs --out=/path/to/ibems-backup-2026-08-21
```

Reads only. Safe to run at any time, including while the daemons are running. It writes one
NDJSON file per table plus a `manifest.json` with row counts, and **exits non-zero if any
table failed**, so a partial backup announces itself rather than looking complete.

`server/backup.mjs` exports rows only — no schema, no RLS policies, no functions, no
`auth.users`. That is deliberate: the schema, the policies and the functions live in
`supabase/*.sql` under version control, which is a better home for them than a nightly
tarball. See that file's header.

### Every week, by itself — `ibems-backup.timer` (RM-149)

Since 2026-09-30 the edge takes this backup itself, every Sunday at 03:30 (`server/backup-cycle.mjs`,
`server/backupCycle.mjs`), and puts it where the Pi's card is not:

1. Every table above is exported as gzipped NDJSON, kept on the edge in `~/backups/ibems-weekly/<UTC day>/`
   (`BACKUP_LOCAL_DIR`), and uploaded to the private bucket that holds the sealed raw days, under
   `<site>/backup/<UTC day>/`.
2. The manifest (rows and sha256 per table, or the error) goes up last. **A folder with a manifest is a finished backup;
   one without is an interrupted one.**
3. Every copy is downloaded again and its sha256 compared.
4. Only then are older backups removed: the newest eight stay in the bucket (`BACKUP_KEEP_WEEKS`) and four on the edge.
   A failed week removes nothing, and a sealed day is never touched.
5. One sealed day, drawn at random, is restored as a drill (below).

A failure of any step is sent to the phone (`NTFY_TOPIC`) and leaves `systemctl status ibems-backup` failed. The first
run exported 19 tables, 0.70 MB, and its drill passed (E-226). `npm run preflight` reports the file store's use of its
1 GB as `storage_size`.

```bash
npm run backup:cycle                 # dry run: what it would export, where, and what it keeps
sudo systemctl start ibems-backup    # a run now; journalctl -u ibems-backup for the result
```

To restore from the bucket, download a dated folder, `gunzip` each `.ndjson.gz`, and follow "Restoring" below; the
files are the same NDJSON `backup.mjs` writes.

A manual export is still worth taking **right after the report for a month appears**, since that is the point at
which a month becomes permanent. Copy it somewhere that is neither the Pi nor the hosting account: the weekly copy
lives in the same account as the database, so it does not survive losing access to that account.

## Restoring

A restore is three steps, in this order — the middle one was learned by doing it (below):

1. **Schema.** Apply `supabase/schema.sql`, then every `phase*.sql` in filename order, against
   a fresh project. This recreates tables, RLS policies and functions.
2. **Empty what the migrations seeded.** Applying the migrations to an empty database leaves a
   `sites` row and a `dsm_thresholds` row, and loading the backup on top of them fails on the
   primary key. A restore means "make the database equal to the backup", so truncate every
   backed-up table (cascade — the unexported tables that reference them are empty in a fresh
   project anyway) before loading.
3. **Data.** Load each `*.ndjson` in the order `BACKUP_TABLES` lists them. That order is a
   restore order and a test holds it there: every table comes after every table it references,
   so `sites` loads first and `devices` second. The rehearsed way to load a file is the one
   `supabase/restore-rehearse.sh` uses — `COPY` each line into a `jsonb` column and
   `jsonb_populate_record` it against the table's own type — which works through `psql` against
   the project's connection string as well as against a container. Loading through PostgREST
   with the service-role key also works in principle and has not been rehearsed.

### Rehearsing a restore — `npm run restore:rehearse`

```bash
npm run restore:rehearse                     # exports a fresh backup, then restores it
npm run restore:rehearse -- /path/to/backup  # restores an existing export
```

Needs docker. Starts the same throwaway `postgres:16-alpine` that `supabase/rehearse.sh` uses,
applies every migration in order, empties the seeded rows, loads the nineteen files in restore
order, and then proves three things per table: the file loaded through the real constraints, the
row count equals `manifest.json`, and **every row re-read from the table as JSON equals the JSON
that was exported** — the type round trip (numeric, timestamptz, jsonb, arrays) on every row rather
than a spot-checked three. It recreates the account ids the files name as placeholder
`auth.users` rows first (and counts them), and loads `space_nodes` parents-first in rounds. It
never reads the live project except through `npm run backup`, and it changes nothing there.

### What a restore will NOT give you

Stated plainly, because discovering these mid-incident is the worst time to learn them:

- **`auth.users` is not exported.** Operator accounts must be recreated. Every `commands` row
  references `requested_by` as a `uuid` — restored into a project with different user ids,
  those references point at nobody. The audit rows survive; their attribution does not.
- **Raw `readings` and `building_totals` are not exported**, by design (see above). Since RM-148 they have a
  backup of their own: see the next section.
- **`ingestion_health` and `acu_loop_state` are not exported**, deliberately. One is a status
  snapshot rewritten every tick; the other is what the aircon loop believes it last commanded.
  Restoring either would restore a stale claim — for the loop, a stale belief about a device's
  setpoint, which its planner is built to refuse rather than act on.
- **Rows that name a user are refused until that user exists.** `updated_by`, `set_by` and
  `override_by` on `acu_rules`, `energy_tariffs`, `emission_factors`, `space_nodes`,
  `socket_config` and `site_ui_prefs` are foreign keys to `auth.users` — and on `acu_rules`,
  `updated_by` is NOT NULL. Recreate the accounts first, or clear those columns while loading;
  for a tariff that loses who entered it, though the email snapshot phase38 stores beside it
  survives.
- **`space_nodes` must be loaded parents first.** Each node references its parent, and the file
  is ordered by id rather than by depth.
- **Secrets are not exported.** `server/.env` holds the service-role key, the break-glass
  hash and the light API token. It is gitignored and it is not in the backup. Losing the Pi
  means rotating all three — `node-red-bridge/rotate-light-api-token.mjs` covers the last one.

## The raw minutes — the edge archive and its sealed days (RM-148)

Raw per-minute rows are not in the export above. Since RM-148 their permanent home is the edge's own archive,
`server/data/archive/archive.sqlite`, with every row ingest writes, the history copied down from the cloud, and the
16–17 Aug 2026 export ([ADR-0011](adr/ADR-0011-edge-archive-hot-tier.md)).

With the hot tier switched on (`ARCHIVE_HOT_TIER=1` in `server/.env`):

- **Every complete UTC day is sealed off the edge.** It is written as one gzip CSV per stream beside the archive, then
  copied to the project's private file storage, bucket `ibems-archive`, created by `npm run archive:storage -- --apply`.
- **The cloud keeps its raw rows until that copy exists.** It prunes a day only after the day is sealed, copied, and
  covered row for row by the archive.

**The restore drill.** It was first run on 2026-09-30, for 15 Sep and 16 Aug, and passed: every file downloaded, re-sealed
and recorded with the same sha256. **It now runs every week with the backup**, on a day drawn at random from those
whose readings were sealed and copied (E-226). It fails when a stream the archive recorded as copied is missing from
the bucket. To run it by hand:

```bash
npm run archive:restore -- --day=2026-09-01
```

It downloads that day's sealed files, loads them into a throwaway archive, seals them again, and checks that the result
has the same sha256 as the day recorded when it was sealed. It writes nothing outside a temporary directory.

**Recovering from a lost or failed card:**

1. `npm run archive:restore -- --since=<first day> --until=<yesterday> --into=<new file> --apply` rebuilds the sealed
   days into a new archive. A day the bucket does not hold is listed, not guessed.
2. With ingest stopped, move the new file into place as `server/data/archive/archive.sqlite`.
3. `npm run archive:backfill -- --apply` copies the days the cloud still holds that were not yet sealed.

## Verifying — the step that actually closes RM-006d

Do this once, then record the date here:

1. Take a backup.
2. Create a scratch Supabase project.
3. Apply the schema and load the data per the steps above.
4. Check the row counts against `manifest.json`.
5. Spot-check a value that would be wrong if the load mangled types — a `numeric` energy
   figure, a `timestamptz`, and a `jsonb` `schedules.rule`.
6. Point a local frontend build at the scratch project and confirm Analytics and Reports
   render real history.
7. Delete the scratch project.

**Restore last verified: 2026-09-22, in a container.** `npm run restore:rehearse` took the day's
export (19 tables, 12,960 rows, from `sites` to `period_building_reports`) through steps 1, 3, 4
and 5 above against PostgreSQL 16: every count matched the manifest and every row read back equal
to what was exported. Two things it found are now written into "Restoring": the migrations seed
`sites` and `dsm_thresholds`, and `space_nodes` in id order needed five parents-first rounds for
four rows. One account id had to exist first. **Not yet done: steps 2, 6 and 7** — a scratch
Supabase project, and a frontend pointed at it rendering the restored history. Update this line
when they are.
