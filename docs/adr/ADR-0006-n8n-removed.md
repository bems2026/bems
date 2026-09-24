---
title: ADR-0006 — n8n was trialled and removed
status: Accepted
date: 2026-08-16
evidence: [E-032, E-075, E-077, E-205]
---

# ADR-0006 — n8n was trialled and removed

**Status:** Accepted · **Decided:** by 2026-08-16, when it was decommissioned on the edge · **Decided by:** the
project team

## Context

Before the current design, n8n ran on the edge as a workflow tool. It had its own read endpoints on the flow
(`/twin`, `/lights/status`, `/outlets/status`, `/energy/status`) and a standalone 3D "twin" page. An MQTT publisher in
the old flow existed for it [E-205].

## Decision

n8n is not part of iBEMS. Automation runs in the repository's own scheduler, through the audited command path
([X2](../X2-control-logic.md)). Reads go through the authenticated proxy.

## Alternatives considered

*Reconstructed: no record of the options weighed at the time survives. These are the reasons that hold on the evidence now.*

| Option | Why not |
|---|---|
| Keep n8n for automation | Its workflows would switch loads outside the audited path, the one place every command is recorded before it is sent |
| Keep n8n for notifications | Push notices need no workflow engine: one module, one topic, no credential ([X3](../X3-operations.md#monitoring-the-monitor)) |

## Consequences

- Not installed on the edge. A dated backup of its removal remains [E-032].
- The flow-cleanup plan lists its endpoints as dead read paths. `POST /light/:id` is **not** among them: despite an old
  comment calling it n8n's, it is the live dispatch path [E-205].
- A browser profile on the edge still holds site data for the port n8n served on (F-022) [E-077].

## What would change this answer

None foreseen. A future integration that needs a workflow engine must still send its commands through the proxy.
