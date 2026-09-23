---
title: Diagram sources
purpose: The six system figures the manual requires, their source files, and where each is used
audience: [integrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo afa5aaf
evidence: []
---

# Diagram sources

Each figure is Mermaid, kept here as `<name>.mmd` and embedded in the chapters that use it. **Each one shows a real
mechanism**: every arrow is a message or a call that exists in the running system, labelled with what it carries.
Nothing here is a box diagram that matches no actual message (Appendix A).

Figures inside the ported chapters (the device function block diagrams, the control loops) live inline in those
chapters and are not repeated here.

| # | Figure | Source | Used in | Status |
|---|---|---|---|---|
| 1 | Whole system: five layers, with the three planes as vertical bands | `layers.mmd` | `00-overview.md` | Drawn with 00 |
| 2 | Data path, device to screen: one reading's journey, with the transform and units at each hop | `data-path.mmd` | `00-overview.md`, `04-data.md` | Drawn with 00 |
| 3 | Command path, screen to device: audit write before dispatch, the interlock, where acknowledgement does and does not exist | `command-path.mmd` | `00-overview.md`, `X2-control-logic.md` | Drawn with 00 |
| 4 | Failure-mode overlay: what breaks at each hop, and what the user sees | `failure-modes.mmd` | `03-edge.md`, `91-troubleshooting-index.md` | Drawn with 03 |
| 5 | Network topology, generalised with no real addresses | `network.mmd` | `02-network.md` | Not yet drawn |
| 6 | Deployment: what runs where, and which process supervises which | `deployment.mmd` | `00-overview.md`, `03-edge.md` | Drawn with 00 |
