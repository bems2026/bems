---
title: Overview
purpose: What iBEMS is, the principles it keeps, how it is built, and what state each feature is in
audience: [administrator, integrator, operator, installer]
status: Draft
last_verified: 2026-09-24
applies_to: repo b8af936 · edge checkout fcb1ff6
evidence: [E-010, E-011, E-017, E-018, E-021, E-023, E-026, E-041, E-051, E-113, E-115, E-120, E-125, E-056, E-058, E-060, E-062, E-063, E-064, E-065, E-066, E-070, E-076, E-078, E-080, E-082, E-083, E-084, E-086, E-087, E-110, E-111, E-122, E-123, E-126, E-127, E-128, E-129, E-134, E-135, E-137, E-138, E-161]
---

# Overview

iBEMS measures a building's electricity circuit by circuit, switches the loads it is allowed to switch, and keeps an
honest record of both. It is built to be copied. The hardware is consumer smart-home devices and a single-board computer
[E-011, E-051], and every part of the software is in one public repository.

This chapter says what the system is, the rules it keeps, how its parts fit, and **what state each feature is in**.
Every statement about the system as built carries an evidence tag; the [manual's front page](README.md#how-to-read-the-evidence-tags)
explains them.

## What iBEMS is

| It does | How | Status |
|---|---|---|
| Measures consumption by circuit and by outlet, every minute | CT branch meters and metered outlets report to the edge server, which writes one row per device per minute | Field-validated [E-080, E-086] |
| Shows the building live, and its history | A web app, on a wall display and in any browser | Field-validated [E-023, E-060] |
| Switches lights and plug loads by hand | Audited commands through the edge server, gated by a hardware interlock | Field-validated [E-041, E-084] |
| Runs schedules | Stored in the database and fired by the edge server's scheduler | Field-validated [E-084] |
| Keeps demand under a limit | Automatic shedding, one group at a time, never restoring by itself | Field-validated [E-084, E-087, E-123] |
| Holds a room at a comfort target | An infrared commander, stepped by a room-temperature loop | Field-validated [E-084, E-113] |
| Flags unusual consumption | Rolling statistics: two tests must agree | Field-validated [E-076, E-080] |
| Produces reports | Daily, weekly and monthly figures with their coverage, exportable as CSV | Field-validated [E-080; ROADMAP EX-033] |
| Keeps control through an internet outage | A local audit buffer and offline session checks | Field-validated for ingestion [E-134]; implemented for commands [E-078] |
| Reaches the building from off site | Over a private mesh network, never exposed to the internet | Implemented; configured on the edge [E-026] |

Planned items (generation from the solar inverter, occupancy and daylight sensing, prediction) are listed only in
[94 Roadmap](94-roadmap.md).

## Principles

The feature list follows from a handful of rules, applied at every layer. Each is enforced in code, not just stated.

1. **Never state what the system cannot see.** A missing value shows a dash, never a zero. A silent device is excluded
   from totals, not counted as nothing. A gap in the record stays a gap [E-082, E-111]. "Online" means a message
   *arrived*, not that a number changed. *Known limit:* stored offline rows can carry a held value. Every aggregate
   filters them out, and any new query must too [E-083].
2. **One registry; everything else is generated.** One file describes a building's devices. The Node-RED bridge,
   the mock bridge and the payload transform all come from it, so nothing is repeated per device [E-062, E-063, E-127].
   This is what makes a second building cheap.
3. **Record before you act.** A command is written to the audit trail before anything is sent, together with the
   interlock's decision. No record, no switching [E-065, E-122].
4. **The building stays controllable with no internet.** The devices are local and so is control. If the database
   cannot be reached, commands are recorded in a local buffer and readings are queued until the link returns
   [E-078, E-134]. A database *refusal* is an answer and still refuses; only a failed connection is buffered [E-128].
5. **Shed, never restore.** Switching a load off unattended can be undone by a person; switching it on cannot
   [E-123].
6. **Refuse rather than guess.** Commands are absolute ("on", "off", a setpoint), never "toggle". A value outside the
   hardware range is refused [E-128, E-138].
7. **Dry run by default.** Every script that touches the live flow, and the installer, prints its plan and changes
   nothing without `--apply` [E-128, E-129].
8. **Never cry wolf.** Alerts fire on a change of state, not on every check that finds the same state [E-128].
9. **The repository is public.** No keys, tokens, passwords, host names or addresses in code, documents or commit
   messages. Site-specific values live on the edge server only.
10. **Every claim carries evidence, and a passing test suite is not proof.** Changes are read back from the running
    system.

## Architecture: five layers, three planes

The system is described in five layers, following the usual IoT reference model (perception, network, middleware,
application, business) and the building-automation tiers (field, automation, management). Three **planes** cut across
the layers: security, control logic and operations. They are not stages that data passes through.

**Figure 1 — the layers, and the real messages between them.** Source: [`diagrams/layers.mmd`](diagrams/layers.mmd).

```mermaid
flowchart BT
  subgraph L1 ["L1 · Field devices"]
    dev["Meters · Switches · Metered switches<br/>Commander (IR) · Sensors"]
  end
  subgraph L2 ["L2 · Network — a dedicated 2.4 GHz segment, an uplink, a mesh network"]
    net[/"device Wi-Fi · LAN · mesh VPN"/]
  end
  subgraph L3 ["L3 · Edge computing — one single-board computer on site"]
    nr["Node-RED<br/>generated bridge + device tabs"]
    proxy["Proxy<br/>the only authenticated door"]
    ingest["Ingest daemon"]
    sched["Scheduler daemon"]
  end
  subgraph L4 ["L4 · Data aggregation and storage — hosted, off site"]
    db[("Postgres + Auth<br/>23 tables, RLS")]
    sheets[("Spreadsheet mirror<br/>optional")]
  end
  subgraph L5 ["L5 · User interface"]
    browser["Web app (React, Vite)<br/>in a browser, or the kiosk"]
  end

  dev ~~~ net ~~~ nr
  dev <-->|"Tuya LAN protocol v3.3–3.5: local key, TCP 6668; discovery broadcasts on UDP 6667"| nr
  nr -->|"HTTP on loopback: GET /api/readings/latest every 60 s"| ingest
  ingest -->|"HTTPS REST, service-role key: readings, totals, health"| db
  nr -->|"append rows every 180 s"| sheets
  nr <-->|"HTTP on loopback, after the proxy verifies the session"| proxy
  proxy <-->|"HTTPS/WS with a session token: /api, /ws/live"| browser
  db <-->|"HTTPS with the public key under RLS: history, schedules, settings"| browser
  sched -->|"reads schedules, limits, rules"| db
  sched -->|"audited commands"| nr
  proxy -->|"audit row before dispatch"| db
```

| Layer | Owns | Named technology, as built |
|---|---|---|
| **L1 Field devices** | The six roles: Meter, Switch, Metered switch, Sensor, Commander, Source ([01a](01a-device-roles.md)) | Tuya-ecosystem Wi-Fi devices speaking the Tuya LAN protocol v3.3–3.5: CT branch meters (one box can carry two channels), dual-socket metered outlets, relay light switches and an infrared hub that also senses the room [E-051, E-125] |
| **L2 Network** | The dedicated device segment, addressing, the local control path, uplink and remote access ([02](02-network.md)) | A 2.4 GHz Wi-Fi segment; a mesh VPN (Tailscale) with tailnet-only HTTPS [E-026] |
| **L3 Edge computing** | Parsing, deciding, dispatching and supervising; everything that must survive an outage ([03](03-edge.md)) | Raspberry Pi 4 (8 GB), Debian 13, Node.js 22, Node-RED 4.1.8, systemd [E-010, E-011, E-017, E-018, E-021] |
| **L4 Data** | The system of record, ingestion and retention ([04](04-data.md)) | Supabase (hosted Postgres + Auth): 23 tables, row-level security, no anonymous policies [E-064, E-161]. A Google Sheets mirror is optional and secondary [E-058]. |
| **L5 Interface** | Seeing and acting, on the wall display or remotely ([05](05-interface.md)) | React 19, Vite 8, TypeScript, zustand; seven pages [E-060] |

| Plane | Cuts across | Why it is a plane, not a layer |
|---|---|---|
| **X1 Security and access** ([X1](X1-security.md)) | L1–L5 | Credentials exist at every layer. Covering them per layer scatters the one inventory that must be complete. |
| **X2 Control and automation** ([X2a strategy](X2a-control-strategy.md), [X2 realisation](X2-control-logic.md)) | L1–L3, configured from L5 | It is decided at the edge, executed in the field and configured from the UI: a band, not a floor. |
| **X3 Operations and lifecycle** ([X3](X3-operations.md)) | L1–L5 | Commissioning, backup, updates, spares and handover apply to the whole system. |

**Logical layers are not machines.** One edge server hosts L3 and also the L4 ingestion, the L5 web server and the
proxy. The only off-site component is the hosted database and its sign-in service (Figure 2).

## What runs where

**Figure 2 — deployment: what runs on which machine, and what supervises it.** Source:
[`diagrams/deployment.mmd`](diagrams/deployment.mmd).

```mermaid
flowchart LR
  subgraph site ["On site"]
    subgraph edge ["Edge server — one single-board computer (L3 + L4 ingestion + L5 serving)"]
      subgraph sysd ["systemd (system)"]
        nr["nodered.service<br/>Node-RED · loopback:1880"]
        proxy["ibems-proxy.service<br/>:8080"]
        ingest["ibems-ingest.service<br/>+ retention, reports"]
        sched["ibems-scheduler.service"]
        dash["ibems-dashboard.service<br/>static files · :5183"]
        mq["mosquitto.service<br/>(optional; no device client)"]
        tmr["timers: lan-map 10 min ·<br/>fleet-recover 5 min · wifi-prefer 5 min"]
      end
      subgraph usr ["systemd --user (graphical session)"]
        kiosk["ibems-kiosk.service<br/>Chromium --kiosk"]
      end
      files[("server/.env · server/data/<br/>~/.node-red (flows, creds, context)")]
    end
    devs["Field devices<br/>dedicated 2.4 GHz segment"]
    screen["Wall display"]
  end
  subgraph off ["Off site"]
    db[("Hosted Postgres + Auth")]
    cloud["Vendor cloud<br/>(optional fallback)"]
    push["Push notifications"]
  end
  remote["Remote user<br/>via mesh network (tailnet-only HTTPS)"]

  tmr -. "restarts Node-RED when devices are reachable but not connected" .-> nr
  proxy --> nr
  ingest --> nr
  sched --> nr
  kiosk --> dash
  kiosk --> proxy
  kiosk --- screen
  nr <--> devs
  ingest --> db
  sched --> db
  proxy --> db
  proxy -. fallback .-> cloud
  ingest -. "fleet alarm, edge-triggered" .-> push
  remote --> dash
  remote --> proxy
```

Every long-running process is a systemd unit that restarts itself on failure. The kiosk is a *user* unit, because it
must run inside the logged-in graphical session [E-021, E-023]. How to build and supervise all of it is in
[03 Edge](03-edge.md).

## Following one reading and one command

**Figure 3 — one reading, device to screen, with the transform and units at each hop.** Source:
[`diagrams/data-path.mmd`](diagrams/data-path.mmd). The example values are a real stored reading [E-080, E-135].

```mermaid
sequenceDiagram
  autonumber
  participant D as Device<br/>(CT meter)
  participant T as Node-RED<br/>device tab
  participant B as Node-RED<br/>bridge tab
  participant I as Ingest daemon
  participant P as Postgres
  participant X as Proxy
  participant W as Browser
  Note over D,T: Raw datapoints are integers, e.g. cur_power 8159, cur_voltage 2270, cur_current 7692
  D->>T: dp report on change, or the reply to a 60 s GET poll (Tuya LAN, TCP 6668)
  Note over T: Parser: value ÷ 10^scale from the capability catalogue → 815.9 W · 227.0 V · 7.692 A.<br/>Stored in the tab's flow context with its arrival time.
  B->>T: collector link-call (flow context is per tab)
  T-->>B: parsed state + arrival time
  Note over B: buildLatest: one reading per device {power_w, voltage, current, online, ts, stale_after_ms}.<br/>online=false after 600 s with no new arrival.
  I->>B: GET /api/readings/latest (loopback, every 60 s)
  B-->>I: JSON readings + building totals
  Note over I: shapeRows + scrub: a non-finite or out-of-bounds value is stored as NULL and counted.<br/>Only a row with an unusable timestamp is dropped.
  I->>P: INSERT readings, building_totals (HTTPS REST, service-role key, ts in UTC)
  Note over I,P: If Postgres is unreachable: rows go to a local buffer and flush on reconnect
  B-->>X: WS /ws/live push every 2 s (loopback)
  X-->>W: live frame (session-verified)
  W->>P: history via database functions (public key, RLS)
  P-->>W: per-minute rows ≤ 30 days old, hourly buckets beyond
  Note over W: Shown in the SITE's time zone. A late reading is dimmed after its stale budget,<br/>a dash after 300 s, and a silent device is excluded from totals, never zeroed.
```

Evidence for the hops: the scaling [E-135]; the poll cadences [E-056]; the online, late and expired thresholds
[E-110, E-111]; the scrub [E-138]; outage buffering [E-134]; retention [E-070]; access to history through database
functions [E-126, E-161]; site-time display [E-137].

**Figure 4 — one command, screen to device.** It shows the audit write before dispatch, the interlock, and where
acknowledgement does and does not exist. Source: [`diagrams/command-path.mmd`](diagrams/command-path.mmd).

```mermaid
sequenceDiagram
  autonumber
  actor O as Operator
  participant W as Browser
  participant X as Proxy
  participant A as auditedDispatch
  participant P as Postgres<br/>(or local buffer)
  participant N as Node-RED<br/>http-in
  participant D as Device
  O->>W: press a control (absolute state: on / off / setpoint, never "toggle")
  W->>X: POST /api/command + session token
  Note over X: Verify the session: against Auth, or the cached signing key when offline.<br/>Break-glass sessions are view-only and refused here.
  Note over X: Validate: class is controllable · value inside the hardware range (else REFUSE) ·<br/>below site policy → accept, with a warning written into the note
  X->>A: device, command, attribution
  A->>P: INSERT commands row: status dry_run (gate closed) or dispatching (gate open)
  alt the row cannot be written, and Postgres answered 4xx
    P-->>A: refusal (an answer)
    A-->>X: refused, nothing moves
  else transport failure
    A->>P: row written to the local audit buffer instead (uploaded later)
  end
  Note over A: INTERLOCK: HARDWARE_DISPATCH_ENABLED and the device class in DISPATCH_CLASSES
  A->>N: POST /light/:id · /outlet/:target · /acu · /capability/:id (LIGHT_API_TOKEN)
  N->>D: set dp (Tuya LAN). For IR: send the frame, with no echo expected
  N-->>A: HTTP 2xx: the flow accepted it. This is NOT the device confirming.
  opt local dispatch failed and a vendor fallback is configured
    A->>D: vendor cloud dispatch
  end
  A->>P: UPDATE status dispatched / failed, via = local · cloud · none
  X-->>W: 202 Accepted, confirmed: false
  Note over W,D: Verification: the browser reconciles the pending command against the next readings.<br/>No new state → "The device did not report the new state." IR units never report, so the room sensor is the proof.
```

Evidence for the steps: session verification and break-glass [E-066, E-128]; validation [E-120, E-138]; record-first
with the gate's decision [E-065, E-122]; the interlock, observed **open** on this deployment [E-041]; the local buffer
and the 4xx rule [E-078, E-128]; the `202` acknowledgement [E-138]; browser-side verification [E-115].

!!! warning "Hardware dispatch is enabled on the pilot deployment"
    `HARDWARE_DISPATCH_ENABLED` was observed as `true` on 2026-09-23, and commands have reached relays since
    2026-08-24 [E-041, E-084]. A new deployment starts with it unset, which means closed. Opening it is a signed-off
    step in commissioning: [X2 § dispatch interlock](X2-control-logic.md).

## How this manual is organised

The [front page](README.md) gives a reading path for each role. The order of the chapters follows the layers (01–05),
then the planes (X1–X3), then building a new site (90), then the references (91–94). The pilot site appears only in
[99](99-worked-example.md).
