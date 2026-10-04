---
title: ADR-0015 — The data architecture is built around a request budget
status: Accepted
date: 2026-10-04
evidence: [E-224, E-241, E-242, E-243, E-244]
---

# ADR-0015 — The data architecture is built around a request budget

**Status:** Accepted · **Decided:** 2026-10-04 · **Decided by:** the operator, on the RM-159 plan ("verify and
improve the database setup … plan and implement what's best"), and on the sign-in question (reads are checked with
the auth service once per token). **Amends:** [ADR-0011](ADR-0011-edge-archive-hot-tier.md), which placed the data; this
record says how the tiers may talk to each other.

## Context

- **The quota that binds is log ingestion, not storage.** The Free plan ingests 1 GB of log a month, from every
  service (API gateway, Postgres, Auth, Storage) [E-242]. Every request to the project is a log line of roughly 3 KB,
  whatever it carries. The database stood at 142 of 500 MB and file storage near zero, while log ingestion read
  1.10 of 1 GB on 2026-10-04 [E-242].
- **Reading the log is metered too.** Log query (100 GB, 100 × the ingest quota) went from about 2 to 30.4 GB while
  RM-158 was checked in the dashboard's Logs view [E-242]. Neither quota is enforced before the start of 2027; after
  that, a Free project over them is degraded.
- **The volume came from timers, not from data.** After RM-158, about 6,500 gateway lines a day remained [E-242]:

  | Source | Lines a day | Why |
  |---|---|---|
  | The kiosk: connectivity and trouble queries | 2,300 | every 5 min, each with a CORS OPTIONS |
  | The proxy's sign-in check | 1,440 per open screen | a one-minute cache against a one-minute poll |
  | The scheduler's configuration read | 1,440 | every minute |
  | Ingest uploads | 1,200 | 3 requests every 5 min, plus 80 early uploads for anomalies |
  | Maintenance, reports, backup | 80 | every 6 h, and weekly |

  The Analytics week, left open, would have added 6,300.
- **The volume of data is small.** Twenty devices at one reading a minute is 28,800 rows a day: about 1 GB a year on
  the edge's card, which has 90 GB free [E-244].

## Decision

### The rule

1. **The edge is the system of record and the read path for everything live or recent.** Raw minutes, building
   totals, anomalies and the command record are written on the Pi first, in SQLite (WAL, `synchronous=FULL`), before
   anything is sent (ADR-0011, ADR-0014). Any screen's repeated read is answered there.
2. **The cloud receives batched writes and answers the reads a person asks for.** Uploads are one request per interval
   (`ingest_upload`, phase55). The cloud keeps 14 days of raw minutes, permanent hourly rollups and every period
   report. It serves reports, settings, the 30-day and year charts, sign-in, and the copy that outlives the card.
3. **No timer-driven request from a browser reaches the project while the edge answers.** Each timed fetch asks the
   edge first and falls back to the cloud only when the edge cannot answer (`src/lib/requestBudget.test.ts` pins
   this).
4. **Each daemon reports what it spends.** The edge counts its own requests by kind (`server/requestMeter.mjs`), and
   `npm run preflight` judges the last full day against the budget. Nobody has to read the metered log to know.

### The budget

| Source | Requests a day, after RM-159 | How |
|---|---|---|
| Ingest uploads | 288 | `ingest_upload`: every stream and the health row in one request, every 5 min |
| Ingest maintenance and reports | about 60 | 6-hourly retention, seals, report checks |
| Scheduler | about 100, plus one per change | reads on the edge's signal (`server/configSignal.mjs`), and every 15 min as a safety net |
| Proxy sign-in checks | about 24 per open screen | once per token (an hour), and before a command if the last answer is over a minute old |
| Commands, policy reads, backup | tens | one request per command |
| **The edge, in all** | **about 600** | `request_budget` warns above 1,500 and fails above 3,000 |

With Postgres and Auth lines, that is roughly 0.1 GB of log a month, about a tenth of the quota. That leaves room for a
second site on the same project, which the replication framework needs.

### The schema, by tier

