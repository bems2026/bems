---
title: Diagram sources
purpose: The system figures the manual requires, their source files, and where each is used
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
| 1 | Whole system: five layers, with the real messages between them. The three planes are the table beneath it in 00. | `layers.mmd` | `00-overview.md` (Figure 1) | Drawn 2026-09-24 |
| 2 | Data path, device to screen: one reading's journey, with the transform and units at each hop | `data-path.mmd` | `00-overview.md` (Figure 3); later `04-data.md` | Drawn 2026-09-24 |
| 3 | Command path, screen to device: audit write before dispatch, the interlock, where acknowledgement does and does not exist | `command-path.mmd` | `00-overview.md` (Figure 4); later `X2-control-logic.md` | Drawn 2026-09-24 |
| 4 | Failure-mode overlay: what breaks at each hop, and what the user sees | `failure-modes.mmd` | `03-edge.md` § How it fails (Figure 6); `91-troubleshooting-index.md` | Drawn 2026-09-24 |
| 5 | Network topology, generalised with no real addresses | `network.mmd` | `02-network.md` § What it is (Figure 5) | Drawn 2026-09-24 |
| 6 | Deployment: what runs where, and which process supervises which | `deployment.mmd` | `00-overview.md` (Figure 2) | Drawn 2026-09-24 |
| 7 | Trust boundaries: who can reach each listener, and with which credential | `trust-boundaries.mmd` | `X1-security.md` (Figure 7) | Drawn 2026-09-24 |

**Each chapter embeds the figure inline** so that it renders on GitHub as well as in the site build. The `.mmd` file is
the source. Phase D adds a check that each inline copy is identical to its source.
