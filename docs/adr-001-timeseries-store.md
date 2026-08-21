# ADR-001 — The time-series store stays Postgres (Supabase). No InfluxDB.

**Status:** Accepted, 2026-08-21. Amended 2026-08-22 to answer the split proposal and
Google Sheets, both raised after the original decision.
**Decides:** ROADMAP §5 — "should iBEMS move device readings to a purpose-built time-series
database?", and the follow-up form of the same question: "should Supabase be the brain for
application logic while InfluxDB is the engine for sensor telemetry, with Google Sheets as
the reporting surface?"

A recorded answer, in the sense RM-005 uses the phrase. The question is reasonable, it will
be asked again at the next site, and an ADR exists so it is answered once with its reasoning
attached rather than re-argued from scratch by whoever asks next.

## Context

iBEMS stores per-device metering in Postgres, via Supabase: `readings` at one row per device
per 60s tick, aggregated for display by the `readings_buckets` RPC, aged into
`readings_hourly` and pruned by `server/retention.mjs`. InfluxDB is the obvious alternative —
it is built for exactly this data shape, and "energy monitoring" is its canonical example
workload.

**What is actually true about the current deployment**, measured rather than assumed:

- 20 devices, one sample per minute. That is **0.33 writes/sec**.
- 130,367 rows after 4.7 days of operation, ~27,700/day (measured on the live Pi, 2026-08-21).
- Steady state under the current 30-day policy: ~830k rows in `readings`, ~175k rows/year in
  `readings_hourly`. Both bounded.

**One prior belief, corrected here so it is not inherited:** an earlier reading of this
project's history suggested `node-red-contrib-influxdb` was installed on the Pi, as a
survivor of the pre-Stage-1 design in the way the Mosquitto broker is (RM-005). It is not.
`node-red-bridge/live-flow-baseline.json` — the redacted capture of the real flow — contains
**zero** InfluxDB nodes, and the string does not appear anywhere in this repository. The
path that suggested otherwise was a Node-RED installation on a developer's Windows machine,
not the Pi. There is no InfluxDB legacy here to either honour or clean up. (Whether the npm
package is present on the Pi host while unused by the flow is not answerable from off-site,
and would not change this decision either way.)

## Decision

**Keep Postgres. Do not introduce InfluxDB, or any second datastore, at this scale.**

## Why

**1. The workload is three to six orders of magnitude below where a TSDB earns its keep.**
InfluxDB's design centre is 10⁴–10⁶ points/sec. This system writes 0.33/sec. Postgres will
not notice this workload for years, and "it is time-series data" is a statement about shape,
not about volume.

**2. The features it would have bought are already built, tested and verified.** Continuous
downsampling and retention policies are InfluxDB's headline advantages over a relational
store — and they are EX-055, EX-085 and EX-086: `roll_up_and_prune_readings`,
`readings_buckets`, and a stateless retention trigger, all landed and verified against real
data on 2026-08-21. Migrating now would mean deleting working, tested code in order to
re-solve a problem that is solved.

**3. The security model does not port, and it is load-bearing.** This is the strongest
argument and the one most easily missed.

- `readings_buckets` is `security invoker` **specifically** so Row Level Security still
  applies; its own header records that a `security definer` version would "hand every reading
  to any caller, silently undoing phase5_lockdown_rls.sql".
- `phase9_command_outcome.sql` grants a deliberately narrow update: own row, only while in
  flight, only to a terminal status.
- Every table's access is expressed as an RLS policy tied to a Supabase Auth user, and
  command audit rows are attributed to the real signed-in operator (EX-101).

InfluxDB authorizes with org/bucket tokens. It has no row-level policy bound to a Supabase
Auth identity. Moving readings there means inventing a second authorization model and a proxy
layer to bridge the two — replacing a mechanism the database enforces with one application
code has to remember to enforce. That is a downgrade, and it is the kind that fails silently.

**4. It splits every join the reporting work needs.** A monthly report joins readings to
`devices`, to `device_config` (room, category, shed group) and to `commands`. In one store
that is SQL the database optimises. Across two stores it becomes application code fetching
both sides and joining them in memory — more code, no index, and a new class of bug.

**5. There is nowhere good to run it.** On the Pi puts the permanent historical archive on
the least reliable node in the system: the host that lost all 18 field devices to a band
mismatch on 2026-08-20 and dropped its own uplink for seven minutes on 2026-08-21. InfluxDB
Cloud means a second vendor, a second bill and a second backup surface — while RM-006d
records that the *first* one still has no verified backup. Adding an unbacked store while an
unbacked store is an open action item is the wrong order to do things in.

**6. Operational cost is not free.** A second datastore is a second thing to deploy, monitor,
upgrade, secure, back up, and explain to whoever inherits this. The project's existing
instinct — `supabaseRest.mjs` is a hand-rolled dozen-line client rather than a dependency,
`mock-bridge` is zero-dependency — is to refuse complexity that has not earned itself. This
has not.

## The split version: Supabase as "brain", InfluxDB as "engine"

Raised 2026-08-22, and answered separately because it is a genuinely better proposal than
"replace Postgres with InfluxDB" — and because a future reader will arrive at it
independently.

The shape: application state (auth, devices, schedules, thresholds, the command audit) stays
in Supabase; sensor telemetry moves to InfluxDB. Polyglot persistence, each store doing what
it is good at.

**What is right about it**, said plainly rather than waved past: the instinct is correct.
Telemetry does have a different access pattern from application state — high-volume
append-only writes, time-ordered reads, downsampling, retention windows. Splitting the two is
a real pattern in production IoT, not a mistake. A system built from scratch at ten times
this scale should probably look roughly like this.

**Why it is still the wrong call here: the split cuts straight through the queries this
system actually runs.** Measured against the code rather than asserted:

