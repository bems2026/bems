---
title: Replication — step 1 to done
purpose: Take a building with nothing installed to a working, handed-over iBEMS
audience: [integrator, administrator, installer]
status: Draft
last_verified: 2026-09-24
applies_to: repo 29403b5
evidence: [E-063, E-065, E-088, E-122, E-130, E-134, E-137, E-149, E-157, E-176, E-196, E-205, E-206]
---

# Replication — step 1 to done

This is the whole path, from a building with nothing installed to a system handed over and improving. Follow the steps
in order. Each step needs only what an earlier step produced.

Two documents hold the detail for their parts, and this one does not restate them:

- [`replication.md`](replication.md): the software half, walked end to end on throwaway sites, with each step marked
  as executed or not.
- [`physical-install.md`](physical-install.md): the hardware half. It is a template with 12 gaps marked `〔FILL IN〕`,
  which only a site visit closes (Q-13).

Every step below has the same five parts: **precondition**, **procedure**, **expected result**, **done when**, and
**if it fails**.

## What it is

### What you are replicating

One building gets its own edge server and its own software stack, and every row it stores carries its site's
identity [E-149]. A site is a directory, `shared/sites/<site>/`, holding three files: `site.mjs` (name, time zone,
location, policy), `devices.mjs` and `circuits.mjs`. The edge is told which directory it is [E-063]. Everything
per-device is generated from that directory (ADR-0007).

### Invariants: keep these, at every site

