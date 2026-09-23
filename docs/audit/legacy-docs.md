---
title: Legacy documentation audit (A5)
purpose: Every doc-like file, where it lives, what it covers, what still holds, and what must not be carried forward
audience: [integrator]
status: Draft
last_verified: 2026-09-23
applies_to: repo 2f4c570 · parent folder as of 2026-09-23
evidence: [E-060, E-072, E-100, E-101, E-102, E-103, E-104, E-105, E-106]
---

# Legacy documentation audit

Feeds Phase S's disposition table (`5s-disposition.md`, next gate). **Nothing is moved or edited yet.** Decided on
2026-09-23: files outside the repo stay outside git. Their content is re-verified and mined, and the originals move
to the workspace's own `archive/2026-09-legacy/`.

The **identifier scan** (E-100, E-102) matched patterns and printed no values. It checked:
- IPv4 addresses other than loopback and the RFC 5737 ranges
- mesh-network addresses and names
- `ts.net` host names
- MAC addresses
- JWTs
- database host names and the project reference
- key and secret assignments
- private-key blocks

## Outside the repository (workspace folder, untracked)

| File | Covers | Holds true (spot-checked) | Stale or wrong | Mock or fabricated data | Removed components | Identifiers |
|---|---|---|---|---|---|---|
| `iBEMS-Handbook-01-Field-Devices.html` | Field devices: 6 roles, device catalogue, selection, installing, states, troubleshooting, a worked example, and its place in the project plan | The six-role taxonomy is vendor-neutral, as intended | Its "Where this fits the project plan" section is funding context and must not reach the public repo (decided 2026-09-23). Its occupancy-sensor guidance describes a device class iBEMS does not have. It stays as generic guidance, labelled with its status (R8). | None found | None | Clean |
| `iBEMS-Handbook-02-Control-Strategy.html` | 4 triggers, 6 strategies, priority ladder, control flow, load state machine, a 33-test manual | The 24 °C room target, the deadband and the stepping loop match `acu_rules` (target 24, deadband 0.5, step 1: E-087, data-audit) | **§3.6 "Predictive and optimising control"** is not built (E-076) and becomes `Planned` in `94-roadmap.md` (R8). Its occupancy conditions are Planned. It uses `localStorage` for test ticks (E-105). | None found | None | Clean |
| `iBEMS-Conceptual-Framework.html` | Hardware and software framework; pages; web architecture; input → process → output | The edge-plus-hosted-database split, and "no on-site hardware" for the hosted layer | Written before the Reports and Settings pages existed (E-060) | 1 placeholder word | None | Clean |
| `iBEMS-System-Dossier.html` | A system overview: five layers, one registry, one authenticated door, feature list, Track A, the replication refactor, schedule status | Five layers, one registry and one authenticated door (E-063, E-065, E-066) | **"Mosquitto — bound to loopback since 26 Aug"** is false (E-028, F-001). Its schedule and paperwork status is dated. Its funding and milestone content stays out of the repo. | 8 placeholder or sample words, to be checked at mining | Records HA, "MQTT as the device bus" and TimescaleDB as dropped, which is correct as history (C1) | Clean |
| `iBEMS-Full-Stack-Anatomy.html` | Browser to relay: sign-in, routes, layering, state, command path, server tier, data and RLS, the honesty model | The command path's record-first rule (E-065) and offline session verification (E-066) | **"The six routes"** (now seven, E-060), **"the ten stores"** (now 16), and test counts that are out of date | 7 | MQTT once | Clean |
| `iBEMS-Dashboard-Anatomy.html` | The web app: routes, layering, the live pipeline, stores, the command lifecycle, honesty, design system, kiosk | The honesty model's direction (E-082, E-083) | "Six routes" and "ten stores". Its test count ("607 … 68 files") is out of date. | 6 | None | Clean |
| `iBEMS-Field-Device-Playbook.html` | Six control paradigms, two loops, device-by-device management, diagnosing a dark device, commissioning, standing rules | "Restart before you suspect hardware" is consistent with `CLAUDE.md` and ADR-002 | Overlaps Handbook Ch.1. It is deduplicated at mining. | None | None | Clean |
| `ibems-tracker.html` | A 13-phase, 12-month project tracker (M1–M12) | — | Hand-maintained, and **prefers `localStorage` over its own file** (E-105). It drifted before. Milestone data stays out of the repo. | — | — | Clean |
| `ibems-architecture-upgrade_2.md` | Architecture, current and multi-site target | — | Mentions Home Assistant 3 times and MQTT 9 times. Mined only for the multi-site target, and re-verified. | 3 | HA, MQTT, ESP32 | Clean |
| `ibems-fullstack-roadmap.md` | Status and sequencing as of 2026-08-26 | — | Defers to `ROADMAP.md` for state. Nothing is mined from it. | — | HA, MQTT | Clean |
| `ibems-reports-prompt.md`, `ibems-reports-prompt-review.md` | A task prompt for the Reports page, and its review | — | Work instructions, not documentation. Their outcome is RM-137 to RM-143 in `ROADMAP.md`. | — | — | **The review holds one mesh address** (E-102). It must never be copied anywhere. |
| `iBEMS-Documentation-Prompt.md` | v1 of this documentation prompt | — | Superseded by v3 | — | — | Clean |
| `Readme project front.txt` | A README draft | — | Mostly carried into the repo `README.md` | 16 (placeholder commands) | InfluxDB once | Clean |
| `iBEMS-*.xlsx` (3 workbooks) | The funded project plan and the test log | — | **Reported to the university. Never moved or edited by this work.** | — | — | Not scanned (binary) |