- **Auto-shed** is the sharpest case. `planShed` takes four inputs and produces a fifth:
  live per-device `readings` and the building `_totals` (telemetry), `dsm_thresholds` (the
  operator's configured limits), `device_config` (the operator's shed-group assignments), and
  it writes a `commands` audit row. Three of those five are application state and two are
  telemetry — so the split would run straight through the middle of a single decision, taken
  every 15 seconds, about whether to switch a real relay off.
- **The monthly report** joins six sources: `readings_hourly`, `readings`,
  `building_totals_hourly`, `building_totals`, `commands`, `anomalies`. Four are "brain", two
  are "engine".
- **The Devices table** renders each row from three sources at once: live telemetry, the
  device registry, and the operator's own `device_config` edits (room, category, shed group).
  Analytics is the milder case — it joins telemetry to `devices` only, not to
  `device_config`.

Each of those becomes application-side join code: more surface, no index, and a new class of
bug in the one path that can move a relay.

**The security argument survives the split unchanged, and is the strongest one.** Today the
browser reads telemetry *directly* from Supabase with the anon key, and RLS is the only thing
keeping it behind a login — `readings_buckets` is `security invoker` precisely for that. Move
telemetry to InfluxDB and the proxy must mediate every telemetry read, behind a second
authorization model with no relationship to a Supabase Auth user. That is a large new surface
added to protect data that is already protected, and it is the kind of change that fails
quietly rather than loudly.

**And the "engine" already exists.** Continuous downsampling and retention policies are the
features the split would be buying, and they were built, tested and verified against real
data in Phases 9 and 11. Adopting InfluxDB means deleting working code to re-solve a solved
problem.

## Google Sheets

Raised alongside the split, as the reporting surface. It gets a different answer: **Sheets is
a good destination and a bad database.**

As a destination it fits this project well — the deliverables are institutional reports, and
everyone at the site can already read a spreadsheet. The only question is how the data gets
there, and that is where it stops being free:

- An automated sync needs a Google service-account credential on a deployment whose
  repository is public, plus the `googleapis` dependency, on a server that deliberately has
  none (`server/supabaseRest.mjs` is hand-rolled for exactly this reason).
- The CSV export built in Phase 12 already reaches Sheets in one step (File -> Import).

So an automated sync buys "nobody has to click" and costs a managed secret. That is a bad
trade today and a defensible one later, if monthly reporting becomes an obligation to someone
who will not log in. Recorded as **FI-011**, deliberately paired with FI-005's alert channel
so the credential problem is solved once rather than twice.

Sheets as the *store* — the system writing readings into a spreadsheet and reading them back
— is not on the table. No types, no constraints, no RLS, a hard row ceiling, and an API quota
that would drop writes silently.

## What would change this answer

Stated as triggers, so this is a decision rather than a preference. Any one of these raises
the row rate by roughly two orders of magnitude and makes the question live again:

- **Sub-minute sampling** — per-second metering, or streaming waveform/power-quality data.
- **100+ devices at the current cadence**, or ~20 devices at per-second cadence.
- **The multi-site rollout (FI-003)** — many buildings ingesting concurrently into one
  store. This is the realistic trigger, and the only one likely to fire on its own: ten
  buildings at the current cadence is roughly **105M rows/year** before retention, which is
  where the split stops being premature and starts being the right answer.
- **Query latency becoming user-visible** on the rollup path despite correct indexing.

Absent one of those, re-opening this is a rewrite in search of a reason.

## The one argument for the split that is not technical

Recorded because it is the argument most likely to actually reverse this decision, and
because dismissing it as unserious would be dishonest.

This is an academic project. A panel or reviewer may expect to see a recognised IoT stack,
and "we used Postgres" can read as not having considered the question at all. That is a
presentation concern rather than an engineering one — but presentation concerns are real when
the deliverable is a thesis.

The better answer to it is this document. *"We measured 0.33 writes/sec, implemented
downsampling and retention in Postgres, and recorded the thresholds at which we would
migrate"* is a stronger defence than *"we used InfluxDB because it is what is used."* If a
panel still disagrees after reading it, that is a legitimate reason to revisit — and it
should then be recorded as what it is: a decision made for how the work is received, not for
how it runs.

## The staged answer

| Stage | Trigger | Move |
|---|---|---|
| **Now** | — | One Postgres store, plus CSV export. Built and running. |
| **Next** | `readings` growth outpaces the prune | Partition by month; the prune becomes `DROP TABLE`. Same store, same RLS, same backups. (FI-012) |
| **Only then** | One of the triggers above actually fires | Revisit a TSDB — with partitioning experience in hand to judge whether it is still needed. |

## The successor inside Postgres, if growth does bite

If `readings` volume ever becomes a real problem, the next step is **native declarative
partitioning by month**, not a new database. Partitioning turns the prune into a
`DROP TABLE` — instant, no long-held lock, no vacuum debt — while staying inside RLS, Auth,
the existing backups and the existing test suite.

The concrete motivation already exists: `roll_up_and_prune_readings` currently ends in a
single unbounded `DELETE ... WHERE ts < cutoff` inside one transaction. That is harmless at
today's volumes and while it runs every six hours, but it is the part that degrades first as
the table grows, and partitioning is what removes it rather than tuning it.

`pg_partman` would make this tidier. Whether that extension is available on this Supabase
project has **not** been verified — check before planning around it.

## Consequences

- Reporting, retention and history all continue to target one store, one security model, one
  backup.
- RM-006d (a verified backup) covers everything, because there is only one thing to cover.
- The project keeps its zero-added-dependency posture on the server side.
- If a future site does hit a trigger above, this document is the starting point, not a
  blank page — and the partitioning step is the thing to try before the rewrite.
