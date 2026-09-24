---
title: ADR-0007 — One static, configuration-driven device registry, from which the flow is generated
status: Accepted
date: 2026-08-10
evidence: [E-062, E-063, E-132, E-203, E-205]
---

# ADR-0007 — One static, configuration-driven device registry, from which the flow is generated

**Status:** Accepted · **Decided:** 2026-08-10, the first commit · **Decided by:** the project team

## Context

The original hand-built flow carried about thirty near-identical function nodes: a parser, a formatter and a schedule
per device. Adding an outlet meant copying and hand-editing four nodes, and one wrong data-point number broke a
device silently. Two incompatible data-point mappings existed for one device type, and energy was computed two
different ways [E-205, the legacy document's §1 table].

## Decision

Every device is declared once, in the site's files under `shared/sites/<site>/` (`site`, `devices`, `circuits`). They
are read through `shared/registry.mjs` [E-063]. Everything per-device is **generated** from that:

- the bridge tab of the Node-RED flow, by `node-red-bridge/build-flow.mjs`;
- the mock bridge;
- the one transform from raw reading to engineering units [E-062].

Hand-editing the generated flow is forbidden, and `npm run test:bridge` fails if it drifts from the registry.

## Alternatives considered

*Reconstructed: no record of the options weighed at the time survives. These are the reasons that hold on the evidence now.*

| Option | Why not |
|---|---|
| Hand-built flow, one set of nodes per device | The failure the context describes: copy-paste per device, silent breakage |
| Dynamic discovery as the source of truth | Discovery finds what answers, not what should be there. A device that is off would vanish from the building. |

## Consequences

- **Replication is cheap:** a new site is a new directory, not a new flow ([90](../90-replication.md)).
- The generator owns only the bridge tab. **The four hand-built device tabs, and two settings on them, live only on
  the edge**. Nothing in the repository declares them [E-132]. That is the one place this decision does not reach.
- Adding a device class means code, a catalogue entry and tests, not a flow edit.

## What would change this answer

A fleet large or changeable enough that editing the site's files becomes the bottleneck. Even then, the registry
would be generated from an inventory, not replaced by discovery.
