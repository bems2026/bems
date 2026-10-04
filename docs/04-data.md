---
title: Data and storage
purpose: Understand, size and query the relational store, its ingestion and retention (L4)
audience: [integrator, administrator]
status: Draft
last_verified: 2026-10-04
applies_to: repo dfe41a0 + RM-159
evidence: [E-042, E-058, E-064, E-065, E-066, E-070, E-078, E-080, E-081, E-082, E-083, E-084, E-085, E-086, E-088, E-089, E-090, E-111, E-121, E-122, E-124, E-126, E-134, E-137, E-138, E-142, E-149, E-157, E-161, E-162, E-163, E-164, E-165, E-166, E-167, E-168, E-193, E-218, E-219, E-220, E-221, E-222, E-224, E-225, E-227, E-235, E-241, E-242, E-243, E-244]
---

# Data and storage

The record lives in two places, by design ([ADR-0011](adr/ADR-0011-edge-archive-hot-tier.md),
[ADR-0015](adr/ADR-0015-data-architecture-and-request-budget.md)):

- **The edge's archive** keeps every raw reading, for good, and answers every screen's repeated reads.
- **The hosted database** keeps 14 days of raw readings, the permanent hourly history, every report, every command and
  who asked for it, and every setting a person makes. The reports and settings pages read it.

Nothing else is authoritative. The spreadsheet mirror is a convenience, not a record.

Two contracts define it in detail, and this chapter does not repeat them:

- [`storage-contract.md`](storage-contract.md): what writes each table, the mapping from bridge payload to table, and
  retention.
- [`bridge-contract.md`](bridge-contract.md): the field names upstream.

## What it is

### The store

**Supabase:** hosted PostgreSQL, with its Auth service for sign-in and row-level security on every table. The schema
is `supabase/schema.sql` plus 55 `phase*.sql` migrations, applied in filename order. It defined **23 tables** when
counted [E-064]. **All timestamps are stored as `timestamptz` in UTC** and shown in the site's time zone [E-088, E-137].

### The tables

Units are in the column names: `_w` is watts, `_kwh` kilowatt-hours, `voltage` volts, `current` amperes, `_c` degrees
Celsius. Row counts are from the pilot on 2026-09-23 [E-080].

| Table | One row is | Key columns (units) | Written by | Why it exists |
|---|---|---|---|---|
| `readings` | one device, one minute | `device_id`, `ts` (PK); `power_w`, `voltage`, `current`, `energy_kwh_today`, `total_energy_kwh`, `online`, `capabilities` (jsonb) | ingest, uploaded from the edge every 5 min | The per-minute record: 14 days in the cloud (374,876 rows on 2026-10-04 [E-244]), every minute on the edge |
| `readings_hourly` | one device, one hour | `device_id`, `hour` (PK); `power_w_avg`, `power_w_max`, `energy_kwh_today_max`, `energy_kwh_today_first`, `energy_kwh_today_last`, `energy_kwh_gain`, `sample_count`, `online_sample_count` | the retention rollup | The permanent history, once minutes are pruned |
| `building_totals` | the building, one minute | `ts` (PK); `total_power_w`, `avg_voltage`, `phase_current_{red,yellow,blue}`, `energy_kwh_{today,week,month}`, plus `*_integrated` | ingest | The building as the **sum of its branch meters** [E-168] |
| `building_totals_hourly` | the building, one hour | `hour` (PK); averages, maxima, `sample_count` | the retention rollup | Permanent building history |
| `anomalies` | one flagged reading | `device_id`, `ts`, `metric`; `value`, `z_score`, IQR bounds, `method` | ingest (only when both tests agree) | Unusual-use alerts, kept 365 days |
| `commands` | one command attempt | `id`; `device_id`, `socket`, `action`, `target_c`, `requested_by` (NOT NULL), `requested_at`, `status`, `via`, `source`, `note` | proxy and scheduler, **before** dispatch | The audit trail, never pruned [E-065, E-122, E-193] |
| `schedules` | one scheduled switch | `device_id`, `socket`, `rule` (jsonb: on, off, days), `enabled`, `updated_by` (must be set) | the app | Time-based control, fired by the scheduler [E-121] |
| `dsm_thresholds` | the site's demand limits | `max_total_kw`, `max_phase_current`, `auto_shed`, `updated_by` | the app | Demand-side management |
| `acu_rules`, `acu_loop_state` | one comfort rule, and what the loop last did | `target_c`, `deadband_c`, `step_c`, `min_step_interval_s`, `window_*`, `days`; `commanded_c`, `alert_kind` | the app; the scheduler | The room-target loop |
| `devices` | one device | `id` (PK), `display_name`, `class`, `sockets`, `branch_circuit`, `status` | ingest (from the registry) | What the app can list, without the bridge |
| `device_config`, `socket_config` | one device, or one socket | `room`, `category`, `load_shed_group`, `space_node_id`, floor-plan position | the app | Placement and shed groups |
| `space_nodes`, `sites`, `site_ui_prefs` | the site, its rooms, its layout choices | `sites.timezone`, `sites.policy` (jsonb); the space tree | migrations and the app | Multi-site identity [E-149] |
| `period_reports`, `period_building_reports` | one device (or the building), one day, week or month | `period`, `period_start`; `energy_kwh`, `peak_power_w`, `online_sample_count`, `expected_sample_count` | report generation, inside ingest | Reports, **with their coverage** |
| `monthly_reports`, `monthly_building_reports` | the same, monthly (older form) | as above | report generation | Kept for continuity |
| `energy_tariffs`, `emission_factors` | one rate, effective from a date | `currency`, `rate_per_kwh`; `kg_co2e_per_kwh`; `source` (required) | the app | Cost and emissions on reports [E-166] |
| `ingestion_health` | the ingest daemon's heartbeat | `last_success_at`, `buffered_row_count`, `last_error`, `scrub_rejected_count` | ingest, every cycle | Monitoring the monitor [E-085] |

