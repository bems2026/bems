---
title: Roadmap
purpose: Every planned item the manual mentions, with its status and dependency — the only place planned features appear (R8)
audience: [administrator, integrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo 2e79005
evidence: [E-149]
---

# Roadmap

This is the only page in the manual that describes what iBEMS does **not** do yet. Every other chapter describes the
system as built.

It indexes; it does not track. [`ROADMAP.md`](../ROADMAP.md) is the single source of truth for feature state, and each
row below gives its ID there. Where an item has no ID, it says so: it is mentioned in the manual but nobody has
committed to it.

**Status labels:**
- **Planned**: tracked in ROADMAP and wanted, with nothing blocking but the work.
- **Blocked**: waiting on something named.
- **Untracked**: mentioned by the manual; no ROADMAP item exists.
- **Not chosen**: considered and set aside, with the reason.

## Planned capabilities

| Item | Status | Depends on | ROADMAP |
|---|---|---|---|
| **The solar inverter:** read generation into the same store as everything else, through a bridge on the edge | Blocked | The inverter's logger joining the device network (Q-12). The bridge needs the broker, on loopback or a password-protected listener (ADR-0003, F-001). | RM-026 |
| **Record the room's temperature and humidity** from the IR hub, not only show them live | Planned | — | FI-032 |
| **Optimum start and stop** for the aircon | Blocked | A room-temperature history (FI-032) and a working room sensor | Untracked |
| **Daylight-driven lighting and blinds** | Blocked | A daylight sensor and a motorised blind, neither installed; new device classes | RM-070 |
| **Occupancy-driven lighting** | Blocked | An occupancy sensor and its device class | Untracked |
| **Air-quality-driven ventilation** | Blocked | An air-quality sensor, fan control, and their device classes | Untracked |
| **Battery storage, water-heater and fan or pump roles** | Untracked | Device classes for each ([01a](01a-device-roles.md#3-device-catalogue)) | Untracked |
| **A holiday and exception calendar** that suspends schedules on named dates | Untracked | A date table and one screen | Untracked |
| **Learn IR codes** beyond the library's one mode (FI-031), and for an aircon whose protocol is unknown (FI-037, not needed for the pilot's unit) | Planned | — | FI-031, FI-037 |
| **Bind an aircon remote explicitly** when a site has more than one | Planned | A second aircon | FI-030 |
| **Enrol a new aircon from the page** | Planned | — | FI-033 |
| **Site provisioning** for a new building | Planned | — | RM-033 |
| **A shared database for several sites**, with cross-site sign-in | Untracked | A second site. Every row already carries its site (E-149). | Untracked |
| **Predictive control and maintenance** | Blocked | A year of clean hourly history, and a named use (ADR-0010) | Untracked |
| **Deep links to a report's tab and period** | Planned | — | FI-040 |
| **Faster 30-day history reads**, which now hit the statement timeout | Planned | — | FI-034 |
| **Publishing this manual:** site and PDF builds, docs CI, conventions, and the verification pass | Planned | This manual's Phases D and E | RM-145e |

## Fixes the audit recommends

The audit's findings each name a concrete fix and who can make it. They are recommendations, not commitments: see
[`audit/findings.md`](audit/findings.md). Each finding's last column says whether it needs a code change.

## Open at the pilot

Faults and chores specific to the pilot's devices and accounts are listed with the site, in
[99 § Open items](99-worked-example.md#open-items).

## Not chosen

| Item | Why not | Record |
|---|---|---|
| MQTT as the device bus | The devices speak their own local protocol; a bus adds a second copy of state | ADR-0003 |
| Home Assistant | A second registry and state model beside the database, outside the audited path | ADR-0004 |
| TimescaleDB, or a second time-series store | The volume does not need it | ADR-0005, ADR-001 |
| n8n | Its workflows would switch loads outside the audited path | ADR-0006 |
| Node-RED's built-in dashboard | No sign-in, no page structure, no audited control | ADR-0008 |
| A key-extraction tool built into iBEMS | It would borrow another application's vendor identity. Keys come from an external tool's export. Revisit only if the vendor publishes a sign-in for third parties. | FI-036 |
| A trained anomaly model, for now | No history to train on, and it cannot be explained to an operator | ADR-0009 |
