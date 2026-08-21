# Backup and restore policy — Supabase

Answers ROADMAP **RM-006d**, the half of RM-006 the Phase 9 retention work did not cover, and
ROADMAP §5 question 4 ("Is there a backup of the Supabase project?").

> **Status: documented, not yet verified.** The acceptance criterion is *"a documented,
> verified backup, and a restore that has actually been tried."* The procedure below is
> written and the export tool is tested, but **no restore has been performed**. Until one has,
> RM-006d stays open. A backup nobody has restored is a belief, not a backup — recording that
> honestly is the point of this paragraph.

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

Suggested cadence: **monthly, right after the report for the previous month appears**, since
that is the point at which a month becomes permanent. Copy the directory somewhere that is not
the Pi — the Pi is the single most likely thing in this system to fail.

## Restoring

A restore is two steps, in this order:

1. **Schema.** Apply `supabase/schema.sql`, then every `phase*.sql` in filename order, against
   a fresh project. This recreates tables, RLS policies and functions.
2. **Data.** Load each `*.ndjson` back through PostgREST with the service-role key, in the
   order `BACKUP_TABLES` lists them — `devices` first, because several tables carry a foreign
   key to it.

### What a restore will NOT give you

Stated plainly, because discovering these mid-incident is the worst time to learn them:

- **`auth.users` is not exported.** Operator accounts must be recreated. Every `commands` row
  references `requested_by` as a `uuid` — restored into a project with different user ids,
  those references point at nobody. The audit rows survive; their attribution does not.
- **Raw `readings` and `building_totals` are not exported**, by design (see above).
- **Secrets are not exported.** `server/.env` holds the service-role key, the break-glass
  hash and the light API token. It is gitignored and it is not in the backup. Losing the Pi
  means rotating all three — `node-red-bridge/rotate-light-api-token.mjs` covers the last one.

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

**Restore last verified: never.** Update this line, in this file, when step 7 is done.
