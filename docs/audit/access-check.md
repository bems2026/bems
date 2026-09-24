---
title: Access check
purpose: What the audit could and could not reach on 2026-09-23, and how
audience: [integrator]
status: Draft
last_verified: 2026-09-23
applies_to: repo 2f4c570 · edge checkout fcb1ff6
evidence: [E-001, E-002, E-003, E-004, E-005, E-034, E-041, E-050, E-080, E-090]
---

# Access check — Phase 0

| Target | Reached? | How | Result | Evidence |
|---|---|---|---|---|
| Repository (workstation) | Yes | `git fetch`, then `HEAD` compared with `origin/master` | Current at `15aa65e` before this work. Phase 0 committed `2f4c570` (`.gitignore`) on top. | E-001 |
| Edge server over the mesh network | Yes, **relayed** rather than direct | `tailscale ping -c 3 $EDGE_HOST` | 3 of 3 pongs, 165–1038 ms, "direct connection not established". | E-002 |
| Edge shell | Yes | `ssh -o BatchMode=yes $EDGE_USER@$EDGE_HOST 'echo ok'` | Answered on the first try. No mesh re-authentication was needed. | — |
| Edge checkout | Yes | `git rev-parse HEAD; git status -sb` on the edge | `fcb1ff6`, one commit behind `origin/master` (that commit touches only `ROADMAP.md`). Clean, with no local-only commits. | E-003 |
| Kiosk bundle | Yes | `GET /` on the dashboard port, from the edge | `assets/index-DGcKHoNp.js`, built 2026-09-23 20:57. | E-004 |
| Live flow | Yes, from disk | `~/.node-red/flows.json` read on the edge and redacted there. **No Admin API call was made.** | 303 nodes. Redaction's residual check flagged only long node IDs. | E-050 |
| Database | Yes, `GET` only | The edge's own `server/.env`, loaded by `node --env-file` on the edge. The key was never printed or copied. | 23 tables counted and sampled. The size could not be read over REST (Q-01). | E-080, E-090 |
| Root-only files | No | — | `sshd_config.d/50-cloud-init.conf` is unreadable without sudo, and no sudo was used. | E-034 |

**Held to G5 throughout.** There were no service starts, stops or restarts, no file edits on the edge, no package
changes, no `git fetch` on the edge and no flow deploy. The only HTTP calls to local services were `GET` requests.
The dispatch flag was read, not changed: it is `true`, and the scheduler reports `dispatch=OPEN` (E-041).

**Another agent is present.** A long-running Claude Code session runs on the edge (E-005). It has committed locally
without pushing before, so any later session compares the edge's `HEAD` with `origin/master` before trusting either.