### The honesty rules, and where each is enforced

| Rule | Enforced where | Evidence | Known limit |
|---|---|---|---|
| **A missing reading is a gap, never a zero** | Ingest stores what arrived. A bad value is stored as NULL. When nothing arrives, no row is written. | E-082, E-138 | — |
| **A silent device is excluded from totals, not counted as zero** | The bridge's aggregates skip offline meters; the database functions count only online samples | E-168, E-083 | Stored offline rows can carry a held value. **Every new query must filter `online`** (F-013). |
| **A command is recorded before it is dispatched** | `auditedDispatch`: no row, no dispatch | E-065, E-122 | A row can end at `dispatching` if its final update is lost (F-006) |
| **Every automatic action has an owner** | `commands.requested_by` NOT NULL; schedules must carry `updated_by`; each daemon attributes its commands to whoever saved the rule | E-121, E-164 | — |

### Keys and access

| Who | Key | What it can do |
|---|---|---|
| The edge server's daemons | The **service-role key**, in `server/.env` only | Everything, bypassing row-level security. It never reaches a browser. [E-042] |
| A browser | The **public (anon) key**, plus the user's own session | Whatever the `authenticated` policies allow: telemetry and reports can be read, not written, and long-range history comes through database functions [E-126, E-161]. |
| Anyone without a session | The public key alone | **Nothing.** No policy grants the `anon` role anything [E-161]. |

**The role model is flat.** Every signed-in account may do everything the policies allow. No admin or operator role
exists [E-163]. Control who can sign in, therefore, and see [X1](X1-security.md).

### Ingestion

| Property | As built | Evidence |
|---|---|---|
| Interval | One cycle per 60 s, committed to the edge's archive first: every device's reading, the building total, and any anomalies. The archive is uploaded every 5 min, all streams and the health row in one request (`ingest_upload`, phase55). | E-086, E-243 |
| Idempotency | Upserts on `(device_id, ts)`, `ts`, and `(device_id, ts, metric)`. A re-sent row replaces its twin. | E-162 |
| Validation | Bad values stored as NULL and counted. Rows more than 5 min ahead or 7 days behind are dropped. | E-138, E-142 |
| Outage buffering | Since RM-148 the archive is the buffer: a row stays owed until the cloud has taken it, and a row the cloud refuses for good is set aside on the edge (`upload_rejects`). Before that, a local file did this: a 7-minute outage, 8 rows, no loss. | E-134, E-142, E-219 |
| Health | `ingestion_health`, written with each upload (every 5 min) and at once when health changes: last success, rows owed, rejections | E-085, E-225 |