## Inside the repository (tracked)

| File | Covers | Status against the audit | Referenced by code or tests? |
|---|---|---|---|
| `README.md` | The front door | Current. It gets a link to the manual in Phase D. | — |
| `CLAUDE.md` | Orientation and site facts | **The broker fact is false** (E-104, F-005). Everything else checked holds. | **Read by a test** (E-072) |
| `ROADMAP.md` | Feature state; the source of truth | **EX-131 contradicts the edge** (E-104). The manual cites its IDs rather than restating it. | — |
| `SECURITY.md` | Reporting, and repo hygiene | **The broker line is false** (E-104) | — |
| `CONTRIBUTING.md` | Working rules | Current | **Read by a test** |
| `docs/README.md` | Index of the ten documents | Becomes the manual's navigation page in Phase S2/D | — |
| `docs/bridge-contract.md` | The bridge's field contract | Current. The live generator matches (E-052). | Yes |
| `docs/storage-contract.md` | Database contract and retention | Current against E-070 and E-083 | Yes |
| `docs/pi-session-brief.md` | How to work on the edge | **The broker row is false; the opening state is stale** (E-104, E-106). | **Read by a test** |
| `docs/replication.md` | The software half of replication | Current. `90-replication.md` links to it and does not restate it. | Yes |
| `docs/physical-install.md` | The hardware half, a template with 12 gaps | Current as a template (Q-13) | **Read by a test** |
| `docs/phase-f-runbook.md` | The first flow deploy (2026-08-10) | Mentions the Node-RED dashboard UI. It is historical and is kept as reference. | Yes |
| `docs/backup-policy.md` | Database backup and restore | Current for the database. **Silent on the edge's own credentials** (F-002). | Yes |
| `docs/outage-recovery.md` | Outages and the field network | Current (2026-09-22) | Yes |
| `docs/adr-001-timeseries-store.md` | ADR: the time series stays in Postgres, and why not InfluxDB or Sheets | Current. Indexed from `docs/adr/`, not moved. | — |
| `docs/adr-002-device-recovery-path.md` | ADR: recovering a silent device (Proposed) | Current | Yes |
| `docs/floor-plan-design.md` | Design for customisable floor plans | A design document. `ROADMAP.md` holds its state. | — |
| `docs/assets/**` | README images and the scripts that regenerate them | Excluded from the site build | — |

**Identifiers in tracked files** (E-100, E-101): none from the checked classes, **except** real private LAN addresses in two
test fixtures and one code comment (F-009). No secret was found in any tracked file, so nothing needs rotating on that account.
