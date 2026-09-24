---
title: Glossary
purpose: Every term and abbreviation used in the manual, defined once
audience: [operator, administrator, installer, integrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo 2e79005
evidence: []
---

# Glossary

Each term is defined once, here. Chapters use the term and link to where it matters.

| Term | Meaning | Where it matters |
|---|---|---|
| **2.4 GHz segment** | The dedicated Wi-Fi network the field devices join. They support 2.4 GHz only, and the edge must share the same layer-2 segment to hear their broadcasts. | [02](02-network.md) |
| **ADR** | Architecture decision record: one decision, its context, the alternatives, and what would change it | [adr/](adr/README.md) |
| **Anomaly** | A reading that both a z-score test and an interquartile-range test flag against the device's recent window | [ADR-0009](adr/ADR-0009-anomaly-rolling-statistics.md) |
| **ARP (neighbour table)** | The edge's table of which address answers on the local network. The reliable way to ask "is it on the network?"; ping is not. | [02](02-network.md#how-it-fails) |
| **Audit row** | The `commands` row written **before** a command is dispatched. No row, no dispatch. | [X2](X2-control-logic.md), [04](04-data.md) |
| **Auto-shed** | Demand-side management: switching off tiered relays, one tier at a time, when a demand limit is breached. It never switches anything back on. | [X2](X2-control-logic.md#how-demand-thresholds-are-evaluated) |
| **Break-glass** | A local, view-only sign-in, checked by the proxy, for when the sign-in service cannot be reached | [05](05-interface.md#administration-guide), [X1](X1-security.md) |
| **Bridge** | The Node-RED flow's HTTP and WebSocket interface to the devices, on the edge's loopback address | [03](03-edge.md), [`bridge-contract.md`](bridge-contract.md) |
| **Commander (C)** | A device role: accepts commands, reports nothing. In practice an infrared hub that works a unit's own remote codes. | [01a](01a-device-roles.md#2-the-six-device-roles) |
| **Coverage** | The share of expected samples actually recorded for a period. Every report states it. | [04](04-data.md) |
| **`credentialSecret`** | Node-RED's key for its stored credentials. Never change it once set. | [X1](X1-security.md#the-credential-inventory) |
| **CT** | Current transformer: the clamp around a conductor that lets a meter measure its current. Panel work, done by a qualified electrician. | [01](01-field-devices.md), [`physical-install.md`](physical-install.md) |
| **Data point (dp)** | One numbered value a device reports or accepts, such as a relay's state or a meter's power | [01](01-field-devices.md), [03](03-edge.md) |
| **Device class** | The software's type for a device (switch, dual outlet, meter, IR aircon, sensor), which decides how it is parsed and commanded | [01](01-field-devices.md) |
| **Device role** | What crosses a device's boundary: meter, switch, metered switch, sensor, commander or source. Design around the role, not the brand. | [01a](01a-device-roles.md) |
| **Dispatch** | Sending a recorded command to the hardware | [X2](X2-control-logic.md) |
| **Dispatch interlock** | `HARDWARE_DISPATCH_ENABLED`. Off: every command is recorded as `dry_run` and nothing moves. The site decides it, and records the decision on a form. | [X2](X2-control-logic.md#the-dispatch-interlock) |
| **`dispatching`** | An audit row whose outcome was never recorded: the command was tried, and whether it landed is unknown | [X2](X2-control-logic.md) |
| **DSM** | Demand-side management: limiting demand by switching loads, here by auto-shed | [X2](X2-control-logic.md) |
| **`dry_run`** | An audit row for a command that was recorded but not sent, because the interlock is off or the device cannot be dispatched to | [X2](X2-control-logic.md) |
| **Edge (edge server)** | The small computer in the building that runs the bridge, the proxy, ingest, the scheduler and the kiosk | [03](03-edge.md) |
| **Enrolment** | Adding a device through the app's *Add device* wizard, with its local key | [01](01-field-devices.md#how-to-install) |
| **Flow** | Node-RED's program. The bridge tab is generated from the registry; four device tabs are hand-built. | [03](03-edge.md) |
| **Held value** | A reading a device repeats unchanged while reporting online. It is not a live measurement, and the app says so. | [05](05-interface.md#design-rules-that-carry-meaning) |
| **Ingest** | The daemon that reads the bridge every 60 s and writes the database, buffering locally through an outage | [04](04-data.md#ingestion) |
| **IQR** | Interquartile range: the spread of the middle half of a window of samples, used for one of the two anomaly tests | [ADR-0009](adr/ADR-0009-anomaly-rolling-statistics.md) |
| **IR** | Infrared: how a commander works an air-conditioner, by sending the unit's own remote codes | [01](01-field-devices.md) |
| **Kiosk** | The full-screen dashboard on the edge's own display, started by a user-level service | [05](05-interface.md#access-modes) |
| **Local key** | A device's secret for local control. It changes only when the device is re-paired. | [X1](X1-security.md#the-credential-inventory) |
| **Mesh network (tailnet)** | The private network (Tailscale) that gives enrolled devices remote access to the edge | [02](02-network.md), [X1](X1-security.md) |
| **Meter (M)** | A device role: reports data, is never switched. Here, a CT meter on a circuit. | [01a](01a-device-roles.md) |
| **Metered switch (MS)** | A device role: switched, and reports its own consumption. Here, a dual-socket outlet. | [01a](01a-device-roles.md) |
| **Node-RED** | The flow engine on the edge that talks to the devices | [03](03-edge.md) |
| **Packet yield** | The share of expected readings that arrived. The acceptance threshold is 99 % on a normal day. | [02](02-network.md) |
| **Phase** | One of the three supply phases (red, yellow, blue). Each branch meter sits on one. | [04](04-data.md) |
| **Proxy** | The edge's authenticated front door: it checks the session, writes the audit row and dispatches | [03](03-edge.md), [X1](X1-security.md) |
| **Public key (anon key)** | The database key in every browser. Public by design; it grants nothing without a signed-in session. | [X1](X1-security.md) |
| **Registry** | `shared/registry.mjs`, fed by the site's files: every device declared once, everything else generated | [ADR-0007](adr/ADR-0007-config-driven-registry.md) |
| **RLS** | Row-level security: the database's per-row access rules. Here, one rule set for "signed in". | [04](04-data.md#keys-and-access) |
| **Room floor** | The coldest room temperature an automatic aircon rule may aim for, set on *Settings → Building policy* | [X2](X2-control-logic.md) |
| **Schedule** | A clock rule for one relay: on and off times and the days, armed or not | [X2](X2-control-logic.md#what-a-schedule-record-looks-like) |
| **Sensor (E)** | A device role: reports conditions, such as temperature, occupancy or daylight | [01a](01a-device-roles.md) |
| **Serve** | The mesh network's feature that publishes the dashboard to the tailnet over HTTPS, and nowhere else | [02](02-network.md) |
| **Service-role key** | The database key that bypasses row-level security. Only on the edge, and never in a browser. | [X1](X1-security.md#the-credential-inventory) |
| **Shed tier** | A relay's place in auto-shed's order: group 1 first, then 2, then 3. "Never shed" protects it; unassigned is never shed. | [X2](X2-control-logic.md) |
| **Site** | One building's identity: its directory under `shared/sites/`, its database row, and the stamp on every row it stores | [90](90-replication.md#what-you-are-replicating) |
| **Source (G)** | A device role: a producer or store of energy, such as a solar inverter. Not supported yet. | [94](94-roadmap.md) |
| **SSID** | A Wi-Fi network's name. The manual names networks by role, never by their real name. | [02](02-network.md) |
| **Stale** | A reading older than its device's window (2.5 × its reporting cadence). It dims and is flagged. | [05](05-interface.md#design-rules-that-carry-meaning) |
| **Switch (S)** | A device role: switched, and reports its state only. Here, a lighting switch. | [01a](01a-device-roles.md) |
| **Tuya** | The vendor platform the pilot's devices use, with a local protocol and an optional cloud | [01](01-field-devices.md) |
| **Upsert** | Insert, or replace an existing row with the same key. Why a re-sent reading does not duplicate. | [04](04-data.md#ingestion) |
| **UTC** | Coordinated Universal Time. Everything is stored in it and shown in the site's time zone. | [04](04-data.md) |
| **Vendor cloud** | The device maker's internet service. Optional: commands go over the local network first. | [ADR-002](adr-002-device-recovery-path.md) |
| **Window (reporting)** | How long a device may go without reporting before it counts as stale: 150 s for outlets, meters and the aircon, 30 s for switches and the room sensor | [05](05-interface.md#design-rules-that-carry-meaning) |
| **z-score** | How many standard deviations a reading lies from its window's mean. One of the two anomaly tests. | [ADR-0009](adr/ADR-0009-anomaly-rolling-statistics.md) |