### Sizing and retention

**Retention.** Raw minutes are kept 14 days in the cloud (30 before RM-148), then rolled into permanent hourly buckets
**in the same transaction as the prune**, because a delete that commits without its rollup destroys data. Anomalies are kept 365 days. Commands are kept
for ever [E-070]. **Queries that span both resolutions** go through `readings_archive`, which reads across the
boundary [E-165].

**Tiers (RM-148, [ADR-0011](adr/ADR-0011-edge-archive-hot-tier.md)).** Every raw row is also kept for good on the edge.
The ingest daemon commits each tick to a SQLite archive before the cloud gets it, and the history the cloud held was
copied into it; per device and hour, the archive held every row the cloud did [E-219, E-220]. The cloud's copy of a
reading's `capabilities` keeps only measurements, switch state and the codes something reads back (57 % smaller,
E-221). **Since 2026-09-30 the cloud's raw window is 14 days**, pruned only where the edge holds the rows and the day's
sealed copy is off the edge. The raw tables were reset from the archive the same morning, and the two match per
device-hour both ways [E-222]. Minute exports of older periods are read from the edge through the proxy.

**The method**, with the pilot's numbers:

| Quantity | Formula | Pilot |
|---|---|---|
| Raw rows per day | devices × 86 400 ÷ interval_s | 20 × 86 400 ÷ 60 = 28 800; measured ≈ 28 600 [E-081] |
| Raw rows at steady state | rows/day × 30 | ≈ 860 000; measured 858 691 [E-080] |
| Hourly rows per year | devices × 24 × 365 | ≈ 175 000, permanent |
| **Bytes per row** | **measure it:** `pg_total_relation_size(table) ÷ rows`, indexes included | **435** for `readings`, of which the `capabilities` jsonb is 271 of an average 320 bytes of data [E-218] |
| Raw storage | steady rows × bytes/row | 833 171 × 435 ≈ **346 MB** of a 392 MB database [E-218] |

**The plan's cap.** On the Supabase Free plan, the database turns **read-only above 500 MB** and ingest stops writing.
The plan also pauses after a week of inactivity and has no automatic backups [E-089]. The pilot is on the Free plan at
392 MB [E-218]. **Worked threshold:** 500 MB ÷ 860 000 rows ≈ **580 bytes per raw row**. The pilot's 435 bytes is under
it, but with only about 90 MB to spare once everything else is counted. So RM-148 keeps 14 days of raw rows in the
cloud and every raw row on the edge (F-004).

### The spreadsheet mirror

Node-RED also appends meter and outlet figures to Google Sheets: 11 append nodes, each every 180 s [E-058]. It is a
**report mirror, not a system of record**:

- It is written from the flow, not from the database, so it can disagree with the record.
- Google limits writes to 60 requests per minute per user per project, and a spreadsheet to 20 million cells [E-167].
  At 11 appends of 4 cells every 180 s, one spreadsheet would fill in about 2.6 years. That is a Hypothesis: whether
  the 11 targets share one spreadsheet was not read (Q-09).
- Nothing reads it back, and its failures are not monitored [UNVERIFIED].

Keep it only if someone uses it; the record does not need it. ADR-001 records why the store is Postgres and not a
spreadsheet ([ADR index](adr/README.md)).

## What you need

