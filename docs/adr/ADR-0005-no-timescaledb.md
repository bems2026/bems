---
title: ADR-0005 — TimescaleDB was not adopted; the time series stays in plain Postgres
status: Accepted
date: 2026-08-21
evidence: [E-032, E-070, E-075, E-080, E-165]
---

# ADR-0005 — TimescaleDB was not adopted; the time series stays in plain Postgres

**Status:** Accepted · **Decided:** 2026-08-21, with [ADR-001](../adr-001-timeseries-store.md) · **Decided by:** the
project team

## Context

Earlier planning assumed a time-series database under the readings. The legacy System Dossier names TimescaleDB among
three components "that earlier planning assumed" and then dropped. No other record of the proposal survives [E-075].
ADR-001 weighed the same question for InfluxDB, with the pilot's measured write rate.

## Decision

Readings are stored in plain Postgres, in the hosted database, with no time-series extension. The per-minute table is
kept 30 days and rolled up into hourly tables, which are kept for good [E-070]. Long ranges are read through database
functions that cross that boundary [E-165].

## Alternatives considered

*Reconstructed: no record of the options weighed at the time survives. These are the reasons that hold on the evidence now.*

| Option | Why not |
|---|---|
| TimescaleDB | The volume does not need it: about 0.33 writes a second and 28,600 rows a day at the pilot (ADR-001, E-080). It would tie the project to a host that offers the extension. |
| InfluxDB beside Postgres | Decided against in ADR-001: two stores, two backups, and queries that must join across both |

## Consequences

- One store, one backup, one set of row-level policies ([04](../04-data.md)).
- Not installed on the edge [E-032].
- Growth is handled by retention and rollups, and ADR-001 names partitioning as the next step.

## What would change this answer

ADR-001's triggers: a write rate or table size that plain Postgres, partitioned, no longer serves. Measure bytes per
row before deciding (Q-01).
