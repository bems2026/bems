---
title: Worked example: the pilot site
purpose: The pilot installation mapped onto the manual — the only chapter where site specifics live
audience: [integrator, administrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo 2e79005
evidence: [E-010, E-011, E-012, E-015, E-017, E-018, E-021, E-023, E-026, E-041, E-051, E-080, E-081, E-084, E-087, E-125, E-156, E-157, E-158, E-166, E-168, E-175]
---

# Worked example: the pilot site

Every other chapter describes iBEMS in general. This one shows it installed once, at the pilot, with the numbers
measured there. Use it to see what a finished site looks like, and what it cost to get there.

Addresses, network names and account details are left out, as everywhere in the manual (G2).

## The site

| | |
|---|---|
| **Name** | MMSU CARE Office / NBERIC, as `shared/sites/mmsu-nberic-care/site.mjs` names it |
| **Place** | Batac City |
| **Time zone** | Asia/Manila (UTC+08:00) |
| **Scope** | One office: its lighting, its convenience outlets and one air-conditioner, fed from one sub-panel |
| **Policy** | The coldest room target an automatic aircon rule may aim for: 24 °C. Commands go over the local network first (`local-first`). |

## The fleet

Twenty devices, all on the vendor's local protocol [E-051]:

| Role ([01a](01a-device-roles.md)) | Class | Count | Devices |
|---|---|---|---|
| Switch (S) | `switch` | 7 | Lighting switches L1–L7. Protocol v3.5. |
| Metered switch (MS) | `outlet_dual` | 7 | Convenience outlets CO1–CO7, two sockets each. Protocol v3.4. |
| Meter (M) | `meter` | 4 on 3 devices | CT meters on the four branch circuits. One dual-channel device serves two branches, and its channels are told apart in software. Protocol v3.5. |
| Commander (C) | `acu_ir` | 1 | An IR hub that commands the office aircon, and senses the room's temperature and humidity. Protocol v3.3. The unit's codes decode as TCL112, so the flow builds any state from one captured frame; local IR was verified on the unit (ROADMAP RM-120). |
| Sensor (E) | `sensor_temp_humidity` | 1 | A stand-alone outdoor sensor, **never installed** [E-125] |

### The electrical tree

One service entrance feeds one sub-panel with four metered branch circuits:

| Branch | Phase | Feeds | Metered by |
|---|---|---|---|
| L.O Red | Red | Lighting circuits L1–L4 | `mtr_lo_red` |
| CARE ACU | Red | The office aircon, the unit the IR hub commands | `mtr_arec_acu` |
| C.O Yellow | Yellow | The convenience outlets, and another office's aircon on the same branch | `mtr_co_yellow` |
| L.O Yellow | Yellow | Lighting circuits L5–L7 | `mtr_lo_yellow` |

**The blue phase has no meter.** The building total is the sum of these four branches, so the dashboard shows blue
as "Not metered" rather than zero [E-168]. The hardware install is recorded in
[`physical-install.md`](physical-install.md), with its gaps marked (Q-13).

## The network

| | As built | Evidence |
|---|---|---|
| Device segment | A dedicated 2.4 GHz SSID with no client isolation. The edge joins it by Wi-Fi at the highest autoconnect priority (30), with the office network as its fallback (10). | E-158 |
| Uplink | Through the same Wi-Fi. About 15 kB/s out and 4 kB/s in, mesh traffic included, in one sample. | E-156 |
| Packet yield | A median of 99.9 % of expected minutes on normal days; 60–67 % on outage days | E-157 |
| Remote access | The mesh network, tailnet-only, relayed rather than direct | E-026, F-019 |

## The edge server

| | As built | Evidence |
|---|---|---|
| Board | Raspberry Pi 4 Model B, 7.6 GiB | E-011 |
| Storage | A 128 GB consumer SD card dated 2018, of unknown endurance | E-012, F-015 |
| Operating system | Debian 13 "trixie", desktop, kernel 6.18 | E-010 |
| Runtime | Node.js 22.23.2; Node-RED 4.1.8 with the Tuya nodes | E-017, E-018 |
| Services | Node-RED, ingest, proxy, scheduler and dashboard, under systemd; the kiosk as a user service | E-021, E-023 |
| Display | 800 × 480 touch, on the edge itself | E-175 |
| Dispatch interlock | On | E-041 |
| Heat | It has throttled since boot (F-003) | E-015 |

## The data

| | As measured on 2026-09-23 | Evidence |
|---|---|---|
| Per-minute readings | 858,691 rows, the 30-day window, about 28,600 a day | E-080, E-081 |
| Hourly history | From 2026-08-16 | E-081 |
| Commands recorded | 1,727 since 2026-08-17: auto-shed 953, people 541, schedules 228, the aircon loop 5 | E-084 |
| Automation | One schedule armed (the aircon). Auto-shed armed with both limits set. These are the operator's settings. | E-087 |
| Tariffs and emission factors | None entered yet, so reports show no cost | E-166 |

## Open items

Faults and chores specific to this site, tracked in [`ROADMAP.md`](../ROADMAP.md):

| ROADMAP | About |
|---|---|
| RM-006c | Arming auto-shed. **ROADMAP still lists it as open, but the database showed auto-shed armed on 2026-09-23** [E-087]. Reconcile. |
| RM-012, RM-013, RM-018, RM-020, RM-021 | Individual devices dropping, hanging or needing a power cycle |
| RM-016 | Flow nodes for devices that are not in the vendor's cloud project |
| RM-121 | The vendor cloud's subscription, which expired on 2026-09-17. The cloud is optional since then. |

And from the audit, for this site's operator:

- **Restore the broker to loopback** (F-001).
- **Review the account list** (Q-17), now that sign-up is off (F-026).
- Narrow the mesh network's SSH policy (F-025), and turn VNC off or bind it to loopback (F-007).

## Lessons from the pilot

Each chapter's field issue log records what happened here, and why the design changed:

| Chapter | What the pilot taught |
|---|---|
| [01 § Field issue log](01-field-devices.md#field-issue-log) | Read what a device announces, not its datasheet; restart before suspecting hardware; a value nobody re-reads is a memory |
| [02 § Field issue log](02-network.md#field-issue-log) | A silent ping proves nothing about layer 2; give every device a fixed address |
| [03 § Field issue log](03-edge.md#field-issue-log) | A commit is not a deployment; a setting that lives only on the host needs a check that notices when it goes |
| [04 § Field issue log](04-data.md#field-issue-log) | One quantity needs one derivation |
| [05 § Field issue log](05-interface.md#field-issue-log) | A screen nobody touches is never refreshed |
| [X1 § Field issue log](X1-security.md#field-issue-log) | With no roles, who can sign in is the whole access policy |
| [X2 § Field issue log](X2-control-logic.md#field-issue-log) | Keep the safety rule, and move it to your side of the link |
| [X3 § Field issue log](X3-operations.md#field-issue-log) | An alarm must reach someone who is not looking |
