---
title: ADR-0011 — Raw history's permanent home is the edge, with a sealed copy off it; the cloud keeps 14 days
status: Accepted
date: 2026-09-29
evidence: [E-089, E-218, E-219, E-220, E-221, E-222]
---

# ADR-0011 — Raw history's permanent home is the edge, with a sealed copy off it; the cloud keeps 14 days

**Status:** Accepted · **Decided:** 2026-09-29 · **Decided by:** the operator, on the RM-148 plan. **Amends:**
[ADR-001](../adr-001-timeseries-store.md) §5 and [ADR-0005](ADR-0005-no-timescaledb.md)'s consequences.

## Context

ADR-001 kept one store, the hosted Postgres, and turned down a second store on the edge. The edge was "the least
reliable node in the system", and a second store would have been an unbacked one beside an unbacked one.

What was measured on 2026-09-29 changed the question.

- **The database was near the plan's cap.** It was on the Free plan at 392 of 500 MB, and above 500 MB the database
  turns read-only and ingest's own writes fail [E-089, E-218].
- **One table was nearly all of it.** `readings`, the 30-day raw window, was 346 MB, and its `capabilities` jsonb was
  271 of an average 320 bytes a row: settings a device repeats every minute [E-218].
- **Raw minutes had no permanent home.** Minutes older than 30 days existed nowhere at all, since retention deleted
  them and the backup skipped them.
- **The hourly rollups and reports were small.** They are permanent, and they were never the problem.

## Decision

- **The edge keeps every raw row for good.** Ingest commits each tick to a SQLite file on the edge before anything is
  sent, and an uploader feeds the cloud from it [E-219].
- **Each complete UTC day is sealed and copied off the edge.** It is written as a gzip CSV and copied to the project's
  private file storage.
- **The cloud keeps 14 days of raw rows**, plus the permanent hourly rollups, reports and audit trail.
- **A cloud day is pruned only when three things are true:**
  - the archive holds at least the cloud's rows for every device and hour;
  - nothing older is still waiting to upload;
  - the day's sealed copy is off the edge.
- **Reads go to the tier that holds the data.**
  - Ranges longer than the raw window read the cloud's rollups.
  - Minute-level exports of older periods come from the edge, through the same authenticated proxy as the rest of
    the API.
- **The cloud's copy of `capabilities` keeps only what something reads back:** measurements, switch state, the codes
  the scrub tools use, and the system's flags [E-221].

## Why ADR-001's objections no longer hold

| ADR-001 said | What answers it now |
|---|---|
| The edge is unreliable, and an archive there would be the only copy | The edge is not the only copy of anything older than a day: each sealed day is copied off it, and a cloud day is not pruned until it is. The card failing costs, at most, days the cloud still holds. |
| An unbacked second store while the first had no verified backup | The sealed days *are* the backup, and `npm run archive:restore -- --day=D` restores one into a throwaway archive and checks it rebuilds byte for byte. |
| A second authorization model | None was added. The edge's archive is read only through the proxy, which verifies the same Supabase session as every other route. |
| It splits the joins the reports need | The reports still run in the cloud, over the rollups and the 14 raw days. Only per-minute exports of older periods read the edge. |

## Alternatives considered

| Option | Why not |
|---|---|
| Stay at 30 days and buy the Pro plan | It costs money every month. The operator chose to stay within the free tier. |
| Keep 30 days and only slim the rows | It buys headroom once. The raw minutes older than 30 days would still be lost, as before. |
| `VACUUM FULL` to give the space back | It builds a whole new copy beside the old one. At 392 of 500 MB, that peak could put the database into read-only mode in the middle of the operation. The one-time shrink is instead a pause, `TRUNCATE`, then a reload of the window from the archive. |
| Postgres, TimescaleDB or DuckDB on the edge | SQLite ships inside the Node.js runtime the daemons already use, so it adds no dependency and no service. DuckDB needs a native package, and a Postgres server is one more thing to secure and upgrade. The workload is about 0.33 rows a second. |
| Declarative partitioning (FI-012) | It is not needed at 14 days. A daily prune of about 29,000 rows plus autovacuum serves. |

## Consequences

- **The cloud's size stops tracking the raw window.** Growth now comes from the rollups and reports, tens of MB a
  year.
- **The edge's disk and SD card now matter more.** `npm run preflight` checks that the archive is current, that there
  is free disk, and that Node-RED saves its context sparingly. Saving every 30 s had been most of the card's writes.
- **A restore has two halves.** Sealed days come back from the file storage, and the recent days come from the cloud
  (`archive:backfill`).
- **The cloud keeps 14 days of raw readings only while the operator's switch is on** (`ARCHIVE_HOT_TIER=1`, on since
  2026-09-30 [E-222]). Without it the daemon keeps 30 days, as before.

## What would change this answer

- **The file storage fills.** A sealed day measured about 0.2 MB (38 days were 7.7 MB [E-222]), so 1 GB lasts over ten
  years at this fleet's size. `npm run archive:storage` reports its use.
- **Several sites share one database** (FI-003). Then ADR-001's triggers apply again, and this is the starting point.
- **A per-minute read of an old period is needed from somewhere other than the edge**, and the proxy cannot be
  reached from there.
- **The edge's card fails with days not yet sealed.** Measure how often that happens before deciding the seal
  cadence is too slow.
