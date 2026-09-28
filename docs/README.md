---
title: iBEMS manual
purpose: Front page of the adoption and replication manual — where to start, by role, and what state each chapter is in
audience: [operator, administrator, installer, integrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo cdf750f
evidence: [E-051, E-060, E-061, E-062, E-063, E-064, E-065, E-066, E-071, E-086, E-135, E-168, E-170, E-196]
---

# iBEMS — adoption and replication manual

iBEMS is a low-cost building energy management system. Branch meters, relays and an infrared commander sit on a
dedicated local network. A single-board edge server runs the control logic, and a hosted Postgres database keeps the
record. A web app shows it all and lets people act on it. **This manual is how another building builds, commissions,
operates and improves its own**, from nothing.

It describes a system, not an installation. Everything specific to the pilot site lives in one chapter,
[99-worked-example](99-worked-example.md). Every other chapter applies to any building.

!!! note "Every chapter is drafted"
    All chapters were written by 2026-09-24 (ROADMAP RM-145) and are marked **Draft**. A chapter becomes **Reviewed**
    once someone other than its author has read it. Where a chapter and a document in [Reference](#reference) disagree,
    trust the one verified more recently, and say so in [open questions](audit/open-questions.md).

## Start here, by role

| You are… | Read, in order |
|---|---|
| **Operator:** you use the dashboard day to day | [05 User interface](05-interface.md) (user guide) → [X2a Control strategy](X2a-control-strategy.md) §1–§6 → [91 Troubleshooting index](91-troubleshooting-index.md) |
| **Administrator:** you own the system for the institution | [00 Overview](00-overview.md) → [X1 Security](X1-security.md) → [X3 Operations](X3-operations.md) → [04 Data](04-data.md) → [93 Governance](93-governance-compliance.md) |
| **Installer:** you fit devices and wire panels | [01a Device roles](01a-device-roles.md) → [01 Field devices](01-field-devices.md) → [physical-install](physical-install.md) → [02 Network](02-network.md) |
| **Integrator:** you build and maintain the stack | [00 Overview](00-overview.md) → [03 Edge](03-edge.md) → [02 Network](02-network.md) → [04 Data](04-data.md) → [05 Interface](05-interface.md) → [X2 Control logic](X2-control-logic.md) → [90 Replication](90-replication.md) |

**Developer:** you change the code. Start with [Find it in the code](#find-it-in-the-code), then
[03 Edge](03-edge.md), [X2 Control logic](X2-control-logic.md) and [04 Data](04-data.md).

## Find it in the code

| Question | Where | Read |
|---|---|---|
| Which devices exist, and on which circuits? | `shared/sites/<site>/` (`site`, `devices`, `circuits`), read through `shared/registry.mjs`. `shared/siteConfig.mjs` picks the site. | [03](03-edge.md), ADR-0007 [E-063] |
| Where is a raw reading turned into volts, amps and watts? | The parser on each device's Node-RED tab, generated from the capability catalogue `shared/deviceCapabilities.mjs` by `npm run fix-dp-parsers:pi`. The scale is per product. | [03 § Parsing](03-edge.md#parsing-raw-datapoint-to-engineering-unit) [E-135] |
| Where are readings combined into one per device, and into building totals? | `shared/buildLatest.mjs`, inlined into the generated bridge tab (`node-red-bridge/build-flow.mjs`) | [03](03-edge.md), [04](04-data.md) [E-062, E-168] |
| What writes the database? | `server/ingest.mjs`, every 60 s | [04 § Ingestion](04-data.md#ingestion) [E-086] |
| Where is the schema? | `supabase/schema.sql`, then every `supabase/phase*.sql` in filename order | [04](04-data.md) [E-064] |
| Where is a command authorised? | `server/proxy.mjs` (`handleCommand`): a verified session with a user; break-glass refused. Then `shared/commands.mjs` (`validateCommand`) checks the body. | [X1 § Authentication](X1-security.md#authentication-and-authorisation-end-to-end), [X2](X2-control-logic.md#when-the-system-refuses-to-act) [E-066, E-170] |
| Where is it recorded, and then sent? | `server/auditedDispatch.mjs` records first; `server/dispatchLight.mjs` sends it to the flow | [X2](X2-control-logic.md) [E-065, E-196] |
| What runs unattended? | `server/scheduler.mjs`: schedules, auto-shed and the aircon loop, deciding in `schedulePlan.mjs`, `shedPlan.mjs` and `acuLoopPlan.mjs` | [X2](X2-control-logic.md#where-each-strategy-lives) [E-071] |
| Where are the pages? | `src/App.tsx` routes by URL hash to `src/components/<page>/`; the live connection is `src/hooks/useLiveConnection.ts` | [05 § Architecture](05-interface.md#architecture) [E-060] |
| Where does the browser find the bridge? | `src/config/bridge.ts`, the only place a bridge address appears | [05](05-interface.md#architecture) [E-061] |

## The manual

The status column means:

- **Scaffold:** headings only.
- **Draft:** written, not yet reviewed.
- **Reviewed:** read by someone other than its author.
- **Verified:** checked against the running system on its `last_verified` date.

| Chapter | Covers | Status |
|---|---|---|
| [00 Overview](00-overview.md) | What iBEMS is, its principles, the architecture, feature status | Draft |
| [01 Field devices](01-field-devices.md) | L1: selection, panel work, pairing, calibration, faults | Draft |
| [01a Device roles and catalogue](01a-device-roles.md) | The six roles, twelve device types, installing, states, troubleshooting (ported Handbook Ch.1) | Draft |
| [02 Network](02-network.md) | L2: the device network, uplink, remote access | Draft |
| [03 Edge](03-edge.md) | L3: the edge server, from blank card to running | Draft |
| [04 Data](04-data.md) | L4: schema, ingestion, retention, sizing, queries | Draft |
| [05 Interface](05-interface.md) | L5: the web app and kiosk; user and administration guides | Draft |
| [X1 Security](X1-security.md) | Credentials, boundaries, accounts, threats | Draft |
| [X2 Control logic](X2-control-logic.md) | Where each strategy is implemented, the interlock, every refusal | Draft |
| [X2a Control strategy](X2a-control-strategy.md) | Triggers, strategies, priority, control flow, the 34-test manual (ported Handbook Ch.2) | Draft |
| [X3 Operations](X3-operations.md) | Commissioning, go-live, routine operations, backup, change, handover | Draft |
| [90 Replication](90-replication.md) | Step 1 to done, for a new building | Draft |
| [91 Troubleshooting index](91-troubleshooting-index.md) | Every fault, by symptom | Draft |
| [92 Glossary](92-glossary.md) | Every term, defined once | Draft |
| [93 Governance and compliance](93-governance-compliance.md) | Regulation, electrical safety, privacy, licensing | Draft |
| [94 Roadmap](94-roadmap.md) | Planned items only | Draft |
| [99 Worked example](99-worked-example.md) | The pilot site | Draft |
| [Architecture decisions](adr/README.md) | Why the system is built the way it is | Index |

## How to read the evidence tags

A tag like **[E-051]** points at a row of the [evidence ledger](audit/evidence-ledger.md). Each row names the command or
file that produced the observation, when, and whether it was **Confirmed** (observed), a **Hypothesis** (reasoned but
not observed), or **Stated** (the operator's word, not inspected). **[UNVERIFIED]** marks a claim nobody has checked;
each one is listed in [open questions](audit/open-questions.md). Statements of general engineering practice, such as
how to fit a current clamp, carry no tag. Every statement about how iBEMS behaves does.

Feature status follows one scale everywhere: **Field-validated** (observed working on the deployed system) ·
**Bench-validated** · **Implemented, not validated** · **Planned** (only in [94 Roadmap](94-roadmap.md)).

## Reference

These documents predate the manual and **stay at their paths**, because the code and tests cite them. The manual's
chapters link to them rather than restating them.

### Contracts

| Document | Read it when |
|---|---|
| [`bridge-contract.md`](bridge-contract.md) | You are touching anything the bridge emits. It is the single source of truth for field names; the mock and the real Node-RED flow are both held to it. |
| [`storage-contract.md`](storage-contract.md) | You are touching the database. It is additive to the bridge contract, never a rename of it. |

### Standing it up and running it

| Document | Read it when |
|---|---|
| [`replication.md`](replication.md) | You want the software half of a new site today: a transcript of a run that worked, marking which steps were executed and which were only read from the code. |
| [`physical-install.md`](physical-install.md) | You are mounting CT clamps, relays or the IR blaster. **It is a template with its gaps marked**, not a finished guide. Every `〔FILL IN〕` is something only a person at the site can supply. |
| [`pi-session-brief.md`](pi-session-brief.md) | **You are working on a deployed edge server, not on the repository.** It gives the first-moves checks and the traps this project has already paid for. |
| [`outage-recovery.md`](outage-recovery.md) | The power went out, or the field network will not come back. |
| [`backup-policy.md`](backup-policy.md) | You want to know what is backed up and what a restore will not give you. A restore rehearsal has been performed; the scratch-project half has not. |
| [`phase-f-runbook.md`](phase-f-runbook.md) | *Historical.* The first deployment of the flow to a real edge server. |

### Decisions and design

| Document | Read it when |
|---|---|
| [`adr-001-timeseries-store.md`](adr-001-timeseries-store.md) | Someone proposes InfluxDB, a split store, or Google Sheets. Accepted 2026-08-21. |
| [`adr-002-device-recovery-path.md`](adr-002-device-recovery-path.md) | A device stops responding and the only known recovery is a walk to the breaker. Proposed, not accepted. |
| [`floor-plan-design.md`](floor-plan-design.md) | *Design.* You are working on customisable floor plans. `ROADMAP.md` stays the source of truth for what is built. |

### Also

- [`audit/`](audit/README.md): the evidence the manual is written from.
- [`../ROADMAP.md`](../ROADMAP.md): feature state, in far more detail than anything here. Start at §0.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md): the working rules.
- [`assets/`](assets/README.md): the README's illustrations, and the scripts that regenerate them.
