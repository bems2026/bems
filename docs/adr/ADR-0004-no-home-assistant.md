---
title: ADR-0004 — Home Assistant was not adopted
status: Accepted
date: 2026-08-10
evidence: [E-032, E-063, E-075, E-203, E-205]
---

# ADR-0004 — Home Assistant was not adopted

**Status:** Accepted · **Decided:** 2026-08-10, in the first commit's design; recorded 2026-08-26 · **Decided by:**
the project team

## Context

Early planning placed Home Assistant as the device layer, over an MQTT bus (ADR-0003). It would have provided device
discovery, a device registry, energy accounting and a user interface [E-205].

## Decision

Home Assistant is not part of iBEMS. What it would have provided is built in the repository instead:
- a device registry, `shared/registry.mjs`, fed per site (ADR-0007) [E-063];
- discovery by listening to the devices' own broadcasts ([01](../01-field-devices.md));
- energy accounting in one shared transform ([03](../03-edge.md));
- a web application with sign-in and audited control (ADR-0008).

## Alternatives considered

*Reconstructed: no record of the options weighed at the time survives. These are the reasons that hold on the evidence now.*

| Option | Why not |
|---|---|
| Home Assistant as the device layer | A second registry and a second state model beside the database. Its automations would bypass the audited command path. Replicating a site would mean configuring Home Assistant as well. |
| Home Assistant as a front end only | Its accounts and roles are separate from the database's, so every action would need a second audit trail |

## Consequences

- Not installed on the edge [E-032], and named in no tracked file other than ROADMAP [E-075].
- iBEMS owns the code Home Assistant would have supplied, and its tests.

## What would change this answer

A site whose devices Home Assistant supports and iBEMS does not, where writing a new device class costs more than
bridging. The bridge would then have to go through the proxy's audited path, like every other command source.
