---
title: ADR-0009 — Anomaly detection is rolling statistics, and both tests must agree
status: Accepted
date: 2026-08-19
evidence: [E-076, E-204, E-247]
---

# ADR-0009 — Anomaly detection is rolling statistics, and both tests must agree

**Status:** Accepted, 2026-08-19. Amended by RM-004 after measurement, 2026-09-07, and by RM-160, 2026-10-05 ·
**Decided by:** the project team; RM-160's gate with the operator

## Context

The dashboard needed to flag unusual power per device, with no history to train on. The rule had to be explainable to
an operator, and quiet enough to be believed.

Agreement did not make it quiet. In the seven days to 2026-10-05 it still recorded 1,524 anomalies, about 220 on a full
day, every one passing both tests [E-247]. Most came from loads that cycle: one outlet runs about five minutes in every
twenty-four, and a branch meter steps between several levels. The window explains it. A level held for k of the 20
samples, the rest at zero, gives z = √((20 − k) / k), which reaches 3.5 only for k ≤ 1. So every new level was flagged
on its first and second minute, and absorbed by the third, however often the device returned to it.

## Decision

The ingest daemon keeps a rolling window of 20 samples per device (about 20 minutes), with a 10-sample warm-up. It
records a reading as an anomaly only when all of these hold:

- **both** tests flag it [E-204]:
  - a z-score of at least 3.5;
  - Tukey's far-out fence, 3.0 × the interquartile range;
- **the level is unfamiliar** [E-247]: fewer than 5 of the device's own online minutes in the previous 7 days lie
  within ±15 % of it, never narrower than ±5 W. The edge's archive answers, so a restart forgets nothing;
- **it starts a run**: the device's previous reading was not itself unusual. One run is one row.

A noise floor stands in for the spread of a flat window, so a real jump on a steady device is still caught. Which
check fired is stored with every row [E-076]. When the archive cannot answer, the level counts as unfamiliar and the
reading is recorded: a fault there costs noise, never silence.

## Alternatives considered

| Option | Why not |
|---|---|
| Either check flags | Tried first. In four days to 2026-09-07 it recorded 2,833 anomalies, 2,152 from the IQR check alone, and every switch-on's second sample raised one [E-204]. |
| A trained model | There was no history to train on, and an operator cannot interrogate one |
| One row per run, and nothing else | Replayed on the week to 2026-10-05: about 919 rows of 1,551, still about 130 a day [E-247] |
| A list of cycling devices to skip | 256 rows, but the three skipped devices would go unwatched even at 2 kW, and every building would need its own list [E-247] |
| A two-state (on/off) baseline | The busiest meter holds several levels, and another is not two-state at all [E-247] |
| A minimum duration | 98 % of flagged runs lasted one or two minutes, because the window absorbs a new level by the third. A real jump is absorbed the same way [E-247] |
| A familiar level counted only in the same part of the week | 41 runs a week against 25. The operator chose any time: use out of hours is a pattern, and the reports' working-hours baseline is the place to judge it [E-247] |

## Consequences

- Anomalies are kept 365 days, and the alerts bell shows them ([05](../05-interface.md#user-guide)). Replayed, the gate
  leaves about 4 rows a day where there were about 220 [E-247].
- The reports count **unusual events**. A report for a period that began before 6 Oct 2026 says that its count is
  the older kind; the rows recorded before then were left as they were.
- The method column makes the choice auditable, and tunable, afterwards.
- It sees one device at a time. A slow drift over weeks, or a building-wide pattern, is not what it catches.
- **What RM-160 gives up** [E-247]: a familiar level at an unusual hour (the aircon at 03:00 at its usual draw), and a
  cycling load stuck on. Before, each raised two rows among about 220 a day. The sharpest case is a **tripped breaker
  in the day**: every metered device rests at 0 W overnight, so a fall to zero is always familiar. In the week to
  2026-10-05, 185 falls to zero were flagged, 37 in office hours, and each read like a load being switched off.
  Recording them again would bring back about a hundred runs a week.

## What would change this answer

Enough history, a year or more, to model normal use by time of day and season. Then weigh a baseline model against
this one on the stored rows, using the `method` column to compare. See ADR-0010.