| Invariant | Why | Where it is enforced |
|---|---|---|
| **The layer boundaries** (field, network, edge, data, interface) | Each fails and is replaced on its own | [00](00-overview.md) |
| **The registry pattern:** devices declared once, everything generated | Replication is a new directory, not a new flow | ADR-0007; `npm run test:bridge` |
| **One control core:** every command, manual or automatic, goes through the audited path | One place to reason about what moved and why | [X2](X2-control-logic.md) [E-065] |
| **The dispatch interlock** | Everything is recorded, and nothing moves, until the site decides | [X2](X2-control-logic.md#the-dispatch-interlock) [E-122] |
| **Audit before dispatch** | "A relay moved with no record" cannot happen | E-065, E-196 |
| **UTC storage, site-time display** | One clock in the data; local time on screen | E-088, E-137 |
| **The secrets policy:** secrets only on the edge, never in the repository | The repository is public | [X1](X1-security.md) |
| **The staged go-live** | Each stage proves what the next relies on | [X3](X3-operations.md#staged-go-live) |
| **Accounts by invitation only** | There are no roles; who can sign in is the access policy | [X1](X1-security.md) [E-176] |
| **Topology in the database, wiring in the repository** | The building must stay controllable with no internet. Wiring is load-bearing; labels are not. | E-205 (the architecture record, §5.2) |

### Adaptables: change these freely

| Adaptable | Within |
|---|---|
| Device brands and models | The role's specification ([01a](01a-device-roles.md)) and a supported device class ([01](01-field-devices.md)) |
| Circuit and device counts | What the edge and the network carry ([02](02-network.md), [03](03-edge.md)) |
| The database plan | Its size cap and pause rules measured against the site's volume ([04](04-data.md#sizing-and-retention)) |
| Branding and the site's name | `site.mjs` |
| Schedules, thresholds, comfort rules, tariffs | The app, owned by the site's operator |
| The room-temperature floor | The institution's policy, entered on Settings |

## What you need

- A building owner who wants it, and a named operator and administrator for afterwards ([X3](X3-operations.md)).
- A qualified electrician for all panel work ([93](93-governance-compliance.md)).
- The roles and their specifications ([01a](01a-device-roles.md)) and the supported device classes
  ([01](01-field-devices.md)).

## How to install

### Step 1: Readiness assessment

**Precondition.** The building owner has agreed to a survey.

**Procedure.**

1. **Panel access:** obtain the single-line diagram of each distribution panel. Confirm a qualified electrician can
   isolate and work on it ([`physical-install.md`](physical-install.md) §0).
2. **Circuit count:** list every branch circuit with what it feeds (lighting, outlets, air-conditioning, other), and
   its phase.
3. **Network feasibility:** confirm a 2.4 GHz network can be dedicated to the devices, reaching every panel and room
   that will have one. Confirm it has no client isolation. Once an edge is on site, `npm run rf:survey` samples the 2.4 GHz channel from where it sits, read-only [E-206] ([02](02-network.md)).
4. **Uplink:** confirm internet access for the edge, and how often it fails ([02](02-network.md#how-it-fails)).
5. **Ownership afterwards:** name who will operate it, and which institutional accounts will hold the database, the
   mesh network and the devices ([X1](X1-security.md#accounts)).

**Expected result.** A one-page survey: panels, circuits by type and phase, network plan, uplink, owners.

**Done when.** Every item above has an answer, or an owner and a date for one.

**If it fails.** No panel access, or no permitted panel work: see *Leased premises* under
[Common variations](#common-variations). No dedicated 2.4 GHz segment possible: stop. The devices cannot be reached
([02](02-network.md)).

### Step 2: Scoping: start small

**Precondition.** Step 1's survey.

**Procedure.** Choose the first scope from 01a's selection guide ([01a § 4](01a-device-roles.md#4-choosing-what-you-need)).
The recommended start is **one meter at the main incomer, three or four branch meters, and switching on the largest
controllable load**. Add sensors only after a month of data shows where the energy goes.

**Expected result.** A short list: which circuits are metered, which loads are switched, which are commanded (IR),
and why each.

**Done when.** The owner has agreed the list, and every switched load has been checked against the rule that **no
compressor is switched at its supply** ([01a § 2](01a-device-roles.md#2-the-six-device-roles)).

**If it fails.** If scope keeps growing, cut to the recommended start. It proves the system, and every later device
is added the same way ([X3](X3-operations.md#change-control)).

### Step 3: Bill of materials

**Precondition.** Step 2's scope.

**Procedure.** Price one line per role. Part numbers are left to the site: iBEMS names none it has not verified.

| Role | Specification that matters | Quantity | Local price |
|---|---|---|---|
| Edge server | A 64-bit board with ≥ 4 cores. The pilot runs on 8 GB and uses about 2.2 GiB; a smaller board is untested. **Endurance-rated storage**, a correctly rated supply, its own enclosure, and a desktop session for the kiosk ([03](03-edge.md#what-you-need)) | 1 per building | |
| Access point | 2.4 GHz with no client isolation; able to reserve addresses ([02](02-network.md)) | 1, or enough for coverage | |
| Meter (M) | CT-clamp, supported device class, rated for the circuit's current ([01](01-field-devices.md)) | 1 at the incomer + 1 per chosen branch | |
| Switch (S) | Supported class, rated for the circuit's load | 1 per switched lighting circuit | |
| Metered switch (MS) | Supported class, per-socket metering | 1 per switched outlet or outlet group | |
| Commander (C) | An IR hub the vendor's local protocol supports, in line of sight of the unit | 1 per unit or per group in sight | |
| Sensor (E) | Supported class | Only after the first month | |
| Uninterruptible supply | For the edge and the access point | 1 | |
| Spares | [X3 § What to keep on the shelf](X3-operations.md#what-to-keep-on-the-shelf) | | |

**Expected result.** A priced list, with the electrician's labour priced separately.

**Done when.** Each line names a model that meets its specification **and** is a device class iBEMS supports, or the
cost of adding that class.

**If it fails.** A device the vendor's local protocol does not support cannot be controlled locally. Choose another
model, or plan the work of a new device class ([01](01-field-devices.md)).

### Step 4: Bench build

**Precondition.** The edge server, one metered switch and one switch, on a bench. Nothing is in a panel.

**Procedure.**

1. Run the software with no hardware at all: `npm run mock`, then `npm run dev` ([`replication.md`](replication.md)
   step 7).
2. Build the edge ([03](03-edge.md#how-to-install)), with `HARDWARE_DISPATCH_ENABLED` left **unset**, so every command
   is recorded as `dry_run`.
3. Scaffold the site (`npm run site:new`), fill in `site.mjs`, and run `npm run site:check` ([`replication.md`](replication.md)
   steps 1–4 and 10).
4. Set up the database and add the site's row ([04](04-data.md#how-to-install)).
5. Pair the two devices and enrol them ([01](01-field-devices.md#how-to-install)).
6. Sign in, switch each device from the app, and read back its `dry_run` row ([05](05-interface.md#how-to-verify)).

**Expected result.** Both devices report on the Devices page within their windows. Each click writes a `dry_run` row
and moves nothing.

**Done when.** `npm run preflight` reads `Ready`, or each warning is understood [E-130].

**If it fails.** Devices offline on a working network: check the 2.4 GHz segment, the protocol version and client
isolation first ([02](02-network.md#how-it-fails), [01](01-field-devices.md#how-it-fails)).

### Step 5: Build sequence, layer by layer

**Precondition.** Step 4 passed on the bench.

**Procedure.** In this order, each by its chapter's *How to install*:

| # | Layer | Chapter | Done when |
|---|---|---|---|
| 6.1 | Network: the dedicated segment, addresses, uplink, mesh | [02](02-network.md#how-to-install) | The edge and one device answer on the segment; packet yield measured |
| 6.2 | Edge: operating system, installer, services, flow | [03](03-edge.md#how-to-install) | `preflight` reads `Ready` |
| 6.3 | Data: schema, site row, keys, backup | [04](04-data.md#how-to-install) | `ingestion_health` fresh every minute |
| 6.4 | Field devices: meters, switches, commanders, by a qualified electrician | [01](01-field-devices.md#how-to-install), [`physical-install.md`](physical-install.md) | Every device reporting within its window for 24 h |
| 6.5 | Interface: build, kiosk, remote access | [05](05-interface.md#how-to-install) | A signed-in browser shows `LIVE` |
| 6.6 | Security: sign-up off, accounts, SSH policy, credential copy | [X1](X1-security.md#how-to-install) | X1's checks pass |

**Expected result.** The whole system running, with the interlock still off.

**Done when.** Stages 1 and 2 of the staged go-live have passed their exit criteria
([X3](X3-operations.md#staged-go-live)).

**If it fails.** Each chapter's *How it fails* table, by symptom. [91](91-troubleshooting-index.md) merges them all.

### Step 6: Baseline, before automating

**Precondition.** Step 5 done, with the interlock off and no rule armed, so nothing is automated yet.

**Procedure.**

1. Leave every schedule, limit and comfort rule disarmed. The interlock stays off, so a stray click moves nothing.
2. Record **at least four weeks** with no automation armed. Longer is better: a baseline must span the building's
   normal cycle.
3. Produce the baseline: `npm run baseline:report` writes a summary and the dataset it came from, read-only
   [E-206]. `npm run demand:profile` gives the demand profile for choosing thresholds later.

**Expected result.** A baseline report with coverage stated, kept with the commissioning pack.

**Done when.** The baseline covers at least four normal weeks at ≥ 99 % of expected minutes per meter [E-157].

**If it fails.** **Without a baseline, no saving can be claimed.** If automation must start sooner, say so in every
later report, and compare against the same weeks of the next year instead.

### Step 7: Commissioning

**Precondition.** Step 6's baseline recorded. The owner has decided the priority order ([X2a § 4](X2a-control-strategy.md#4-priority-which-input-wins))
and read how the code realises it ([X2](X2-control-logic.md#the-priority-order-as-built)).

**Procedure.**

1. Run X2a §8's test manual with the interlock off. Record each result ([X2a § 8](X2a-control-strategy.md#8-test-manual)).
2. Decide on the interlock, and record the decision on its form ([X2](X2-control-logic.md#the-dispatch-interlock)).
   Restart the proxy and the scheduler, and read the state back from the scheduler's start line.
3. With the interlock as decided, run the control and reliability tests again.
4. Assemble the commissioning pack and sign the certificate ([X3](X3-operations.md#the-commissioning-pack)).

**Expected result.** A signed test record, a signed interlock record and a signed certificate.

**Done when.** Stage 3 of the staged go-live has passed ([X3](X3-operations.md#staged-go-live)).

**If it fails.** Each failed test is a finding with an owner, or the test is repeated after a fix. A failure is never
signed off as a pass.

### Step 8: Handover

**Precondition.** Step 7 signed.

**Procedure.**

1. Train the operator against the competency list ([X3](X3-operations.md#training-and-handover)).
2. Hand over the documentation set: this manual, the commissioning pack, the baseline, the network and access
   record.
3. Transfer each account to its institutional owner, with a written handover ([X1](X1-security.md#accounts)).
   Rotate every shared secret the installers knew ([X1](X1-security.md#the-credential-inventory)).
4. Complete stage 4, remote access, if the owner wants it ([X3](X3-operations.md#staged-go-live)).

**Expected result.** The operator runs the system unaided, and no installer holds an account or a secret.

**Done when.** Each competency has been demonstrated with a witness, and each account's holder is recorded.

**If it fails.** Keep the installer's access only as long as needed, then rotate and record it.

### Step 9: The first 90 days

**Precondition.** Step 8 done.

**Procedure.** Run the routine checks ([X3](X3-operations.md#routine-checks)), and expect these:

| When | Watch | Expect |
|---|---|---|
| Week 1 | Devices dropping at particular times | Network contention or a failing supply ([02](02-network.md#how-it-fails)) |
| Weeks 1–4 | Stale and held readings | A device class with a push quirk. Every node needs its poll ([01](01-field-devices.md)). |
| Month 1 | The first monthly report | Coverage stated. Days with gaps explained. |
| Months 1–3 | Demand against the thresholds | Adjust them from `npm run demand:profile`, not by guessing [E-206] |
| After the first power cut | The recovery runbook | [outage-recovery](outage-recovery.md) |

**Expected result.** A short log of what went wrong and what fixed it, in each chapter's field issue log.

**Done when.** Three consecutive monthly reports are complete, with ≥ 99 % coverage.

**If it fails.** Recurring faults become findings with owners ([X3](X3-operations.md#incident-response)).

### Step 10: The improvement loop

**Precondition.** Three months of data after the baseline.

**Procedure.**

1. From Reports, find where energy goes out of hours, and which circuits grew month on month (the query cookbook in
   [04](04-data.md#query-cookbook), queries 2 and 4).
2. For each candidate, ask which role would address it ([01a § 4](01a-device-roles.md#4-choosing-what-you-need)).
3. Test demand shedding on paper first: `npm run shed:profile` reports what shedding each tier would have achieved
   [E-206].
4. Add one change at a time, through change control ([X3](X3-operations.md#change-control)). Measure it against the
   baseline, using query 8.

**Expected result.** Each change comes with a measured effect, or a finding explaining why it had none.

**Done when.** This step never finishes. It repeats each quarter.

**If it fails.** If a change shows no effect, check coverage first: missing data can hide a saving or invent one.

## How to configure

Each site's configuration is its site directory and the app's settings. See
[Adaptables](#adaptables-change-these-freely).

## How to verify

The framework is verified by its exit criteria: step 7's signed certificate, and step 9's three complete months.

## How to operate

### Common variations

| Variation | What changes |
|---|---|
| **No reliable internet** | The devices, the flow and the edge keep working locally. Commands still record, to the local audit buffer [E-196], and ingest buffers readings [E-134]. **Sign-in needs the internet**: keep an existing session on the kiosk, and set up break-glass for viewing ([05](05-interface.md)). Remote access needs the internet. |
| **Leased premises, no panel work permitted** | Meter and switch at the plug with metered switches only. There is no branch metering, so totals are the sum of what is plugged in, not the building. Say so in every report. |
| **An existing BMS** | Do not switch anything the BMS controls. Meter alongside it first. Any integration must send its commands through the proxy's audited path (ADR-0004). |
| **Solar or storage on site** | The source role (G) is not supported yet. The inverter bridge is planned ([94](94-roadmap.md)). Until then, meter the inverter's output circuit as a branch. |
| **Multiple buildings** | One edge and one site directory per building, each with its own identity on every row [E-149]. A shared database across sites is possible later and is not built now ([94](94-roadmap.md)). |

## How it fails

| Symptom | Likely cause | Check that tells the causes apart | Fix | How to confirm it held |
|---|---|---|---|---|
| Devices never appear at the bench | The edge is not on the devices' 2.4 GHz segment, or client isolation is on | ARP for a device from the edge ([02](02-network.md#how-it-fails)) | Put the edge on the device segment; turn isolation off | The device appears in *Add device* |
| `site:check` fails on a new site | The site directory is incomplete | Its message names the file and field | Complete it | `site:check` passes |
| No saving can be shown | No baseline, or coverage too low to compare | The baseline report's coverage | Re-baseline over a comparable period | A comparison with coverage stated |
| Commissioning tests fail with the interlock on | A device or path not proven at the bench | The test's audit rows | Fix, then re-run the whole suite | A clean, signed record |
| The installer still holds access months later | Handover step 3 skipped | The account and tailnet lists | Transfer, rotate, record | The lists match the owners |

## Field issue log

Site specifics are in [99](99-worked-example.md). The software half's walked steps, and what they found, are in
[`replication.md`](replication.md).

| Date | Symptom | Root cause | Fix | Evidence | Lesson |
|---|---|---|---|---|---|
| 2026-08-31 | Steps a new site needs were not all walkable | Some parts had only ever been read, not run | Each step marked executed or not | [`replication.md`](replication.md) header | A replication guide must say which steps have been walked |

## What to keep on the shelf

| Item | Why |
|---|---|
| The survey, scope and baseline of each site | Every later claim is measured against them |
| The signed commissioning pack | [X3](X3-operations.md#the-commissioning-pack) |
