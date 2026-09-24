---
title: Environment audit (Phase A) — summary
purpose: What the audit found, how the live system differs from the manual's model, and what the next phase changes
audience: [administrator, integrator]
status: Draft
last_verified: 2026-09-23
applies_to: repo 2f4c570 · edge checkout fcb1ff6
evidence: [E-003, E-006, E-010, E-021, E-023, E-026, E-028, E-041, E-045, E-052, E-058, E-060, E-064, E-065, E-066, E-070, E-071, E-078, E-079, E-084, E-089, E-125]
---

# Environment audit — summary

Phase A of the adoption and replication manual (ROADMAP RM-145). It was carried out read-only on 2026-09-23 against
the repository and, over the mesh network, the edge server's services, live flow and database. **No service, flow,
file or row on the edge was changed** (G5). The dispatch flag was read and left alone (G7).

| File | What it holds |
|---|---|
| [`evidence-ledger.md`](evidence-ledger.md) | 80+ observations. Every one names the command or file that produced it. |
| [`claims-check.md`](claims-check.md) | Verdicts on the 13 carried-over claims. **Seven are wrong in whole or in part.** |
| [`findings.md`](findings.md) | 23 findings: **1 Critical, 3 High, 12 Medium, 7 Low**. F-002 dropped from Critical on 2026-09-24. |
| [`open-questions.md`](open-questions.md) | 14 questions, 3 now closed, each with an owner and a next action |
| [`system-map.md`](system-map.md) | The inventory: repository, processes, ports, live flow, command path and data |
| [`legacy-docs.md`](legacy-docs.md) | Every doc-like file, in and outside the repo, and what may be carried forward |
| [`access-check.md`](access-check.md) | What was reached, and how |
| [`5s-disposition.md`](5s-disposition.md) | Phase S1: one row per doc-like file, its disposition, and the target tree (GATE S) |
| `raw/` | The command output itself. **Gitignored and never committed.** |

## The short version

1. **The system is what the manual's five-layer, three-plane model says it is**, and more complete than the prompt
   assumed. It has seven pages, not five (E-060), and 23 tables, not seven (E-064). The generated bridge is live
   exactly as generated (E-052).
2. **Two premises of the prompt are wrong in ways that change the manual.**
   - **Hardware dispatch is on** (E-041). Commands have reached relays since 2026-08-24, and most of the 1,727 audit rows are `dispatched` (E-084).
   - **Automation is not in Node-RED.** It runs in `server/scheduler.mjs` against the database (E-071).
3. **One thing on the edge needs the operator before anything is published about it.**
   - **F-001:** the MQTT broker has accepted anonymous connections on every interface, device Wi-Fi included, since
     2026-09-17. That reverses a hardening that four current documents still describe. The operator chose on
     2026-09-24 to restore loopback-only.
   - **F-002** is now Medium. The operator states that a full copy of the credentials exists off the card (E-079), so
     what remains is writing the practice down and testing one restore.

## Delta: the model (prompt §5) against the live system (§5.3)

| Part of the model | Live system | Delta | Change the document or the system? |
|---|---|---|---|
| L1 Field devices: six roles | Meters (3 CT meters), Metered switches (7 outlets), Switches (7 light circuits), a Commander (IR hub) that is also a Sensor (room temperature and humidity), and a stand-alone Sensor node that was never installed (E-125). **Source** (the inverter) is not connected. | Source is Planned, not built | **Document:** Source is labelled `Planned` (R8), with RM-026 as its dependency |
| L2 Network: dedicated 2.4 GHz LAN, local keys, remote access | As modelled. The mesh network uses tailnet-only HTTPS Serve, and Funnel is off (E-026). | The broker (F-001) and VNC (F-007) are exposed on the device segment | **System**, before `02-network.md` is written |
| L3 Edge: one board runs everything, with no internet needed for control | As modelled: Raspberry Pi 4, Debian 13, Node 22, Node-RED 4.1.8 and systemd (E-010–E-021). Control and the audit survive a WAN outage (E-078). | Thermal throttling (F-003). No `catch` nodes (F-011). Some host configuration exists only on the edge (F-010). | **System** for F-003. **Document** the rest, and state the F-011 decision |
| L4 Data: relational store, ingestion, retention, optional spreadsheet | As modelled: hosted Postgres, 30-day per-minute retention then hourly rollups (E-070), and the Sheets mirror live (E-058) | The plan tier and size are unknown (F-004). The honesty rule is enforced by queries, not the schema (F-013). | **Measure** (Q-01), then document |
| L5 Interface: web app, auth, kiosk and remote modes | As modelled: seven pages, Supabase Auth, break-glass, a kiosk user unit and mesh Serve (E-023, E-060, E-066) | — | — |
| X1 Security: one complete credential picture | Present, but incomplete in practice | Anonymous broker (F-001), credential backup undocumented and its restore untested (F-002), SSH posture unverified (F-008), real LAN addresses committed (F-009), desktop used for browsing (F-022) | **System** (F-001, F-002, F-007, F-009); **document** the rest |
| X2 Control logic: decided at the edge, configured from the UI | As modelled. Record-first dispatch, an interlock, and a scheduler for schedules, auto-shed and the aircon loop (E-065, E-071). | 19 auto-shed rows stuck at `dispatching` (F-006) | **Investigate** (Q-08), then document |
| X3 Operations: commissioning, backup, updates, spares | The database backup is documented and a restore rehearsed (`backup-policy.md`) | The edge's credential copy exists but is unwritten and its restore untested (F-002). The update policy is unwritten (F-020). | **Document**, after F-002 has an answer |
| "Logical layers are not machines" | Confirmed. The edge hosts L3, L4 ingestion, L5 serving and the proxy. The database is the only off-site component (E-021, E-089). | — | — |

## GATE A — passed 2026-09-24

- The operator approved the findings and verdicts ("verify and proceed"). Before the push, the key live facts were
  re-read (E-006) and the full suite passed: lint, build, 2,174 vitest, 1,369 bridge and 821 server tests.
- **F-001:** the operator chose **loopback-only**, meaning the 2026-08-26 state. The operator runs the change on the
  edge, and the audit re-reads it afterwards. EX-131 and the four documents need no edit once it holds.
- **F-002:** a complete off-card copy exists (E-079), so the finding is now Medium.
- Q-01, Q-02 and Q-10 remain open. None of them blocks Phase S.

## What the next phase changes (Phase S, up to GATE S)

- Writes `docs/audit/5s-disposition.md`: one row per doc-like file, with its disposition, the sections kept and the
  E-IDs that support them. It also writes the target tree. This is planning only, and **no file is moved or edited
  before GATE S.**
- After GATE S, the originals outside the repo move to the workspace's own `archive/2026-09-legacy/` (not git). Inside
  the repo nothing is deleted, and the existing `docs/*.md` stay at their paths.
