# ADR-001 — The time-series store stays Postgres (Supabase). No InfluxDB.

**Status:** Accepted, 2026-08-21
**Decides:** ROADMAP §5 — "should iBEMS move device readings to a purpose-built time-series
database?"

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

## What would change this answer

Stated as triggers, so this is a decision rather than a preference. Any one of these raises
the row rate by roughly two orders of magnitude and makes the question live again:

- **Sub-minute sampling** — per-second metering, or streaming waveform/power-quality data.
- **100+ devices at the current cadence**, or ~20 devices at per-second cadence.
- **The multi-site rollout (FI-003)** — many buildings ingesting concurrently into one store.
- **Query latency becoming user-visible** on the rollup path despite correct indexing.

Absent one of those, re-opening this is a rewrite in search of a reason.

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
