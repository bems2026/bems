---
title: ADR-0008 — A standalone web application, not the flow engine's built-in dashboard
status: Accepted
date: 2026-08-10
evidence: [E-018, E-060, E-066, E-163, E-181, E-202, E-203]
---

# ADR-0008 — A standalone web application, not the flow engine's built-in dashboard

**Status:** Accepted · **Decided:** 2026-08-10, the frontend's first commit · **Decided by:** the project team

## Context

Node-RED ships a dashboard palette, installed on the edge [E-018]. It draws widgets from flow nodes, served by
Node-RED itself. The system needed sign-in, a page structure, audited control, and history from the database.

## Decision

The interface is a separate single-page application: React, TypeScript, Vite [E-060]. It is served as static files by
its own service, and it talks to the authenticated proxy and to the database, under the user's own session
[E-066], and to a keyless weather service [E-181]. The live flow contains **no** dashboard nodes [E-202].

## Alternatives considered

*Reconstructed: no record of the options weighed at the time survives. These are the reasons that hold on the evidence now.*

| Option | Why not |
|---|---|
| Node-RED's dashboard | It cannot carry the database's sign-in, a page structure beyond tabs, or the audited command path. Its widgets are served by the same process as the bridge, so exposing the UI would expose the bridge. |
| A hosted front end (a cloud static host) | The page must work from the edge's own display when the internet is down. It is served from the edge. |

## Consequences

- The bridge stays on loopback, with only the proxy in front of it ([X1](../X1-security.md)).
- The app has its own build, tests and design rules ([05](../05-interface.md)).
- Access control is only as fine as the database's roles, and today there is one: "signed in" [E-163].

## What would change this answer

None foreseen. A site that wanted Node-RED's dashboard for commissioning could run it on loopback, behind an SSH
tunnel, and never for control.
