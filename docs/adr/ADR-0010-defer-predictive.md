---
title: ADR-0010 — Predictive control and predictive maintenance wait for enough history
status: Proposed
date: 2026-09-24
evidence: [E-070, E-125, E-174, E-204]
---

# ADR-0010 — Predictive control and predictive maintenance wait for enough history

**Status:** Proposed · **Recorded:** 2026-09-24, by this manual. No earlier dated decision was found; the system has
simply never built them · **Decided by:** to be confirmed by the project team

## Context

X2a §3.6 describes predictive and optimising control: forecasting load, pre-cooling, optimum start and stop. Predictive
maintenance would forecast device failure from its readings. Both need history that captures the building's cycles:
days, weeks, seasons and occupancy.

As built, the per-minute record reaches back 30 days and the hourly record to the first day of logging [E-070]. The
Automation page lists optimum start and stop as **not installed**, blocked on a room-temperature history [E-174]. The
pilot's stand-alone room sensor was never installed [E-125].

## Decision

Build neither until the site holds at least a full year of hourly history, covering every season and semester. Until
then, control stays rule-based (schedules, limits, the room-target loop) and anomaly detection stays statistical
(ADR-0009).

## Alternatives considered

| Option | Why not |
|---|---|
| Build now on the history available | A model trained on part of a year learns part of a year. Its errors would switch real loads. |
| Buy a vendor's predictive service | It would move control decisions off the audited path, and out of the institution's hands |

## Consequences

- The hourly tables must be kept, and backed up, for their whole life ([04](../04-data.md)).
- The room temperature must be recorded, not only read live. That is tracked as FI-032 in ROADMAP.

## What would change this answer

A full year of clean hourly history per circuit, room temperature recorded beside it, and a named use: a measured
saving that rules cannot reach.