| Entity | Grain | Edge (SQLite) | Cloud (Postgres) | Cold (bucket) |
|---|---|---|---|---|
| Readings | device × minute | every minute, permanently | 14 days | a sealed CSV.gz per day |
| Building totals | site × minute | every minute, permanently | 14 days | a sealed CSV.gz per day |
| Anomalies | device × minute × metric | permanently | 365 days | in the weekly backup |
| Hourly rollups | device × hour | — (the next step, if the edge must serve long ranges) | permanent (`readings_hourly`, `building_totals_hourly`) | in the weekly backup |
| Period reports | device or site × day/week/month | — | permanent, restatable (`period_reports`, `period_building_reports`) | in the weekly backup |
| Commands | one per attempt | recorded first, until uploaded | permanent (`commands`) | in the weekly backup |
| Configuration | per site and device | the scheduler's in-memory copy | authoritative (`schedules`, `acu_rules`, `dsm_thresholds`, …) | in the weekly backup |

### Principles kept

- **Local first, idempotent writes.** Every telemetry row is keyed on its natural key (device, minute) and upserted, so
  a repeated upload changes nothing. A refused row is set aside on the edge, never dropped silently (RM-148).
- **Time is stored as UTC instants**; local days exist only in the report functions, in the site's time zone.
- **Counters are banked, never trusted** (RM-155): a register that falls is not energy lost, and a jump is not energy
  used.
- **Retention is verified, not assumed.** Raw rows leave the cloud only after the edge has them, the day is sealed, and
  the counts match (ADR-0011).
- **Least privilege.** The browser holds the anon key and a signed-in session. Row security covers every table. The
  daemons alone use the service role. Every function the browser does not need is revoked from it (phase39, phase50,
  phase55).
- **Batch over chatter, and push over poll.** A change announces itself (the configuration signal, the command
  record) instead of being discovered by asking every minute.

## Technology comparison

| Option | Writes | Reads at scale | Cost of a request | Operations | Verdict |
|---|---|---|---|---|---|
| **SQLite on the edge** (chosen, ADR-0011) | local, no network | indexed ranges in milliseconds | none | none: a file, a WAL, a nightly seal | Keep. Raw history's home. |
| **Postgres or InfluxDB on the Pi** | local | richer queries | none | a server to run, upgrade and back up on an SD card | Not worth it: SQLite already answers every edge read. |
| **Supabase Free** (chosen, ADR-001) | batched | SQL, functions, row security | one log line per request | none: hosted | Keep, inside the budget above. |
| **Supabase Pro** | same | same | 20 GB of log included, at $25 a month | none | The fallback if more sites outgrow the Free quota. |
| **A managed time-series database** (InfluxDB Cloud, Timescale) | built for it | fast rollups | per request or per volume | a second account and auth model | Rejected: ADR-0005; the data is small, and requests, not query speed, were the limit. |
| **Parquet in the bucket, read with DuckDB** | daily files | analytics over years | none at rest | a reader to build | A future cold-analytics option; the sealed CSV.gz days already hold the same rows. |

## Alternatives considered

| Option | Why not |
|---|---|
| A direct Postgres connection from the edge instead of the REST API | It would skip the gateway's log, but needs a database password and a driver on the Pi (the server has no dependencies), and a long-lived connection over Wi-Fi. Batching gets the same saving with neither. |
| Upload every 15 minutes | 192 fewer lines a day, at the cost of the watchdog's 15-minute alarm (RM-150). Not needed at this budget. |
| Supabase Realtime for configuration changes | A WebSocket client to write and keep alive, and its own log lines. Every change already passes the edge. |
| Serve the 30-day chart from the edge's raw minutes | Its hours older than 14 days follow the cloud's rolled-hour rules (time-weighted, held minutes excluded); raw buckets would change the chart. It stays on the cloud, refreshed hourly. |

## Consequences

- **The kiosk spends nothing on the project while the edge answers.** A page served from elsewhere still works, from
  the cloud, as before.
- **A session signed out elsewhere keeps reading for up to its token's hour,** as Supabase's own database allows. It
  stops commanding within a minute, as before.
- **A setting saved in the app reaches the scheduler within seconds** instead of within a minute. One changed in the
  SQL editor takes up to 15 minutes.
- **The capacity lasts [E-244].**
  - **Cloud:** raw windows are bounded, and the permanent tables grow by about 175,000 hourly rows a year. That is
    roughly 35 MB a year, against 358 MB of headroom.
  - **Edge:** about 1 GB a year against 90 GB free.
  - **Bucket:** about 0.2 MB a day of sealed days.

## What would change this answer

- **More than three or four sites on one Free project,** or enforcement making 0.1 GB a month per site too much: move
  to Pro, or give each site its own project.
- **Long-range charts that must work without the cloud:** an hourly rollup on the edge, kept like the cloud's.
- **A per-user permission on reading:** the once-per-token check would need a shorter life.
