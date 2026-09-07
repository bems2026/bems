# Security policy

iBEMS runs real buildings. A fault here does not corrupt a record — it switches a relay, or
leaves a room dark. Please treat it accordingly.

## Reporting a vulnerability

Use **[GitHub's private vulnerability reporting](https://github.com/bems2026/bems/security/advisories/new)**
(Security → Report a vulnerability). It is private to the maintainers until a fix ships.

If that is unavailable to you, email the maintainers at **care@mmsu.edu.ph** with `iBEMS
security` in the subject.

Please include what you did, what happened, and what you expected. A proof of concept helps;
**do not run one against a live deployment that is not yours** — the devices in scope are the
lights, outlets and air-conditioning of an occupied building.

Expect an acknowledgement within five working days. This is a small research team, not a vendor
with an on-call rota, and we would rather say that than imply a response time we cannot hold.
There is no bounty.

## Scope

In scope: this repository — the frontend, the daemons under `server/`, the generated Node-RED
flow, the SQL under `supabase/`, and the deployment scripts under `scripts/`.

Out of scope: vulnerabilities in Tuya devices or the vendor cloud, in Node-RED, Supabase, or
Raspberry Pi OS. Report those to their own maintainers. We are interested in how *this* project
uses them, including a dependency we pin at a version with a known fault.

## What this repository must never contain

**This repository is public and has been from the start.** No token, key, password, hostname, IP
address, or Supabase project identifier belongs in the code, the docs, the commit messages, or a
screenshot — see the rules in [`CONTRIBUTING.md`](CONTRIBUTING.md) and the `.gitignore`, which is
written broadly on purpose because the next credential backup will be named something nobody
predicted.

If you find something like that in the history, report it privately by the route above rather
than opening an issue.

## How the deployment is arranged, and why

Stated because it tells you where a report is worth making, not as an inventory of what to
attack:

- **The vendor API secret is the most sensitive credential in the system** — ahead of the
  database service-role key, because it reaches hardware directly and no row-level policy scopes
  it. It lives in one file on the deployed machine, is read only by `server/` code, and is never
  imported by the frontend. The browser bundle carries the RLS-constrained anon key and nothing
  else, on purpose.
- **The bridge and the MQTT broker listen on loopback only.** Both once did not, and both are
  narrower now because a measurement — not a review — showed what was reachable from the device
  Wi-Fi. Widening either is reinstating the problem, not configuring a feature. If you deploy
  this, keep them there.
- **Hardware dispatch is gated and off unless a deployment sets it.** Every command is validated
  and written to an audit row *before* anything is touched, using the caller's own token, so a
  relay that moved without a record is not a representable state.
- **Auto-shed sheds and never restores.** Switching load off unattended is recoverable by a
  person; switching it back on is not.
