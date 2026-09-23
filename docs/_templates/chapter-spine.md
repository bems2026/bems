---
title: <Chapter name — two to four words>
purpose: <One sentence: what the reader can do after reading this>
audience: [<administrator | operator | installer | integrator>]
status: Draft                    # Draft | Reviewed | Verified
last_verified: <YYYY-MM-DD>      # the date someone last checked this page against the running system
applies_to: <repo commit or tag>
evidence: [<E-NNN>, …]           # every ledger row this page cites
---

# <Chapter name>

<!-- Every layer and plane chapter uses this spine, in this order. Delete nothing: an empty section says
     "Nothing yet" and why, so a reader can tell "not needed" from "not written". -->

## What it is

<!-- The explanation. Why it exists, the mechanism, the design decisions, and the trade-offs (R7: "why" lives here,
     not in procedures). Name the technology and its version (R6). Mark every claim about the as-built system
     with an evidence tag [E-NNN], or [UNVERIFIED], and say Confirmed or Hypothesis where it matters (R4).
     Give each feature a status: Field-validated · Bench-validated · Implemented, not validated · Planned (R8).
     Planned items only link to 94-roadmap.md. -->

## What you need

<!-- Parts, accounts, skills and access, as a table. Specifications that matter; no part numbers unless verified
     (G6); no prices. -->

## How to install

<!-- Procedures, built from _templates/procedure.md. -->

## How to configure

<!-- Procedures. Settings as tables: name, meaning, units in the header (R3), default, and where it lives. -->

## How to verify

<!-- What a person observes that proves it works. A pass is something a witness can see, not a screen that
     looks right. -->

## How to operate

<!-- Routine tasks, and what "good" looks like. -->

## How it fails

<!-- Fault matrix. Every row follows _templates/fault-entry.md: symptom → likely cause → check that tells the
     causes apart → fix → how to confirm it held (R2). -->

| Symptom | Likely cause | Check that tells the causes apart | Fix | How to confirm it held |
|---|---|---|---|---|

## Field issue log

<!-- Real problems met in the pilot, written as generalised lessons (_templates/field-issue.md). Site specifics
     stay in 99-worked-example.md, and this log links there. -->

## What to keep on the shelf

<!-- Spares, with the reason and the lead time. No prices. -->