| Item | Specification that matters |
|---|---|
| A Supabase project | Institution-owned. **A plan whose database cap exceeds your measured steady size with headroom**, and one that includes backups (see above). |
| The schema | `supabase/*.sql`, applied **in filename order, unedited** ([replication](replication.md)) |
| Keys | The URL, the public key and the service-role key, entered into `server/.env` on the edge (names in [03](03-edge.md#serverenv)) |
| A backup routine | `npm run backup`, and one restore rehearsal ([backup-policy](backup-policy.md)) |

## How to install

**Precondition.** A new, empty project.

| Step | Action | Expected result |
|---|---|---|
| 1 | In the SQL editor, run `schema.sql`, then every `phase*.sql` in filename order | Each runs without error. Re-running one is safe; the tests enforce it. |
| 2 | Add this site's row: run `npm run site:sql` and paste the one statement it prints | One row in `sites`, with the site's time zone |
| 3 | Put the URL and keys into `server/.env` on the edge, then start the daemons | `ingestion_health.last_success_at` advances every 5 minutes, with each upload from the edge's archive (E-225) |

**Done when.** `npm run preflight` passes `db_reachable` and `db_site_row`, and `db_size` and `storage_size` read under 70 % of the
plan's caps. Those two need `phase50`'s `usage_bytes()`; the defaults are the Free plan's 500 MB and 1 GB (E-224).

**The request budget ([ADR-0015](adr/ADR-0015-data-architecture-and-request-budget.md)).** Every request to the hosted
project is a line of roughly 3 KB in its log, whatever it carries. The Free plan ingests 1 GB of log a month, and
reading the log is metered as well (log query, 100 GB). Neither is enforced before the start of 2027 [E-242]. The log,
not the 500 MB database, is the quota this project keeps meeting (E-224, E-241, E-242). So the design rule is:

- **The edge answers every repeated read.** The alert bell, the trouble episodes, the flapping badge and the Analytics
  week read the edge's archive. They fall back to the cloud only when the edge cannot answer. A browser asking the
  cloud sends a CORS `OPTIONS` before each request, so one five-minute poll costs 576 lines a day per open screen.
- **The cloud gets batched writes.** One upload every 5 minutes is one request: `ingest_upload` (phase55) carries every
  stream and the health row. An anomaly waits for it.
- **A change announces itself.** The scheduler reads its configuration when the edge signals a change: a setting saved
  in the app, or a person's command. Otherwise it reads every 15 minutes.
- **A session is asked about once per token.** The proxy checks a session's signature and expiry on every request. It
  asks the auth service once per token (about an hour), and again before a command if the last answer is over a minute
  old.
- **Each daemon counts what it spends.** It writes a ten-minute journal line, "Supabase request(s) in the last 10 min",
  and keeps a day's count in `server/data/request-meter/`. `npm run preflight` judges the last full day
  (`request_budget`: warn above 1,500, fail above 3,000).

| Source | Requests a day before RM-159 | After |
|---|---|---|
| The kiosk's timed reads | about 2,300 | 0 while the edge answers |
| Sign-in checks | about 1,440 per open screen | about 24 per open screen |
| The scheduler's configuration | 1,440 | about 100, plus one per change |
| Uploads | about 1,200 | 288 |
| Maintenance, reports, backup | about 80 | about 80 |

Measured on 2026-10-03, before RM-158: about 10,800 gateway lines a day (E-241). The meter, not the dashboard's Logs
view, is how to size it now: reading the log spends log query.

**Rollback.** Drop the project and start again. Nothing else depends on it until the daemons write.

**Tested.** The migrations were rehearsed into a throwaway PostgreSQL 16 during the restore rehearsal [E-124]. A clean
new project has not been built from this list.

## How to configure

| Setting | Where | Default |
|---|---|---|
| Raw retention | `INGEST_RETENTION_DAYS` in `server/.env` | 14 days with the hot tier on (`ARCHIVE_HOT_TIER=1`), else 30 |
| Upload interval | `INGEST_UPLOAD_MS` | 300000 (5 min) |
| Scheduler safety-net read | `SCHEDULE_REFRESH_MS` | 900000 (15 min); it also reads on the edge's signal |
| Tariffs, emission factors | The app's Settings page (the tariff section) → `energy_tariffs`, `emission_factors`, each with a source | None. Reports show no cost until one is set. |
| Demand limits, schedules, comfort rules | The app | Owned by the operator |

## How to verify

| Check | How | Pass looks like |
|---|---|---|
| Recording | `ingestion_health` | `last_success_at` within the last minute; `buffered_row_count` 0 |
| Coverage | Reports, or query 6 below | ≥ 99 % of expected minutes per device on a normal day [E-157] |
| Totals reconcile | A day's `building_totals` energy against the sum of the branch meters | Equal by construction [E-168]. A clamp-meter check on the incomer confirms the branches ([01](01-field-devices.md#how-to-verify)). |
| No zeros for silence | Query 7 on a day with a known outage | A gap, not a run of zeros |
| Access | Open the database's REST endpoint with the public key and no session | Nothing returned [E-161] |

## How to operate

### Query cookbook

Run these in the database's SQL editor. **They are read-only.** They use the tables above and the site's own time zone
from `sites`.

!!! warning "Not yet executed"
    These queries were written against the schema but **have not been run** against a database: this documentation
    session had no SQL access. Q-15 asks the operator to run them. Until then, treat each as a starting point.

```sql
-- 1. Consumption by circuit (branch meter) for a period. Coverage is shown beside the figure.
select d.id, d.display_name,
       round(sum(p.energy_kwh)::numeric, 2)                                   as kwh,
       round(100.0 * sum(p.online_sample_count) / nullif(sum(p.expected_sample_count), 0), 1) as coverage_pct
from period_reports p join devices d on d.id = p.device_id
where p.period = 'day' and p.period_start between date '2026-09-01' and date '2026-09-30'
  and d.class = 'meter'
group by d.id, d.display_name order by kwh desc nulls last;

-- 2. Out-of-hours consumption, last 7 days, from the per-minute record (online minutes only;
--    each minute counts as 1/60 h at its reported power).
select r.device_id, round(sum(r.power_w) / 60000.0, 2) as kwh_out_of_hours
from readings r cross join (select timezone from sites limit 1) s
where r.online and r.power_w is not null and r.ts >= now() - interval '7 days'
  and (extract(isodow from r.ts at time zone s.timezone) > 5
       or (r.ts at time zone s.timezone)::time not between time '08:00' and time '17:00')
group by r.device_id order by kwh_out_of_hours desc;

-- 3. Peak demand, and when (site time). building_totals holds the last 14 days.
select b.ts at time zone s.timezone as local_time, b.total_power_w
from building_totals b cross join (select timezone from sites limit 1) s
where b.total_power_w is not null
order by b.total_power_w desc limit 1;

-- 4. Biggest month-on-month growth per device.
select device_id, period_start, energy_kwh,
       energy_kwh - lag(energy_kwh) over (partition by device_id order by period_start) as growth_kwh
from period_reports where period = 'month'
order by growth_kwh desc nulls last limit 10;

-- 5. Untracked load: each branch meter's energy minus its sub-metered outlets, per day.
--    ASSUMES a meter and its outlets share one `branch_circuit` value. Check that first.
with m as (select p.period_start, d.branch_circuit, sum(p.energy_kwh) kwh
           from period_reports p join devices d on d.id = p.device_id
           where p.period = 'day' and d.class = 'meter' group by 1, 2),
     o as (select p.period_start, d.branch_circuit, sum(p.energy_kwh) kwh
           from period_reports p join devices d on d.id = p.device_id
           where p.period = 'day' and d.class = 'outlet_dual' group by 1, 2)
select m.period_start, m.branch_circuit, round((m.kwh - coalesce(o.kwh, 0))::numeric, 2) as untracked_kwh
from m left join o using (period_start, branch_circuit) order by 1 desc, 2;

-- 6. Device availability (coverage) per day, last 14 days.
select period_start, device_id,
       round(100.0 * online_sample_count / nullif(expected_sample_count, 0), 1) as coverage_pct
from period_reports where period = 'day' and period_start >= current_date - 14
order by period_start desc, coverage_pct;

-- 7. The longest gaps in recording (retained window).
select ts as last_before_gap, next_ts, next_ts - ts as gap
from (select ts, lead(ts) over (order by ts) as next_ts from building_totals) g
where next_ts - ts > interval '2 minutes'
order by gap desc limit 5;

-- 8. Effect of a schedule change: average daily energy per device, 14 days before and after a date.
select device_id,
       round(avg(energy_kwh) filter (where period_start <  date '2026-09-15')::numeric, 3) as before_kwh_per_day,
       round(avg(energy_kwh) filter (where period_start >= date '2026-09-15')::numeric, 3) as after_kwh_per_day
from period_reports
where period = 'day' and period_start between date '2026-09-01' and date '2026-09-28'
group by device_id order by device_id;

-- 9. Cost at the tariff in force on each day.
select p.period_start, round(p.energy_kwh::numeric, 2) as kwh, t.currency,
       round((p.energy_kwh * t.rate_per_kwh)::numeric, 2) as cost
from period_building_reports p
join lateral (select currency, rate_per_kwh from energy_tariffs
              where effective_from <= p.period_start order by effective_from desc limit 1) t on true
where p.period = 'day' order by p.period_start desc;

-- 10. Baseline against current: two periods of equal length, building-wide.
select period_start, energy_kwh, peak_total_power_w,
       round(100.0 * online_sample_count / nullif(expected_sample_count, 0), 1) as coverage_pct
from period_building_reports
where period = 'month' and period_start in (date '2026-08-01', date '2026-09-01');
```

Every figure a report states should travel with its coverage, as queries 1, 6 and 10 show. A month at 27 % coverage,
like the pilot's first, partial month [E-080], is a different claim from a month at 99 %.

### Reporting exports

The Reports page exports each period's figures as CSV and as a PDF, with coverage beside every figure (ROADMAP EX-033,
RM-140). That export is what government energy reporting draws on ([93](93-governance-compliance.md)).

## How it fails

| Symptom | Likely cause | Check that tells the causes apart | Fix | How to confirm it held |
|---|---|---|---|---|
| Writes fail silently | The database is unreachable, or refusing | `ingestion_health.last_error`; is `buffered_row_count` growing? `journalctl -u ibems-ingest` | Restore the connection or the key. The buffer flushes itself. | `buffered_row_count` back to 0 [E-134] |
| Duplicate rows | Not possible for readings and totals, which upsert on their keys [E-162] | Check whether the "duplicates" differ in `ts` by seconds | None needed. It is two minutes, not one minute twice. | — |
| Wrong time zone in a report | A query formatting UTC as local, or a site row with the wrong zone | `select timezone from sites`; is the query converting with `at time zone`? | Fix the site row, or the query | A known event appears at its local time |
| A negative or doubled day | A counter rolled over, or a register jumped | Compare that day's `energy_kwh` with its integrated power (`*_integrated`). Is `energy_removed_kwh` set on the report row? | Report generation restates such days and records the restatement (`energy_removed_kwh`, `energy_restated_at`) | The day's energy agrees with its integrated power |
| A circuit's day short of its integrated power | Its register fell inside the day (a restart, a channel swap), and the reduction was not banking it | Compare `energy_kwh` with the circuit's power over the day. Is phase53 applied (`readings_hourly.energy_kwh_gain` exists)? | Apply phase53: it banks the register across a fall and restates stored rows, keeping `energy_kwh_before` [E-235] | The day within a few percent of its integrated power |
| Totals do not match the meter on the incomer | A branch unmetered, a CT wrong, or silent branches excluded | Query 5; coverage; a clamp meter on each branch | Fix the CT or add the branch meter ([01](01-field-devices.md)) | Within the institution's tolerance |
| Storage outruns the plan | Raw rows × bytes/row above the cap | `select pg_size_pretty(pg_database_size(current_database()))` | Upgrade the plan, or shorten raw retention | Size flat week on week |
| The project was paused by the host | Free plan inactivity | The Supabase dashboard; ingest's `last_error` | Restore the project. Pick a plan that never pauses. | `last_success_at` advancing |
| The UI is empty, but rows exist | Row-level security: not signed in, or the query selects a revoked raw table | Does the same page work signed in? Does the call use a database function? | Sign in, or read through the function [E-161, E-165] | The page shows the rows |

## Field issue log

Site specifics are in [99](99-worked-example.md).

| Date | Symptom | Root cause | Fix | Evidence | Lesson |
|---|---|---|---|---|---|
| 2026-08-21 | The raw table grew without bound | Nothing had ever deleted a row | 30-day retention, rolling up and pruning in one transaction | E-070 | A delete without its rollup destroys data |
| 2026-09-08 | Two pages showed two different building totals | Two derivations of the same circuits, never compared | The total became the sum of the branch meters | E-168 | One quantity, one derivation |
| 2026-09-22 | Recorded minutes overstated for a held meter | A held value counted as a recorded minute | Held minutes counted separately (phase47) | ROADMAP FI-027 | A held value is not a measurement |

## What to keep on the shelf

| Item | Why |
|---|---|
| A recent `npm run backup` export, off the edge | A restore needs it ([backup-policy](backup-policy.md)) |
| The date of the last restore rehearsal | An untested backup is a Hypothesis |
| The Q-01 size figures, updated quarterly | They decide the plan |
