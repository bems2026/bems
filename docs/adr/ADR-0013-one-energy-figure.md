---
title: ADR-0013 — A period's energy is the sum of its circuits, on every tab
status: Accepted
date: 2026-10-01
evidence: [E-233]
---

# ADR-0013 — A period's energy is the sum of its circuits, on every tab

**Status:** Accepted · **Decided:** 2026-10-01 · **Decided by:** the operator, on the RM-154 plan. **Amends:** the stored
building row's standing as "authoritative" (phase27 and phase47). RM-057 had already made that building row the sum of
the same meters.

## Context

- **Two figures for one period.** The operator asked why the Reports page's Overview and Circuits tabs printed
  different energy for the same period: the week of 21 Sep 2026 read 80.53 kWh on one and 77.88 on the other
  [E-233].
- **Both are the same four branch meters, reduced two ways.**
  - The Overview read the stored building row. That row is the bridge's month counter, which banks every bounded
    rise of the registers as it happens, across a counter that falls.
  - The Circuits tab summed each meter's bounded daily energy, rebuilt in SQL from stored hourly readings. That
    credits nothing for the hours around a counter falling, and trims impossible jumps.
- **On most days they agree to the hundredth.** They part where a counter reset, jumped or missed hours.
- **Measured [E-233]:**
  - On 23 Sep the counter read 17.26 kWh, the circuits 19.59, and the meters' average power over the day 21.00.
  - The counter's week of 21 Sep (80.53) is not the sum of its own seven days (75.17).
  - The circuits' week (77.88) is exactly the sum of theirs.

## Decision

- **A period's energy is the sum of its branch circuits' bounded energy.** A day's energy is the sum of its circuits'
  daily energy.
- **The same figure everywhere:**
  - both tabs, "vs the previous period", Compare, and the baseline comparison;
  - the cost and emissions;
  - the daily CSV and the PDF.
- **The building counter is kept as a stated check.** When it differs by a twentieth of a kilowatt-hour or more, the
  page says so once, in the same words on both tabs, with the days the two part.
- **A missing circuit row keeps the counter.** A sum missing a branch is not the building.
- **A circuit refused as impossible is named.** The figure then says it is at least that much.
- **Where it lives.** `src/lib/periodEnergy.ts`, applied once in `ReportsPage`.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep the counter and show the circuits' shortfall as "unattributed" | It would add a row for an artefact rather than a load. The counter does not add up even to its own days, so its residual would be a measurement error presented as energy. |
| Fix the SQL so the circuits bank energy across a falling counter, as the bridge does | A migration plus a backfill of every stored device row. Worth doing, but it is a change to stored history and needs the operator to apply it. The page rule stands either way: it makes the tabs agree with whatever the circuits say. |
| Rewrite the stored building rows to the circuits' sum | It would lose the counter, the only independent second reduction, and needs a write to the database's history. |

## Consequences

- **The Overview's energy can differ from the stored building row.** The difference is stated beside it, not hidden.
- **The Overview reads the circuits' days.** That is one more limited database call per period.
- **Compare reads the earlier period's circuits.** That is one `period_reports` read when the earlier period is chosen.

## What would change this answer

- **The SQL reduction is fixed to bank across falling counters.** The counter note should then fall silent, except
  for gaps in the stored rows, and that would confirm the rule.
- **A site whose branch meters do not cover the whole building.** Then the circuits' sum is a part of the building
  and the counter is the whole; the rule would have to say "metered energy", and the counter would come back as a
  figure of its own.
