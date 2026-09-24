---
title: ADR-0009 — Anomaly detection is rolling statistics, and both tests must agree
status: Accepted
date: 2026-08-19
evidence: [E-076, E-204]
---

# ADR-0009 — Anomaly detection is rolling statistics, and both tests must agree

**Status:** Accepted, 2026-08-19. Amended by RM-004 after measurement, 2026-09-07 · **Decided by:** the project team

## Context

The dashboard needed to flag unusual power per device, with no history to train on. The rule had to be explainable to
an operator, and quiet enough to be believed.

## Decision

The ingest daemon keeps a rolling window of 20 samples per device (about 20 minutes), with a 10-sample warm-up. It
records an anomaly only when **both** of these flag the new reading [E-204]:
- a z-score of at least 3.5;
- Tukey's far-out fence, 3.0 × the interquartile range.

A noise floor stands in for the spread of a flat window, so a real jump on a steady device is still caught. Which
check fired is stored with every row [E-076].

## Alternatives considered

| Option | Why not |
|---|---|
| Either check flags | Tried first. In four days to 2026-09-07 it recorded 2,833 anomalies, 2,152 from the IQR check alone, and every switch-on's second sample raised one [E-204]. |
| A trained model | There was no history to train on, and an operator cannot interrogate one |

## Consequences

- Anomalies are kept 365 days, and the alerts bell shows them ([05](../05-interface.md#user-guide)).
- The method column makes the choice auditable, and tunable, afterwards.
- It sees one device at a time. A slow drift over weeks, or a building-wide pattern, is not what it catches.

## What would change this answer

Enough history, a year or more, to model normal use by time of day and season. Then weigh a baseline model against
this one on the stored rows, using the `method` column to compare. See ADR-0010.
