---
title: Architecture decisions
purpose: Index of every architecture decision record, including the two that predate this folder
audience: [integrator, administrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo 23bb463
evidence: [E-030, E-032, E-062, E-063, E-072, E-075, E-076, E-203, E-205]
---

# Architecture decisions

Each record states the decision, when it was made, the alternatives, and **what would change the answer**. New records
use [`_templates/adr.md`](../_templates/adr.md) and are numbered from ADR-0003.

The first two records keep their original names and places, one level up. Code comments cite `adr-002` by path in nine
files, and moving it would change code, which this documentation work does not do [E-072].

| ID | Decision | Status | Decided |
|---|---|---|---|
| [ADR-001](../adr-001-timeseries-store.md) | The time series stays in Postgres (the hosted database). No InfluxDB, no split store. | Accepted | 2026-08-21 |
| [ADR-002](../adr-002-device-recovery-path.md) | Recovering a device that has stopped responding | Proposed | 2026-09-17 |
| [ADR-0003](ADR-0003-mqtt-not-device-transport.md) | MQTT is not the device transport; the broker is kept for the inverter bridge alone | Accepted | 2026-08-10 |
| [ADR-0004](ADR-0004-no-home-assistant.md) | Home Assistant was not adopted | Accepted | 2026-08-10 |
| [ADR-0005](ADR-0005-no-timescaledb.md) | TimescaleDB was not adopted; the time series stays in plain Postgres | Accepted | 2026-08-21 |
| [ADR-0006](ADR-0006-n8n-removed.md) | n8n was trialled and removed | Accepted | 2026-08-16 |
| [ADR-0007](ADR-0007-config-driven-registry.md) | One static, configuration-driven device registry, from which the flow is generated | Accepted | 2026-08-10 |
| [ADR-0008](ADR-0008-standalone-web-app.md) | A standalone web application, not the flow engine's built-in dashboard | Accepted | 2026-08-10 |
| [ADR-0009](ADR-0009-anomaly-rolling-statistics.md) | Anomaly detection is rolling statistics, and both tests must agree | Accepted | 2026-08-19 |
| [ADR-0010](ADR-0010-defer-predictive.md) | Predictive control and maintenance wait for enough history | Proposed | 2026-09-24 |

## How these were dated and checked

Each record was written after the audit and checked against its evidence rows. Two rules follow from that:

- **The date is the decision's, not the writing's.** Where the system was built that way from its first commit, the
  record says so and gives the commit's date [E-203]. Where the decision was only written down later, the record
  gives both dates. The legacy architecture document dates the rejection of the MQTT and Home Assistant design to
  its 2026-08-26 rewrite [E-205]. That answers Q-14: no separate 2026-08-18 revision was found.
- **Alternatives are marked when they are reconstructed.** Most early decisions left no record of the options
  weighed. Those tables say so, and give only reasons the evidence supports now.

One premise the prompt carried was refuted: MQTT was not "dropped". The broker is installed and running, and exposed
(F-001). ADR-0003 records what was actually decided.
