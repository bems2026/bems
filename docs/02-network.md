---
title: Network and communication
purpose: Build and operate the isolated device network, the uplink and remote access (L2)
audience: [integrator, administrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo afa5aaf
evidence: []
---

# Network and communication

*Not written yet. This page is a scaffold (Phase S2). Its checklist is in the page source.*

## What it is

<!-- Brief (prompt §9). Cover:
     - Topology and the case for isolation
     - Router and access point setup: 2.4 GHz and why; channel; SSID hygiene; isolation from office traffic; firewall posture
     - Institutional pitfalls: client isolation, captive portals, band steering, egress filtering; discovery broadcasts do not cross subnets
     - Addressing plan: static vs reservation; a block scheme for more buildings; finding a device after a lease change (lan-map, set-device-ip)
     - Local control path: credential, how obtained, where stored, rotation, factory reset
     - Ports and protocols table (generalised)
     - Uplink: what needs internet, bandwidth, BEHAVIOUR DURING AN OUTAGE (first paragraph managers read)
     - Remote access: mesh enrolment, ACLs, node-key expiry, what is deliberately not exposed (F-001, F-007)
     - Verification: signal survey, end-to-end latency, packet yield with a pass threshold
     - Link, do not repeat: outage-recovery.md
-->

## What you need

## How to install

## How to configure

## How to verify

## How to operate

## How it fails

| Symptom | Likely cause | Check that tells the causes apart | Fix | How to confirm it held |
|---|---|---|---|---|

<!-- At minimum: device unreachable but powered; time-of-day drops; whole segment down; control works, telemetry does not; latency degradation; address conflict; works in vendor app but not from the edge; edge unreachable remotely. -->

## Field issue log

## What to keep on the shelf
