---
title: ADR-0003 — MQTT is not the device transport; the broker is kept for the inverter bridge alone
status: Accepted
date: 2026-08-10
evidence: [E-018, E-028, E-030, E-104, E-202, E-203, E-205]
---

# ADR-0003 — MQTT is not the device transport; the broker is kept for the inverter bridge alone

**Status:** Accepted · **Decided:** 2026-08-10, in the first commit's design; recorded 2026-08-26 · **Decided by:**
the project team

## Context

Early planning proposed an MQTT broker as the bus between the field devices and everything else, with Home Assistant
on top (ADR-0004). A Mosquitto broker was already running for an ESP32 that reported the aircon's state, and it was
taken as proof the pattern was in use [E-205].

The field devices do not speak MQTT. They speak the vendor's local protocol, which the Node-RED Tuya nodes handle
directly ([01](../01-field-devices.md)). Putting a broker in the path would have added a hop, a second model of each
device, and a second place for state to drift.

## Decision

Devices are reached by Node-RED over the vendor's local protocol. Node-RED serves HTTP and a WebSocket to the proxy
and the ingest daemon, from a flow generated from the device registry (ADR-0007). **No device traffic uses MQTT.** The
generated flow may not contain an `mqtt out` node; the contract test fails if it does [E-202]. The broker stays
installed for one future consumer: the solar inverter's bridge (RM-026), whose integration is built for MQTT.

This is how the system was built from its first commit [E-203]. The rejection of the MQTT design was written down on
2026-08-26 [E-205].

## Alternatives considered

*Reconstructed: no record of the options weighed at the time survives. These are the reasons that hold on the evidence now.*

| Option | Why not |
|---|---|
| MQTT as the device bus, every device bridged onto topics | The devices do not publish MQTT. Bridging each adds a translation layer and a second copy of state. |
| Remove the broker entirely | The inverter bridge (RM-026) expects one. Removing and reinstalling is more work than keeping it bound to loopback. |

## Consequences

- The live flow's only MQTT nodes are the broker's config node and one **disabled** input from the retired ESP32
  [E-030].
- **The broker still runs, and on 2026-09-17 it was opened to every interface with anonymous access** (F-001) [E-028].
  Four documents still say it is loopback-only (F-005) [E-104]. A broker nothing uses is still an exposure.
- The inverter bridge, when it comes, must either run on the edge (loopback) or use a password-protected listener
  bound to the LAN address. **Widening the loopback listener is reinstating the problem**, not configuring the feature.

## What would change this answer

A device class that publishes MQTT natively and has no local API. Then add it as a subscriber in the flow and record
the change here. Until the inverter bridge exists, stopping the broker is also consistent with this record.
