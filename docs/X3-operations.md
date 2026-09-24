---
title: Operations and lifecycle
purpose: Commission, run, change, update, recover and eventually retire the system (plane X3)
audience: [operator, administrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo 537f956
evidence: [E-017, E-018, E-027, E-038, E-039, E-065, E-076, E-110, E-111, E-124, E-131, E-157, E-183, E-186, E-188, E-200, E-201]
---

# Operations and lifecycle

This chapter follows the system from handover to retirement, the way a building-automation contractor hands over a
plant. The detailed procedures it relies on already exist, and it links to them rather than repeat them:
- [`backup-policy.md`](backup-policy.md): taking and restoring the database backup.
- [`outage-recovery.md`](outage-recovery.md): what an outage does, and the two things a person does afterwards.
- [`replication.md`](replication.md) and [`physical-install.md`](physical-install.md): standing up a new site.
- [`pi-session-brief.md`](pi-session-brief.md): working on the edge itself.

## What it is

### The commissioning pack

Handed over with the system, and kept current. Each item names where its content comes from, so it can be regenerated
rather than retyped.

| Item | Contains | Source |
|---|---|---|
| **Point list** | Every data point, one row each: device, point name, unit, scale, valid range, and source (local network, or vendor cloud) | The site's devices (`shared/sites/<site>/`), the capability catalogue (`shared/deviceCapabilities.mjs`), and the units in [04](04-data.md#the-tables). Checked against the vendor with `npm run tuya:spec`. |
| **Sequence of operations, as built** | What runs unattended, when, and why | [X2](X2-control-logic.md), plus the site's armed rules as the Automation page's Summary lists them |
| **Alarm and threshold register** | Every limit that makes the system act or warn | The demand limits and shed tiers; the aircon rules and the room floor; the staleness windows [E-110, E-111]; the anomaly rule [E-076]; the fleet notice [E-200] |
| **Test record** | X2a §8's tests, each with a result, a date and a name | [X2a § Test manual](X2a-control-strategy.md#8-test-manual) |
| **Network and access record** | Addressing, the SSIDs by role, the mesh network, who holds each account | [02](02-network.md), [X1](X1-security.md). Kept off the public repository. |
| **As-built record** | What is installed, with dates | See [The as-built record](#the-as-built-record) |
| **Commissioning certificate** | The signed statement below | This page |

**Commissioning certificate**

| Field | Entry |
|---|---|
| Site and building | |
| Devices commissioned (count, by class) | |
| Test record attached, with every failure explained | |
| Dispatch interlock state at handover, read from the scheduler's start line | |
| Open findings accepted by the owner, by ID | |
| Handed over by (role, name, date) | |
| Accepted by (role, name, date) | |

### Staged go-live

Each stage has entry and exit criteria. **On this system the database comes before local control**, not after it: the
proxy will not start without the database, and no command moves a relay without an audit row [E-201, E-065].

| Stage | What runs | Entry | Exit |
|---|---|---|---|
| **1 · Local view-only** | The bridge and a build without the database, on the edge only | Every device discovered on the device segment ([01](01-field-devices.md)) | Every device reporting within its window for 24 h; packet yield ≥ 99 % [E-157] |
| **2 · Database-backed** | Ingest, sign-in, reports, and the scheduler with the interlock **off** (every command recorded as `dry_run`) | Stage 1 passed; the schema applied; accounts invited ([04](04-data.md), [X1](X1-security.md)) | `ingestion_health` fresh for a week; one day's report complete; one restore rehearsed ([backup-policy](backup-policy.md)) |
| **3 · Local control** | The interlock **on**, recorded with its form ([X2](X2-control-logic.md#the-dispatch-interlock)) | X2a §8's T1 Control and T2 Reliability passed | Every relay commanded and confirmed from the app; one schedule fired and recorded |
| **4 · Authenticated remote** | Mesh Serve, remote accounts | X1's How to install, steps 1–6 | X1's How to verify, every row passing from a remote device |

### The as-built record

Updated **at the time of the change**, never afterwards from memory:

| What | Where it is recorded |
|---|---|
| Feature state, with evidence | `ROADMAP.md`, by `EX-`, `RM-` and `FI-` ID |
| The site's devices and circuits | `shared/sites/<site>/`, checked by `npm run site:check` |
| The hand-built flow tabs, as last captured | `node-red-bridge/live-flow-baseline.json` |
| Settings that live only on the host | [03 § Settings that live only on the host](03-edge.md#settings-that-live-only-on-the-host), and F-010 |
| The site in words | [99](99-worked-example.md) |

## What you need

| Item | Specification that matters |
|---|---|
| A named operator and a named administrator | Roles in [X1](X1-security.md#accounts). One person may hold both at a small site. |
| The commissioning pack | Above, current |
| Spares | [What to keep on the shelf](#what-to-keep-on-the-shelf) |
| A place off the edge for backups and credentials | Encrypted ([backup-policy](backup-policy.md), F-002) |

## How to install

Commissioning is the staged go-live above. The steps for each stage are in the chapters it names; this chapter adds
only the order and the exit criteria.

**Done when.** Stage 4's exit criteria pass and the certificate is signed.

**Tested.** The pilot reached every stage over its build history, but not in this order and not against these
criteria, which are written for the next site [E-201].

## How to configure

| Setting | Where | Recommended |
|---|---|---|
| The notice topic | `NTFY_TOPIC` in `server/.env`, with the topic subscribed on the operator's phone | Set. It is the only alarm that reaches someone away from a screen [E-200]. |
| Report settle times | `shared/reportSchedule.mjs` | Leave as built: a day settles after 1 h; weeks and months after two days |
| Retention | `INGEST_RETENTION_DAYS` | 30 days of minutes, then hourly for good ([04](04-data.md#sizing-and-retention)) |

## How to verify

The routine checks below are the verification: each says what good looks like.

## How to operate

### Routine checks

| When | Check | Good looks like |
|---|---|---|
| **Daily** | The header pill; the Devices page | `LIVE`; every device's *last seen* within its window |
| | *Automation → Summary*, "What automation did in the last 24 hours" | What fired is what was meant to fire |
| | The alerts bell | Nothing unexplained |
| **Weekly** | `npm run preflight` on the edge | `Ready`, or each warning understood |
| | The week's report | Coverage ≥ 99 % of expected minutes per device [E-157] |
| | `ss -tln` on the edge | Only the listeners [X1](X1-security.md#physical-security) expects |
| **Monthly** | The month's report, once it appears (the 3rd) | Complete; any restated day explained |
| | `npm run backup`, copied off the edge | A new export, off the card ([backup-policy](backup-policy.md) suggests exactly this cadence) |
| | The edge's temperature and throttle flags (`vcgencmd measure_temp; vcgencmd get_throttled`) | Below the soft limit; no new throttling (F-003) |
| | `journalctl -p err --since '-30 days'` for iBEMS units | Nothing new from an iBEMS unit [E-039] |
| **Quarterly** | Accounts and mesh devices against the staff list ([X1](X1-security.md#how-to-operate)) | One-for-one |
| | The off-card credential copy | Current |
| | A database restore rehearsal (`npm run restore:rehearse`) | Every count and row matches [E-124] |
| **Annually** | X2a §8's tests, re-run | All pass, or each failure has a finding |
| | A restore of the edge from the credential copy onto a spare card | The flow's credentials decrypt and the fleet comes back (F-002) |
| | Tariffs and emission factors | The rates in force, each with its source |
| | The SD card's age against its endurance | Replace it before it fails (F-015) |

### Monitoring the monitor

How you learn that recording stopped before a month of data is lost:
- **From the edge, with `NTFY_TOPIC` set:** a notice when the fleet drops or recovers, and one when each monthly
  report is made. The monthly notice doubles as a heartbeat: **a month with no notice means something stopped** [E-200].
- **From anywhere:** `ingestion_health.last_success_at` in the database. It should be under a minute old
  ([04](04-data.md#how-to-verify)).
- **The gap:** every notice comes from the edge itself. If the edge dies, nothing says so (F-034). Until an outside
  check exists, the daily look at the header pill **is** the monitor.

### Change control

Every change to the building's devices changes documents too. Change them in the same act.

| Change | Do | Then update |
|---|---|---|
| **Add a device** | [01 § How to install](01-field-devices.md#how-to-install) | The point list; the device's shed tier and rules; [99](99-worked-example.md); ROADMAP |
| **Change a device** (move, re-wire, re-pair) | Re-pairing issues a new local key: import it ([X1](X1-security.md#the-credential-inventory)) | The point list; the circuit in `shared/sites/<site>/`; `npm run site:check`; the physical-install record |
| **Remove a device** | [05 § Take a device out of service](05-interface.md#administration-guide), then remove it | The point list; the site's registry; ROADMAP |
| **Change code** | Commit, then deploy: rebuild for `src/`, restart the three daemons for `server/` and `shared/` [E-131] | ROADMAP, in the same change |
| **Change a host setting** | Back up the file first (a timestamped copy beside it) | 03's host-only list; the as-built record |

### Update policy

| Component | How it updates today | Policy |
|---|---|---|
| The operating system | By hand. `unattended-upgrades` is not installed [E-038]. | Monthly, on site or with someone reachable. Never an unattended upgrade of Node.js or Node-RED. |
| Node.js | NodeSource apt, by hand [E-017] | Within the `>=22 <25` range the repository declares. Run the full test suite first. |
| Node-RED and its palette | Global npm, by hand [E-018] | Only deliberately: back up `~/.node-red/` first, then run `npm run preflight` and `verify:pi` afterwards |
| The mesh agent | **Updates itself** [E-027] | Accepted, or turned off (F-020) |
| iBEMS itself | `git pull`, then build or restart as the change needs | CI green on the commit first; then the deploy step above |

**Rolling back** is the same act in reverse: check out the previous commit and rebuild or restart; restore the `.bak`
copy of a host file; restore `flows.json` from its backup, **never** with a different `credentialSecret` [E-186].

### Incident response

| Severity | Means | Who | Within |
|---|---|---|---|
| **1 · Safety** | A load switching unexpectedly, a relay that will not switch off, heat or smell at a panel | The facility's electrical staff first, then the operator | Immediately. Isolate at the breaker; the app is not a safety device. |
| **2 · Control lost** | Commands failing across the fleet; unexplained automation | The operator | The same working day |
| **3 · Recording lost** | `ingestion_health` stale; reports with gaps | The operator | Within a day, before the retention window turns a gap into a loss |
| **4 · Degraded** | One device offline; one remote user locked out | The operator | Within a week |

After each incident of severity 1 to 3, add a row to the chapter's field issue log (the template is
[`field-issue.md`](_templates/field-issue.md)) and to ROADMAP.

### Training and handover

A new operator is competent when they can do each of these, unaided, and a second person has watched:

| # | Competency | Where it is taught |
|---|---|---|
| 1 | Read every state on the Overview and Devices pages, and say what "stale" and "held" mean | [05](05-interface.md#design-rules-that-carry-meaning) |
| 2 | Switch a load, and explain a refusal from its message | [05](05-interface.md#user-guide) |
| 3 | Arm and disarm a schedule, and read what automation did | [05](05-interface.md#user-guide), [X2](X2-control-logic.md) |
| 4 | Restore a shed load, and say why it was shed | [X2](X2-control-logic.md#how-demand-thresholds-are-evaluated) |
| 5 | Recover from a power cut, as the runbook says | [outage-recovery](outage-recovery.md) |
| 6 | Take and restore a backup | [backup-policy](backup-policy.md) |
| 7 | Offboard a person | [X1](X1-security.md#how-to-operate) |
| 8 | Isolate a circuit at the breaker, and know that the app is not a safety device | The site's electrical procedures |

### Decommissioning

| Retiring | Do |
|---|---|
| **A device** | Take it out of service ([05](05-interface.md#administration-guide)), remove it, and factory-reset it so its local key dies with it |
| **A building** | Disarm every rule; set the interlock off and record it; take a final backup; retire the site's accounts and mesh devices; **wipe the SD card** [E-188] |
| **The whole system** | As for a building, then export what the institution must keep and delete the database project |
| **The data** | Decide what is kept, and for how long, with the institution's records officer. Accounts and the audit trail are personal data ([93](93-governance-compliance.md)). |

## How it fails

| Symptom | Likely cause | Check that tells the causes apart | Fix | How to confirm it held |
|---|---|---|---|---|
| A month with no report notice | The edge, ingest or the notice topic stopped | `ingestion_health.last_success_at`; `systemctl status ibems-ingest` | Restore the service; re-subscribe the topic | The next notice arrives |
| Days of data missing, found late | Nothing outside the edge watched it (F-034) | Report coverage; the edge's uptime | Restore recording; add the outside check | Coverage back to ≥ 99 % |
| The fleet offline after a power cut | The devices came back before the network, or a node gave up | [outage-recovery](outage-recovery.md) | As the runbook says | Every device within its window |
| A change works, then vanishes after a rebuild | A host-only setting was lost (F-010) | 03's host-only list against the host | Restore from the `.bak`; record the setting | `preflight` passes |
| A restore brings the flow back without its credentials | A different `credentialSecret` | [X1](X1-security.md#how-it-fails) | Restore the original `settings.js` | The nodes connect |

## Field issue log

| Date | Symptom | Root cause | Fix | Evidence | Lesson |
|---|---|---|---|---|---|
| 2026-08-25 | Six of seven outlets offline for hours, unnoticed | The only place it would have shown was a screen nobody was watching | The fleet notice (FI-005) | E-200 | An alarm must reach someone who is not looking |
| 2026-09-02 | The kiosk ran week-old software | A single-page app never reloads | The build watch | E-183 | Deploying is not the same as being seen |
| 2026-09-22 | A database restore rehearsed end to end | — | `npm run restore:rehearse` | E-124 | Only a rehearsed backup is a backup |

## What to keep on the shelf

Lead times are `[UNVERIFIED]`: record the site's own when each spare is bought.

| Item | Why |
|---|---|
| A high-endurance SD card, imaged or ready to image | The card is the most likely hardware failure (F-015) |
| A spare power supply for the edge, at its rated output | Undervoltage looks like software faults |
| One spare of each device class in use | A failed device is replaced, not repaired |
| The commissioning pack, printed | It is needed when the system is not |
| The certificate and the latest test record | Proof of what was handed over |
