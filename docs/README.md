---
title: iBEMS manual
purpose: Front page of the adoption and replication manual — where to start, by role, and what state each chapter is in
audience: [operator, administrator, installer, integrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo afa5aaf
evidence: []
---

# iBEMS — adoption and replication manual

iBEMS is a low-cost building energy management system. Branch meters, relays and an infrared commander sit on a
dedicated local network. A single-board edge server runs the control logic, and a hosted Postgres database keeps the
record. A web app shows it all and lets people act on it. **This manual is how another building builds, commissions,
operates and improves its own**, from nothing.

It describes a system, not an installation. Everything specific to the pilot site lives in one chapter,
[99-worked-example](99-worked-example.md). Every other chapter applies to any building.

!!! warning "This manual is being written"
    The chapters are built in gated phases (ROADMAP RM-145), and the status table below says honestly which ones exist.
    Until a chapter is written, the documents in [Reference](#reference) remain the authority on their subjects.

## Start here, by role

| You are… | Read, in order |
|---|---|
| **Operator:** you use the dashboard day to day | [05 User interface](05-interface.md) (user guide) → [X2a Control strategy](X2a-control-strategy.md) §1–§6 → [91 Troubleshooting index](91-troubleshooting-index.md) |
| **Administrator:** you own the system for the institution | [00 Overview](00-overview.md) → [X1 Security](X1-security.md) → [X3 Operations](X3-operations.md) → [04 Data](04-data.md) → [93 Governance](93-governance-compliance.md) |
| **Installer:** you fit devices and wire panels | [01a Device roles](01a-device-roles.md) → [01 Field devices](01-field-devices.md) → [physical-install](physical-install.md) → [02 Network](02-network.md) |
| **Integrator:** you build and maintain the stack | [00 Overview](00-overview.md) → [03 Edge](03-edge.md) → [02 Network](02-network.md) → [04 Data](04-data.md) → [05 Interface](05-interface.md) → [X2 Control logic](X2-control-logic.md) → [90 Replication](90-replication.md) |

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
| [X3 Operations](X3-operations.md) | Commissioning, go-live, routine operations, backup, change, handover | Scaffold |
| [90 Replication](90-replication.md) | Step 1 to done, for a new building | Scaffold |
| [91 Troubleshooting index](91-troubleshooting-index.md) | Every fault, by symptom | Scaffold |
| [92 Glossary](92-glossary.md) | Every term, defined once | Scaffold |
| [93 Governance and compliance](93-governance-compliance.md) | Regulation, electrical safety, privacy, licensing | Scaffold |
| [94 Roadmap](94-roadmap.md) | Planned items only | Scaffold |
| [99 Worked example](99-worked-example.md) | The pilot site | Scaffold |
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
- [`assets/`](assets/): the README's illustrations, and the scripts that regenerate them.
