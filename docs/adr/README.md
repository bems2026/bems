---
title: Architecture decisions
purpose: Index of every architecture decision record, including the two that predate this folder
audience: [integrator, administrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo afa5aaf
evidence: [E-030, E-032, E-062, E-063, E-072, E-075, E-076]
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

## To be written (Phase B)

The prompt (§9) asks for these. Each is confirmed against the audit before it is written. Where the audit refutes the
premise, the record states what was actually decided (claims check C1).

| Planned record | What the audit already says |
|---|---|
| MQTT is not a device transport; the broker is reserved for the inverter bridge | MQTT carries no device traffic (one disabled client node, E-030). The broker **remains installed**, and its exposure is finding F-001, so this record waits on F-001. |
| Home Assistant was not adopted | Not installed on the edge (E-032); named in no tracked file (E-075) |
| TimescaleDB was not adopted | Not installed; the time series stays in hosted Postgres (ADR-001, E-032) |
| n8n was trialled and removed | Decommissioned on the edge on 2026-08-16 (E-032); recorded in `node-red-bridge/cleanupPlan.mjs` (E-075) |
| A static, configuration-driven device registry | `shared/registry.mjs` fed by `shared/sites/<site>/` (E-063); the flow is generated from it (E-062) |
| A standalone web application instead of the flow engine's built-in UI | The Node-RED dashboard palette is installed, but the app is React (E-060, E-018) |
| Anomaly detection is scoped to rolling statistics | z-score and IQR must agree; there is no model (E-076) |
| Predictive control and maintenance are deferred until there is enough history | Not built (X2a §3.6, E-076) |
