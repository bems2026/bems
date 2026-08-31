# iBEMS — Feature State & Roadmap

**Last audited:** 2026-09-01 (UTC) — the control path, against the live Pi
**Audited at commit:** `1f46590`

**2026-09-01, and it changes what §0 says.** The headline claim below — that there is no
unblocked coding task left — was **wrong**, and it was wrong because the fault report that
contradicted it had been read as a network problem. A physical test reported an outlet toggle
failing with something like "bridge not reachable", outlet rows flapping between stale and live
while Node-RED showed the same devices connected throughout, and the Control page appearing to
block ON/OFF. All three were reproduced against the live Pi and were **one constant**:
`STALE_AFTER_MS` was 30 s for every device, while an outlet is polled once a minute by design.
See **EX-133** through **EX-140**. Two of those (EX-139, EX-140) are built and dry-run against
the live flow but **not applied** — they need a flow write. Two new backlog items were recorded
rather than fixed: **FI-019** (the bridge listens on every interface) and **FI-020** (a switch's
freshness is unmeasurable).
The lesson worth keeping is not about staleness. It is that "every unticked item is blocked on
something outside the code" was believed for a fortnight while a working outlet was being
reported as unreachable — because the misreport named the wrong subsystem and nobody re-measured.
**Landed since that audit, not re-audited:** a long session on 2026-08-31 — RM-006c's tier
editor, FI-018 (baseline report), FI-008 (contrast guard), FI-006 (totals expiry), FI-007 (badge
contrast), FI-002 (`npm run preflight`), RM-033's `npm run site:sql`, and the installer rehearsal
including its apply path. Each was verified on its own terms: suites on the workstation and the
Pi, CI, neutered guards, and a live read-back where one was possible. **The file below has not
been re-read against the tree since `b31caa2`**, so entries older than that date carry the
authority of that audit and no more. Saying which is which is cheaper than an audit that did not
happen.

> **PICKING THIS UP FRESH? Read §0 first, then this paragraph.** Every unticked item below is
> blocked on something outside the code: a person at the office, hardware that is not on the
> network, an operator decision, or elapsed time. There is no unblocked coding task left in
> Track B. The one remaining code item anywhere is FI-009, and its own entry explains why it was
> left alone. Do not go looking for work in the code; the useful work now is on the building.
**Audit method:** static read of the working tree, plus **on-site inspection at CARE office** —
live SSH, a Wi-Fi survey from the Pi's own radio, and packet-level capture of the devices' Tuya
discovery broadcasts. The 2026-08-25 evening re-audit ran *on the Pi*: a passive listen on the
discovery ports, the cloud's per-device MAC joined against the Pi's ARP table, and the live flow
read back through the admin API.
The 2026-08-26 evening pass ran from a **remote** session, with every network check executed on
the Pi over the tailnet — ARP and a UDP broadcast mean nothing anywhere else. It re-verified
RM-026 twice and corrected three §0 claims that had gone stale, two of them within the same
day: see RM-026, RM-020 and EX-101. It also closed the gap in EX-130 — an internet outage had
been removing control of a device fleet that is entirely local, for scheduled and auto-shed commands
as well as manual ones — and settled RM-026's integration shape.
The Phase 10-13 entries below were added from a workstation with no database access — see
§5 Q8 for exactly what that leaves unverified.
The 2026-08-26 late pass was a **planning** pass, not a measurement one: no live check was
re-run, so nothing above its date should be re-dated on its authority. It added §2's **Track B**
(RM-027 – RM-034), the replication refactor, after an audit of what the codebase assumes about
being one building in one room. It also renumbered four entries — the Auth & security block
held a second EX-100 – EX-103, colliding with the alerts/command/chart/notification entries of
the same numbers, and is now EX-108 – EX-111. Every cross-reference in this file pointed at the
other four and none needed changing.

> This repository is **public**. No tokens, keys, passwords, hostnames, IP addresses, or
> Supabase project identifiers may appear in this file. Where a deployment detail matters,
> describe it generically ("the Pi", "the tailnet address").

---

## 0. Triage — what to do next

This file is long because the reasoning is the point; this section exists so that "what
now" does not require reading all of it. Everything here is expanded below under its own id.

### Everything outstanding, 2026-08-31 — the handoff list

*Superseded in part on 2026-09-01: see the header, and the two flow writes now waiting at the
end of this list. "None of them wait on code" was true of this list and not true of the system.*

Grouped by what each one waits on. Ids link to the entries
below, which carry the evidence.

**A person has to be at the CARE office**
- **RM-020** — `co4`, `co5`, `co6` need power cut and restored. The software remedy was built and
  tried on `co5` and did not work: the device answers ARP, accepts a static address, then refuses
  every TCP connection.
- **RM-021 / RM-012 / RM-013 / RM-018** — devices that need a physical look or a network rejoin.
- **RM-016** — re-pair the IR blaster and the outdoor temperature sensor. Both report
  `online: false` and neither is in the Tuya cloud project. **Their registry `status` still says
  `active`, which claims more than is true.**
- **RM-007** — sign in once on the office kiosk, then power-cycle it to learn whether it comes
  back signed in.
- **RM-033** — `docs/physical-install.md`'s **twelve `〔FILL IN〕` gaps**. Photographs, part
  numbers, breaker way numbers, and institutional answers. **None can be filled by inference**;
  taking the file to the office as a checklist is the intended use.

**An operator decision or action, remotely**
- **RM-006c — arm auto-shed.** Tiers are assigned. Two conditions gate it and **one action fixes
  both**: open Automation *signed in*, turn auto-shed on, and save. Setting the flag in the
  database alone arms nothing, because the shed actor comes from `dsm_thresholds.updated_by`,
  which is null. Read that entry before flipping it — `group_1` is the lighting, ~16 W of a 919 W
  demand against a 2.21 kW ceiling.
- **Build the space tree.** `space_nodes` is **0 rows** and no device is placed. This is still the
  single highest-leverage thing available: RM-028's tree, RM-030's by-space totals and RM-031's
  plan all start showing real numbers at once, and it is the only check on the `authenticated`
  SELECT policy that a service-role probe cannot make.
- **RM-026** — join the Deye logger to the device SSID. Nothing can be built or tested until then,
  and this one is **contractual**: Milestone 3, due January 2027.
- **RM-006d** — perform a restore. A backup that has never been restored is not a backup.
- **Repository description and topics** — the description is set; **only 2 of 12 topics landed**.
  `gh` returns 404 because the CLI account has push but not admin. Owner account, web UI.
- **The funder workbook** — `iBEMS-General-Project-Plan.xlsx` was reconciled 2026-08-26 and has
  drifted. `ibems-tracker.html` was brought current on 2026-08-31; the workbook was deliberately
  left alone. Five specific changes are listed in the session notes, the first being that
  Checklist item 16 reads as though aircon control works today while item 7 says the IR needs
  re-pairing.

**Elapsed time**
- **RM-004** — re-check anomaly detection for false positives once a week of continuous telemetry
  exists.
- **FI-012** — partition `readings` *if* growth ever outgrows the prune. Conditional; not due.
- **FI-011** — push delivery for the monthly report, once a notification channel is configured.

**Two flow writes are built, dry-run, and waiting on a go-ahead** *(added 2026-09-01)*
- **EX-133's flow rebuild** — `npm run build:flow` is done and committed; the Pi needs
  `npm run deploy:pi -- --force --apply` for the per-device staleness budgets to reach the wire.
  Until then the bridge omits `stale_after_ms` and the frontend falls back to the old global
  30 s, so **the fix is inert on the Pi** even though the app is deployed.
- **EX-139 / EX-140** — `npm run fix-health:pi --apply` and `npm run poll-outlets:pi --apply`.
  Both dry-run clean against the live flow. Back up `~/.node-red/flows.json` first, always.

**Code, and deliberately not done**
- **FI-019** (the bridge on `0.0.0.0:1880`) and **FI-020** (a switch's freshness is
  unmeasurable) were found on 2026-09-01 and recorded rather than fixed — each entry says why.
- **FI-009** is the only other unblocked coding task in the file. Its own entry explains why it was left:
  each of the three selectors needs value-level rather than reference-level comparison to gain
  anything, and `FloorPlanView` genuinely reads every device. Filtering inside a zustand selector
  is also a documented loop hazard here. Low value, real risk.

### Do this first, 2026-08-28

**`phase23_plan_coords.sql` is applied and verified live** — see RM-031. The ordering hazard it
carried is spent: `device_config` selects `plan_x,plan_y` and answers 200.

**The thing that would unlock the most is still not code: build a tree.** `space_nodes` is
empty on the live project. Devices → Spaces, add a building and a room, place a few devices —
and RM-028's tree, RM-030's by-space totals and RM-031's plan all start showing real numbers at
once. It is also the only check on the `authenticated` SELECT policy that cannot be made from a
service-role probe.

### The short version, 2026-08-26

The system is **healthy and honest**: 15/20 devices online, all five services up, ingestion
writing every minute, and the dashboard no longer reports readings it cannot actually observe.
**A counting note, measured 2026-08-31.** The fleet is **20 devices**, not 21. The bridge's
`/api/readings/latest` serves **21 rows** — the twentieth device plus the `_totals` pseudo-row —
and the row count has been read as a device count in several places in this file. `15/21` above
was that error and now reads `15/20`. Dated observations further down (`9/21 to 14/21`) are left
as they were written; EX-076 and EX-085 already say `20 devices` and are the ones that were right.

Three things stand between here and "finished":

1. **Three outlets need a person at the office** (RM-020) — `co4`, `co5`, `co6`. The
   software path was **built and tried on `co5` on 2026-08-26, and it did not work**: the
   device answers ARP, accepted a correct static address, and then refused every TCP connection.
   So all three need power. Membership still moves hourly — re-measure, never memorise — but the
   cheap remedy has now been tested rather than assumed.
2. **Auto-shed is built but inert** until someone says which loads may be shed first (RM-006c).
   This is the largest *finished* feature that does nothing yet, and it is one decision.
3. **The solar inverter is not on the network** (RM-026) — the integration is stubbed and
   cannot be tested until the logger joins the device SSID.

Everything else is small, and the build order below is honest about size.

### Blocked on someone being at the office

| Item | Why it is stuck |
|---|---|
| **RM-020** Power-cycle `co4`–`co6` | `co4` and `co6` are absent from the segment entirely — no ARP entry, so not associated to the AP. `co5` **is** on the segment and still needs power: the static-address remedy was tried on it 2026-08-26 and it refused every connection (RM-021). **Operator cannot do this during office hours** (stated 2026-08-26) and will say when they can. Was `co1`–`co6`; `co1`–`co3` came back once the Pi was returned to the device network (RM-023). `co4` moved `stale` → `absent` inside one session, so **re-run `npm run tuya:macs` before the trip** — the list moves, and it moved twice on the day this row was last rewritten. |
| **RM-007** Kiosk sign-in | Needs one interactive login at the physical screen. `ibems-kiosk` is inactive. |
| **RM-016** IR Blaster + Outside Temp | Re-pairing needs the devices and the Smart Life account. Quiesced meanwhile, so they cost nothing but still cannot report. **Confirmed by the operator 2026-08-31: neither has been set up.** Verified the same day against the live bridge — `acu_main` and `sens_outside_temp` both report `online: false` with no values, so the Climate card shows `—` and the IR card shows "no reading yet", which is the honest rendering. Their registry `status` is still `active`, which claims more than is true; worth revisiting when they are paired rather than churning it twice. |

### Blocked on hardware that is not on the network

| Item | Why it is stuck |
|---|---|
| **RM-026** Deye/Solarman inverter | The logger is **not on the device SSID**. Integration shape **decided: MQTT via a pre-built local bridge** — see the entry. **Re-verified twice on 2026-08-26 and still absent**, now with a census rather than a sweep: every neighbour MAC on the device subnet was diffed against the cloud's own device MACs, and **the only non-Tuya host on the segment is the router**. A UDP logger-discovery broadcast drew **no reply** (every datagram back was the Pi's own probe echoing). Its configured address is in the stick's own AP-mode subnet, which has no route from the Pi. The Node-RED side is a stub — one config node and one register node, wired to nothing — and no Solarman credentials exist, so the vendor-cloud route is not quietly available either. Nothing can be built or tested until the stick is joined to the device SSID. |
| **RM-005** ESP32 AC sniffer | Publishes nothing. The broker is running and the flow subscribes, but a five-minute listen on all topics saw **zero messages** — and this was on the correct 2.4 GHz network, so the old explanation ("the Pi was on 5 GHz") no longer covers it. The ESP32 itself is silent. **Note since EX-131:** the broker is now loopback-only, so reviving this needs a LAN listener with a `password_file` as part of the work — it was never reachable *and* used, so nothing was taken away. |

### Waiting on elapsed time, not on work

- **RM-012** — `l6` is reachable and controllable again; only its one-hour stability window
  is unproven.
- **RM-004** — anomaly false-positive re-check needs about a week of continuous telemetry.
- **RM-006d** — a restore has never been *performed*. Configured is not verified. Supabase
  itself is reachable (checked 2026-08-26).

### Waiting on an operator decision

- **RM-006c** — **load-shed tiers.** Thresholds are set and the whole shed path is built,
  tested and audited; it sheds nothing because no device has a tier. Which loads may drop
  first is a judgement about the building, not a technical question.
  **MEASURED 2026-08-31, and it reframes the decision — `npm run shed:profile`.** Over 14 days
  of office hours the building drew **919 W** of metered demand:

  | circuit | avg | share |
  |---|---|---|
  | C.O Yellow (outlets) | 561 W | 61.0% |
  | CARE ACU (aircon) | 305 W | 33.2% |
  | L.O Yellow (outdoor ACU) | 36 W | 4.0% |
  | **L.O Red (lighting)** | **16 W** | **1.8%** |

  - **Everything a relay can switch comes to 29 W — 3.1% of demand.** Auto-shed cannot hold
    this building under a threshold as it is currently instrumented, and planning should say so
    rather than discover it.
  - **The outlet branch draws 561 W and its seven switchable outlets account for 29 W**, so
    **95% of that circuit is on ordinary sockets** and cannot be shed at all. That gap is the
    untracked load the Analytics page already charts (EX-006); this is the first time it has
    been quantified against what shedding can reach.
  - **Lighting is 1.8%.** Shedding lights first — the intuitive order — takes the lights out of
    an occupied office to save about 16 W. It should be the LAST tier, not the first.
  - **The largest controllable load is the aircon at 33%, and it is not on a relay.** It is
    reached by IR setpoint and mode, so it sits outside the shed tiers entirely and is a
    separate lever (the funded plan's own policy floor, RM-027's `acu_min_setpoint_c`).
  - **A tier is PERMISSION, not size.** An outlet averaging 1 W may be 400 W the afternoon
    somebody plugs a kettle in. So tiers are still worth setting — but for what may be dropped,
    not for what is big today.

  **Naming corrected 2026-08-31, and three things deliberately keep the old spelling.** The
  branch meter's display name was `AREC ACU`; the operator confirms the IR-commanded aircon **is
  the CARE ACU** and that it has its own branch circuit, so the display name and the circuit are
  now `CARE ACU`. What did NOT change, each for a reason:
  - **`mtr_arec_acu`**, the device id — every historical `readings` row is keyed by it, and a
    rename orphans two months of real data;
  - **`ctx: 'arec'`**, the flow-context prefix the live Node-RED source tabs write
    (`arec_last_p`, `arec_energy`), which `build-flow.mjs` does not generate — renaming it stops
    collection silently;
  - **`TUYA_NODE_VERSIONS['AREC ACU']`**, keyed on the live tuya node's own `deviceName`. The
    node on the Pi is still called `AREC ACU` (verified against `flows.json`), so renaming the
    key would make `findSettingsDrift` report a node that exists as missing.
  A display name costs nothing to correct; an identity costs the record. Whoever renames the
  Node-RED node one day should change the third of these in the same breath, and leave the first
  two alone forever.

  **AN EDITOR EXISTS NOW — Devices → Load shedding.** The tiers were settable only one device at
  a time, in the per-device metadata panel, with no view of what they added up to; the decision
  this entry calls "the highest-value single one" was one nobody could see the shape of.
  `src/components/devices/LoadShedPanel.tsx` shows every relay-controlled device with its tier,
  saves on choice, and — the part that matters — shows **all three conditions `shedPlan` actually
  applies**, not just the tier: assigned, dispatchable, and currently on. An editor showing only
  the first would let somebody tier a fleet that cannot be commanded and believe the building was
  protected; `inertCount` names that gap out loud.
  *It refuses to offer a tier for anything that cannot be shed, and says why instead.* The aircon
  is the largest controllable load here and has no relay — leaving it silently out of the list
  would read as an oversight, leaving it in would be a lie.
  *`src/lib/shedTiers.ts` is pure and mirrors `server/shedPlan.mjs` rule for rule.* A UI showing a
  different set from the thing that switches power would be worse than no UI, because it would be
  believed.

  **Still the operator's call, and now a better-posed one.** What is needed is not a wattage
  ranking but an answer per device: *what is plugged into co1–co7, and which lighting circuits
  serve areas with daylight?* Three of the seven outlets (`co4`–`co6`) have barely reported in
  two weeks (RM-020), so their averages mean nothing and their tiers should be set on what they
  feed rather than on what they have measured.

### The migration that was outstanding is applied

**`supabase/phase18_command_via.sql`** (EX-101) **has run.** This section previously said it
was still to be applied by hand; that was stale. Checked 2026-08-26 evening: the `via` column
exists, the migration's own `comment on column` text is served in the PostgREST OpenAPI
description — which is what distinguishes "the file ran" from "a column appeared somehow" — and
the newest command rows carry `via=local` while older ones are `NULL`, exactly as that
comment predicts.

So *which devices needed the cloud fallback this week* is now an answerable question, and the
first answer is a reassuring one: of the commands on record, the three dispatched since the
column landed all went **local**, with no cloud fallbacks.

### Build order — what to do next, largest value first

1. **RM-006c: the tiers are assigned; two things still gate auto-shed, and they share one fix.**
   All 14 shed-capable devices were classified on 2026-08-31 — lights as `group_1`, outlets split
   across `group_2`/`group_3` — so the classification gap is closed. What remains is **not just
   the `auto_shed` flag**: `server/scheduler.mjs` takes its shed actor from
   `dsm_thresholds.updated_by`, and `planShed` returns idle without one. That column is **null on
   the live row**, because the thresholds were written as the service role. So setting `auto_shed`
   directly in the database would arm nothing.
   **Both are fixed by the same action: open the Automation page signed in, turn auto-shed on, and
   save.** That stamps `updated_by` with a real user and sets the flag in one write. This is a
   property to rely on rather than a bug — a load-shed row is the last one anyone would want
   traced to an invented user.
   *Worth knowing before flipping it:* `group_1` is the lighting, ~16 W of a 919 W office-hours
   demand against a 2.21 kW ceiling, so the first shed step is the most visible action available
   and close to the least effective one. The tiers are editable on the Devices page.
2. ~~**FI-008 (S)** — a contrast regression guard.~~ **Done 2026-08-31**, and it found a real
   latent AA failure on its first run. See its entry.
3. ~~**FI-006 (S)** — wire `StaleDataBadge` into the views that still derive staleness inline.~~
   **Done 2026-08-31.** It was not a badge problem: four components read `_totals` and none
   applied the expiry rule, so the Overview's headline kW and the DSM breach flag were both
   drawn from whatever row was last in the store. See its entry.
   **Worth more since EX-107**: timestamps are now honest, so a staleness badge finally means
   something on metered devices instead of being permanently fresh.
4. **EX-096 device removal, end to end** — never run against a real device, because nothing
   has been enrolled yet. The first enrolment is also the first real test of the `switch` path
   fixed in EX-094.
5. **FI-011 (S)** — push the monthly report through the alert channel EX-103 already built.
6. **FI-009 (S)** — narrow the three remaining whole-map store selectors.
7. **RM-026 Deye** — as soon as the logger is on the network; see its entry for the decision
   between the two integration shapes. Re-verified absent 2026-08-26 evening.
8. ~~**RM-027 (M)** — site identity.~~ **DONE 2026-08-27**: applied, deployed, verified live.
   Next in Track B is **RM-028**, the space tree.

**Track B — replication (RM-027 – RM-034), added 2026-08-26.** Everything above is this site;
Track B is every other site. It is listed after the small items because none of it is urgent,
and **before** it would once have been, because the argument that held it back has weakened.

That argument was "only worth starting once the first site is boring", and it was right when the
first site was on fire. It is now the wrong test: most of what remains here is blocked on a
person being at the office, on hardware joining a network, or on a week of elapsed time — none of
which is unblocked by waiting. Track B is the largest thing that can be worked on *while* those
resolve. It is also Milestone 6 of the funded project, due June 2027, and it is the deliverable
the whole thing was funded to produce.

FI-002 and FI-003 have not been dropped; they are RM-033, and they are last in the track because
they need the four schema steps before them to mean anything.

**Deliberately not doing:** the one-click bridge restart deferred from EX-100. It needs a
`sudoers` entry that would let any authenticated app user bounce the bridge, and the two
reasons to want it have both weakened — the fleet-drop alert now reports the drop, and the
Wi-Fi fallback that caused the worst outage is corrected automatically by EX-106.

### Worth knowing about the system's reach

**Local device control does not depend on the internet, and now neither does commanding it.**
The Tuya fleet is on the Pi's own segment and answers local keys; dispatch has always preferred
that path. Until 2026-08-26 the *audit* step did depend on the internet, which meant an outage
removed every control in the building — see **EX-130**. Sessions are now verified offline
against a cached public key and commands are recorded to a durable local buffer, with both
safety properties intact. Break-glass sessions remain view-only.

### The standing hazard

**RM-013** (devices leave the network and rejoin) is the root cause behind RM-020, RM-021,
RM-018 and much of RM-012. It is not closed and may not be closeable from this side — see its
entry for what was measured and what was ruled out. Two pieces of evidence sharpen it:
the six outlets did **not** drop together but fell away one at a time across a whole day; and
on 2026-08-26 the access point dropped its DHCP lease outright, taking the Pi with it. So the
hazard has two faces — devices leaving, and **the AP itself faltering** — and only the second
now has a guard (EX-106).

---

## 1. Existing features (verified)

Every entry below was confirmed by opening the cited path. Grouped by domain.

### Frontend — pages & shell

- [x] **EX-001** Hash-routed SPA shell with five pages, skip link, and per-route focus/scroll/title handling — `src/App.tsx`, `src/lib/useHashRoute.ts`, `src/components/layout/AppShell.tsx`
- [x] **EX-002** Shared page header with consistent action alignment across all five pages — `src/components/layout/PageHeader.tsx`
- [x] **EX-003** Overview as a bento grid: live demand, energy breakdown, device status counts, main-panel health, climate diagnostics, energy flow, next-up schedule — `src/components/overview/`
- [x] **EX-004** 3D office scene with an editable furniture/device layout, tokenised materials — `src/components/scene3d/`, `src/components/overview/SpatialView.tsx`
- [x] **EX-005** 2D floor plan view — `src/components/floorplan/FloorPlanView.tsx`
- [x] **EX-006** Analytics with 24h bridge history plus 7d/30d from Supabase, per-source cards, untracked-load comparison — `src/components/analytics/`
- [x] **EX-014** Error boundaries around the shell and each routed page, so a render fault cannot leave the kiosk on a blank screen with nobody on site — `src/components/common/ErrorBoundary.tsx`
- [x] **EX-015** One shared wall-clock tick for the whole app, replacing five independent 1s intervals; exactly one `setInterval` remains in the frontend — `src/lib/useNowTick.ts`
- [x] **EX-016** Number formatting with the "missing renders `—`, never 0" rule in one place, including `shareOfTotal` — `src/lib/format.ts`
- [x] **EX-007** Control page: lighting matrix, outlet plan with per-socket pucks, switch/outlet lists, IR command centre, session command log — `src/components/control/`
- [x] **EX-008** Devices fleet table with per-device comm state and metadata editing — `src/components/devices/DevicesView.tsx`, `src/components/devices/DeviceMetaEditor.tsx`
- [x] **EX-009** Automation page: Supabase-backed schedules and DSM thresholds — `src/components/automation/`
- [x] **EX-010** Weather cards from Open-Meteo (no API key) — `src/components/weather/`
- [x] **EX-011** Alerts bell merging staleness watchdog and anomaly alerts under one acknowledge set — `src/components/layout/AlertsPopover.tsx`
- [x] **EX-012** Manual dark theme with WCAG-checked token overrides — `src/index.css`, `src/stores/themeStore.ts`
- [x] **EX-028b** `GET /api/tuya/devices` on the proxy — the cloud’s view of the fleet
      without needing SSH, and the server-side surface the enrolment wizard needs (Part B),
      built once. **The card that rendered it on the Devices page was removed 2026-08-25** at
      the operator’s request: it restated what the fleet table already showed and spent a
      screen of prose doing so. The endpoint stays — the wizard’s device picker and its
      `claimed` flag are its real consumers, and `npm run tuya:devices` still prints it.
      `TUYA_ACCESS_SECRET` never leaves the proxy process: `server/tuyaFleet.mjs` copies fields
      in by **allowlist**, so a credential Tuya adds in a future API version is dropped by
      default rather than forwarded by default, and `assertNoSecrets` then throws on anything
      credential-shaped rather than stripping it — quietly filtering would hide a wrong edit to
      the allowlist until it resurfaced elsewhere. A deployment with no credentials gets 501 and
      the wizard says so plainly instead of half-working: not configured is not the same as broken.
      **Deliberately not joined per device, and deliberately not counted against the local
      total.** The registry carries no Tuya id, so the only sound join key does not exist on the
      frontend yet; and comparing the two counts instead is unsound, because several registry
      devices are two logical readers of one physical meter and two flow nodes have no cloud
      device at all. That exact mistake was made once already and produced a confident, empty
      verdict. Carrying the Tuya id into the registry is what makes the per-device join possible
      — which is FI-001's table —
      `server/tuyaFleet.mjs`, `src/lib/tuyaFleet.ts`
- [x] **EX-091** `fetchJson` call sites are checked by a test, not by review. `fetchJson` owns
      the base address (`BRIDGE_HTTP_URL`, which already ends in `/api`), so callers must pass a
      bare path. Both possible ways to get that wrong had shipped: `tuyaFleet.ts` passed a full
      URL and produced `/apihttp://…/api/tuya/devices`, which missed every proxy route, fell
      through to Node-RED and surfaced as **“The vendor cloud could not be reached”** — reading
      as a credentials or network fault for as long as the card existed; `enroll.ts` passed
      `/api/enroll` and produced `/api/api/enroll`, so the endpoint was never reachable at all.
      Neither is a type error and both survive a green suite, because the mistake is inside a
      string. The guard greps every call site and was confirmed to fail on the reintroduced bug
      before being kept — `src/lib/bridgeClientPaths.test.ts`
- [x] **EX-092** The Control page’s dispatch state moved from a page banner onto the cards it
      constrains. The banner was removed 2026-08-25 at the operator’s request: with all three
      classes dispatching it only ever read “every command on this page switches real hardware”,
      a paragraph announcing the absence of a problem. `SimulatedBadge` already carried the same
      fact per card and is strictly more precise, so `flagSimulated` dropped its `partial`-only
      gate and `SwitchesListCard` gained the badge slot outlets and the ACU already had. **The
      closed state is the one that needed care** — the banner used to own it alone, so removing
      it naively would have left a fully-closed gate with no signal anywhere; every card is now
      flagged instead of none. `dispatchScopeMessage` and its tests went with it.
      The companion “N devices are not shown here” note went too: all five it named are meters,
      the ACU and a sensor — classes that inherently have no control function — so it asked the
      operator to go fix a setting that was already correct.
      `src/components/control/SimulatedBadge.tsx`, `src/components/control/dispatchScope.ts`
- [x] **EX-093** The enrolment wizard says when it does not know what is already enrolled,
      instead of implying nothing is. `GET /api/tuya/devices` derives `claimed` by reading the
      live flow, which needs `NODE_RED_ADMIN_USER/PASS` — credentials the Tuya call itself does
      not use, so that read fails independently. It was wrapped in an **empty catch**, and on
      failure every `claimed` came back false, which is indistinguishable from an empty flow.
      Found on the Pi 2026-08-25: those two keys were in the repo-root `.env` but not in
      `server/.env`, which is the only file the unit loads (`EnvironmentFile=`). The endpoint
      returned all devices as unclaimed and the wizard offered **all 19 already-enrolled**
      devices as available — a wrong list that looks right, and the worst possible shape for
      this bug, because enrolment is the one screen where the list *is* the information.
      Fixed on the Pi, and now: the catch logs, the response carries `claimed_known`, and the
      wizard states the uncertainty rather than rendering a confident count.
      **`server/.env.example` gained the Tuya and Node-RED admin sections it never had**, so
      a rebuild cannot silently drop a key again — the root `.env.example` had described these
      as deploy-script-only, which stopped being true when the proxy began reading the flow.
      `server/.env.example`, `server/proxy.mjs`, `src/lib/tuyaFleet.ts`,
      `src/components/devices/EnrollWizard.tsx`
- [x] **EX-094** Two defects that made enrolment quietly wrong, both found 2026-08-25 by
      comparing the generated nodes against `live-flow-baseline.json` rather than against the
      tests — which had encoded one of them.
      **1. Only one output port was wired.** A `tuya-smart-device` in `event-both` mode emits
      data on port 1 and status on port 2, and every real node in the flow wires both to the
      same target. The planner wired port 1 alone, so `CONNECTED`/`DISCONNECTED` never reached
      the parser — its health branch could only ever set `isOnline` true via `else if (dps)`,
      and an enrolled device would come online once and never go offline again. That is the
      frozen-value class of failure this project has already paid for repeatedly.
      `test/enroll-plan.test.mjs` asserted the single-port shape, so the suite defended it.
      **2. `switch` was offered but unenrollable.** `ENROLLABLE_CLASSES` has always listed it
      and the wizard has always shown it, but `registryEntryFor` sets `ctx: null` for a light
      — correctly, since a light has no metering context — and the planner refused any entry
      without one. The form validated, then the plan step refused. Lights are 7 of 19 devices
      and the likeliest class to add, so this was the half of enrolment most likely to be used.
      Fixed with a light path in the planner: device -> `change` node tagging `msg.lightId` ->
      the existing shared `Collect status` function, which is **wired into, never modified**,
      so the additive invariants still hold. The light number is derived from the trailing
      digits of the device id, the same source `state_key` comes from, so the two cannot
      disagree; enrolment is refused outright when the collector is absent, rather than
      writing a wire to nothing.
      `node-red-bridge/enrollPlan.mjs`, `test/enroll-plan.test.mjs`
- [x] **EX-095** `planRemoval` / `validateRemovalPlan` — the mirror of enrolment, as pure
      functions. Removal invariants are the inverse of enrolment ones and need their own care:
      a subtractive write has a failure mode an additive one does not, because taking out a
      node that something still wires TO leaves a dangling reference which Node-RED **accepts**.
      The flow then loads and routes into nothing, reading as a dead device rather than a bad
      edit — so wires to removed nodes are cleaned, and the invariants reject any that are not.
      Node ids are derived rather than searched for: a `deviceName` is editable in the Node-RED
      editor, and matching on one would eventually remove the wrong node. The class is never
      consulted — every id enrolment could have created is listed and filtered by what is
      actually present, so removal cannot miss a companion by misreading the class. The
      strongest test is a round trip: enrol-then-remove is asserted to be the identity function
      on the flow, for a metered device and a lighting circuit alike.
      `node-red-bridge/enrollPlan.mjs`, `test/removal-plan.test.mjs`
- [x] **EX-096** Device removal, end to end — the other half of "add and remove devices", and
      the mirror of enrolment at every layer: `validateRemoval` beside `validateEnrollment`,
      `removeService.mjs` beside `enrollService.mjs`, `POST /api/remove` beside
      `POST /api/enroll`, `npm run remove:pi` beside `npm run enroll:pi`, and a Remove button
      beside Edit on each fleet row.
      **The write order is reversed, deliberately.** Enrolment writes the registry first, so a
      failed flow write leaves a device the app knows about but nothing polls — visible as NO
      DATA and fixed by re-running. Removal writes the FLOW first, which is the same rule read
      backwards: a failed registry write again leaves a device listed but not polled. The other
      order would leave hardware polled that nothing displays, and that is the state nobody
      notices. A test asserts the registry is untouched when the flow write fails.
      **Only enrolled devices are offered.** The built-in ones are hand-written in
      `registry.mjs`; a script editing hand-written source is what the separate generated
      module exists to avoid. Refusing one says "built-in", never "not found" — the two have
      different fixes, and the wrong word sends someone hunting a bug that is not there. No
      button is rendered at all for a built-in, rather than a disabled one that invites the
      click and then explains itself.
      **History survives and the UI says so.** `readings` is keyed by `device_id`, not by a
      foreign key into the registry, so removal deletes the device and keeps everything it
      measured. That is the question someone hesitating over this button actually has, so it
      is answered in the panel rather than left to be inferred.
      The panel previews on open rather than behind a button — there is one input, the row you
      clicked, so there is nothing to fill in first — and names the flow nodes that would go
      rather than counting them: a count answers "is this plausible", the names answer "is this
      the right device", which is the question that matters when the other side is real
      hardware. Applying stays behind its own confirm.
      `server/removeService.mjs`, `server/removeRoute.mjs`, `shared/enrollment.mjs`,
      `src/lib/removeDevice.ts`, `src/components/devices/RemoveDevicePanel.tsx`,
      `node-red-bridge/remove-device.mjs`
- [x] **EX-097** The aircon and the outside-temp sensor no longer report a fabricated ONLINE.
      `buildLatest` derived `online` from real evidence for meters (`src.h`) and, since the
      `lightStatus` work, for switches — but everything else fell through to a hardcoded
      `r.online = true`. That covered exactly the two devices fed by `ac_dash_state`:
      `acu_main` and `sens_outside_temp`.
      **It was live, not hypothetical.** On 2026-08-25 `journalctl -u nodered` showed the
      `NBRIC IR Blaster` and `Outside Temp` nodes in a permanent 10-second `find() timed out`
      retry loop — they are not in the Tuya cloud project and have never once connected
      (RM-016) — while `/api/readings/latest` reported both devices `online: true` carrying no
      measurement at all: `state: null`, no `temp_c`, no `room_temp_c`. A fabricated online is
      worse than a stale reading, because a stale one at least happened once.
      **The first version of this fix was wrong, and its tests passed anyway.** It checked
      `Object.keys(ac).length > 0`, on the assumption that a dead blaster leaves
      `ac_dash_state` empty. The mock populates it in full, so the assumption held in the
      suite and the fix shipped green — and changed nothing in production. Reading the live
      context off the Pi through the Node-RED admin API showed why: the flow seeds a
      **placeholder** rather than leaving it empty —
      `{power:"OFFLINE", setTemp:"--", roomTemp:"--", humidity:"--", outTemp:"--"}`.
      Every key is present, so key-presence was always going to say ONLINE.
      The rule is now "carries at least one real measurement": `num()` rejects `"--"` and
      `"OFFLINE"` and accepts `"25.4"`, so the placeholder reads offline and a real poll reads
      online, with no magic string to keep in sync. Any single field suffices — the blaster
      sends temperature and humidity on separate DPS, so demanding all of them would report a
      half-working device as dead. The empty-object case is still covered by the same test.
      The regression test now uses the exact object read off the live Pi, not an invented one.
      This is the same move the `switch` branch made when `lightStatus` turned out to be
      readable — except that branch stayed optimistic on a missing health map, because it
      really could mean an older flow. Here a placeholder is a positive statement that nothing
      has reported, so this one fails closed.
      `shared/buildLatest.mjs`, `test/contract.test.mjs`
      **Live on the Pi 2026-08-25.** `buildLatest.mjs` is inlined into the generated flow, so
      this needed `build:flow` plus a forced `deploy:pi`. Verified by reading the live flow
      back: the running `Build latest readings` node carries the new assignment, and both
      `acu_main` and `sens_outside_temp` now report `online: false`. Fleet online went 14 -> 12,
      which is exactly the two fabricated values disappearing and nothing else.
      Getting it deployed took two attempts, and the first failure is why EX-099 exists.
- [x] **EX-098** `npm run quiesce:pi` — stops a permanently unreachable tuya node retrying
      forever, without removing it. `NBRIC IR Blaster` and `Outside Temp` each call
      `findDevice()` every ~10 s in perpetuity, filling the Node-RED log with `find() timed
      out` and holding a discovery listen slot open for hardware that will never answer.
      Flips `disableAutoStart`, a field already present on every node in the flow, so this
      changes a value rather than introducing one. **Reversible** via `--undo`, which is what
      you want the moment either device is re-paired — nothing else has to be put back.
      **The invariants are strict because the target is.** These nodes live on the four
      hand-built source tabs that `build-flow.mjs` does not generate and nothing in the repo
      can restore. `findTimeout` and `tuyaVersion` exist ONLY there, and losing them presents
      as every device going offline — which reads as a network fault and has already cost days.
      So `validateQuiescePlan` asserts exactly one boolean changes on exactly the named nodes:
      a modified node that was not named is refused, a named node modified beyond
      `disableAutoStart` is refused, and any change in node count is refused. The undo path is
      checked by the same invariants with before/after swapped. Re-running is provably a no-op
      — the plan returns the original object rather than a copy when a node is already quiet.
      `node-red-bridge/quiescePlan.mjs`, `node-red-bridge/quiesce-dead-nodes.mjs`,
      `test/quiesce-plan.test.mjs`
- [x] **EX-099** `deploy:pi` compares the deployed bridge tab CONTENTS, not just its id.
      "Already deployed" was decided from the bridge tab id being present and nothing else, so
      a regenerated `bridge-flow.json` printed **"Nothing to do"** and exited **0** — which
      reads exactly like success. It silently skipped the EX-097 aircon fix on 2026-08-25:
      the operator ran the deploy, saw a benign message, reported it applied, and the live
      flow was still running the superseded rule. It was caught only by reading the live flow
      back through the admin API and diffing the two `r.online` assignments by hand. Every
      future flow change would have been skipped the same way.
      Now a content signature decides it, and a mismatch exits **1** with the exact command to
      fix it — verified against the real stale flow on the Pi, message and exit code both.
      The signature **deliberately ignores node ids and canvas coordinates**: `build-flow.mjs`
      numbers nodes sequentially and does not promise stability across a re-run, so including
      them would report drift on every regeneration and make `--force` the reflex. A check
      that always fires is the same failure wearing the opposite mask — both end with nobody
      reading the message. Wire *targets* are ids too, so only their count is compared; a pure
      rewiring would slip past, which is accepted because `build-flow.mjs` derives topology
      from the registry and a real topology change arrives with a node change beside it.
      `node-red-bridge/bridgeSignature.mjs`, `node-red-bridge/deploy.mjs`,
      `test/bridge-signature.test.mjs`
- [x] **EX-100** The alerts bell reports a *fleet* drop, and names the remedy.
      Per-device COMM FAULT rows already said what was down; nothing said what to do, and on
      2026-08-25 what to do was cheap and remote — a Node-RED restart recovered five devices,
      one of which (`l6`) had a written diagnosis calling it an RF/hardware fault that needed
      eyes on the fixture. Eight separate COMM FAULTs also read as eight problems when they
      are usually one, so the fleet row is listed first and reframes the rows beneath it.
      **The hard part is not counting offline devices, it is not crying wolf.** Two devices
      here are offline permanently by design (the quiesced IR blaster and outside-temp
      sensor), and counting them would hold the alert on forever — which is how a warning
      becomes furniture. `fleetStuck` splits on `online_samples`: a device seen up at any
      point in the 24h window CAN be up, so its being down now is a change; one never up in
      the window is not news and no restart will alter it. Evidence, not an exclusion list —
      a hardcoded list of "expected offline" ids would go stale the first time one recovered.
      Threshold is three simultaneous drops: one device is RM-013 being RM-013, and firing on
      that would mean firing most days.
      `src/lib/deviceConnectivity.ts`, `src/components/layout/AlertsPopover.tsx`

      **The one-click restart button was deliberately NOT shipped with it.** The proxy runs
      unprivileged, so a `POST /api/bridge/restart` needs a `sudoers` NOPASSWD entry, which
      would let any authenticated app user bounce the bridge. That may still be worth it —
      RM-018 alternative is a walk to a breaker — but the detection should be seen to be
      right before the privilege is granted, and there is now a second route that needs no
      privilege at all: Claude runs on the Pi (`docs/pi-session-brief.md`) and is authorised
      to restart services there. Revisit once the alert has been observed firing correctly.
- [x] **EX-101** How a command reached the hardware is now recorded and shown.
      `dispatchCommand` has always returned `via` — local, cloud or none — but it was folded
      into the audit row free-text `note` and nowhere else. That made the most operationally
      useful signal in the table unqueryable: you could not ask *which devices have needed
      the cloud fallback this week*, which is the question that identifies a device going bad
      **before** it goes dark.
      **Why it matters more than it looks:** a cloud-recovered command SUCCEEDS. The relay
      moves, the operator sees an ordinary confirmation — and the device has stopped
      answering on the LAN. Nothing distinguished that from a healthy command.
      Three places, one fact: `supabase/phase18_command_via.sql` adds the column (nullable,
      no backfill — a row written earlier genuinely does not know its path, and NULL says so
      where a guess would not; also distinct from `none`, which positively claims both paths
      were tried and both failed); the ack carries `via` so the page can react; and the alerts
      bell raises a row naming the device. The CHECK is narrow where `status` two columns over
      is deliberately free text — `via` is a closed set defined by the dispatch code, so a
      value outside it means the two have drifted, which is the thing worth catching. A test
      reads the literals out of `dispatchLight.mjs` rather than restating them.
      The recovery is held in `commandStore`, not the session command log, because a store
      must not import upwards from `components/control` — and because the bell already reads
      stores and owns acknowledgement, which is where a fault belongs.
      **Deployment order deliberately does not matter.** The migration is applied by hand, so
      there is a window where the code is live and the column is not — and PostgREST rejects
      an UPDATE naming an unknown column, which would have failed the outcome patch for EVERY
      command and left rows stuck at `dispatching`: the audit trail degrading quietly in order
      to add a nicety. The patch retries once without `via`, matched narrowly so a genuine
      outage still surfaces as an unrecorded outcome instead of being masked by a retry that
      drops a field and calls it success. A runbook note would have had to be read at exactly
      the right moment; this does not.
      **THE MIGRATION HAS RUN — verified 2026-08-26 evening.** §0 carried it as outstanding
      for longer than it actually was. Three pieces of evidence, because "the column exists" on
      its own would not distinguish the file having run from a column arriving some other way:
      the `via` column is present; the migration's own `comment on column` text is served
      verbatim in the PostgREST OpenAPI description, and only that file writes it; and the
      newest command rows carry `via=local` while everything older is `NULL`, which is
      precisely the boundary the comment describes.
      So the tolerate-a-missing-column retry above is now dead weight in the happy path. **Leave
      it there** — it is the guard for a rebuilt database or a second site, which is exactly the
      window it was written for, and it costs nothing until then.
      *First reading of the diagnostic this unblocked:* every command dispatched since the
      column landed went **local**, with no cloud fallbacks. Nothing to act on, which is the
      answer you want from a health query.
      `supabase/phase18_command_via.sql`, `server/auditedDispatch.mjs`, `server/proxy.mjs`,
      `src/stores/commandStore.ts`, `src/components/layout/AlertsPopover.tsx`
- [x] **EX-102** (FI-010) The 24h chart stops drawing a device that was not reporting.
      Every meter last known wattage is carried forward into each sample — that is what "last
      known reading" means — so a device offline all day filled the chart with a confident
      flat line. The 7d/30d charts lost that blindness earlier and the aircon ONLINE flag lost
      it on 2026-08-25; this is the same fix one layer down, where the samples are written.
      **One line in each of two places, because both halves have to agree.** The bridge ring
      buffer records `online` on each point, *conditionally* — a point from a bridge that
      never reported it has no flag, and that is unknown, not false. `pointValue` then
      suppresses a point only when the flag is explicitly `false`. Assuming the absent case
      either way would fabricate exactly what this set out to stop: assume online and the flat
      line returns; assume offline and real history is erased in the name of honesty.
      Fixed in `pointValue` rather than per chart because that is the single place a point
      becomes a plotted number, and every consumer already reads `undefined` as a gap.
      The contract tests were confirmed to fail with the generator change neutered.
      `node-red-bridge/build-flow.mjs`, `src/components/analytics/chartParams.ts`,
      `src/lib/types.ts`, `test/contract.test.mjs`
- [x] **EX-103** (FI-005) Alerts that leave the dashboard.
      A multi-hour outage went unnoticed because the only place it would have surfaced was a
      screen nobody was looking at. On 2026-08-25 six of seven outlets went off the network
      while the operator was at home, and nothing said so.
      **Edge-triggered, and that is the entire design.** The ingest daemon ticks every 60 s,
      so a level check would re-send the same notification every minute — six outlets down
      overnight is 480 messages, and the first thing anyone does with that is mute the
      channel, which is strictly worse than no alerting at all. `createFleetAlarm` returns an
      event only on a transition: once entering the state, once leaving it.
      It tracks which devices it has seen online, for the same reason `fleetStuck` splits on
      `online_samples` — the two permanently quiesced devices would otherwise trip the alarm
      at startup and hold it there forever. A device MISSING from a tick is not counted as
      down either: absence is a gap in the feed, and inferring failure from silence is how a
      bridge hiccup becomes a fleet alarm. And the alarm is only consulted on a cycle that
      actually reached the bridge — during a bridge outage we have no idea what the devices
      are doing, and reporting that as "every device dropped" would be the loudest possible
      way to be wrong.
      **ntfy, because this repository is public.** FI-011 rejected email and Sheets delivery
      precisely because a credential for either would sit in a file beside a public checkout.
      ntfy needs no account and no OAuth: the only secret is a topic name, and someone who
      guesses it can read notifications but cannot act on the building. Unset `NTFY_TOPIC` is
      a supported state, not an error — and it stays silent about being unset, or the journal
      would gain a line every time the fleet changed state on a site that never wanted this.
      Every send failure is caught: the daemon exists to record the building electricity, and
      being unable to push a notification about that is not a reason to stop.
      The message names the remedy, like the bell does — a notification that only says
      "something is wrong" costs a trip to the office.
      `server/fleetAlarm.mjs`, `server/notify.mjs`, `server/ingest.mjs`,
      `server/ingestCycle.mjs`, `server/.env.example`

      **Needs a flow deploy to take effect** — the ring buffer lives in the generated flow, so
      `build:flow` plus `deploy:pi --force --apply`. Until then no point carries the flag and
      the chart behaves exactly as before, which is the correct degradation rather than a bug.
- [x] **EX-040b** In-page enrolment wizard — the Devices page's "+ Add device" is real. Picks a
      vendor device the flow does not already poll, takes an id/class/name/room, previews, then
      enrols.
      **Validation runs client-side through the same `validateEnrollment` the server calls**, so
      the feedback while typing is the answer submit will give rather than an approximation. A
      form that accepts input the backend then rejects teaches people to ignore it.
      **Preview and apply hit the same endpoint**, differing only by a flag, so the preview
      cannot drift from the path that writes — and the preview exists precisely to be trusted.
      Enrol stays disabled until a preview has actually succeeded.
      *One bug found while building it:* the wizard first filtered candidates on
      `device.tuya_device_id`, a field `Device` does not carry — the browser has no way to know
      which vendor id backs which registry device. `claimed` is now derived server-side, where
      the flow can actually be read, and marked rather than filtered so "already enrolled" stays
      distinguishable from "not in the project".
      The local key is never sent to the browser; the summary carries its length —
      `src/components/devices/EnrollWizard.tsx`, `server/enrollRoute.mjs`,
      `server/enrollService.mjs`
- [x] **EX-041b** Enrolment logic exists once. `server/enrollService.mjs` is called by both the
      CLI and `POST /api/enroll`; two implementations would eventually disagree about validation
      or about what happens when the second write fails, and the symptom would be a device that
      half exists. Every dependency is injected, so the whole path is tested without a cloud, a
      Pi, or a filesystem — including the 409 case, which reports that the registry entry was
      already written so re-running is safe rather than looking like corruption.
      The endpoint is authenticated like every other route but deliberately **not** behind
      `HARDWARE_DISPATCH_ENABLED`: that gate governs moving a relay, and enrolling moves
      nothing. Conflating them would mean a site that has not opened dispatch could never add a
      device — backwards, since you enrol before you switch — `server/enrollService.test.mjs`
- [x] **EX-039b** Device enrolment — registry entry and flow nodes generated from one validated
      decision, with the local key fetched from the vendor cloud rather than copied between
      browser tabs. That manual step is most of what made FI-001 an L. The key never reaches a
      terminal; only its length is printed.
      A device is only real once **both** halves exist. Writing only one fails quietly: a device
      the app shows that never reports, or hardware the flow polls that nothing displays. The
      registry is written first deliberately — if the flow write then fails, the app shows a
      device that does not report yet, which is visible and recoverable; the reverse is not.
      `registry.mjs` now merges a generated data module rather than reading JSON at runtime
      (which would put `fs` in a module the frontend's own test imports) or being edited by a
      script. Built-in devices stay first so enrolling one cannot reorder a list that several
      places key off implicitly.
      Validation **refuses rather than guesses**, because a bad enrolment fails weeks later as a
      device reading offline forever — indistinguishable from a network fault. It refuses a
      vendor device already enrolled, one the cloud cannot see, an id that would not survive as
      a context key, and a protocol version the cloud did not report.
      *Deliberately not enrollable:* `meter` and `acu_ir`. A meter's identity is a logical
      channel chosen by which CT clamp sits on which circuit — an electrical decision a wizard
      cannot validate — and the ACU's IR command set is bespoke.
      The parser is generated from a template so a new device cannot get subtly different
      online-detection from its neighbours, carries the settings this project measured rather
      than library defaults, and stamps `_last_time` only when data actually arrived —
      `shared/enrollment.mjs`, `node-red-bridge/enrollPlan.mjs`, `npm run enroll:pi`
- [x] **EX-037b** Duplicate device sessions collapsed: 21 tuya nodes -> 19, one session per
      physical device. Two nodes carrying the same `deviceId` each held a TCP session to one
      device — the dual-channel yellow meter and the branch meter measuring the aircon. Halves
      the socket pressure on both, and exhausting that table is what leaves a device answering
      the cloud but not the LAN. Applied via a dry-run-by-default patch script whose plan is a
      pure function, so the dry run and the apply cannot drift —
      `node-red-bridge/sessionCollapsePlan.mjs`, `npm run collapse-sessions:pi`
- [x] **EX-038b** Outlets are polled every 60 s. Nothing in the flow had ever asked an outlet
      for its state, so a reading only advanced when the device happened to report a change.
      Because `readings` is keyed `(device_id, ts)` and ingestion upserts, a stalled timestamp
      overwrote its own row rather than adding one — `co1` recorded 40 samples against a
      switch's 60 in the same hour, and every per-outlet figure downstream inherited that.
      Verified after applying: outlet timestamps now advance within the poll cadence, where
      `co1` had been stalling 15+ minutes. This patch only ADDS nodes, and validation asserts
      every pre-existing node is byte-identical afterwards — an accidental rewire on a tab
      carrying live control logic would be far harder to spot than a missing node —
      `node-red-bridge/outletPollPlan.mjs`, `npm run poll-outlets:pi`
- [x] **EX-036b** Vendor-cloud dispatch as a **fallback**, tried only after a local command has
      failed. Solves the reported hang: a device whose inbound socket table is exhausted stops
      answering on the LAN while its outbound cloud connection stays healthy, which previously
      meant walking to a breaker. Local remains primary and the cloud is never reached when
      local succeeded — a test pins that ordering, because a control system that quietly started
      routing through a vendor would be a worse outcome than the hang it fixes.
      Command codes were read from the devices themselves (`GET /v1.0/devices/{id}/functions`),
      not guessed: `switch_1` for a lighting circuit, `switch_1`/`switch_2` per outlet socket.
      An outlet command with no socket is **refused rather than guessed**, since switching both
      would act beyond what was asked. `acu_ir` has no cloud route at all — its IR blaster is
      not in the cloud project (RM-016) — so no attempt is made that would bury the real local
      failure behind a misleading second one.
      The audit row records **which path moved the relay**: a command that only landed via cloud
      means the device stopped answering locally, and collapsing that into a bare `dispatched`
      would hide the one signal saying a device needs attention.
      Vendor ids are read from the live flow at startup rather than added to this repository,
      which is public; an unreadable flow disables the fallback instead of failing the proxy —
      `server/dispatchCloud.mjs`, `server/cloudDispatchConfig.mjs`,
      `docs/adr-002-device-recovery-path.md`
- [x] **EX-035b** Channel-interchange detector for the shared dual-channel meter.
      `mtr_co_yellow` and `mtr_lo_yellow` are two logical meters on one physical device, told
      apart only by which DPS range each is read from. Confirmed 2026-08-25 that they swap
      outright: `co` went 42 -> 1289 W in the same sample `lo` went 1285 -> 41 W, each taking
      the other's previous value.
      **Detects; deliberately does not correct.** Correcting means choosing which assignment is
      true, and nothing in the data settles it — both circuits are real loads that can be large
      or small. "The ACU is usually the bigger one" is a guess, and a guess applied silently
      inside measurements is how an unauditable figure reaches a report.
      Requires a real separation before calling a trade: two channels reading 43 W and 52 W
      change order constantly, and firing on those would bury the one event that matters —
      `shared/channelSwap.mjs`, `test/channel-swap.test.mjs`, `npm run check:meters`
- [x] **EX-032b** Devices page trimmed to what can be read at a glance: the fleet banner folded
      into the page subtitle (`20 devices · 10 online · N unstable today`, clause omitted
      entirely when nothing flaps), and the per-row note reduced to `16 drops today`.
      The percentage it replaced was measured over however much data existed rather than over
      the window, so `5% up` did not mean what it looked like — which is precisely why it needed
      a coverage qualifier trailing it. A number needing a caveat to be read correctly is the
      wrong number to show, and removing it removed the reason for the caveat: `uptimeRatio` and
      `connectivityCoverage` went with it. A count needs no denominator and at worst
      undercounts, which is honest — `src/components/devices/DevicesView.tsx`
- [x] **EX-033b** An offline device no longer displays readings. `co5` rendered `OFFLINE` beside
      `230.4 V / 2.23 A / 513.9 W`. **This reverses EX-039's own rule**, which keyed expiry on
      age alone because "a device that dropped a second after reporting still has a real last
      reading". That reasoning missed the mechanism: `shared/buildLatest.mjs` stamps `ts = now`
      and only overrides it when the device reports its own time, so an offline device's
      timestamp is **synthesized** — its age is not evidence of anything, and the age rule could
      never fire for it. The COMM badge is the fact; the figures were not —
      `src/lib/staleness.ts`
- [x] **EX-034b** `Sensors` added to the category vocabulary — `sensor_temp_humidity` is a real
      class here and could previously only be filed under `other`, which means "considered, none
      of these fit". `phase17` only widens what the CHECK accepts, so unlike `phase14` it needs
      no value mapping and is order-independent with the frontend. Applied and verified. The
      "frontend agrees with the constraint" assertion moved to the phase 17 test, because it
      pins the UI to one migration's vocabulary and must follow the newest or it fails the
      moment a category is added — `supabase/phase17_device_categories_sensor.sql`
- [x] **EX-027b** `npm run demand:profile` — the recorded building demand, so a DSM limit comes
      from evidence instead of a guess. Suggests a ceiling **above the observed peak**, not a
      percentile of it: a limit anchored inside normal operation sheds load on an ordinary busy
      afternoon. Refuses to suggest anything from under 500 readings, because a number drawn
      from a handful of samples is a guess wearing a decimal point and this system can act on it
      by switching off lights. Writes nothing.
      *Pagination is the load-bearing part.* The first pass asked for 4,000 rows, got exactly
      1,000, and computed percentiles over 53% of the data with nothing to indicate it — the
      same PostgREST cap `phase9_history_buckets.sql` and `server/backup.mjs` both exist to
      escape, walked into anyway. The true count is 1,877, and the difference is not cosmetic:
      the truncated peak was 1,577 W against a real 1,767.8 W, so a threshold derived from it
      would have sat ~12% low and shed load on a normal day —
      `server/demandProfile.mjs`, `server/demandProfile.test.mjs`, `server/demand-profile.mjs`
- [x] **EX-026b** `npm run tuya:devices -- --verify-keys` — checks every flow node's local key
      against the key Tuya holds, and reports only whether it matches. A wrong key does not fail
      loudly: the device is discovered, the connection is attempted, and it fails looking like a
      network fault. This project has already made that mistake — RM-001a first blamed a stale
      key for `l6`/`l7`, wrongly, because nothing could check.
      Neither key is printed and neither reaches the result object; the comparison runs on a
      per-run salted HMAC, so an accidental dump of an intermediate cannot leak one and two runs
      produce nothing correlatable. A bare digest would have been false comfort — a Tuya local
      key is drawn from a small enough space to be reversed from a candidate list.
      **First run, 2026-08-24: all 19 keys match.** That rules stale keys out as a cause of
      anything currently open, which is worth having as evidence rather than as an assumption —
      `server/keyAudit.mjs`, `server/keyAudit.test.mjs`
- [x] **EX-024b** Tuya cloud client, dependency-free, server-side only. Signing is pinned by
      test to the exact canonical string, because Tuya reports every signing mistake as a flat
      `sign invalid` with no indication of which half was wrong — the token request and a
      business request sign different prefixes, an empty body hashes to the SHA-256 of the empty
      string rather than to nothing, and the hex must be uppercase. Failures arrive as HTTP 200
      with `success:false`, the same shape as PostgREST's silent truncation and its RLS-blocked
      writes, so success is never inferred from a status code —
      `server/tuyaCloud.mjs`, `server/tuyaCloud.test.mjs`
- [x] **EX-025b** `npm run tuya:devices` — compares Tuya's cloud view of every device against
      the bridge's local view. The cloud reaches devices over the internet rather than the local
      subnet, so **disagreement between the two is the diagnosis**: cloud-online plus
      local-offline means the device is powered, joined and talking to Tuya while the Pi cannot
      reach it, which points at the access point; both offline points at the device. Read-only.
      Local keys are fetched only with `--keys` and even then only their length is printed —
      the values exist to populate a registry, not to be read off a terminal that may be pasted
      into an issue — `server/tuya-devices.mjs`
- [x] **EX-104** `npm run tuya:macs` — the third view, which closes what the cloud view leaves
      open. EX-025b tells "the device is off" from "the Pi cannot reach it", but it cannot split
      the first case, because a device can lose its *uplink* to Tuya while remaining perfectly
      well associated to the local AP. This joins Tuya's per-device MAC
      (`/v1.0/iot-03/devices/factory-infos`) against the Pi's own `ip neigh`: a resolved MAC
      means the device answered an ARP request, so layer 2 works whatever ICMP, UDP discovery or
      the cloud say — the reasoning `CLAUDE.md` already records for ruling out client isolation,
      applied per device. **The MAC is the only sound join key**: the cloud's `ip` field is the
      WAN egress address as of last contact, stale for exactly the devices in question and never
      mappable to a LAN address.
      It touches **no device and opens no connection**, which is the point — probing these
      directly costs their single local connection slot, and doing that is what wedged four of
      them on 2026-08-25.
      On first run it split RM-020's six power-cycle candidates into four that were still on the
      segment and two that were genuinely gone. Unresolved ARP lines (`FAILED`, `INCOMPLETE`)
      are deliberately **not** counted as presence — that inversion would reverse the entire
      conclusion, and the Pi's table carried such a line at the time; there is a test for it, and
      it was confirmed to fail when the guard is removed —
      `server/macPresence.mjs`, `server/macPresence.test.mjs`, `server/tuya-devices.mjs`
- [x] **EX-029b** An offline device no longer displays readings. `co5` rendered `OFFLINE`
      beside `230.4 V / 2.23 A / 513.9 W`. This **reverses EX-039's own rule** the day after it
      shipped: age alone was the test, on the reasoning that a device which dropped a second
      after reporting still has a real last value. That missed the thing that makes it wrong —
      `shared/buildLatest.mjs` stamps `ts = now` and only overrides it when the device reports
      its own time, so an offline device's timestamp is **synthesized**, its age is not evidence
      of anything, and the age rule could never fire for it. The COMM badge is the fact; the
      figures were not — `src/lib/staleness.ts`
- [x] **EX-030b** `sensor` added to the category vocabulary, so a real device class can stop
      being filed under `other` (which means "considered, none of these fit", not "no right
      answer exists"). `phase17` only *widens* the CHECK, so unlike `phase14` it needs no value
      mapping and is safe to apply in either order relative to the frontend. The "frontend
      agrees with the constraint" assertion **moved** to the phase 17 test: it pins the UI to a
      specific migration's vocabulary, so it must follow the newest one or it fails the moment a
      category is added, reporting a correct change as a broken one —
      `supabase/phase17_device_categories_sensor.sql`, `test/phase17-device-categories-sensor.test.mjs`
- [x] **EX-031b** `server/schemaProbe.mjs` — probing an applied-by-hand migration without
      leaving anything behind. `probeRejects` is genuinely read-only (a refused write changes
      nothing); `probeAccepts` cannot avoid writing, because acceptance is only observable by
      being accepted, so it captures the row first and restores it in a `finally` that runs even
      when the probe throws.
      **Written because a note was not enough.** Checking a constraint by writing a live value
      and remembering the restore afterwards was done twice on 2026-08-24 — the second time
      *after* the lesson had been recorded in RM-014. The fix for a mistake that survives being
      written down is to make the safe shape the convenient one —
      `server/schemaProbe.mjs`, `server/schemaProbe.test.mjs`
      *Postscript, 2026-08-25 — the tool existing was still not enough.* The same live-data
      probe was hand-rolled with `curl` a third time, against `device_config` again, without
      checking whether a helper already existed; a redundant and weaker copy of this module was
      then written and deleted. Two things generalise. Reaching for `curl` because it is one
      line is how a safe path gets bypassed — check `server/` for an existing helper before
      writing a probe. And ROADMAP's "Existing features" list is the index of what is already
      built: consulting it before adding a module is cheaper than discovering the duplicate
      afterwards from an id collision.
- [x] **EX-023b** Per-device connectivity on the Devices page: 24 h uptime and how many times
      each device changed state, plus one fleet line when any device is flapping. Built because
      RM-013 — devices disassociating from the access point — was invisible from the dashboard
      and took a packet capture on the Pi to find. The data had been there all along:
      `readings.online` is `boolean not null` and has been written every 60 s per device since
      ingestion started; nothing read it that way. Read-path only, no new storage.
      An RPC rather than a client query for two reasons that agree: 20 devices x 1440
      samples/day is ~28,800 rows against a 1,000-row PostgREST cap that reports nothing when it
      truncates (the phase 9 trap), and counting transitions needs `lag()`, which PostgREST has
      no equivalent for. Empty windows render `—` rather than 0%, because unknown uptime and
      "down all day" are different claims. A single transition is not flapping — a device that
      dropped once and recovered would otherwise flag on every ordinary restart, which is how a
      warning becomes something people stop reading. Steady devices render nothing at all —
      `supabase/phase15_device_connectivity.sql`, `src/lib/deviceConnectivity.ts`,
      `src/hooks/useDeviceConnectivity.ts`, `test/phase15-device-connectivity.test.mjs`
      *Amended within the hour, after its own output showed a flaw in it.* Outlets carry a
      device-reported `ts` (`buildLatest.mjs:72`), `readings` is keyed `(device_id, ts)`, and
      ingestion upserts — so an outlet whose clock stalls overwrites its own row rather than
      adding one, and its `samples` undercounts the window. The first version rendered "73% up"
      over 40 samples beside "58% up" over 60 as though they were one measurement. The RPC now
      returns `expected_samples` and the note carries coverage beside the figure, reusing
      `coverageOf` rather than restating its bands — the same rule `monthly_reports` applies so
      a barely-observed month can never quote a bare total.
      *Amended again 2026-08-25, and this time by removing rather than qualifying.* The uptime
      percentage is gone, along with the coverage qualifier that existed only to make it
      readable. A figure needing a caveat to be understood is the wrong figure to show; the row
      now reads `16 drops today`, and a count needs no denominator — at worst it undercounts,
      which is honest. The fleet banner went with it, its one fact folded into the page
      subtitle. `uptimeRatio` and `connectivityCoverage` were deleted, not left unused.
- [x] **EX-022b** Category vocabulary revised to how this site is actually laid out: Lighting,
      Aircon, Outlet, Branch Circuit, Critical, Others — replacing a generic building-management
      list (`hvac`, `office_equipment`, `kitchen`) with the groupings the CT map has always had
      and the category list never did. `coerceCategory` drops the retired values, so a row
      written before the migration reads as uncategorised rather than putting an option in the
      `<select>` that the CHECK would reject on the next save. A guard test pins the option list
      and the SQL CHECK to each other, making enforceable a comment `deviceConfig.ts` had only
      asserted — `src/lib/deviceConfig.ts`, `supabase/phase14_device_categories.sql`,
      `test/phase14-device-categories.test.mjs`
- [x] **EX-021b** Drift guard for the tuya node settings on the hand-built source tabs.
      `shared/tuyaNodeSettings.mjs` declares the expected `findTimeout` and per-node
      `tuyaVersion`; `test/tuya-node-settings.test.mjs` checks them against the committed
      `live-flow-baseline.json`, so a reverted timeout, a changed version, or a vanished node
      fails `npm run test:bridge` rather than surfacing as "every device is offline" — which is
      what it looks like otherwise. Each value is recorded with its provenance: the versions are
      the devices' own decrypted announcements, and the 10 s timeout is two of the measured 5.0 s
      broadcast intervals. The six nodes whose version could not be confirmed against a live
      announcement are listed separately, so an unverified value cannot pass as a verified one —
      `shared/tuyaNodeSettings.mjs`, `test/tuya-node-settings.test.mjs`
      *Verified against the running system:* re-capturing the live flow produced no diff.
      *Not proved:* that the live flow still matches later — the baseline is a snapshot, and
      `npm run capture-flow:pi` is what refreshes it.
- [x] **EX-019** Per-device **function** declaration — `control`, `monitoring`, `scheduling` —
      stored in `device_config` beside room and load-shed group, and driving which page lists a
      device. Previously a device's page membership was decided by its class in frontend code,
      which put a *site* decision inside a page: a light switch has control but no metering
      here, while the identical relay elsewhere might feed a metered circuit. `null` means "not
      configured" and falls through to a class default; `[]` is a real answer — "no role here" —
      and the two stay distinguishable all the way down to the nullable column.
      Defaults were chosen to reproduce the previous membership **exactly**, verified against
      the real registry: Control 15/20, Automation 15/20, Analytics 11/20, all identical to
      before. What changed is that each page now *names* what it left out and why, instead of
      omitting devices silently — the reason the missing switches read as a bug rather than a
      decision. Analytics keeps two independent gates: the operator's `monitoring` declaration
      and the catalog's `metered` fact, because a temperature sensor is monitored and still has
      no wattage to chart — `src/lib/deviceFunctions.ts`, `src/hooks/useDevicesFor.ts`,
      `supabase/phase13_device_functions.sql`, `test/phase13-device-functions-schema.test.mjs`
- [x] **EX-018** One device-class catalog replacing seven independent per-class tables, each of
      which answered part of "what is this class" and could drift alone: `SWITCHABLE_CLASSES`,
      `CLASS_ICON`, `DevicesView`'s `CLASS_ORDER`/`CLASS_FILTER_LABEL`/`CLASS_PILL_LABEL`,
      `AutomationPage`'s `FILTER_CLASS`, `AnalyticsPage`'s hardcoded `'branches' | 'outlets'`
      union, and `dispatchScope`'s `COMMANDABLE_CLASSES`. Adding a device class is now one entry
      plus whatever the type checker then demands, instead of a hunt through seven files where
      five failed *silently* — a missing filter chip or scope group renders nothing rather than
      erroring. `deviceIcons.ts` had already made this argument for icons alone; this is the same
      argument for everything else. Analytics groups are derived from the catalog and rendered
      through a presentation lookup **with a fallback**, so an unstyled group appears plain rather
      than disappearing. Characterization tests copy each replaced table verbatim and assert the
      consolidation changed no behaviour — `src/lib/deviceClassCatalog.ts`,
      `src/lib/deviceClassCatalog.test.ts`
      *Deliberately not folded in:* `server/dispatchLight.mjs`'s `DISPATCH_CLASSES`, which answers
      what this *deployment* can currently drive rather than what a class is, and already reaches
      the frontend through `capabilitiesStore`.
- [x] **EX-017** Control availability no longer depends on reading freshness. Reported on site
      2026-08-24: **outlets could not be switched at all.** Every outlet toggle carried
      `disabled={… || stale}`, and because nothing polls an outlet (FI-013) the reading is stale
      almost always — so an outlet was operable only in the seconds after it happened to push a
      change of its own accord. Lights escaped it purely because they report continuously.
      Telemetry and dispatch are different facts travelling opposite directions: a reading comes
      *from* the device, a command goes *to* it through the proxy and the bridge.
      `isCommandable` gates on `online: false` — a real refusal, since the bridge is saying it has
      no connection — and nothing else; `unknown` still gates a toggle that has no state to toggle
      from. `IrCommandCenterCard` had already declined to make this conflation, and is now the
      rule rather than the exception — `src/lib/socketView.ts`, and the four control cards
- [x] **EX-039** A reading past a 5-minute expiry renders `—` rather than its last figure,
      extending `format.ts`'s "missing renders `—`, never 0" rule to values whose *age* has made
      them meaningless. Found on site 2026-08-24: the Outlet tab's parser refreshes
      `<ctx>_last_time` on the device's **connection** event without touching the measurements,
      so a reconnected outlet served a four-day-old 235.9 V under a minutes-old timestamp while
      the device itself read 224.9 V — `online: true` throughout, so nothing downstream had cause
      to doubt it. Deliberately keyed on age alone, not `online: false`: a device that dropped a
      second after reporting still has a real last reading, and blanking it would discard the most
      useful number on screen exactly when it is needed — `src/lib/staleness.ts`
- [x] **EX-013** Per-reading freshness treatment: content dims, flag stays legible — `src/components/common/StaleDataBadge.tsx`, `src/lib/staleness.ts`

### Frontend — state & data layer

- [x] **EX-020** Bridge resilience layer: abort timeouts, in-flight guard, exponential backoff, WS primary with HTTP-poll fallback — `src/lib/bridgeClient.ts`
- [x] **EX-021** Session-expiry recovery: a 401 triggers one token refresh, then falls through to the login screen instead of retrying a dead token forever — `src/lib/authToken.ts`, `src/stores/authStore.ts`
- [x] **EX-022** Optimistic command state with feed reconciliation and revert-on-failure — `src/stores/commandStore.ts`
- [x] **EX-023** Device catalogue, latest readings, totals and history store — `src/stores/deviceStore.ts`, `src/hooks/useLiveConnection.ts`
- [x] **EX-024** Operator-editable device metadata (room, category, load-shed group, display-name override, notes) — `src/lib/deviceConfig.ts`, `src/stores/deviceConfigStore.ts`
- [x] **EX-025** Anomaly fetch/store surfaced in the alerts bell — `src/lib/anomalies.ts`, `src/stores/anomaliesStore.ts`
- [x] **EX-026** Capabilities store reporting both the dispatch gate and which device classes actually reach hardware — `src/stores/capabilitiesStore.ts`, `src/components/control/dispatchScope.ts`
- [x] **EX-027** Relay corroboration and socket-view derivation, kept pure and unit-tested — `src/lib/relayCorroboration.ts`, `src/lib/socketView.ts`
- [x] **EX-028** DSM threshold maths and load-shed banner logic — `src/lib/dsm.ts`
- [x] **EX-029** Long-range history read as server-side time buckets, with a truncation guard that throws rather than returning a plausible-looking partial answer — `src/lib/supabaseHistory.ts`
- [x] **EX-031** History is tagged with the range it was fetched for and read only via `historyFor()`, so one range's points can never be charted under another's label — `src/stores/deviceStore.ts`
- [x] **EX-030** One retry/backoff schedule shared by the four Supabase-backed stores instead of four hand-copies — `src/stores/retrySchedule.ts`
- [x] **EX-032** *(deployed 2026-08-22)* Archive-backed 90d/1y ranges on Analytics, reading across the retention boundary through one RPC so the caller never has to know where it sits. The range set is 24h/7d/30d/1y — 90d was removed on request, and because `LongRange` and `ARCHIVE_RANGES` key every table that describes a range, the type system found each place it had to go — `src/lib/supabaseHistory.ts`, `src/components/analytics/AnalyticsPage.tsx`
- [x] **EX-033** *(deployed 2026-08-22)* Reports page: stored monthly figures per device and building-wide, with CSV export. Coverage is rendered beside every figure, so a barely-observed month can never quote a bare total — `src/components/reports/ReportsPage.tsx`, `src/lib/supabaseReports.ts`
- [x] **EX-036** Page-header actions can shrink, so the controls below the title wrap instead of being clipped off the edge. `flex: none` forbade shrinking, so on a 375px screen Analytics' toggle row rendered 722px wide with its Parameter and Scope groups unreachable, the Devices toolbar 833px and Control's button row 363px — all clipped rather than scrolled. One rule, three pages — `src/index.css`
- [x] **EX-038** The Devices fleet table becomes a two-section card per device below 720px — identity with its status chips on one line, a rule, then the readings with the action riding the end of them — instead of a 860px sideways-scrolling grid. Halves the card height and leaves no band spent on a single chip — scrolling right to read Power had taken the device's own name off screen. The nine `role="columnheader"` nodes are hidden visually but kept in the accessibility tree, so the row/column association EX-008 added survives — `src/components/devices/DevicesView.tsx`, `src/index.css`
- [x] **EX-037** Segmented controls stack full-width below 480px with 44px-tall targets, single-column card grids on phones, and `minmax(0, 1fr)` on the single-column fallbacks so a wide child cannot floor a grid column at its min-content width — `src/index.css`
- [x] **EX-035** *(deployed to the Pi 2026-08-22)* Account menu in the nav's right-hand cluster holding Reports and sign-out, keeping the tab bar at the five live operational views. Routes are derived from `ROUTE_ITEMS`, not the tab bar, so a page can leave the tabs without leaving the router — `src/components/layout/AccountMenu.tsx`, `src/components/layout/navItems.ts`
- [x] **EX-034** RFC 4180 CSV serializer with spreadsheet-formula neutralisation, a UTF-8 BOM for Excel, and missing rendered as empty rather than 0 — `src/lib/csv.ts`

### Server & ingestion

- [x] **EX-040** Ingestion daemon polling the bridge and writing devices/readings/building_totals/ingestion_health, with local NDJSON buffering on outage — `server/ingest.mjs`, `server/ingestBuffer.mjs`.
      Confirmed in production 2026-08-21: a real ~7-minute uplink loss buffered 8 rows, then flushed and cleared them on reconnect with no data loss (`buffered_row_count` back to 0, `last_error` null).
- [x] **EX-041** Authenticated proxy: the only process besides Node-RED allowed to reach the bridge; validates a session before forwarding — `server/proxy.mjs`
- [x] **EX-042** Break-glass local login for when Supabase Auth is unreachable; view-only, cannot issue commands — `server/breakGlass.mjs`, `server/hashBreakGlassPassword.mjs`
- [x] **EX-043** Command audit path: validate, dispatch, then record — a failed dispatch is logged as `failed`, never silently omitted — `server/proxy.mjs`
- [x] **EX-044** Rolling z-score/IQR anomaly detection with a noise floor substituted into the denominator rather than used as a skip-gate — `server/anomalyStats.mjs`
- [x] **EX-045** Systemd units for ingest, proxy, and the office kiosk display — `server/ibems-ingest.service`, `server/ibems-proxy.service`, `server/ibems-kiosk.service`
- [x] **EX-047** Scheduler daemon firing the Automation page's schedules through the same gate and audit trail as a manual click, attributed to whoever saved the schedule — `server/scheduler.mjs`, `server/schedulePlan.mjs`, `server/ibems-scheduler.service`
- [x] **EX-051** Outlet and aircon control endpoints on the flow, mirroring the light chain — `node-red-bridge/addDeviceEndpoints.mjs`
- [x] **EX-052** Dispatch routed per device class from one shared list, so capabilities, scheduling and shedding all cover the same classes — `server/dispatchLight.mjs`
- [x] **EX-053** Aircon setpoint end to end: bounded in the contract, carried by the command, selectable on the Control page — `shared/commands.mjs`, `src/components/control/IrCommandCenterCard.tsx`
- [x] **EX-049** Automatic load shedding on a DSM threshold breach — shed-only, one tier per evaluation, never touching Protected or unassigned devices; same gate and audit trail as any other command — `server/shedPlan.mjs`, `shared/dsmMath.mjs`
- [x] **EX-050** The Automation page records who saved a schedule or threshold, without which neither can fire — `src/lib/supabaseConfig.ts`
- [x] **EX-048** Light dispatch shared by the proxy and the scheduler rather than duplicated — `server/dispatchLight.mjs`
- [x] **EX-046** Log rate limit for the bridge unit, so a device-discovery failure loop cannot evict the journal's history — `server/nodered-log-ratelimit.conf`
- [x] **EX-054** Record-then-dispatch shared by the proxy and the scheduler, so a command cannot reach hardware without an audit row already written; both verify the affected-row count rather than trusting a 200 — `server/auditedDispatch.mjs`
- [x] **EX-055** `readings` retention: a 30-day raw window rolled into permanent hourly buckets, triggered statelessly from the database's own answer rather than a remembered timestamp — `server/retention.mjs`, `supabase/phase9_readings_hourly.sql`
- [x] **EX-056** The ingestion cycle is orchestration-tested with its I/O injected, and a bridge outage now reaches `ingestion_health` instead of only being logged — `server/ingestCycle.mjs`
- [x] **EX-057** Proxy upstream timeout for a bridge that accepts and then hangs, a bounded token-verify cache, and 502s that no longer echo the raw upstream error — `server/proxy.mjs`
- [x] **EX-058** Retention generalised over the table, covering `building_totals` and `anomalies` as well as `readings`, each pass guarded so one table's failure cannot stop the others — `server/retention.mjs`
- [x] **EX-059** Monthly report generation on the same stateless trigger as retention — "which settled months have no report, or one built before they settled?" — with a grace period so a month is never reported before its late-flushing rows land, and a report built too early rebuilt exactly once rather than frozen at partial data — `server/reports.mjs`
- [x] **EX-070** Supabase data export for the tables that cannot be reconstructed, explicitly paginated because a full page is what a silent cap also looks like; exits non-zero on a partial backup — `server/backup.mjs`, `npm run backup`

### Bridge & hardware

- [x] **EX-060** Node-RED flow generated from a single canonical device registry; never hand-edited — `shared/registry.mjs`, `node-red-bridge/build-flow.mjs`
- [x] **EX-061** Deploy script that refuses to write unless the live flow's tab ids/labels match what generation assumed — `node-red-bridge/deploy.mjs`
- [x] **EX-062** Read-only health check safe to run at any time — `node-red-bridge/verify.mjs`
- [x] **EX-063** Tuya health-signal repair: devices can now actually report disconnected, and a disconnected meter contributes nothing to totals rather than its frozen last reading — `node-red-bridge/fix-tuya-health-signals.mjs`, `shared/buildLatest.mjs`
- [x] **EX-064** Light API token rotation, moving a hardcoded plaintext token to an environment variable and closing the fail-open branch — `node-red-bridge/rotate-light-api-token.mjs`
- [x] **EX-065** Real hardware dispatch for lights, gated closed by default; the proxy refuses to start if the gate is open with no token — `server/proxy.mjs`
- [x] **EX-067** The live flow is under version control as a redacted structural baseline, and the capture tool refuses to write if anything survives redaction — `node-red-bridge/capture-live-flow.mjs`, `node-red-bridge/redactFlow.mjs`, `node-red-bridge/live-flow-baseline.json`
- [x] **EX-068** Dead-flow pruning: 426 -> 307 nodes, removing the legacy `/ui` dashboard, debug sinks and the MQTT twin. Closed an unauthenticated MQTT path that could switch real lights with no audit row and no dispatch gate — `node-red-bridge/cleanupPlan.mjs`, `node-red-bridge/prune-dead-flow.mjs`
- [x] **EX-066** Mock bridge implementing the same contract with fault injection (`--cmd-fail`, `--cmd-drop`, `--dispatch`) so every state is reachable without hardware — `mock-bridge/server.mjs`

- [x] **EX-107** `online` requires evidence that the device actually reported, not just that a
      socket is open. The tuya node's connection flag describes its own socket, and a socket
      whose peer vanished without a FIN stays "connected" indefinitely — so `buildLatest` now
      also derives when each metered device last reported, stamps `ts` with that rather than
      `now`, and withdraws `online` past `STALE_READING_MS`. Stamping `ts = now` was what let
      the frontend's staleness watchdog sleep through a total outage: an always-fresh timestamp
      cannot look old.
      **Arrival, not value change** — the distinction is the whole design, and the obvious
      version would have made the dashboard under-report the building. A live meter on an idle
      circuit repeats the same numbers indefinitely; keying on "the numbers stopped" marks it
      dead and `online: false` removes it from the building totals. Two channels of one physical
      meter proved it: one byte-identical at 0 W for ten minutes while the other swung 14 V.
      So the signal is the tab's sample buffer, which fills on every message whether or not the
      measurement moved. The outlet tab's own arrival stamp is preferred where it exists; the
      energy tab writes none, hence the generated `Track meter arrivals` step.
      Absent arrival information — a mock, or a flow predating the step — falls back to previous
      behaviour rather than inventing offline, which is the safe direction and is tested —
      `shared/buildLatest.mjs`, `node-red-bridge/build-flow.mjs`, `test/reading-freshness.test.mjs`
- [x] **EX-106** The Pi returns to its preferred Wi-Fi network by itself. A oneshot fired by a
      15-minute timer: if the highest-priority saved profile is in range and the Pi is on
      something else, it moves — and moves back if that does not work out.
      **The safety contract is the feature**, because the operator is usually remote and a Pi
      with no uplink cannot be recovered from a keyboard nobody is sitting at. It only ever
      moves *towards* the preferred profile, never away; it will not leave a working connection
      for one that is out of range or weak; a move counts as successful only if the Pi ends up
      associated to the target **and** can reach the internet, and anything less is reverted to
      whatever it was on before; if the revert also fails it tries every other saved profile
      before giving up; and a failed attempt starts a two-hour backoff so a half-broken AP
      cannot cause endless churn.
      "Preferred" is **derived** from `autoconnect-priority`, not configured. The operator has
      already expressed the preference by setting it, a second copy could disagree, and this
      repository is public and should not carry the site's SSIDs.
      Equal priorities are treated as *no* preference and refuse to move — otherwise two
      equally-ranked profiles would swap the radio on every tick, forever.
      The decision is pure and unit-tested (12 tests); each of the four guards above was
      confirmed to fail the suite when removed, including the ordering that makes the log name
      the real reason rather than hiding it behind the backoff.
      `touch /home/bems/.ibems-wifi-prefer.disabled` stops it, for when the Pi is deliberately
      parked elsewhere — `server/wifiPreference.mjs`, `server/wifi-prefer.mjs`,
      `server/wifiPreference.test.mjs`, `server/ibems-wifi-prefer.service`, `.timer`

### Data & Supabase

- [x] **EX-080** Base schema: devices, readings, building_totals, ingestion_health — `supabase/schema.sql`
- [x] **EX-081** RLS lockdown; no anon policies anywhere — `supabase/phase5_lockdown_rls.sql`
- [x] **EX-082** Schedules and DSM thresholds, including the partial-unique-index upsert fix — `supabase/phase6_schedules_config.sql`, `supabase/phase6_schedules_unique_fix.sql`
- [x] **EX-083** Device config as a sibling table, so ingestion's periodic re-upsert cannot null out human edits — `supabase/phase7_device_config.sql`
- [x] **EX-084** Anomalies table, service-role write, authenticated-select-only — `supabase/phase8_anomalies.sql`
- [x] **EX-085** `readings_buckets` RPC: server-side time-bucketed history, averaging only online samples, `security invoker` so RLS still applies, and raising rather than truncating — `supabase/phase9_history_buckets.sql`
- [x] **EX-086** `readings_hourly` rollup table plus an atomic roll-up-and-prune function — `supabase/phase9_readings_hourly.sql`
- [x] **EX-087** A narrow update policy letting a command's own outcome be attached to its audit row: own row, only while in flight, only to a terminal status — `supabase/phase9_command_outcome.sql`
- [x] **EX-088** `readings_archive` RPC merging `readings_hourly` and `readings` into one series, deduplicating the seam, weighting coarser buckets by each hour's own sample count, and raising rather than fabricating a sub-hour grain — `supabase/phase10_history_archive.sql`
- [x] **EX-089** `building_totals_hourly` plus atomic rollup-and-prune, an outright `anomalies` prune, and the `ts` indexes the prune predicates always needed — `supabase/phase11_totals_retention.sql`
- [x] **EX-090** `monthly_reports` / `monthly_building_reports` and an idempotent generator: energy as a sum of daily maxima, days grouped in the site timezone, coverage recorded on every row — `supabase/phase12_monthly_reports.sql`

### Auth & security

- [x] **EX-108** Supabase Auth with a login screen; the proxy verifies the caller's own token — `src/components/auth/LoginPage.tsx`, `server/proxy.mjs`
- [x] **EX-109** Command audit rows attributed to the real signed-in user, inserted with the caller's token so RLS grants it — `server/proxy.mjs`
- [x] **EX-110** Remote access over the tailnet, verified working from off-site
- [x] **EX-111** Anon key only in the browser bundle; the service-role key is read solely by the ingestion daemon — `src/config/supabase.ts`, `server/.env.example`

### Testing & tooling

- [x] **EX-120** 607 frontend tests (vitest) — `src/**/*.test.ts(x)`
- [x] **EX-121** 348 bridge/contract tests, including assertions that the generated flow contains no write nodes and no MQTT — `test/`
- [x] **EX-122** 356 server tests against real spawned processes and hand-rolled fake HTTP servers, no mocking library — `server/*.test.mjs`
- [x] **EX-105** Environment hygiene is checked, not trusted. A module that is *imported* must
      not reconfigure the process: `server/envHygiene.test.mjs` imports each route module in a
      clean child process and asserts it added no keys to `process.env`, and separately greps
      for a module-scope `loadDotEnv`. **Both halves are needed.** The behavioural one is asleep
      on any checkout without a `server/.env` — `loadDotEnv` is a silent no-op there, so it
      passes vacuously on precisely the machines where the bug does no harm, and would have
      caught RM-022 nowhere. The source-level half fails anywhere.
      This is the same shape as EX-091: the mistake is invisible to types, survives a green
      suite, and the only reliable guard reads the source — `server/envHygiene.test.mjs`
- [x] **EX-131** The MQTT broker no longer accepts anonymous connections from the device network.
      It listened on **every interface** with `allow_anonymous true`, on 1883 and on a
      websockets listener at 9001, sharing the 2.4 GHz segment with the field devices. Anything
      associated to that SSID could read every topic and publish to any of them. That was
      already wrong and was about to get worse: RM-026's chosen bridge can **write** to the
      inverter.
      **Bound to loopback rather than password-protected, and the evidence chose that.** Across
      the retained logs the broker has seen **70 connections, every one on 1883 and every one
      from loopback** — zero off-host, ever. Node-RED, its only real client, connects to
      `localhost`. Credentials would have secured a door nobody uses, and would have required a
      live flow write to carry them into the broker config node.
      **Both loopback families.** `localhost` resolves to `::1` on this host as well as
      `127.0.0.1` and the logs show both in use, so a single `listener 1883 127.0.0.1` would
      have silently locked out whichever the resolver happened to prefer. Validated on a spare
      port before going near the live service, precisely because that failure would have looked
      like a broker fault rather than a config one.
      **The websockets listener is retired, not merely closed.** It was added for a
      "browser-based digital twin" that was never built and had **never carried a connection** —
      an open, anonymous listener on the device network with no consumer is pure attack surface.
      **This configuration exists only on the Pi, and nothing in this repository declares it** —
      the same shape as `findTimeout`/`tuyaVersion`, where a rebuild or a package upgrade
      restores the permissive default with no diff and no alarm. Recorded in `CLAUDE.md`'s site
      facts for that reason, and in `docs/pi-session-brief.md` — which is what a session
      actually reads before touching the Pi — with timestamped `.bak` files beside both config
      files.
      *Verified after the change:* Node-RED reconnected within fifteen seconds under its
      existing client id, the Pi's own LAN address refuses 1883, loopback still accepts, 9001 is
      closed, and all six services stayed active with the fleet unchanged.
      *Deliberately left anonymous on loopback:* only processes on the Pi can reach it now, and
      anything with local execution there has far better options than the broker. Adding
      credentials would have bought little and cost a flow write.
      `/etc/mosquitto/mosquitto.conf`, `/etc/mosquitto/conf.d/bems.conf` (both on the Pi only)
- [x] **EX-130** An internet outage no longer removes control of the building.
      **THE GAP, WHICH WAS NOT WHERE ANYONE WOULD LOOK FOR IT.** The Tuya fleet is local: the
      devices sit on the Pi's own L2 segment, answer local keys, and dispatch has always
      preferred the local path with the vendor cloud as fallback. Commanding them needs no
      internet at all. Two things needed it anyway — `handleCommand` verified every session by
      calling `/auth/v1/user`, and `auditedDispatch` wrote the audit row to Supabase *before*
      dispatching — and between them the effective offline command window was **zero**. A WAN
      outage removed every control in the building while the device layer sat there working
      perfectly. Break-glass sessions authenticate locally and last 12 h, but are view-only by
      design, so they did not cover it either.
      **NEITHER SAFETY PROPERTY WAS RELAXED.** Sessions are still verified, and a relay still
      cannot move without the command being recorded first. What changed is that "recorded"
      stopped meaning "recorded in Supabase" and started meaning "recorded durably somewhere we
      control". `auditedDispatch`'s contract is untouched — the durability is supplied by
      wrapping the injected `insertAudit`/`updateAudit`, not by editing the rule.
      **The distinction the whole design turns on: a 4xx is an ANSWER, a throw is an outage.**
      Supabase replying "this caller may not write that row" is an authorization decision and
      still refuses; only a transport failure may be buffered. Laundering a refusal into a local
      queue entry and then moving a relay on the strength of it is the one genuinely dangerous
      mistake available here, and it is the first thing the tests pin.
      **No new secret and no new dependency.** Access tokens are ES256 and the public key is
      published at `/auth/v1/.well-known/jwks.json` — *measured, not assumed*; `node:crypto`
      verifies ES256 natively. A shared JWT secret would have meant adding the most powerful
      credential in the auth system to `server/.env`; a cached public key is not a secret at
      all. The cache persists to disk, because a proxy restarted **during** an outage would
      otherwise silently lose offline capability at the worst possible moment.
      **Network-first, deliberately.** The remote check is authoritative and is the only one
      that notices a session the user has since signed out of; local verification cannot see a
      revocation. So it stays primary and its answers are never second-guessed — the offline
      path applies only when the question could not be *asked*. That is strictly weaker, and it
      is used only when the alternative is losing the building.
      **`alg` is not negotiable.** The oldest JWT break is a verifier that reads the algorithm
      out of the header and obeys: `none` accepts anything, and `HS256` lets an attacker HMAC
      a token using the public key as the shared secret — public, by definition. This verifies
      ES256 and nothing else, and a test forges both.
      **Rotate, never truncate.** Two processes touch the buffer: the proxy appends, ingest
      drains. Read-then-truncate would silently drop a row appended in between — a lost audit
      row for a relay that really did move, which is precisely what the trail exists to prevent.
      `rename(2)` is atomic, so a concurrent append lands in a fresh file. *Stated honestly:
      that atomicity is not covered by a test.* An interleaving hook can only be placed where a
      window exists, and the correct implementation has none — an attempt to add one passed
      against a deliberately broken copy-then-truncate version, so the hook was removed rather
      than left implying a guarantee it never gave.
      **Replay needed no new mechanism.** The buffer entry shape matches the one `ingest.mjs`
      already drains, `requested_by` travels *in the row* so attribution survives an upload
      under service-role credentials, and the outcome is amended into the buffered entry before
      it is ever sent — so one correct row replays, with no migration, despite `command_id`
      carrying no unique constraint.
      **The operator is told.** `/api/capabilities` reports the backlog and the Control page
      says so when it is non-zero, silent otherwise. A command accepted into a local buffer is
      not the same fact as one recorded in the audit table, and this project does not let the
      UI claim the stronger one.
      *Break-glass remains view-only* — the operator's decision, and a test pins it, because an
      outage is exactly the circumstance that could quietly promote it.
      **BOTH CALLERS, NOT ONE.** The first version of this covered only the proxy, which left
      `scheduler.mjs` — schedules and auto-shed — still unable to record and therefore skipping
      every command during an outage. It failed *closed*, so nothing unsafe happened, but a
      scheduled lights-off silently not running is a real cost in a building, and it recreated
      exactly the asymmetry `auditedDispatch`'s own docblock exists to prevent: one safety
      contract, two callers, different behaviour. The scheduler is worth covering precisely
      because it keeps working through an outage — its schedules and thresholds are held in
      memory and only *refreshed* from Supabase, so it goes on evaluating with nothing to
      record against.
      **One buffer file per writing process.** Both processes amend their own entry after
      dispatch, which is a read-modify-write; `writeBuffer` rewrites the whole file, so two
      processes sharing one would let a concurrent reader see a partial file and let the loser
      of the interleaving discard the other's rows. Separate files remove the race outright
      rather than narrowing it, and cost nothing — `ingest.mjs` drains a list. The backlog
      reported to the UI sums both, because "the audit trail is behind" is one fact about the
      system.
      **A test leaked a fabricated command into the production queue, and that is now guarded.**
      While these tests were being written, a full-suite run left a fake `l1` command in
      `server/data/command-audit-buffer-scheduler.ndjson` — a row `ingest.mjs` would have
      uploaded into the **real** audit trail on its next tick, attributed to a test user. The
      cause is instructive rather than careless: the harness closes its fake Supabase while a
      command is in flight, and a socket dying mid-request is indistinguishable from a real
      outage, so it buffered exactly as designed. Every spawn in both harnesses now redirects
      its state under `os.tmpdir()`, and `server/testStatePaths.test.mjs` reads the source to
      keep it that way. *Source-level because the behavioural version cannot be written:* the
      leak depends on a teardown race that does not reproduce on demand — deleting the fix and
      re-running the file produced nothing. The guard found a third unredirected spawn site on
      its first run.
      `server/jwtVerify.mjs`, `server/jwksCache.mjs`, `server/auditQueue.mjs`,
      `server/proxy.mjs`, `server/ingest.mjs`, `server/scheduler.mjs`,
      `server/testStatePaths.test.mjs`,
      `src/components/control/AuditBacklogNote.tsx`, `src/stores/capabilitiesStore.ts`
- [x] **EX-132** A stylesheet token that never existed, in five shipped declarations — and a
      guard so it cannot happen a sixth time. `91f94d5`, `test/design-tokens.test.mjs`.
      `var(--text)` was used in RM-028's and RM-030's CSS. **There is no `--text` in this
      project**; the text colour is `--txt`. An undefined custom property is not an error — CSS
      drops the declaration and the element inherits whatever colour is in scope.
      **Measured, not inferred:** `.space-tree-panel__name` rendered at **1.14:1** in dark mode,
      `rgb(30,41,59)` on `rgba(30,30,30,.75)`. The space tree's node names — the labels of the
      feature itself — were very nearly invisible. The same applied to the tree's form inputs,
      the by-space `<select>`, and `.space-totals-card__value`: the average-power figure. They
      now measure **13.61:1**.
      **Nothing in the pipeline could have caught it.** `tsc` does not read stylesheets; vitest
      renders in jsdom, which computes no cascade worth checking; the contrast guard FI-008
      proposed was never built. It took reading computed colours out of a real browser in both
      themes — which is what CLAUDE.md's "check contrast in BOTH themes" is asking for.
      The guard is narrower than FI-008 and complements it rather than closing it: it fails any
      `var(--token)` without a fallback naming a token `src/index.css` does not define, across
      every `.ts`/`.tsx`/`.css` file. **It is not a contrast checker** — a token that exists can
      still be unreadable on a given background, and only a browser can measure that.
      **Neuter-checked:** reintroduce `var(--text)` anywhere and the test fails naming it.
      *Method note worth keeping:* a contrast reading taken straight after a theme toggle is
      unreliable — the card surface cross-fades, and a stale glass value produced two false
      alarms before I noticed. Measure on a clean load in each theme.
- [x] **EX-133** **Staleness is a per-device budget, not one constant** — the fault behind
      "the outlet keeps flipping between stale and live while Node-RED says it is connected".
      `TIMING.STALE_AFTER_MS` was 30 s for every device, while the classes report on cadences an
      order of magnitude apart. **Measured on the Pi 2026-09-01, 119 samples over 240 s:** every
      live outlet and the near-idle branch meter peaked at **59.9 s** of reading age, because
      `outletPollPlan` asks an outlet for its state once a minute and nothing else asks it
      anything. So every one of them was flagged stale for **half of every minute**, forever, on
      hardware working perfectly. Switches never flagged at all — `buildLatest` stamps
      `ts = now` for them, so their freshness is unmeasurable rather than good.
      `isReadingStale` has **fifteen call sites**, so one constant drove all of: the Devices
      table flipping LIVE↔STALE, the alerts bell raising and clearing a COMM FAULT once a minute
      per outlet, the 3D scene desaturating, and — the expensive one — `commandStore.reconcile`
      reporting a relay that had genuinely moved as "the device did not report the new state".
      The budget now travels on the reading (`Reading.stale_after_ms`), resolved by the bridge in
      `shared/registry.mjs`'s `STALE_AFTER_MS_BY_CLASS`. **The bridge is the right author
      because it owns the poller** — it is the only party that knows an outlet cannot report
      faster than 60 s — and a copy of that table in `src/` would be free to disagree with the
      thing it describes, which is exactly what the single 30 s was. A site may override per
      device in its own directory (Track B). `online: false` still wins over any budget: that is
      the bridge saying it has no connection at all, and no budget may launder it into "fresh".
      **Two of this repo's own guards shaped the result** — the device-naming guard caught a
      device id in a new comment, and the site-composition guard caught a first version
      decorating `DEVICE_REGISTRY`, so the table is threaded into `buildLatest` as a parameter
      like `offsetMinutes` instead. *Requires a flow rebuild* (`build:flow` + `deploy:pi
      --force --apply`), because `build-flow.mjs` inlines the registry —
      `shared/registry.mjs`, `shared/buildLatest.mjs`, `src/lib/staleness.ts`,
      `test/reading-freshness.test.mjs`
      **Guarded against reintroduction:** a test asserts the outlet budget strictly exceeds
      `outletPollPlan.POLL_INTERVAL_S`. A budget shorter than the poll that feeds it *is* this
      bug, and nothing previously forbade it.
- [x] **EX-134** **The mock can now reproduce the fault it could not see.** `mock-bridge` stamped
      `m.t = Date.now()` on every tick, so its devices were the only ones in the system that
      reported continuously — and no amount of local testing could produce the sawtooth above.
      `--poll-cadence=<s>` quantises metered arrivals to a cadence and emits the `arrivals` key
      the real bridge's energy tab produces. `npm run mock -- --poll-cadence=60` is the live Pi's
      actual behaviour. **A fault the mock cannot produce is a fault that gets diagnosed on
      production hardware** — `mock-bridge/server.mjs`
- [x] **EX-135** **A command that moved a relay stopped reporting failure.**
      `commandStore.reconcile` only accepts its success path when the reading is not stale. The
      Outlet Logic Hub echoes a commanded socket within one WS push, but the row's `ts` comes
      from `<ctx>_last_time`, which advances only on the 60 s poll — so under the old budget
      about half of all successful outlet commands missed the success path, waited out
      `COMMAND_CONFIRM_MS`, and were reported as failures. The staleness conjunct stays (it is
      what stops a frozen echo from an offline device confirming a command that never landed);
      what was wrong was the number it consulted. **Verified in a browser:** an outlet commanded
      at a meter age of **59 s** — the worst point in the cycle — switched and produced no FAULT
      row nine seconds later. The failure message is also split: "did not report the new state"
      claims the device answered and contradicted the command, which is only available when the
      reading postdates it — `src/stores/commandStore.ts`
- [x] **EX-136** **Two light controls had dead click handlers.** EX-017 removed `stale` from
      `disabled=` but left it in the `toggle()` of `SwitchesListCard` and `LightingMatrixCard`,
      so the button rendered enabled and the click did nothing at all. A control that looks
      operable and silently is not is worse than a disabled one, which at least says so.
      `isCommandable` (`online: false`) is the real refusal and still gates the button, where it
      is visible — the four control cards
- [x] **EX-137** **"Bridge not reachable" was one socket being offline.** Every dispatch failure
      answered one 502 `hardware_dispatch_failed`, which `describeFailure` rendered as "The
      bridge did not accept the command (502)" — so a refusal meaning *the bridge has no
      connection to this device*, a fact about one socket with a remedy at that socket, arrived
      looking like a building-wide outage. That is what the 2026-08-31 physical test reported,
      while the bridge was serving readings throughout, and it aimed the diagnosis at the wrong
      subsystem for a fortnight. `dispatchCommand` now returns a `reason`
      (`device_offline` | `bridge_unreachable` | `bridge_rejected` | `no_route`) — a code, not a
      prose string for the proxy to parse — the proxy maps each to its own response code and
      carries `via`, and the UI names the actual cause. Where no code arrives, the message now
      claims nothing about which subsystem failed: guessing is what caused the misdiagnosis —
      `server/dispatchLight.mjs`, `server/proxy.mjs`, `src/stores/commandStore.ts`
- [x] **EX-138** **Local-first is declared, observable and provable.** It was already the
      behaviour — the fleet is on the Pi's own 2.4 GHz segment, `dispatchCommand` tries it first
      on every command, and the cloud is only reached after a local failure — but it was a
      property of the code rather than a decision on record, enabled only because credentials
      happened to exist, and nothing on screen said so.
      **Proven on hardware 2026-09-01:** `l1` commanded through `dispatchCommand` with no cloud
      option configured at all — `ok=true via=local` in **85 ms**, state read back as changed,
      then restored. Device id and local key over the building's own LAN, no vendor in the path.
      `SITE.policy.dispatch` is `local-first` (unchanged behaviour) or `local-only`, which
      **refuses** the fallback — a different guarantee from never having configured one, and the
      failure detail says which. The Control page states the policy and names any device that
      answered only through the cloud, which is a success the operator reads as unremarkable
      while meaning that device stopped answering locally. `npm run local-probe:pi` reports it on
      demand, **read-only**, and deliberately does *not* open its own `tuyapi` session: a
      device's inbound socket table is small, and exhausting it is the exact fault ADR-002 was
      written about — `shared/sites/<id>/site.mjs`, `node-red-bridge/localProbePlan.mjs`,
      `src/components/control/DispatchPathNote.tsx`
- [x] **EX-139** **Three metered channels had a health flag that could not go false.** A tuya
      node reports data on output 1 and connection status on output 2; the parser sets
      `<ctx>_health` false only on a `DISCONNECTED`/`ERROR` message, which arrives on output 2.
      Read off the live flow 2026-09-01: of the three meter nodes, **one was wired and two were
      not**, and those two feed three of the four metered channels — roughly **98% of measured
      demand**. `buildLatest` drops an offline meter from the building totals and the
      accumulator gates on the same flag, so a meter that cannot go offline keeps contributing
      its last frozen reading to the kWh figures. Only the ten-minute arrival rule was catching
      it: the backstop doing the primary signal's job.
      `fix-tuya-health-signals.mjs` was written for exactly this and its other two fixes did
      land, but its rewire list names a meter node the flow no longer has, so it now aborts
      before it can help. Expressed as an **invariant** instead — a data output that goes
      somewhere and a status output that goes nowhere is wrong — it needs no list of ids and
      survives the flow being edited. **Dry-run against the Pi finds the two meters plus the two
      quiesced IR devices, and says which are which.** *Not yet applied; needs a flow write* —
      `node-red-bridge/healthWiringPlan.mjs`, `npm run fix-health:pi`
- [x] **EX-140** **The outlet poller skips outlets that are known to be down.** `co4`–`co6` have
      been off the network for weeks (RM-020) and were producing **180** `Device not connected`
      plus a share of **490** `find() timed out` lines every thirty minutes, forever — nothing
      else in the journal was. A log whose steady state is six errors a minute is a log nobody
      reads, and this project has already had a real fault sit unnoticed inside that kind of
      noise. One output per outlet, skipping any the parser has flagged disconnected.
      **Self-healing, which is why it is preferred over quiescing them:** the reconnect loop is
      untouched, so polling resumes by itself when a device returns; `quiescePlan` would need a
      manual `--undo` after the site visit and would not stop the poller sending to a stopped
      node anyway. Unknown health still polls — refusing would keep a device that has never
      reported silent forever. The plan now **upgrades** an existing poller rather than reporting
      "already present, nothing to do", which would have silently declined to fix the thing it
      was run for. *Not yet applied; needs a flow write* — `node-red-bridge/outletPollPlan.mjs`
- [x] **EX-141** **A meter's freshness could be faked by its own frozen wattage** — and the first
      diagnosis of this was wrong, which is worth recording alongside the fix.
      `TRACK_ARRIVALS` stamps an arrival when a signature of the meter's collector fields
      differs from last poll. **The first write-up claimed that signature had no arrival signal
      at all and keyed purely on value change.** That was wrong: the energy collector exposes
      `n`, the tab's sample-buffer depth, which grows on every message, and it was in the
      signature all along — the collector's own comment says exactly that. Measuring the buffer
      instead of reasoning about it settled it: over 43 s, `lo_red` went 2→3 and `arec` 4→5, so
      the meters were reporting roughly once a minute and the tracker was following them.
      **The real defect was narrower and worse.** The signature also contained `e`, the energy
      accumulator — which is integrated **on a timer**, not on arrival. Measured on the Pi
      2026-09-01: across fourteen seconds in which `co_yel_arr_v` stayed at length 1, no message
      at all, `co_yel_energy` moved `0.14347 → 0.14351 → 0.14355`. So a meter drawing power
      registered an "arrival" every couple of seconds while really reporting about once a minute
      — and a meter that **died while loaded** would keep registering arrivals from its own
      frozen wattage, indefinitely.
      That matters because `STALE_READING_MS` exists as the BACKSTOP for a health flag that
      lies, and until the same day **three metered channels could not report a disconnect at
      all** (EX-139). Both the primary signal and its backstop were compromised at once, and the
      backstop was compromised *by* the primary signal: the accumulator is gated on the health
      flag, so `e` only freezes when health is already correct. A backstop must not depend on the
      thing it is backing up.
      `e` is dropped from the signature; `n`, `v`, `c`, `p`, `h` stay, all of which move only
      when a message arrives. Extracted to `node-red-bridge/arrivalTracker.mjs` so the source
      string that ships into the Node-RED function node is **executed** by its tests rather than
      pattern-matched — a correction this subtle is exactly what a regex test waves through —
      `node-red-bridge/arrivalTracker.mjs`, `test/arrival-tracker.test.mjs`
      *Requires a flow deploy to take effect.*
- [x] **EX-142** **A frozen reading could still reach a chart, three ways** — the Analytics
      "Metered vs total" card was plotting **513.9 W that did not exist**. `co5` has been off the
      network for weeks and its history holds 60 consecutive points, every one `online: false`,
      every one carrying that frozen value from before it dropped; the whole building draws about
      35 W. So the outlet line sat roughly fifteen times the building's real demand — far *above*
      the panel total it is meant to sit under — and `Math.max(0, total - metered)` clamped the
      resulting negative to "0.00 kW untracked now", the most reassuring possible rendering of a
      figure that was not computable at all.
      FI-010/EX-102 had added an `online` flag per point and made `pointValue` return `undefined`
      for an offline one; `pointValue`'s own comment calls itself "the one place a point becomes
      a plotted number". **Three callers never went through it.** `sumHistories` added `power_w`
      straight, so every summed line — the Overview energy flow chart too — included each offline
      contributor's frozen value. `downsampleTrend` rebuilt each bucket as `{ts, power_w}` and
      dropped the flag, which defeated EX-102 downstream **only for series longer than
      `maxPoints`** — so 1h and 6h behaved while 24h and the archive ranges, the ones an energy
      claim is read off, quietly plotted memories as measurements. `trendStats` summed every
      point while promising its numbers "stay accurate to the actual readings".
      Neither alternative to a gap was available: summing the frozen value fabricates a reading,
      substituting zero fabricates a different one — it asserts the circuit drew nothing when the
      truth is nobody knows. A dip in a summed line is indistinguishable from the building using
      less, which is the misreading that costs something: an energy saving that was a
      disconnection. A bucket is offline only when NO sample in it was online, and a pair's two
      sides are suppressed independently — an offline outlet must not blank a panel total that is
      perfectly well known — `src/components/overview/totalPowerSeries.ts`,
      `src/components/trends/chartSummary.ts`, `src/components/analytics/analyticsMath.ts`
- [x] **EX-143** **Every popover opened off the edge of the screen.** Measured before any change,
      on the Overview page alone: at 1265 px the weather hint ran **81 px past the right edge**;
      at 375 px **four of five hints** ran 26–61 px off; the alerts bell rendered at
      **`left: -17px`**, so the first 17 px of every alert row was unreachable — and off the LEFT
      edge is the worse direction, because nothing can scroll to it.
      Three controls had three independently written copies of the same `mousedown`-outside +
      `Escape` dismissal and the same CSS-only positioning, and the same bug in all three.
      **The causes differed in a way that matters:** the ⓘ was 260 px anchored `left: 0` to a
      24 px button — too wide for where it started; the alerts panel was 320 px anchored
      `right: 0`, which *fits* a 375 px screen and overflowed anyway because `right: 0` is
      measured from the bell's own 44 px wrapper, whose right edge sits at x=303. Capping the
      width fixed the first and did nothing for the second. Only clamping against the real
      viewport fixes both.
      **`position: fixed` alone is not enough here, and the reason is easy to miss:** `.card` and
      `.top-nav` both carry `backdrop-filter`, which makes them containing blocks for
      fixed-position descendants — so a fixed popover inside either is measured against the card
      or the nav, which is the bug rather than the fix. Portaling to `<body>` is what makes the
      viewport the frame of reference, and it also escapes the cards' overflow clipping.
      `placePopover` is pure and tested at 23 cases because jsdom reports every rect as 0×0, so a
      component test of the arithmetic would assert nothing. It slides rather than flips
      alignment, caps height so long content scrolls inside, and prefers overflowing right over
      left when a viewport cannot fit both margins.
      *Verified in a browser, not only in jsdom:* 30 popovers across six pages at 320×568, 18 at
      375×812 and 1440×900, and 16 at 380×360 with anchors pinned to the top and bottom of the
      viewport to force the flip and the height cap. **None outside the viewport** —
      `src/components/ui/popoverPlacement.ts`, `src/components/ui/useAnchoredPopover.ts`
- [x] **EX-144** **The bridge answered to the whole device Wi-Fi, with no credential.** Node-RED
      serves the admin API **and every http-in node** on one port, and `uiHost` was unset — so it
      bound every interface, including the Pi's `wlan0`, which *is* the dedicated 2.4 GHz SSID
      the Tuya field devices sit on. **Measured rather than reasoned about:** fetching
      `/api/devices` and `/api/readings/latest` from another host with no token returned **200
      and the full device catalogue and live readings**. After the fix, connection refused.
      Bound to loopback rather than firewalled, matching what this deployment already decided for
      the MQTT broker (EX-131). No firewall tooling is installed here, so a rule would have added
      an undeclared host dependency to solve what one line of config solves.
      **Every consumer was inventoried first**, because this is a remote change to the one host
      nobody is standing next to: `ibems-proxy`, `ibems-ingest` and `ibems-scheduler` all default
      to the *literal* `127.0.0.1`; the kiosk talks to `:5183`; `tailscale serve` proxies to
      `:5183` and `:8080` and never to 1880. The literal matters — binding one address of
      `localhost` silently locks out the other, the trap already paid for on the broker.
      **What it costs, stated rather than discovered later:** the Node-RED editor is no longer
      reachable across the network. `ssh -L 1880:127.0.0.1:1880 <host>` reaches it without
      widening anything, and the repo's scripts are already documented to run on the Pi with
      `--host=127.0.0.1`.
      **The check is the durable half.** `settings.js` is not in this repository, so a rebuild or
      a package upgrade restores the permissive default with no diff and no alarm — the same
      shape as `findTimeout` and the broker listener, both of which have already bitten this
      project. `npm run preflight` now dials this machine's own non-loopback addresses and
      reports what answers; verified live, it prints *"The bridge is not reachable off this
      machine — bound to loopback"*. **WARN, not ERROR**: the deployment works either way, and
      overstating it is how a real error further down the list gets skipped —
      `scripts/preflight.mjs`, `test/preflight.test.mjs`, CLAUDE.md's site facts
- [x] **EX-129** `npm run set-device-ip:pi` — the RM-021 remedy, as a reversible script.
      Gives a `tuya-smart-device` node a static `deviceIp` so the bridge stops depending on a
      discovery broadcast the device has stopped sending. Dry run by default, `--apply` to
      write, `--undo` to clear, like every other script that touches the live flow.
      **The address is resolved at run time** — vendor cloud MAC joined against this host's ARP
      table — and never typed in or committed. That keeps the site's addressing out of a public
      repository, and it is also the only correct version: a written-down address is wrong the
      moment DHCP moves it, and a *stale* one is worse than none, because `find()` short-
      circuits past discovery whenever id and ip are both set. The default target set is
      computed, not hard-coded, because the membership moved twice inside one hour on 2026-08-26
      and a list baked into a script would be wrong by the time it ran.
      `validateDeviceIpPlan` holds the same invariants as `quiescePlan`: node count unchanged,
      nothing added or removed, and the only permitted difference anywhere is `deviceIp` on an
      explicitly named node. These live on the hand-built source tabs where `findTimeout` and
      `tuyaVersion` are the only copy that exists.
      **Its first real use returned a negative result — see RM-021.** The script is kept anyway:
      it is free to try, it is the right first move on a dark-but-on-segment device, and having
      run it is what turned "the remedy we have not tried yet" into a measurement.
      `node-red-bridge/set-device-ip.mjs`, `node-red-bridge/deviceIpPlan.mjs`,
      `test/device-ip-plan.test.mjs`
- [x] **EX-128** (FI-015) The on-segment/absent split is served over HTTP, not only over SSH.
      `GET /api/tuya/presence` joins the vendor cloud's per-device MAC against the host's own
      ARP table — the join that separates **"off the network"** from **"on the network but no
      longer discoverable"**, which is worth a free config change before anybody drives to the
      office. *Worth stating carefully, because this entry originally did not:* on-segment is
      **not** a promise that no visit is needed. It says the cheap remedy is worth trying. See
      RM-021, where trying it on `co5` proved the point by failing.
      It existed only as `npm run tuya:macs`. That was correct and completely unreachable
      without a terminal, and the answer is perishable: the split moved **twice inside one hour**
      on 2026-08-26, with one outlet going `stale` → `absent` between two runs twenty minutes
      apart. A fact that decides whether somebody makes a journey should not cost an SSH session.
      **`arp_readable` is the load-bearing part of the payload.** Unlike `/api/tuya/devices`,
      this route reads the *host's* neighbour table, so it means nothing anywhere but the Pi —
      and `joinMacPresence` fed an empty table marks **every device absent**, which is the
      strongest claim this system makes, from no evidence, rendering on screen as the whole
      fleet having left the network. So an unreadable table is reported as unreadable, and a
      command that exits 0 with nothing to say counts as unreadable too: a host that is not on
      the device segment answers exactly that way, and "I cannot see" must not render as "there
      is nothing there". The frontend re-checks the flag rather than trusting the server to have
      withheld `presence`, and reads a *missing* flag as false.
      **MAC and address never reach the browser.** The join needs both; the page needs neither,
      and together they are a map of the building's network — `tuya-devices.mjs` already
      refuses to print them, and a screenshot of a dashboard travels further than a terminal
      does. `toPublicPresence` copies fields in by allowlist, and a test asserts the real
      payload contains no MAC-shaped and no address-shaped string.
      **Shipped as a conditional note, NOT the per-device column FI-015 asked for, and that is
      the honest limit.** The reply is keyed by vendor device; the registry carries no vendor id
      — `shared/registry.mjs` says so outright, because `mtr_co_yellow` and `mtr_lo_yellow`
      are two logical meters on one physical box. Joining on display name would look right and
      be wrong for precisely the devices hardest to reason about, and EX-028b records this
      project making that exact mistake once already and getting a confident, empty verdict for
      it. So the vendor's names are reported as the vendor's, unjoined and labelled as such.
      **CORRECTION, 2026-08-26 evening: "not soundly possible" was too strong.**
      `server/cloudDispatchConfig.mjs` already carries the join — `vendorIdMapFrom` reads the
      vendor id off each `tuya-smart-device` node in the live flow, and
      `registryIdForNodeName` maps it to a registry id. Crucially it **fails closed**: strict
      regexes for `Light Switch N` and `CON`, and `null` for everything else, so the meters
      and the ACU — the ambiguous cases the paragraph above is really about — are refused
      rather than guessed. That is not the display-name matching EX-028b warns against; it is
      the opposite. A per-device column is therefore available **for the 14 commandable
      devices**, with no claim made for the rest. Left as a follow-up rather than built here.
      The note renders **only when it has something to say**, following the same rule as the
      unstable count in the page header — and EX-028b removed a card from this very page for
      restating what the table already showed. This only ever says what the table cannot.
      *Two tests in this change passed while guarding nothing, and were caught by neutering the
      code rather than by review.* One drove `presenceSplit` with `presence: null`, so its
      groups came out empty whether or not the guard existed. Two more asserted a component
      renders nothing using `waitFor`, which is satisfied by the first render — before the
      request returns, when it renders nothing anyway. **Every "expect nothing" assertion needs
      the subject settled first**, or it answers before the question is asked.
      `server/proxy.mjs`, `server/macPresence.mjs`, `server/tuyaCloud.mjs`,
      `src/lib/devicePresence.ts`, `src/hooks/useDevicePresence.ts`,
      `src/components/devices/SegmentPresenceNote.tsx`
- [x] **EX-127** `npm run test:server` runs on Windows, not only on Linux.
      Both EX-105 tests above spawned a child and handed it a bare absolute path as an ESM
      specifier. On Linux that happens to work; on Windows `C:...` is read as a URL with
      scheme `c:` and the import throws `ERR_UNSUPPORTED_ESM_URL_SCHEME`, so the suite ended
      **309/311 on a workstation and 311/311 on the Pi**.
      *Why that is worth fixing rather than tolerating:* it is RM-022's lesson pointing the
      other way. RM-022 was two tests that passed on a workstation and failed on the Pi; this
      was two that passed on the Pi and failed on a workstation. Either way the suite's answer
      depends on where it ran, which teaches you to discount it — and these two in particular
      guard `TUYA_ACCESS_SECRET`, the credential CLAUDE.md names as the most sensitive here.
      A developer on Windows had two red tests they were expected to know were "just Windows".
      The fix is `pathToFileURL(...).href`, which is the correct ESM specifier on **every**
      platform rather than a Windows special-case — verified 311/311 on both — `server/envHygiene.test.mjs`
- [x] **EX-126** Migration rehearsal kept rather than discarded: every phase file applied in order against a real PostgreSQL 16 in a throwaway container, with the Supabase-provided symbols stubbed, then all six functions driven against seeded data. The guard tests below check intent; this checks that Postgres will actually run the file — `supabase/rehearse.sh`
- [x] **EX-123** Schema guard tests asserting RLS shape per migration — `test/device-config-schema.test.mjs`, `test/phase8-anomalies-schema.test.mjs`, `test/phase9-history-schema.test.mjs`, `test/phase10-archive-schema.test.mjs`, `test/phase11-totals-retention-schema.test.mjs`, `test/phase12-monthly-reports-schema.test.mjs`
- [x] **EX-125** First tests against the proxy's WebSocket relay and against a bridge that hangs rather than refuses — `server/proxy.test.mjs`
- [x] **EX-124** Operational scripts encoding the real workflow — `package.json` (`mock`, `verify:pi`, `deploy:pi`, `ingest`, `build:flow`, `rotate-light-token:pi`, `backup`)

---

## 2. Current roadmap (active execution)

- [x] **RM-008** ~~Apply the three Phase 9 migrations.~~ **Done 2026-08-21.** Applied via the
      Supabase Management API; all four objects confirmed live (`readings_buckets`,
      `roll_up_and_prune_readings`, `readings_hourly`, `commands_complete_own_inflight`),
      PostgREST's schema cache reloaded, and the three daemons restarted onto Phase 9 code.
      Verified end to end against real data: a 7d request now returns 475 buckets whose
      newest point is ~9 minutes behind now, where the same window previously returned 1,000
      raw rows ending four days in the past. Every bucket covering the outage is a gap — 124
      of them, all with zero online samples and null power — while the 24 buckets reading
      746.5 W all predate the outage and all have real online samples, i.e. the meter was
      genuinely drawing that at the time. The over-cap guard raises through PostgREST as
      designed. Retention correctly reports nothing to do: the oldest reading is 2026-08-16,
      inside the 30-day window.

- [x] **RM-009** ~~Apply the three Phase 10-12 migrations and restart the ingest daemon.~~
      **Done 2026-08-22.** Applied by hand in the Supabase SQL editor, schema cache reloaded.
      All four tables answer over the data API and PostgREST advertises all six functions.

      *Rehearsed first:* `supabase/rehearse.sh` applied `schema.sql` and all twelve phase
      files in order against PostgreSQL 16 on the Pi, then drove every function against
      seeded data including the live failure shape — a meter frozen at 746.5 W while offline.
      All assertions passed; the two defects it surfaced were both in the harness, not the
      migrations.

      *Verified against production:* `readings_archive` returns real 6-hourly buckets, and
      every bucket with `online_count: 0` comes back `power_w: null` rather than charting the
      frozen value — the invariant proven on live data, not only in a container. Both
      destructive functions execute as no-ops against a cutoff nothing predates. `anon` gets
      404 on all four new functions and empty results on all three new tables, so the
      revoke-then-grant and the RLS both hold.

      *Daemon restarted onto the new code.* All three retention passes run and each names its
      own table; the report pass runs clean; ingestion resumed at 60s with
      `buffered_row_count: 0`, `last_error: null`, and zero error lines through a soak.

      **Two things this does NOT yet prove**, recorded so they are not assumed:
      1. `readings_hourly` is still empty — nothing is 30 days old, so the first real rollup
         lands around 2026-09-15. The rollup/raw seam that `readings_archive` merges has been
         exercised in the rehearsal but never in production. Worth re-checking then.
      2. The report has never run on a complete month. The first is September's, generated in
         early October.

- [x] **RM-001** ~~Put the Pi back on the same 2.4 GHz network as the field devices.~~
      **Done 2026-08-24, on site.** All four branch meters are online and reporting live,
      changing values; `total_power_w` and `avg_voltage` read real numbers again after four
      days of `null`.

      **The recorded root cause was incomplete, and acting on it alone would not have fixed
      this.** There were two independent faults:

      1. **Network.** The Pi was on the general office SSID (5 GHz, ch 36) — but the decisive fault was
         *client isolation*, not the band: the Pi (`…113`) and a laptop (`…173`) could not ping
         each other **on the same /24**. A band split on a bridged SSID cannot do that. The
         connection timestamps date it precisely — the Pi left the device SSID on Aug 20 at 14:38 and
         the devices dropped at 15:27. Fixed by bringing the saved device-SSID profile back up; the profile and PSK were
         already stored at `autoconnect-priority 30`, so it survives a reboot. The Pi also moved
         off a LAN whose address range accidentally overlapped the tailnet's own CGNAT range.
      2. **Protocol drift — the reason the meters stayed down after the network was fixed.**
         The field devices had moved to Tuya protocol **v3.4/v3.5** while the flow still declared
         3.1/3.3. This is what explains `mtr_co_yellow` dropping on **Aug 17, three days before
         anyone touched the Wi-Fi** — a fact the network theory never accounted for.

      Two live-flow config changes, each backed up first (`flows.json.bak-<ts>` on the Pi):
      - `findTimeout` `1000` -> `10000` ms on all 21 `tuya-smart-device` nodes. Measured: every
        device broadcasts on UDP 6667 every **5.0 s**, so a 1 s discovery window caught one in
        five, by luck. That is what 2,520 discovery timeouts per 30 minutes actually was, and it
        had been latent long before the outage.
      - `tuyaVersion` corrected per node to what each device actually announces: the 4 meters and
        all 7 light switches -> `3.5`, CO1/CO2/CO4/CO7 -> `3.4`. `tuyapi 7.7.1` supports both.

      **Neither change lives in `shared/registry.mjs` or the generated flow** — both are on the
      four hand-built source tabs.
      *Corrected 2026-08-24, after checking rather than assuming.* This first said a flow
      regeneration would revert them. It would not: `deploy.mjs` appends to the live flow
      (`merged = baseFlows.concat(bridgeNodes)`) and removes only bridge-tab nodes, so the source
      tabs survive, and no other script in this repo rewrites tuya node properties. The real
      exposure is quieter — nothing in the repo *declared* these values, so nothing verified
      them, and an old `flows.json` restore or an editor hand-edit would lose them with no diff
      and no alarm while looking exactly like a network fault. Closed by EX-021b.

- [x] **RM-010** ~~Apply `supabase/phase13_device_functions.sql`, then deploy the frontend.~~
      **Done 2026-08-24.** Applied by the operator in the Supabase SQL editor; frontend deployed
      to the Pi at `bd1cbdc` and the kiosk reloaded onto the new bundle.
      *Verified against the real project, not assumed:*
      - the exact select the frontend runs — all six original columns plus `functions` — returns
        200, with `functions: null` on the existing row, i.e. "not configured", which is the
        value that falls through to the class default;
      - the CHECK is live: an invalid element is rejected with `23514`
        (`device_config_functions_valid`) and the row is unchanged afterwards;
      - RLS still holds in both directions on the new column. `anon` SELECT returns `[]`, and an
        `anon` PATCH returns **204** — which is *not* a refusal but PostgREST's "success, nothing
        matched", the exact shape `server/proxy.mjs` already carries a warning about. Re-asking
        with `Prefer: return=representation` returns `[]` (zero rows affected) and a service-role
        read confirms the row unchanged. A 204 alone would not have been evidence.

- [x] **RM-001a** ~~Devices offline that need a physical check.~~ **Closed 2026-08-24.** The
      operator re-paired `co3`, `co5` and `co6` with new device ids and keys; all three now
      announce and report. 19 of 20 devices online.
      *Worth keeping:* they came back reporting `online: true` while their nodes still declared
      `3.1` and the devices announced `3.4` — the same "tolerating a lower version" trap recorded
      in `shared/tuyaNodeSettings.mjs`. Working was not evidence the declaration was right; the
      declarations were corrected to the measured value and those three left the unverified list.

- [x] **RM-015** ~~Apply `supabase/phase15_device_connectivity.sql`.~~ **Done 2026-08-24.**
      Applied and returning real data immediately. **Re-apply it** — the function was amended
      the same day to also return `expected_samples`; see EX-023b.
      *What running it revealed within minutes, which is the point of having built it:*
      the four branch meters sit at **100% uptime with zero transitions**, while every device
      that flaps is an outlet or a switch (30-98%, 2-8 transitions each in one hour). That
      narrows RM-013 considerably — this is not the whole fleet disassociating, it is the ~14
      distributed relays and not the 3 panel-mounted meters, which is the shape a client limit
      or an association problem makes, not the shape a bad radio makes.

- [x] **RM-017** ~~Apply `supabase/phase17_device_categories_sensor.sql`.~~ **Done 2026-08-25.**
      Verified the way RM-014 said to and the way I then failed to twice: the retired `kitchen`
      is refused with `23514` and the row is unchanged, which proves the constraint was replaced
      without writing anything. `server/schemaProbe.mjs` (EX-031b) now encodes both halves of
      that method so the next check does not depend on remembering it.

- [ ] **RM-020** Three of the seven convenience outlets need power cut and restored.
      *Acceptance:* `co4`–`co6` answer locally again, and stay answering for an hour.
      **Population as of 2026-08-26 evening: `co4`, `co5`, `co6` — but for two different
      reasons, which is new.** `co4` and `co6` are absent from the segment outright: no ARP
      entry, not associated to the AP. `co5` **is** associated and answers ARP, and still
      belongs here, because RM-021's software remedy was actually tried on it and failed.
      *This corrects an entry written earlier the same day*, which moved `co5` out of RM-020
      on the strength of its ARP reply alone. The ARP evidence was right; the inference from it
      was not. **Answering ARP proves the device's network layer is alive, not that a Tuya
      session can be established** — see RM-021 for the measurement.
      **Watch how fast this moved, because it is the point of the entry.** Inside a single
      session on 2026-08-26, `tuya:macs` first reported `co4` and `co5` both on the segment
      and only `co6` absent; twenty minutes later `co4` had gone `stale` → `absent` while
      `co5` was still answering. Two runs, two different answers, no intervention. A list of
      devices to power-cycle is a perishable good — **re-run `npm run tuya:macs` immediately
      before the trip**, not the day before.
      *Method note, since `STALE` is easy to misread:* an ARP entry in state `STALE` is a
      cached one the kernel has not confirmed, so it is weaker evidence than `REACHABLE`. The
      way to settle it is to force resolution and watch the transition. `co5` went to
      `REACHABLE` and then decayed back to `STALE` — which is exactly what a device that is
      associated but talking to nobody looks like — while `co7`, used as the positive control,
      held `REACHABLE` throughout because the bridge is actively polling it. `STALE` here is
      a symptom of being undiscoverable, not evidence of being gone.
      **Prior population, 2026-08-26 09:30: `co4`, `co5`, `co6`.** It was six; `co1`–`co3` returned
      once the Pi was moved back to the device network (RM-023), which is a reminder that
      "unreachable" was partly the Pi's own fault and worth ruling out before anyone drives in.
      **NARROWED 2026-08-25 evening, from six devices to two.** The claim below that all six had
      "lost both their inbound local path and their outbound cloud connection" was half right.
      Tuya's `/v1.0/iot-03/devices/factory-infos` returns each device's MAC; matched against the
      Pi's own `ip neigh`, four of the six — `co1`–`co4` — **still resolve**, meaning they
      answered an ARP request and are associated to the AP. Only `co5` and `co6` have no entry
      at all. Same symptom at the bridge, opposite remedies: this entry is now the two that
      genuinely need a person, and `co1`–`co4` moved to **RM-021**.
      The method touches no device and needs no local connection, which matters because probing
      these directly costs their single local connection slot — `npm run tuya:macs`
      (`server/macPresence.mjs`). `co7` was used as the positive control: its MAC resolves to
      the entry its working node uses.
      *The distinction this corrects is the expensive one:* "off the network" sends someone to
      the office; "on the network but not discoverable" is a config change. The cloud view alone
      cannot tell them apart, because a device can lose its *uplink* to Tuya while remaining
      perfectly well associated locally — which is exactly what these four did.
      **NEEDS SOMEONE AT THE OFFICE — power-cycle them.** Measured 2026-08-25: `co1`–`co6`
      read `online: false` **both** locally and in the Tuya cloud, `CO1` logged no successful
      connect in 40 minutes, and each was producing ~27 `find() timed out` entries per five
      minutes. Only `co7` and the seven lights survive.
      **A Node-RED restart was already tried and did NOT recover them.** That distinction is
      the whole content of this entry: the same restart *did* recover `l6` and took the fleet
      from 9/21 to 14/21, so these six are not the stuck-node case (RM-012, and the note now
      in `CLAUDE.md`) — they are the genuine one ADR-002 names, where the device has lost both
      its inbound local path and its outbound cloud connection and **power is the only
      recovery**. Cloud dispatch cannot help; that limitation is stated in RM-018 on purpose.
      Two of them (`co1`, `co3`) were still cloud-reachable ~20 minutes earlier and degraded
      during the session, which is RM-013 doing what RM-013 does. Not caused by the dispatch
      test run against `co1`: `co3` was never commanded and dropped identically.
      *Do not close this by restarting anything.* If they return without a power-cycle, that
      is new information and RM-013 needs it.

- [ ] **RM-021** `co1`–`co4` are on the segment but no longer discoverable.
      *Acceptance:* all four report `online: true` to the bridge and hold it for an hour.
      **No site visit needed — this is the half of RM-020 that has a software path.** All four
      answer ARP, so layer 2 works. What they have stopped doing is broadcasting their Tuya
      discovery datagram, and `find()` is the only way the bridge locates a device. Measured by
      a 40 s passive listen on the discovery ports: exactly 11 broadcasters, which is precisely
      the 12 online logical devices (the dual-channel meter is two logical readers of one
      physical box). None of `co1`–`co6` broadcast at all.
      **The fix the node already supports:** `deviceIp` is a documented property on every
      `tuya-smart-device` node and is **empty on all 19**. It is passed straight into tuyapi
      (`node_modules/node-red-contrib-tuya-smart-device/src/tuya-smart-device.js`), and tuyapi's
      `find()` returns immediately when both id and ip are set (`tuyapi/index.js`, the
      `isValidString(this.device.id) && isValidString(this.device.ip)` short-circuit) — going
      straight to a TCP connect and skipping the broadcast these four no longer send.
      **NOT YET PROVEN, and the gap is honest:** all four had their local port open and stable
      across three probe passes spanning 20 minutes. A key-matching sweep was then run against
      them — up to 18 handshake attempts per address. **These devices accept one local
      connection at a time**, so if the first attempt took the slot the rest tested nothing, and
      the sweep's "no key matched" result was discarded as unsound. Since that sweep all four
      have refused the port for over half an hour while still answering ARP. Whether a local
      session can still be established is therefore **open**, and it is the gate on this entry.
      *Ruled out:* a rotated local key. All 17 keys the cloud can vouch for match the flow
      (`npm run tuya:devices -- --verify-keys`).
      *Next step:* after a cooling-off period, **one** connect attempt per device with the
      correct key, `co7` first as a positive control. No sweeps. If they refuse a clean single
      attempt, this folds back into RM-020 and needs the visit after all.
      *If it succeeds:* the addresses must **not** be committed — this repo is public and
      `live-flow-baseline.json` would be the natural but wrong home for them. Commit the
      mechanism instead: resolve MAC → ARP → `deviceIp` at run time, which is also correct
      across DHCP changes. A DHCP reservation on the AP is the durable version and is an
      operator action.
      **Membership of this entry moves — watch it, do not memorise it.** Over 90 minutes on the
      evening of 2026-08-25 the set went `co1 co2 co3 co4` → `co3 co4`: `co2`'s ARP entry
      expired and it left the segment (becoming RM-020), while `co1` flapped cloud-online,
      offline and online again. Re-run `npm run tuya:macs` before acting; a list written down is
      stale within the hour.
      **A Node-RED restart cannot fix this, and that is measured, not assumed.** The reflex this
      project rightly has — restart before suspecting hardware, which recovered `l6` — does not
      apply, because `find()` can only locate a device that broadcasts. Two independent 40 s
      listens 90 minutes apart heard exactly 11 broadcasters both times, and none of `co1`–`co4`
      was among them, including while `co1` was cloud-ONLINE. Restarting would re-enter the same
      timeout loop.
      **`co3` CAME BACK ON ITS OWN at ~22:45 on 2026-08-25, with no power-cycle, no restart and
      no config change.** RM-020 asked for exactly this to be recorded if it happened. It
      resumed broadcasting (the bridge connected to it six times in the following forty minutes)
      and its local port reopened at the same time. Fleet went 12/21 → 13/21.
      *This revises the session's own conclusion.* The four had their local port open for the
      first 20 minutes, then shut immediately after a key-matching sweep was run against them,
      which looked like the sweep having occupied their single connection slot. `co3` recovering
      spontaneously — untouched for over an hour — points instead at the port tracking the
      device's overall network state: dormant device, no broadcast and no port; awake device,
      both. **The sweep was probably not the cause.** It was still the wrong thing to run, but
      it should not be recorded as the explanation.
      **What this means for the remedy:** these devices cycle back by themselves, so "dark" is
      not a terminal state and the churn is bidirectional. A static `deviceIp` is still the
      right fix — it would have held `co3` through the dormant window instead of losing it for
      hours — but the urgency is lower than a permanently dark device implies.
      **THE REMEDY WAS FINALLY TRIED, ON `co5`, 2026-08-26 — AND IT DID NOT WORK.** This entry
      had proposed `deviceIp` since 2026-08-25 without ever running it. It has now run.
      `co5` qualified on every stated criterion: dark to the vendor cloud, `online: false` to
      the bridge, and answering ARP (confirmed by forcing resolution and watching it reach
      `REACHABLE`, with `co7` as a positive control). It was given a static address resolved
      from ARP at run time. **The mechanism worked exactly as documented and bought nothing:**
      the log shows `findDevice(): Found device, going to connect` — the tuyapi short-circuit
      firing, discovery skipped — and then no connection, for six minutes. Zero successful
      connects; 14 timeouts. The address was correct and useless.
      **So the conclusion this entry was missing: ARP is not reachability.** ARP is answered by
      the device's network layer. A Tuya session needs its application layer, and ADR-002
      describes precisely the state where the second is gone while the first is healthy — an
      ESP device with an exhausted socket table. `deviceIp` cures a device that has stopped
      *broadcasting*; it does nothing for one that has stopped *listening*, and from the
      bridge's side those look identical. **`co5` folds back into RM-020**, exactly as this
      entry's own next-step said it should if a clean attempt was refused.
      **The change was reverted, and the reason is worth keeping.** A static address is not
      inert once it is wrong: `find()` short-circuits past discovery whenever id and ip are
      both set, so after the power-cycle that `co5` actually needs, a stale address would send
      every attempt to whatever now holds that lease — and the symptom would be the outlet
      staying dark *after* someone drove to the office to fix it, which is the worst available
      outcome. **A `deviceIp` is only as good as the moment it was resolved. Clear it or
      re-resolve it after any power-cycle.** The live flow was confirmed byte-identical to its
      pre-change backup afterwards, with all 19 nodes' `findTimeout` and `tuyaVersion` intact.
      **The mechanism is committed even though the outcome was negative** — EX-129,
      `npm run set-device-ip:pi`, dry-run by default and reversible. It resolves the address at
      run time from cloud MAC joined against ARP, so no address is ever written into this public
      repository and the value cannot go stale in a file. It is still the right first thing to
      try on the next device that is dark-but-on-segment, because it is free; it is simply no
      longer allowed to be described as a fix.
      *Earlier that same day:* **RESOLVED WITHOUT THE REMEDY, 2026-08-26 (morning).** `co1`,
      `co2` and `co3` are all online and on
      the segment; `co4`–`co6` were absent outright and were RM-020. Nothing was in this entry's
      state at that moment, and the static `deviceIp` has still never been applied.
      *What actually fixed it was RM-023* — returning the Pi to the device network. That is the
      uncomfortable part worth keeping: a night was spent characterising these devices as
      half-dead, and the AP outage the next morning reset them cleanly while stranding the Pi
      on the wrong SSID. **Rule out the Pi's own network before diagnosing the fleet's.**
      `npm run tuya:macs` answers that in one command and touches nothing.
      Leave this entry open: the condition is real, it recurs, and the `deviceIp` remedy is
      still the right one if a device sits on the segment and refuses to be discovered.

- [x] **RM-022** ~~Importing a route module loads every secret in `server/.env` into the
      process.~~ **Done 2026-08-25.** `npm run test:server` is now **299/299 on the Pi** — it
      was 290/295 there and fully green on a workstation, which is the shape of the bug.
      *Fix:* deleted the module-scope `loadDotEnv` from `server/enrollRoute.mjs` and
      `server/removeRoute.mjs`. Nothing replaced it and nothing needed to: the systemd unit
      already carries `EnvironmentFile=…/server/.env` (verified in the running process — five of
      five key variables present after a restart), and the two CLIs
      (`node-red-bridge/enroll-device.mjs`, `remove-device.mjs`) already load it themselves.
      The route modules read `process.env` lazily inside their handlers, so nothing observed the
      value at import time anyway — the call was pure side effect.
      *Guard:* `server/envHygiene.test.mjs`, in two halves on purpose. A behavioural half imports
      each route module in a clean child process and asserts it added no environment keys; a
      source half asserts no route module calls `loadDotEnv` at module scope. The behavioural
      half alone would be **asleep exactly where it matters least** — on a checkout with no
      `server/.env`, `loadDotEnv` is a silent no-op and the assertion passes vacuously. A third
      test pins the deployment assumption the fix rests on: if the unit ever loses its
      `EnvironmentFile`, the proxy starts with no credentials and fails as "the vendor cloud
      could not be reached", a wrong diagnosis this project has chased before.
      All three were confirmed to fail before the fix and pass after.
      *Verified beyond the suite:* proxy restarted and serving, `/api/tuya/devices`,
      `/api/enroll` and `/api/remove` all still gated at 401 rather than crashing, zero errors in
      the journal, and both CLIs still reach the vendor cloud —
      `server/enrollRoute.mjs`, `server/removeRoute.mjs`, `server/envHygiene.test.mjs`
      *What it was.* `server/enrollRoute.mjs` and `server/removeRoute.mjs` both called
      `loadDotEnv(...)` at module top level, so merely `import`ing one populated `process.env` with `TUYA_ACCESS_SECRET`,
      `SUPABASE_SERVICE_ROLE_KEY`, `BREAK_GLASS_PASSWORD_HASH`, `HARDWARE_DISPATCH_ENABLED` and
      the rest. `server/proxy.mjs` imports both, so this fires on every proxy start and in every
      test that spawns one. Demonstrated by importing `enrollRoute.mjs` alone and diffing
      `process.env` before and after — five secrets appear, with no function called.
      **Two consequences, and the second is the one that will cost time.**
      *Credential reach:* `CLAUDE.md` names `TUYA_ACCESS_SECRET` the most sensitive value in this
      system, ahead of the service-role key, because it reaches hardware directly and no RLS
      scopes it. An import should not be what loads it.
      *A suite that cannot pass where it matters:* **5 of 295 server tests fail on the Pi and
      pass on a workstation** — the tests that construct an unconfigured deployment
      (`/api/tuya/devices` → 501, `HARDWARE_DISPATCH_ENABLED` false by default, the gate-closed
      dispatch pair) get the Pi's *real* configuration instead of the empty one they set up.
      Confirmed pre-existing at a clean `HEAD`, so it is not a regression from this session.
      This is worse than a plain failure: the Pi is exactly where `docs/pi-session-brief.md`
      says to run the suite before deploying, so it trains you to accept five red tests, and the
      next real regression hides among them. This project already has "a green test suite is not
      proof" written down; this is the mirror image, and it is louder.
      *Fix direction:* load `.env` in the entrypoints (`proxy.mjs`, `ingest.mjs`, `scheduler.mjs`
      and the CLIs, which already do it) and never in an imported route module. Then assert the
      absence: a test that imports a route module and checks `process.env` is unchanged.

- [x] **RM-023** ~~The Pi falls back to the office SSID and never comes back.~~ **Fixed
      2026-08-26** by EX-106.
      **Observed, not theorised.** At 08:20:47 the device AP dropped the Pi's DHCP lease. At
      08:21:03 NetworkManager failed the connection (`link timed out`, reason `ssid-not-found`)
      and two seconds later auto-activated the general office SSID — which is 5 GHz. The device
      AP was back on the air within the hour at full signal, and **the Pi stayed on the office
      network anyway**. `autoconnect-priority` does not prevent this: it chooses among
      candidates at activation time and never roams away from a connection that works. Left
      alone it would have sat there indefinitely.
      *Cost while it lasted:* every field device unreachable — a discovery listen on the office
      subnet heard **zero** Tuya broadcasters — while the Pi kept internet, Tailscale and a
      working dashboard. Exactly the failure `CLAUDE.md` describes, arriving on its own rather
      than because anyone touched the config.
      *Why the fallback was kept rather than removed:* it is what preserved remote access during
      the outage. Deleting it would trade a recoverable problem for an unrecoverable one — a Pi
      with no uplink and nobody on site. The fix is to leave the fallback automatically once the
      preferred network returns, not to forbid it.
      *Recovery, for the record:* moving the Pi back took the fleet from a true 0/21 to **15/21**
      — the best reading in days. `co1`, `co2` and `co3` all returned, `co2` having been off the
      segment entirely the night before. The AP outage appears to have helped the devices, which
      re-associated cleanly on its return; the Pi was the only thing that did not.

- [x] **RM-024** ~~A half-open tuya session reports `online: true` with frozen readings.~~
      **Fixed and deployed 2026-08-26.**
      *The fix, in two halves.* `buildLatest` now derives when a metered device last actually
      reported, and (a) stamps `ts` with that instead of `now`, which re-arms the staleness
      watchdog that could previously never fire, and (b) drops `online` to false once that
      exceeds `STALE_READING_MS`. The energy tab writes no timestamp of any kind, so a new
      generated bridge step (`Track meter arrivals`) supplies one for those four meters; the
      outlet tab's own stamp is preferred where it exists.
      **The part that had to be measured, not reasoned.** The obvious rule — "the numbers
      stopped moving, so it is dead" — is WRONG here, and shipping it would have subtracted
      healthy circuits from the building totals. `mtr_lo_yellow` and `mtr_co_yellow` are two
      channels of ONE physical meter: over ten minutes the first sat byte-identical at 0 W while
      the second swung between 215 V and 229 V. Confirmed after deployment, where both read
      arrival ages of 3-44 s: they are reporting, their values are simply constant. So the
      signal is **arrival**, taken from the sample buffers that fill on every message regardless
      of whether the measurement changed.
      *Threshold* is ten minutes: measured, an online outlet's arrival stamp lagged up to 59 s
      and the energy tab drains its buffers on a five-minute cycle. Erring short is the
      dangerous direction — `online: false` removes a device from the totals.
      *Verified live:* fleet held at 15/21 across the deploy with no meter falsely dropping out,
      and timestamps now vary with real arrival instead of reading 0 s forever.
      Each of the four guards was confirmed to fail the suite when neutered —
      `shared/buildLatest.mjs`, `node-red-bridge/build-flow.mjs`, `test/reading-freshness.test.mjs`
      *What it was, found 2026-08-26 while diagnosing RM-023 and the reason that took as long
      as it did.* With the Pi on the wrong subnet and **no** device reachable, the bridge reported
      three meters as `online: true` carrying plausible wattage. The values were frozen — byte
      for byte identical across samples 25 seconds apart, for over half an hour:

      ```
      09:00:51  co_yellow=1214.4W/220.2V   arec_acu=595.5W/219.5V
      09:01:41  co_yellow=1214.4W/220.2V   arec_acu=595.5W/219.5V
      ```

      Two independent faults stack, and either alone would have been caught:
      1. The Pi's address changed out from under established TCP sessions, so no FIN was ever
         sent. The tuya nodes still believe they are connected and nothing disproves it.
      2. `shared/buildLatest.mjs` stamps `ts = now` unless the device reports its own time, so
         **the timestamp is synthesized and the staleness watchdog can never fire** on these
         rows. EX-029b already established that an offline device's timestamp is not evidence of
         anything; this is the same fact biting from the other side, where the device is not
         even marked offline.
      *Why it matters more than a cosmetic bug:* this is a dashboard stating, confidently and
      with units, that a building's circuits are drawing power it cannot actually observe. Every
      other honesty guard in this project (EX-029b, EX-102, the `—` never-0 rule) exists to stop
      exactly that, and they are all downstream of an `online` flag that was wrong.
      *Fix direction:* do not infer liveness from socket state alone. Either require a reading
      to have advanced within N poll intervals before reporting `online`, or have the tuya nodes
      apply a TCP keepalive short enough to notice a dead peer. The second is the real fix; the
      first is the cheap guard and is testable without hardware.

- [x] **RM-025** ~~`server/scheduler.test.mjs` fails intermittently when the Pi is busy.~~
      **Fixed 2026-08-26.** Verified against the acceptance criterion rather than by re-running
      until green: with six CPU burners pushing load to **13.2 on 4 cores** — roughly double the
      6-7 that used to break it — the server suite passed **311/311 three times consecutively**.
      *Cause:* every test spawned the real daemon, slept a fixed 2500 ms, killed it and
      asserted. Under load the daemon had not finished a cycle yet, so the assertion ran against
      a process that had done nothing. Lengthening the sleep only moves the load at which it
      breaks and makes every run pay for the worst case.
      *Fix:* wait for the OUTCOME, not for a duration. Each test now states the condition it
      actually cares about and stops the moment it holds; the timeout is a failure ceiling,
      never a wait. The suite got **faster** as a result — this file went from ~42 s of pure
      sleeping to 19 s.
      *The part that needed a production change:* a test asserting that nothing happened cannot
      poll for an outcome. The daemon now logs `first cycle complete` once, after its first
      completed tick, which is the only load-independent way to tell "it ran and did nothing"
      from "it had not got round to it yet". That line is worth having on the Pi regardless —
      "started" and "actually running its loop" are different claims, and only the second means
      a due schedule would have fired.
      *A second race, also closed:* `dueNowRow` pins a schedule to the minute the ROW is built
      in while the daemon judges due-ness by the minute its tick runs in. Built at HH:MM:59 the
      two disagree. Tests that need a due-now row now wait for enough of the minute to remain.
      **It also repaired a test that never tested its claim.** `does not fire the same minute
      twice, even though it checks more often than once a minute` waited 4 s against a 15 s
      loop, so exactly ONE tick ever ran and the guard was never exercised. Proven both ways:
      with the guard deleted it passed under the old timing and fails under the new. The tick
      interval is now tunable via `SCHEDULE_TICK_MS`, symmetric with the existing
      `SCHEDULE_REFRESH_MS`, so the test drives a dozen cycles in a fraction of the old runtime.
      `server/scheduler.mjs`, `server/scheduler.test.mjs`
      *What it was.* Measured 2026-08-26, with load pushed to ~6-7 on 4 cores by running the
      suite back to back. At low load: 299/299, repeatedly. At high load, roughly one run in two fails — and a
      **different** test each time (`does not fire the same minute twice`, `a due schedule is NOT
      dispatched when its audit row cannot be written`, `the audit row is attributed to whoever
      saved the schedule`, `with the gate closed a due schedule is audited as dry_run`). Never a
      test outside this file.
      Confirmed **not** caused by adding a test file: an extra file of twelve trivial tests did
      not reproduce it, and removing the new file did not prevent it. It is the load.
      *Why it is worth an entry rather than a shrug:* this is RM-022's lesson again. A suite that
      is green when the machine is idle and red when it is busy teaches you to re-run until it
      passes, which is indistinguishable from ignoring it — and the Pi is busy exactly when
      something is wrong and you most need the suite to mean something.
      *Likely cause:* these tests spawn real processes and wait on wall-clock minute boundaries;
      under load the process does not get scheduled inside the window they assume. Fix direction
      is to inject the clock rather than to lengthen the timeouts, which only moves the load at
      which it breaks.

- [ ] **RM-026** Deye solar inverter: read generation into the same store as everything else.
      *Acceptance:* inverter power and daily yield appear in `/api/readings/latest` and in
      Supabase alongside the meters, on the same cadence, with the same honesty rules.
      **VERIFIED STATE 2026-08-26 — the hardware is not on the network, so nothing can be
      built yet.** Checks, all negative:
      the configured address is in the logger stick's own **AP-mode subnet**, which has no route
      from the Pi and times out at the gateway; a sweep of the whole device subnet found **no
      host listening on the Solarman TCP port**; and a standard UDP logger-discovery broadcast
      drew **no reply** (only the Pi's own packet echoing back). ARP shows nothing on the segment
      but Tuya devices and the router.
      *(An earlier version of this line said "AP-mode **default**". The address is in that
      subnet but is not the vendor's default host — a small thing, but the difference between
      "nobody ever configured it" and "it was configured while the stick was in AP mode".)*
      **RE-VERIFIED 2026-08-26 evening, remotely, and still absent.** The re-check is worth
      more than the first one because it replaced a sweep with a **census**: every neighbour on
      the device subnet was forced to resolve, then each MAC was diffed against the cloud's own
      per-device MAC list. **Exactly one host on the segment is not a Tuya device: the router.**
      That is a stronger statement than "the Solarman port is closed" — it says there is no
      unaccounted host for the logger to *be*. The UDP discovery broadcast was repeated to both
      the subnet and global broadcast addresses; every datagram received was the Pi's own probe
      echoing back, and there were **zero genuine replies**.
      **Also checked, and worth recording because it closes a door somebody will otherwise try:
      there are no Solarman credentials** in `.env` or `server/.env`. So the vendor-cloud
      route is not quietly available as a way around the network problem — it would need
      credentials the operator has not provided, and it would trade a local read for a
      dependency on someone else's uptime.
      **What already exists**, and it is less than it looks: `node-red-contrib-solarman-devices`
      is installed, and the live flow has a `Deye Solar Inverter` tab containing **one node** —
      a `solarman-register` wired to nothing — plus a `solarman-device` config node holding the
      serial number and that unreachable address. No data path, no context keys, no registry
      entry, nothing in this repository. Treat it as a placeholder, not a partial build.
      **The prerequisite is an operator action, not a coding task:** join the logger stick to
      the device SSID (it is 2.4 GHz-only, like everything else here) and confirm it takes a
      DHCP lease on that subnet. Until `npm run tuya:macs`-style evidence shows it present,
      every integration shape below is untestable.
      **Then choose the shape — the two are genuinely different, and the second is not obviously
      better despite being what was asked for:**
      *(a) Direct, in Node-RED.* Use the installed `solarman-devices` nodes to poll the logger
      over its TCP port and write context keys the bridge collector already knows how to read.
      Follows the existing pattern exactly — one more collector, one more registry entry, and
      `buildLatest` treats it like any other meter, including the freshness rules from EX-107.
      No new moving parts, no new failure mode, and it is the only shape where the inverter
      appears in building totals without further work.
      *(b) Via MQTT.* A separate poller publishes to the Mosquitto broker already running on the
      Pi, and Node-RED subscribes. This is the shape the operator described. It adds a process
      to supervise and a broker to depend on, and the broker's current record is not encouraging
      — the only other thing that ever published to it (RM-005) has been silent for days and
      nobody noticed, because nothing watches it. **If (b) is chosen, a liveness check on the
      MQTT topic is part of the work, not an extra.**
      **DECIDED 2026-08-26 evening: (b), MQTT — reversing the recommendation above.** The
      entry recommended (a), and so did I when asked earlier the same day. The operator pushed
      back with a specific proposal — a pre-built local Solarman-to-MQTT bridge — and the
      evidence supports them rather than the entry. Four reasons, in order of weight:
      1. **The register map is the hard part, and it is already solved.**
         `kbialek/deye-inverter-mqtt` supports **`sun-5k-sg03lp1` by name**, across five
         metric groups (`deye_sg03lp1`, `deye_hybrid_battery`, `deye_hybrid_bms`,
         `deye_hybrid_timeofuse`, `settings`). Hand-modelling a hybrid inverter's battery,
         BMS and time-of-use registers on the `solarman-devices` nodes is exactly the work
         (a) was quietly assuming away.
      2. **There is a model-specific quirk that would have cost a day.** This inverter times
         out when asked for more than roughly 16 registers at once; the bridge exposes
         `DEYE_LOGGER_MAX_REG_RANGE_LENGTH` for it. Under (a) that surfaces as intermittent
         read failures, which read as a network fault — this project's most expensive failure
         shape, and one it has now paid for several times.
      3. **The liveness condition this entry attached to (b) is already met.** The bridge
         publishes `status` and `logger_status` topics of its own, so the check is a
         subscription rather than something to build. That was the main argument against (b).
      4. **Port ambiguity becomes configuration rather than diagnosis.** The stick may speak
         TCP on 8899, the AT protocol on 48899, or Modbus/TCP on 502 — newer SG03LP1 loggers
         ship with **8899 closed** — and the bridge selects with `DEYE_LOGGER_PROTOCOL`.
      *What (a) still had going for it, and what it costs to give up:* it is the only shape
      where the inverter reaches building totals with no further work, and it adds no process
      to supervise. Under (b) that plumbing is a subscriber plus a registry entry, and the
      broker becomes a dependency. Worth it, given 1 and 2.
      **The Pi is ready: Docker 29.7.2 (aarch64), Mosquitto active on 1883, ~5.5 GB RAM free.**
      **TWO THINGS TO SETTLE BEFORE THE BRIDGE IS INTRODUCED, one of them security:**
      - **DONE 2026-08-26 — the broker is locked down (EX-131).** It ran `allow_anonymous true`
        on 1883 and 9001 across every interface, on the device network, while the bridge is able
        to **write** to the inverter (active power regulation, battery parameters, time-of-use)
        behind its `DEYE_FEATURE_*` flags — so anything on that SSID could have commanded the
        inverter. It is now loopback-only. **Two consequences for this work:** keep every
        `DEYE_FEATURE_*` write flag **off**, and **run the container with host networking**,
        because a container on a default bridge network can no longer reach the broker. If a
        non-host network is genuinely needed, add a listener bound to the LAN address *with a
        `password_file`* — do not widen the loopback listener.
      - The broker still carries **zero traffic** (re-checked 2026-08-26), so no MQTT path in
        this system has ever been proven end to end. The first thing the bridge does is also
        the first real test of Node-RED's subscriber.
      **Do not put the serial number, the logger's address, or its password in this repository.**
      They belong in `server/.env` or the Node-RED credential store, like every other secret.

- [ ] **RM-013** Devices leave the 2.4 GHz network and rejoin.
      *Acceptance:* the AP holds one channel, and the announcing-host count stays at the full
      device count for an hour.
      **CONFIRMED cause — the access point re-selects its channel.** Observed 2026-08-25: the
      same BSSID (`…:36`) was on **channel 9**, and ~40 minutes later on **channel 11**. A
      channel change disassociates every client at once, which is exactly the clean, fleet-wide,
      binary dropping seen here and independently by Tuya's cloud. Auto-channel selection is on
      and should be pinned.
      **CORRECTION to what this entry said earlier.** It asserted a 20-client association limit
      as the cause. That was inferred from a single snapshot showing exactly 20 hosts — a round
      number is suggestive, not evidence, and I stated it with more confidence than one
      observation supports. The channel change is *directly observed*, so it now leads. A client
      cap may still contribute (a laptop on this SSID was evicted outright while devices were
      dropping), but it is a hypothesis and the channel hop is a fact.
      *Also ruled out by measurement:* airtime congestion (12-16% utilisation), signal (-46 to
      -48 dBm at the Pi, 95% at a laptop), encryption (WPA2/CCMP, not mixed WPA1/TKIP), local
      keys (all 19 verified against the cloud), protocol versions, and discovery timeout.
      **The fix is on the access point:** pin the channel (1, 6 or 11 — non-overlapping; it is
      already on 11), disable auto-channel selection, and raise the client limit above 30 while
      in there. Telnet (23) is also open alongside SSH on a network whose dispatch gate is live.

      *Channel pinned to 11 by the operator, 2026-08-25 ~08:45.* The AP has held 2462 MHz
      through every sample since, so that half is done. Devices bounced to 2/20 on apply (every
      client is disassociated when wireless config is applied) and had recovered to 8/20 within
      ten minutes. **Too early to judge** — the honest test is whether the announcing count
      holds over an hour, not whether it recovers.
      *The firmware exposes no client-limit setting*, so that lever is unavailable. If drops
      persist once settled, the next things to look for are an **idle/inactivity timeout** (many
      APs deauthenticate quiet clients, and metering devices that report on change are exactly
      that), WMM power-save, and airtime fairness. Failing those, a second AP.
      *Correction worth carrying:* an earlier note here claimed client isolation on the office
      SSID. That rested on the Pi being unable to ping a Windows laptop, which Windows Firewall
      alone explains — see CLAUDE.md. On the device SSID the Pi resolves other clients by ARP
      and reaches them, so there is no isolation.
      *Limitation of the cloud diagnostic, found while using it:* Tuya's online state is not
      instantaneous, so soon after a mass disassociation it can still report devices as up. The
      signal to trust is the set of offline devices **changing between runs** — which it did
      here, confirming genuine flapping rather than a stale snapshot.
      **Outcome measured an hour after the pin, 2026-08-25 09:48.** The pin worked, partially:
      the AP has held 2462 MHz throughout, discovery errors fell roughly 3x (270 per 10 min
      against ~840 before), and the online count is now **stable at 8/20 rather than rotating**.
      Stable-and-low is a different fault from flapping, and the change is real.
      **But 7 devices did not come back: `CO4-CO7` and `Light Switch 5-7`, offline to Tuya as
      well as to the bridge.** Contiguous ranges, and unreachable by either path — which is
      precisely the total-hang case RM-018's cloud fallback explicitly cannot recover. They need
      power cycling. Applying wireless config disassociates every client, and these are the ones
      that hung rather than rejoined.
      *So the remaining question splits in two:* whether the channel pin holds the fleet stable
      once those 7 are power-cycled back (the real test), and separately why a bounce hangs
      devices at all — which is socket pressure, and is what RM-018's second half addresses.
- [ ] **RM-018** Devices hang: the relay stops responding to local commands and the physical
      button does nothing, recoverable only by removing power. Seventeen devices across an
      office makes that a walk to a breaker per incident.
      *Acceptance:* a hung device can be recovered without cutting its supply.
      **FIRST, RESTART NODE-RED — it is free and it is not always the device (2026-08-25).**
      `l6` had been diagnosed the previous day as physically unreachable: `EHOSTUNREACH` at
      every protocol version, ARP `FAILED`, written up as RF range or a stale address and
      "needs eyes on the fixture". `sudo systemctl restart nodered` reconnected it in two
      seconds, and the operator then toggled the real fixture successfully. The same restart
      took the fleet from 9/21 to 14/21 online. A tuya node that has given up stays given up,
      and its symptoms are indistinguishable from a device that is out of range or unplugged —
      so a walk to the breaker can be a walk taken for a software fault. Restart first, then
      cut power only if the device is still dark. See RM-012.
      **Analysed in `docs/adr-002-device-recovery-path.md`.** A Tuya device holds two
      independent paths — inbound local TCP, and an outbound connection it keeps open to Tuya —
      and they fail separately. An ESP device with an exhausted socket table is unreachable
      locally while its cloud connection stays healthy, which is exactly "hung here, fine in the
      app". Measured support: two nodes hold two sessions to each of the two shared meters (16
      sessions for 14 devices), discovery hammered them at 2,520 failed attempts per 30 min
      before `findTimeout` was fixed, and Tuya currently reports ~12 online against the bridge's
      ~8.
      **Built, and as of 2026-08-25 actually reachable — it was not before.** Local stays
      primary (faster, works without internet, no vendor in the loop); cloud is the path that
      exists precisely when local has failed, and the audit row records `via` so a command
      that only survived through the cloud is visible as the warning it is.

      **It had never once fired, for two independent reasons, both silent.**
      *1. Local never reported failure.* `dispatchLocal` decided success on HTTP 2xx, but the
      Node-RED endpoint answers as soon as it ACCEPTS the message — the tuya node then fails
      asynchronously, after the response has gone. Commanding `co1` returned
      `{ok:true, via:"local"}` in 209 ms while Node-RED logged `Device not connected. Can't
      send the SET commmand` at the same instant. So the operator was told a command worked
      when it had not, AND the cloud branch below it was unreachable dead code.
      *2. Cloud dispatch could not authenticate.* `dispatchCloud.mjs` called `client.call()`
      directly while every other consumer called `ensureToken()` first, so it failed with
      `code 1010: token invalid`. Intermittent rather than dead, which is worse: a token
      warmed by an earlier call in the long-running proxy made it work, so it would pass a
      casual test and fail during a real incident.

      Fixed: `call()` now obtains its own token (at the source, so the next caller cannot
      repeat it), and `dispatchCommand` asks the bridge whether the device is online before
      attempting local — offline means a local SET cannot land, so it falls through to cloud
      rather than fabricating a success. An unknown answer is deliberately NOT treated as
      offline: a readings endpoint that hiccups must not reroute every command through the
      vendor.
      **Verified on real hardware:** cloud dispatch to `co1` — locally unreachable, cloud
      online — returned `{ok:true}` in 972 ms. That is the acceptance met: a device that
      cannot be reached locally was commanded without cutting its supply.
      `server/dispatchLight.mjs`, `server/dispatchCloud.mjs`, `server/tuyaCloud.mjs`,
      `server/proxy.mjs`
      **What it will not fix, so nobody expects otherwise:** a device with no cloud connection
      either (what Tuya reporting `offline` means) is reachable by neither path, and power
      remains the only recovery. This converts the common failure into a non-event, not the
      total one.
      *Caveat found while testing:* `GET /v1.0/devices/{id}/status` returns last-known values
      for an offline device rather than failing, so a successful status read is **not** proof of
      reachability. Trust the `online` flag; a command is the only real test.
      *Worth doing regardless:* collapse the two shared meters to one local session each (which
      would also make RM-019's channel interchange impossible by construction, since both
      channels would come from one atomic read), and back off failed discovery.
- [x] **RM-019** ~~The shared dual-channel meter swaps its two channels.~~ **Closed by
      construction 2026-08-25.** The two yellow channels used to arrive on two separate
      sessions, which is what allowed them to disagree about which snapshot they came from.
      EX-037b collapsed those to one session, so both parsers now read the *same message* and
      there is no ordering left for them to get wrong.
      *The detector stays* (`npm run check:meters`). It cost little and it is the only thing
      that would notice if this returned by some route nobody predicted — and the confirmed
      event on 2026-08-25 at 00:13 is exactly the kind of thing that is easy to stop believing
      once it stops happening.

- [ ] **RM-016** Two flow nodes reference devices that are not in the Tuya cloud project.
      *Acceptance:* each is re-paired into the project, or removed from the flow and registry.
      **Resolution chosen 2026-08-25: leave them, quiesce them.** Re-pairing needs the physical
      devices and the Smart Life account, so it stays with the operator; removal was declined
      because `acu_main` reads the same `ac_dash_state` and would lose its temperatures too.
      The retry noise is stopped with `npm run quiesce:pi` (EX-098), and both devices now read
      honestly as offline rather than a fabricated ONLINE (EX-097). Re-pairing later is a
      `--undo` away. This stays open because the devices still cannot report.
      `NBRIC IR Blaster` and `Outside Temp` came back **NOT IN PROJECT** from
      `npm run tuya:devices`. They can never work — the ids in the flow belong to no device this
      account can see, which is why they have never announced and never will. Either they were
      removed from the Smart Life account, or they belong to a different one.
      This is also why `sens_outside_temp` has no real telemetry: `acu_main` and
      `sens_outside_temp` both read `ac_dash_state`, which the IR blaster feeds.

- [ ] **RM-012** `l6` (Light Switch 6) was a one-way link. **Reachable and controllable again
      2026-08-25 — recovered by a Node-RED restart, with nobody touching the fixture.**
      *Acceptance:* `ip neigh` resolves its address, and it stays online across an hour.
      *Remaining:* only the one-hour stability window. Reachability is no longer in question.

      **This overturns the 2026-08-24 diagnosis, and that matters more than the device.** It
      was recorded as not a configuration fault: discovery broadcasts arrived, but a direct
      probe returned `EHOSTUNREACH …:6668` at *every* protocol version and its address showed
      `FAILED` in the ARP table, so the conclusion was RF range, a power-save state or a stale
      address — "needs eyes on the fixture". No one ever went. Restarting Node-RED on
      2026-08-25 produced, within two seconds, `findDevice(): Found device, going to connect`
      then `Connected to device! name : Light Switch 6`; three commands then dispatched `-> OK`
      and the operator confirmed the physical fixture switching. Evidence of a live TCP session
      to :6668 is strictly stronger than the ARP resolution the acceptance asks for, which was
      only ever a proxy for reachability.

      **So the fault was node-side session state, not RF.** A tuya node that has given up stays
      given up: the retry loop keeps calling `findDevice()` against a socket that will never
      recover, and the symptom — permanent `EHOSTUNREACH`, ARP `FAILED` — is indistinguishable
      from a device that is out of range or unplugged. That is why a day of it read as a
      hardware problem.
      **Try `sudo systemctl restart nodered` BEFORE power-cycling anything** (see RM-018, where
      cutting power to each device was the assumed remedy). The same restart took the fleet
      from 9/21 to 14/21 online, so `l6` was not the only device stuck this way.
      Not yet a general rule: one restart, one observation. If a device is still dark after a
      restart, the hardware suspicion is back on.

- [x] **RM-011** ~~The `ACU` node is a second session to the `AREC ACU` branch meter.~~
      **Withdrawn 2026-08-24 — this was a wrong finding, corrected by the operator.** `ACU` and
      `AREC ACU` share a device id and local key **by design**: the aircon is the only load on
      the CARE ACU branch, so the meter measuring that branch is measuring the aircon. Two
      logical devices on one physical meter — the same arrangement `shared/registry.mjs` already
      documents for `mtr_co_yellow`/`mtr_lo_yellow`. The wiring says so plainly and I did not
      read it closely enough before filing: `AREC ACU` feeds the **Unified** parser (live
      V/A/W), `ACU` feeds the **Daily** parser (accumulated energy). Different purposes, one
      device.
      *The one real defect inside the false finding, now fixed:* `ACU` declared protocol `3.3`
      while that device announces `3.5`, which is why it alone logged 39 discovery timeouts in
      ten minutes. Matched to `AREC ACU`, and it has left the unverified list — its version is
      measured, because it is the same physical device.
      *Worth keeping:* "two nodes share a device id" is a normal shape here, not a smell. The
      question to ask is whether the wiring shows two purposes or one duplicated.

- [x] **RM-014** ~~Apply `supabase/phase14_device_categories.sql`, then deploy the frontend.~~
      **Done 2026-08-24.** Applied by the operator; the frontend was already deployed.
      Verified in both directions against the real project: `branch_circuit` is accepted, and
      the retired `hvac` is rejected with `23514`, leaving the row unchanged.
      *Method note worth keeping:* the first check wrote a valid new value to a production row
      to see whether it was accepted, which mutated real data to answer a question. The
      non-destructive form is to attempt a value the **new** constraint rejects — a failed write
      proves which constraint is active and leaves nothing behind. The row was restored.

- [x] **RM-002** ~~Verify the rotated light token against a real fixture.~~ **Done 2026-08-24,
      on site.** A light physically changed state from the dashboard, observed by the operator.
- [x] **RM-003** ~~Open the hardware-dispatch gate and confirm a real relay responds.~~
      **Done 2026-08-24, on site.** `HARDWARE_DISPATCH_ENABLED=true`, proxy restarted (it starts
      only if the token is present, so a clean start is itself evidence), and switches were
      toggled against real fixtures successfully. The first commands in this project's history to
      move real hardware.
      **Note the scope is wider than this entry originally claimed.** It said outlets and the ACU
      would still read `dry_run`; `server/dispatchLight.mjs` has listed
      `['switch','outlet_dual','acu_ir']` since `c287e4c`, so opening the gate made all three
      live at once. The Control page's "Outlets off" master now genuinely cuts every socket.
- [ ] **RM-004** Re-check anomaly detection for false positives once real telemetry resumes.
      *Acceptance:* a week of live-varying data with no unexplained alerts on the cyclical-load branch meters. The current zero-alert result is not evidence — the meters have been returning frozen values.
- [x] **RM-005** ~~Decide whether Mosquitto is still load-bearing or can be decommissioned.~~
      **Answered 2026-08-24.** RM-001 removed the one thing that explained the silence — the
      ESP32 is 2.4 GHz and the site was on 5 GHz — so the question is finally answerable, and the
      answer is that **nothing publishes.**
      - 90 s subscribed to `#` (every topic): zero messages.
      - `ss` on :1883: one client, Node-RED, over loopback. Nothing external is connected.
      - Of the 17 hosts now reachable on the LAN, 15 announce as Tuya devices and the other two
        are the gateway and a randomised-MAC host with no open ports — no ESP32-shaped host.
      What remains is one `mqtt in` node, "ESP32 AC Sniffer" on `nbric/ac/status` (Aircon tab),
      plus the `mqtt-broker` config node.
      **Deliberately not claimed:** that nothing has *ever* connected. The journal only reaches
      back ~20 h and holds a single mosquitto line with no connection entries, so it is not
      logging connections and proves nothing either way. The live evidence above is the whole
      basis for this answer.
      *Decommissioning is one action, not two:* removing the broker without also removing that
      `mqtt in` node leaves Node-RED logging a connection failure on every start. Low-risk to
      leave in place; the cost is only that Phase P would otherwise document "install Mosquitto"
      as a real step for a second building, which is the thing worth avoiding.
- [x] **RM-006** ~~Data retention: automatic cleanup so `readings` does not grow without bound.~~
      **Done 2026-08-21.** 30 days of per-minute resolution, rolled into permanent hourly
      buckets, pruned by `server/retention.mjs` on a 6-hourly check. Steady state ~830k rows
      in `readings`, ~175k rows/year in `readings_hourly`, both bounded. Was measured at
      130,367 rows after 4.7 days and growing ~27,700/day with nothing ever deleting a row.
- [ ] **RM-006d** A backup policy for the Supabase project — the other half of the original
      RM-006, unaffected by the retention work above.
      *Acceptance:* a documented, verified backup, and a restore that has actually been tried.
      **Half done.** The policy is written (`docs/backup-policy.md`) and the export tool is
      built and tested (`npm run backup`, `server/backup.mjs`). **No restore has been
      performed**, so this stays open: a backup nobody has restored is a belief, not a backup.
      The doc's final section is the checklist that closes it. Note also that `auth.users` is
      not exported — restored into a new project, every `commands` row keeps its audit
      content but loses its attribution.
- [ ] **RM-006c** Arm auto-shed. **Thresholds done 2026-08-24; tiers assigned 2026-08-31; what is left is one save from the Automation page — see below, the flag alone is not enough.**
      *Acceptance:* at least one device has a shed group, a threshold is set, and auto-shed is on.
      **Limits written, `auto_shed` deliberately left OFF:** `max_total_kw 2.21`,
      `max_phase_current 15.4` — 25% above a measured peak of 1,767.8 W / 12.30 A over 1,877
      readings (`npm run demand:profile`). A breach is now *detected and reported* on the
      dashboard while nothing switches on its own, which is the monitoring value with none of
      the risk. Both are editable on the Automation page; the operator expects to revise them,
      since the peak depends on what happens to be connected and tested at the time.
      **Tiers are now assigned — measured 2026-08-31.** All 14 shed-capable devices carry one:
      `l1`-`l7` in `group_1`, `co1`/`co4`/`co5` in `group_2`, `co2`/`co3`/`co6`/`co7` in
      `group_3`, written between 17:28 and 17:29 site time through the RM-006c editor. The
      classification gap this entry was opened for is closed.
      *Worth knowing before the flag is flipped:* `group_1` is the lighting, measured at ~16 W of
      a 919 W office-hours demand against a 2.21 kW ceiling, so the first shed step is the most
      visible action available and close to the least effective one. That is the operator's call
      and the tiers are editable; it is recorded here because nothing on screen says it.
      Auto-shed can reach switches, outlets and the aircon now that `DISPATCH_CLASSES` covers all
      three and the gate is open, and it never restores — so which circuits the building may lose
      unattended stays a facility decision, made in the Devices page rather than inferred.
      *Attribution is what actually arms this, and it is worth knowing before the toggle is
      flipped.* The write above went in as the service role, so `updated_by` is null — and
      `planShed` returns idle without an actor (`commands.requested_by` is NOT NULL, and a
      load-shed row is the last one anyone would want traced to an invented user). So auto-shed
      cannot fire even if the flag were set directly in the database. Saving from the UI stamps
      the real user and is the only path that arms it. That is a property to rely on, not a bug.

- [ ] **RM-007** Sign in once on the office kiosk so it leaves the login screen.
      *Acceptance:* the kiosk shows the dashboard and stays signed in across a reboot.
      **Mostly closed 2026-08-24, on site.** The kiosk is installed, `enabled`, `active`, and
      **signed in**: Chromium is up in `--kiosk` on the Wayland session against
      `http://127.0.0.1:5183/`, and the proxy logged **254 OK against 1 × 401** from the kiosk
      origin in an hour. EX-021's session-refresh fix is holding in production — the old loop
      ran 4,383 × 401 in 24 h.
      *Note for future passes:* `ibems-kiosk` is a **`--user` unit**. `systemctl is-active`
      in system scope reports it `inactive`/`not-found` and that is a false negative; use
      `systemctl --user` with `XDG_RUNTIME_DIR=/run/user/1000`.
      **What is left is only the reboot test** — that the session survives a cold boot via
      lightdm autologin has still never actually been exercised.


---

### Track B — replication. Making the system adaptable to any site.

Added 2026-08-26. Reasoning, and the two-tree model these all serve, in
`ibems-architecture-upgrade_2.md` §4–§7 (one level up, outside this repo).

**Why this exists.** The system works, and it works for exactly one room. The project's third
funded component is a framework letting other institutions replicate it, and a framework that
begins "open `shared/registry.mjs` and replace `co1..co7`" is not one. Seven specific couplings
are named in the architecture doc's §4; each item below removes one or more of them.

**The scope decision this reverses.** The 2026-08-10 architecture doc said "single-building
deployment … not a multi-tenant campus system", and the project tracker's item 1.9 recorded
"each building runs its own independent system". Each site still runs its own Pi and its own
stack — that part stands. What changes is that every relationship inside it becomes structural
rather than literal, and every row is stamped with the site it belongs to, so a shared cloud
later is configuration rather than a second migration.

**The property that constrains every item here:** the building must stay controllable with no
internet. EX-130 was built to guarantee it. Topology may live in Supabase; flow-critical wiring
may not.

- [x] **RM-027** ~~Site identity. Nothing in this system knew which building it was.~~
      **DONE 2026-08-27 — applied, deployed and verified against the live system.**
      Both migrations are in (`sites` plus `site_id` on the three tables that had none,
      probed read-only: 4/4 present, the seeded row matching `shared/sites/<id>/site.mjs`
      field for field). The Pi is at `bbf4993`; **399 bridge and 359 server tests pass ON
      THE PI**, which is the RM-022 acceptance and not the same claim as passing on a
      workstation. `verify:pi` 5/5 with `phase_current.blue` still null.
      *The evidence that the transitional default worked, which is the part worth keeping:*
      rows written by the OLD deployed code — which sends no `site_id` — came back stamped
      `mmsu-nberic-care` in production. That is the ordering hazard the rehearsal caught,
      demonstrated harmless on live data rather than argued about.
      *The riskiest change verified itself.* The scheduler's site-scoped read of
      `dsm_thresholds` would have failed **silently** if it returned nothing — schedules and
      auto-shed would simply never fire. It logged `loaded 4 schedule row(s); auto-shed off,
      0 device(s) assigned a shed tier`, which is RM-006c's real state, so it read the real
      row and not an empty set.
      *Incidentally observed:* the fleet went **8/20 to 15/20 across the deploy** — the seven
      light switches returned on their own. They had been offline to the vendor cloud as well
      as to the bridge earlier the same day, which is RM-013 doing what RM-013 does; the
      recovery is the access point's, not this deploy's, and is recorded so it is not
      mistaken for one.
      **One thing deliberately NOT verified live:** the 25 degree ACU policy floor. It is
      covered end to end by `server/proxy.test.mjs` against a real spawned proxy, and a
      refused command provably reaches neither the bridge nor the audit table — but
      exercising it in production means POSTing a command to a real building, and
      `docs/pi-session-brief.md` says to ask first every time.
      **The flow was not redeployed, and does not need to be.** Task 2 changed the generated
      flow's offset from `8 * 3600 * 1000` to `480 * 60000` — the same number of
      milliseconds. The live flow's behaviour is byte-identical, so a `deploy:pi --force`
      would buy nothing and is a flow write, which needs asking.
      *Prior state:* **BUILT 2026-08-26, NOT YET APPLIED.** Four commits: `3dea05d` the site module,
      `aa1e053` the timezone, `fbc77bf` the policy floor, `10fce92` the two migrations.
      *What is left is an operator action, not code:* apply `supabase/phase19_sites.sql`
      then `supabase/phase20_site_scoping.sql`, in that order, by hand in the SQL editor.
      **REHEARSED 2026-08-27 on the Pi, and it caught a defect that would have taken
      ingestion down.** `supabase/rehearse.sh` applied schema.sql and all nineteen phase
      files in order against PostgreSQL 16 in a throwaway container, then drove every
      function against seeded data. It failed twice before it passed.
      *The real one, and the reason this entry no longer says the migrations are safe to
      apply in any order:* `site_id` was NOT NULL **with no default**, and the daemons
      already running on the Pi do not send one — `ingestCycle.mjs` writes `building_totals`
      every 60 s and `updateHealth` upserts `ingestion_health`. Applying phase20 would have
      begun refusing every one of those writes within a minute, presenting as a Supabase
      outage rather than as a migration. **This plan had the ordering backwards in writing**
      ("Tasks 1-5 are safe to ship immediately; Task 6 goes after the migration"); without a
      default there is no safe order, only a choice of which side breaks. Each `site_id` now
      carries a transitional default, so the migration and the code deploy are
      order-independent — see the file's own header for when RM-030 removes it.
      The guarantee is **exercised, not asserted in prose**: the rehearsal performs the two
      inserts shaped exactly as the deployed daemons send them, with no `site_id`, and
      asserts each comes back stamped.
      *The harness one:* an assertion expected 120 `building_totals` rows and got 60,
      because the rollup exercised earlier in the same run had already folded hour 0 into
      `building_totals_hourly` and pruned those rows. The migration was fine; the check was
      coupled to an unrelated step's retention behaviour, and now compares against the
      table's own count. Same shape as the two harness defects RM-009's rehearsal found —
      which is now three for three, and the argument for never skipping it.
      `e186060`
      *Nothing is deployed and nothing is at risk meanwhile.* Every code change defaults to
      the current behaviour — `iso8`'s offset defaults to 480 and `test/contract.test.mjs`
      passes untouched, proven by neutering the default and watching it go red.
      **The query changes are deliberately NOT done yet** and must not be: swapping
      `.eq('id', 1)` for `.eq('site_id', …)` against a table with no such column is a
      PostgREST 400, and it would take the Automation page and the scheduler down. That is
      the second half of this entry, after the migrations are confirmed applied.
      *Shipped and live already, because it needed no schema:* **the aircon can no longer be
      commanded below 25 °C** — the university policy quoted in the funded plan, which the
      code had contradicted since the setpoint feature was built. Verified over real HTTP:
      18 returns `400 below_policy_floor`, 25 returns `202`. Closes §5 Q10.
      `shared/sites/mmsu-nberic-care/site.mjs`, `shared/siteConfig.mjs`,
      `supabase/phase19_sites.sql`, `supabase/phase20_site_scoping.sql`,
      `src/components/control/setpointOptions.ts`
      *Original statement of the problem, kept because it is what the migrations fix:*
      *Acceptance:* a second `sites` row can exist, this Pi writes only its own, and
      `npm run test:bridge` still asserts an identical `/api/readings/latest` shape.
      `supabase/schema.sql` makes `dsm_thresholds` a singleton — `check (id = 1)`, commented
      "One building, one Pi" — and `ingestion_health` the same. `building_totals` is keyed by
      `ts` alone. No table carries a site id, so two deployments cannot share a project and
      neither can be told apart in an export.
      Adds a `sites` table (id, display name, timezone, UTC offset, a `policy` jsonb) and a
      `shared/sites/<id>/` directory holding what varies per building. `shared/registry.mjs`
      becomes a thin composer and keeps exporting `DEVICE_REGISTRY`, `PHASE_MAP`, `METERED`,
      `TIMING` and `publicDevices()`, so **every existing import keeps working** — that is what
      makes this mechanical rather than a rewrite.
      *Does NOT close §5 Q8's report-timezone question, and the plan for this phase was wrong
      to say it would.* `generate_monthly_report`'s `p_tz` is already a parameter with a caller
      that passes a value, so changing its SQL default would be churn rather than a fix. The
      duplication that did need resolving — a hardcoded UTC offset in the bridge AND a zone in
      the report — is now one value in `SITE` with a test asserting the two forms agree. Whether
      that value matches what the devices actually reset their daily counters on is still
      unverified, and still needs a month reconciled by hand.
      `shared/buildLatest.mjs`'s `iso8()` hardcodes a fixed UTC offset and gains a parameter,
      defaulting to today's value so nothing changes shape.
      *First concrete use, and worth doing on its own merits:* `shared/commands.mjs` sets
      `ACU_MIN_C = 16`, while the university's own energy-efficiency policy — a Key Feature in
      the funded project plan — is "not lower than 25 °C". A per-site policy floor validated in
      `validateCommand` makes that a rule the system enforces rather than one the UI suggests.

- [x] **RM-028** ~~The space tree. `room` is free text and there is no rooms table.~~
      **DONE 2026-08-27 — acceptance met.** Devices are placed in a node from the Devices page,
      and `knownRooms()` no longer exists: the room list is a query over a declared tree.
      `ec4a63f` migration, `f10ab56` library, `347fb12` the anon revoke, `1c76b41` store,
      `a92c2ec` the Spaces panel, `1018bc5` the placement cut-over. **Applied to the live
      project and probed 5/5.**
      *Two bugs found by driving the page, neither reachable from the tests.* The Add button was
      enabled with Supabase unconfigured and produced a raw `Cannot read properties of null
      (reading 'auth')` — the store guarded `load()` and then used `supabase!` in every mutation,
      an assertion the unconfigured path falsifies, and the tests mock the client as present so
      they never could have caught it. And sourcing the room datalist from the tree alone
      **emptied it**: this site has `device_config.room` text and no tree yet, so the cut-over
      would have removed every existing suggestion during exactly the window they are needed.
      `knownRooms` survives as `recordedRoomLabels`, renamed to admit what it is and marked for
      retirement once sites are placed.
      *`room` is kept, not dropped* — the label a site shows before a tree exists, and the
      fallback when a placement points at a node the client no longer holds. `placementLabel`
      decides that precedence once and checks the node **resolves** rather than that an id is set.
      *CLOSED 2026-08-27.* `space_subtree` now refuses `anon` with `42501`, matching
      `node_totals`. Getting there took two attempts and the second failure was mine:
      **`phase21`'s header claimed "every statement is guarded, so a re-run is safe" and it was
      not.** PostgreSQL has no `create policy if not exists`, so the re-run raised `42710`, and
      because the SQL editor stops at the first error and those policies sit ABOVE the revoke,
      it aborted before reaching the fix it was being run for. The file looked re-applied and was
      not. **A false claim of idempotency is worse than an honest warning, because it is acted
      on** — a warning makes you check, a promise makes you stop. Both `phase19` and `phase21`
      now drop each policy before creating it, verified by applying each twice into a populated
      database (exit 0, in a container), and `test/migration-idempotency.test.mjs` fails any
      migration making that claim without earning it.
      *Verified after the fix, both directions:* `anon` gets zero rows on select, `42501` on
      insert, and cannot execute either RPC; a real insert round-trips through the service role
      and `space_subtree` returns it; the probe row was cleaned up.
      **One thing NOT verified, and it is worth stating rather than implying:** that
      `authenticated` can still SELECT. The policies were dropped and recreated, and the service
      role bypasses RLS, so nothing available from a script can answer it — minting a user token
      is not something the probe can do. The decisive check is a signed-in operator adding a
      space from the Devices page; if the recreated policy were missing, that write would fail
      with `42501`.
      *Prior state:* SCHEMA AND LIBRARY DONE 2026-08-27; NOT YET APPLIED, NO UI YET. `ec4a63f` the
      migration, `f10ab56` the tree library and Supabase layer.
      *Rehearsed on the Pi, exit 0*, with the tree exercised rather than pattern-matched:
      subtree depths, a subtree re-based to a mid-tree node, four kinds coexisting, a
      case-insensitive duplicate sibling refused, a parent delete cascading to its subtree,
      and a placement surviving that delete as NULL rather than being cascaded away.
      *The cycle guard is the one worth knowing about.* `parent_id` is user-editable and
      nothing prevents A -> B -> A; an unbounded recursive CTE against a cycle does not
      raise, it runs until something gives out. The walk is capped at 32 and the rehearsal
      builds a real cycle and asserts it stops at **exactly** that depth — reaching the cap
      is what proves the cap stopped it, since `UNION ALL` gives a cycle nothing to
      deduplicate it. Pinned that way because the neuter-check for this guard is a hang
      rather than a red test. The client carries its own cap for the same reason in a
      different place: the database's protects the database, not a browser building a tree
      from rows.
      **THE APPLY PATH HAS NOW BEEN RUN, 2026-08-31 — `scripts/rehearse-install.sh --apply`.**
      This entry said for days that it never had been, because there has only ever been one Pi and
      running it there would reinstall a working building. A container removes that objection.
      Five runs, each one finding something the previous one hid. Final state: **21 steps, zero
      failures**, on a machine with nothing on it.
      *Confirmed by reading the artifacts back, not by trusting the installer's report:* Node 22
      from NodeSource (`v22.23.2`), `npm ci`, a clean `tsc -b && vite build` producing
      `dist/index.html`, `serve` at `/usr/bin/serve`, the Node-RED official installer **and** the
      Tuya contrib node (both of which this file had guessed would refuse to run off a Pi), the
      loopback-only mosquitto config **byte-exact** — `listener 1883 127.0.0.1` / `::1`, the one
      line here that is a security property rather than a convenience — `server/.env` at mode
      `600`, and all four units installed with `User`, `Group`, `WorkingDirectory` and
      `EnvironmentFile` rewritten for a different account and checkout.
      **`systemctl` is a recording stub and that is stated everywhere it could mislead.** A
      container has no systemd, so the real installer aborts at step 5 and steps 6-8 — the ones
      that create `server/.env` and rewrite the units — never ran at all. The stub logs each call
      and returns 0; every call it swallowed is printed under a heading saying none of them
      happened. Nothing was enabled, nothing started, no unit validated by systemd. What the log
      does prove is the documented intent: mosquitto and four units enabled, **only** the
      dashboard started.

      **What five runs found, none of which reading the script had produced:**
      1. **`act()` discarded the output of every failing command.** A failed step printed four
         words and nothing else — at the one moment an operator needs the error. Found because
         the build broke and the run would not say why. Now captures and tails 20 lines.
      2. **Preflight checked that `sudo` works, not that the user is in the `sudo` group.** The
         Node-RED installer tests group membership and exits regardless of how sudo is configured,
         so a machine granted sudo through a `sudoers.d` rule passes preflight and fails at step 4
         — after the packages and the build are already installed. Now checked, with the `usermod`
         line, as a warning rather than a FAIL.
      3. **Two units in `server/` are neither installed nor mentioned.** Both exclusions are
         correct — `ibems-kiosk.service` is a `--user` unit needing a graphical session, and
         `ibems-wifi-prefer.service` is Wi-Fi, which this script never touches — but a second
         deployment had no way to learn the kiosk unit exists. Now named in the closing notes.
      4. **The closing notes still told the reader to hand-edit two migration files**, advice
         corrected elsewhere the same day. A message nobody reads on a provisioned machine is
         exactly where stale advice survives.
      5. **Two of the five findings were in the harness, and both mattered.** The first version
         copied an allow-list of files it judged the installer needed and omitted
         `tsconfig.app.json`, producing a build failure the installer had nothing to do with — a
         harness that omits a file reports a defect in the thing it is testing. And its summary
         counted the raw log, where `FAIL` is wrapped in a colour escape and `did` is not, so it
         matched every success and no failure and printed **"0 reported FAIL"** onto a screen with
         a FAIL visible on it. *The harness being wrong about the `sudo` group is also what
         surfaced finding 2* — had the container matched a Pi exactly on the first try, that gap
         would still be waiting for a real institution at step 4.
      *Still not exercised, and the guide still says so:* whether the services actually run.

      **The installer's dry run is also rehearsed on a bare machine, 2026-08-31** —
      `scripts/rehearse-install.sh`, a throwaway Debian container, the pattern `supabase/rehearse.sh`
      established for migrations. **`install.sh` had only ever run on one computer: the Pi that
      already had every package installed.** So every "already satisfied" branch was taken and not
      one of the "would install" branches had ever been exercised — which is exactly the half a
      second institution runs. The rehearsal took the other path for the first time: `warn node
      not installed`, then the NodeSource, npm, Node-RED, mosquitto, `server/.env` and unit-rewrite
      plans, all the way through. It completed clean.
      *The repo is copied in, not mounted*, so a bug that wrote to the checkout could not reach
      the host's; `node_modules` is excluded because its **absence** is one of the untested
      branches, and `server/.env` is stripped both because it holds live credentials and because
      the script branches on whether it exists.
      *What it cannot exercise is printed at the end rather than counted as passing:* `systemctl`
      needs a PID 1 a container does not have, the Node-RED installer checks for Pi hardware, and
      **`--apply` still has never been run**. That remains true and is stated in three places.
      **Running it found a defect immediately, which is the point.** The script's own closing
      instructions still told the reader that `phase19_sites.sql` and `phase20_site_scoping.sql`
      "name a site id you will need to change" — advice this session had already corrected
      elsewhere: apply both unedited, then `npm run site:sql`. A closing message nobody reads on a
      provisioned machine is exactly where stale advice survives. It now also points at
      `npm run preflight` in its verify step.

      **What is left:** apply `supabase/phase21_space_tree.sql`, then the tree editor UI,
      then switch `DeviceMetaEditor`'s room datalist over. `knownRooms()` is deliberately
      still in use — with no editor there is no way to create a node, so cutting now would
      trade real suggestions for an empty list.
      `devices.room` is nullable text; `device_config.room` is text with the comment "this
      building has no fixed room list". So an office, a lab and a floor cannot be grouped,
      rolled up, or scoped — the exact three things a second site needs.
      **One self-referencing `space_nodes` table with a `kind` column, not one table per level.**
      A table per level is precisely what makes a hierarchy rigid: it fixes the depth at schema
      time, so a site that is a single room and a site that is a campus cannot both fit.
      Subtree reads go through a `security invoker` recursive-CTE RPC, matching the pattern
      `readings_buckets` and `readings_archive` already established. **No `ltree` and no
      materialized path** until one is measured to be needed — the same discipline
      `docs/adr-001-timeseries-store.md` applies to reaching for a second datastore.
      The editor reuses `DeviceMetaEditor.tsx`'s existing draft/save/diff machinery
      (`effectiveConfig`, `isSameConfig`); nothing new is needed for the interaction.
      *Keep `device_config.room`,* backfilled, as a denormalised label — the additive discipline
      `supabase/phase7_device_config.sql`'s own header argues for.

- [x] **RM-029** ~~The circuit tree. `PHASE_MAP` is a constant naming four specific meters.~~
      **DONE 2026-08-27 — acceptance met, and the strongest form of it.** `510daf2`.
      `test/contract.test.mjs` passes **71/71 untouched** against the derived map, and the
      regenerated `bridge-flow.json` is **byte-identical** — the derivation reproduces the old
      constant exactly, list order included, so nothing downstream can tell the difference.
      `phase_current.blue` is still `null`.
      *`blue` stays an empty LIST, not a missing key.* `buildLatest` reads `PHASE_MAP.blue`
      directly and the UI renders it as "not metered" rather than a real zero, so `derivePhaseMap`
      emits all three phases whatever is wired to them — while the site's circuit file
      deliberately contains no Blue row, because there is no such branch to describe.
      *Two cross-checks this codebase had nowhere else, both neuter-verified:* every meter a
      circuit names must be a real registry device — a typo would silently drop a branch from the
      building total, giving a reading that looks plausible and is short by one circuit — and
      every branch meter must be claimed by exactly one circuit, which catches the opposite
      mistake. A third guard ties the two files that name the same circuits together, so renaming
      one no longer drifts the other.
      *One test was weak and is now not:* "the registry exports the derived map" passed against
      the OLD hand-written constant, because `deepEqual` cannot tell a derivation from an
      identical value. It now reads the source and fails if a meter id is still spelled out.
      **DELIBERATELY NOT a `circuits` table in Supabase**, which this entry originally implied.
      The electrical tree is **wiring**, and RM-027 already settled where wiring lives: rooms are
      operator-editable and change often, so the spatial tree went to Supabase; a panel changes
      when an electrician changes it, which is a deploy-level event. Putting it behind a network
      read would make the building totals depend on the internet — the property `EX-130` exists
      to protect. `branch_circuit` therefore stays a local name with a drift guard, rather than
      becoming a denormalised label off a `circuit_id` column.
      *Prior text:* The circuit tree. `PHASE_MAP` is a constant naming four specific meters.
      *Acceptance:* `test/contract.test.mjs`'s phase-total assertions pass unchanged against a
      derived map, and `phase_current.blue` is still `null` rather than `0` — the invariant
      `node-red-bridge/verify.mjs` explicitly checks.
      **This is a second tree, not a branch of the first, and conflating them is the mistake
      this entry exists to avoid.** Where a device *is* and what it is *wired to* are
      independent: a lighting circuit crosses rooms, and a room is fed by several circuits.
      Today the first is free-text `room` and the second is free-text `branch_circuit`
      (`'C.O Yellow'`), and neither can be traversed.
      `buildLatest(snap, REG, PHASE_MAP, nowMs)` already takes the map as a parameter, so the
      seam for deriving it exists and nothing downstream needs to change.

- [x] **RM-030** ~~Scoped aggregation. "This lab's consumption" is currently unanswerable.~~
      **DONE 2026-08-27 — applied and verified live, end to end.** `3e57c79` migration and
      rehearsal, `cc8f644` the client reader, `875c930` the Analytics card.
      *Probed against the live project:* `node_totals` is callable, and an unobserved scope
      returns NULL power rather than 0 **on real data**, not only in the rehearsal.
      *The card is where the honesty rule could last have been broken* — it renders through
      `formatNumber`, which owns the missing-is-a-dash rule, and never shows a dash without
      its reason beside it. Partial coverage is stated for the reason the Reports page states
      it: a number alone cannot tell a quiet room from an unplugged one.
      *It asks nothing until a space is chosen.* Defaulting to the first node would answer a
      question nobody asked, and on a site with several buildings the first is arbitrary.
      **It is useful only once a tree exists**, and `space_nodes` is still empty on the live
      project — the card says so and points at the Spaces panel rather than rendering blank.
      *Acceptance is met and exercised, not asserted.* The rehearsal seeds a window holding two
      observed samples (100 W, 300 W) and two OFFLINE rows carrying a frozen 999. If offline rows
      counted, the average would be 599.5 and the peak 999 — both plausible, both never measured.
      A floor's total includes its rooms; the window is half-open; and an unobserved scope
      reports **NULL, not 0**, pinned for two separate reasons (a room with no devices, and a
      room whose devices were all offline). **Neuter-checked:** coalescing the aggregates to 0
      fails with *"an empty room must report NULL power, got 0"*.
      *`phase20`'s transitional `site_id` defaults are retired here*, as that file said this phase
      would. They let phase20 land on a running system whose daemons predated Task 6 and they
      worked; Task 6 shipped, so the net is holding nothing up, and in a shared project a default
      would silently attribute a second Pi's rows to this site — wrong data recorded confidently
      is worse than a write that fails loudly. The columns stay NOT NULL. This inverted a
      rehearsal assertion rather than deleting it: it used to prove a writer with no `site_id`
      succeeded, and now proves such a writer is refused.
      **The `building_totals` primary key is deliberately NOT widened**, which phase20 floated for
      this phase on the reasoning that RM-030 would be touching the rollups anyway. It is not —
      `node_totals` is a new read path over `readings`. Changing a primary key underneath working
      rollup functions, for no benefit this phase can demonstrate, belongs to a phase that has a
      reason to test it.
      **What is left:** apply `supabase/phase22_node_totals.sql`, then the Analytics scope
      selector. The selector is worth little until a tree exists — `space_nodes` is empty on the
      live project — so the honest order is tree first, UI second.
      *Acceptance:* a node's total equals the sum of its descendants' devices, and an offline
      device contributes `null` rather than a frozen figure.
      A per-node totals RPC over `readings` joined through placement. **A new RPC, not a rewrite
      of `building_totals`** — that table holds real data and RM-009's rollup functions depend
      on its shape.
      The honesty rule from RM-024 and EX-107 extends here unchanged and is the part most likely
      to be got wrong: a node whose meters are all offline must report nothing, not zero.

- [x] **RM-031** ~~The 2D floor plan renders from data, not from literals.~~
      **DONE 2026-08-28 — applied and verified live, every constraint and the trigger.**
      `7e2903d` migration and rehearsal, `834cd7a` model and store, `1ac5e45` the view,
      `6872af2` styles.
      **Verified against the live project, 9 checks, and the probe restored itself.** Placing and
      positioning in one statement keeps the position; each range constraint names itself
      (`device_config_plan_x_range`, `_plan_y_range`, `_plan_both_axes`); a same-room write keeps
      the position; **a move to another room clears it**; and deleting a room succeeds and clears
      both placement and position — the case that makes the trigger necessary rather than tidy.
      The device row used was captured first and came back **byte-identical, `updated_at` and
      `updated_by` included**, and both throwaway nodes were removed.
      *A read-only probe alone could not have done this.* Every device here is unplaced, and the
      "a position needs a room" constraint is violated by any position on such a row — so it
      masks the two range constraints, and a rejected write proves only that *some* check fired.
      Isolating them needed a placed row; the trigger needed a successful update.
      *Measured on the way, and now recorded in the code rather than guessed at:* PostgREST
      returns these `numeric` columns as JSON **numbers**. `coercePlanCoord`'s string tolerance
      stays — the encoding is decided elsewhere and `count(*)` already caught this project out —
      but the comment no longer implies it is load-bearing.
      *Deployed and read back.* The Pi is at `43deda9`, rebuilt, and serving the new bundle
      (`index-22jg6l4F.js`, confirmed against the served HTML). All three suites pass **on the
      Pi** — 747 frontend, 466 bridge, 359 server — which RM-022 is the reason for checking.
      The exact column list `fetchDeviceConfigs` sends answers **200** with the **anon** key
      (empty array: `device_config` is `authenticated`-only, unchanged). That is the browser's
      own path proven without a login; the app itself stops at the sign-in screen and fetches
      nothing before auth, so the in-app path was not exercised and is not claimed.
      *The ordering hazard is spent, and worth keeping in the record:* `fetchDeviceConfigs`
      selects `plan_x,plan_y`, and before the migration that select answered **400 / `42703` /
      "column device_config.plan_x does not exist"** — measured, not assumed. On a project
      without phase23 the whole of `device_config` fails to load, rooms and load-shed tiers with
      it. The Pi pulls only when somebody pulls it (no timer; checked), so the order was in hand.
      *Acceptance is met, in both halves:* a site with no plan drawn renders its fleet grouped by
      tree node — placed and unplaced, nothing omitted — and a site with a plan renders it. No
      device id, room name or coordinate appears anywhere in `src/components/spatial/`.
      **A room's plan draws the devices in that room and no others**, which is the correctness
      rule the phase turns on. Coordinates are normalised against ONE node, so a device in a
      child room carries a position measured against the child's frame; drawing it in the
      parent's frame would put it somewhere nobody chose — and the drawing would look surveyed.
      Descendants are counted and named, not drawn.
      **The frame is square because nothing here has measured a room.** Inventing proportions
      would assert a fact nobody established. `space_nodes.attrs` can carry real dimensions when
      somebody measures them, and a 0..1 position converts into them without being re-entered.
      **The database owns the move, the client owns validity.** phase23's trigger clears a
      position when a device changes room: carried over, it would place the device at a spot
      nobody chose in a room it has never been in, drawn as confidently as a surveyed one — and
      the device editor's whole-row upsert produces exactly that payload. *The rehearsal changed
      the rule:* clearing on every move also cleared the write that places and positions in one
      statement, which is what an import or a provisioning script looks like. The two differ in
      one observable way — a carried-over payload has not changed the coordinates.
      **Neuter-checked** with the trigger commented out: *"a move must clear the position, got
      0.25/0.75"* — the stale position, in the new room. **Re-run safety earned, not asserted:**
      the file applied twice in one run, exit 0.
      *The whole-row upsert is the other trap, and it has its own test.* A device is dragged into
      place; a week later somebody edits its notes; the editor sends every column. A row builder
      that did not carry the position would null it, from a screen that never mentions the plan.
      **Placement is click-to-place, not drag — a deliberate deviation from what this entry used
      to say.** A drag needs pointer capture, behaves differently under touch, and is unreachable
      from a keyboard, so building it would have meant building this path anyway as the
      accessible one. Arm a device and click where it goes, or select a pin and type its position.
      `editableLayout.ts`'s `clampToRoom` was **not** reused as this entry proposed: it clamps
      metres against `geometry.ts`'s `ROOM`, so importing it would have pulled the CARE-specific
      module back into the generic plan — the exact coupling this phase exists to cut.
      *Verified in a real browser against real layout*, because the click maths is what jsdom
      cannot check: 15%/85% of a measured 520×520 frame put the marker centre at (253, 880)
      against (253, 881) predicted; a click at 25%/75% recorded `{x: 0.25, y: 0.7506}`, the
      0.0006 being the integer pixel aimed at and the proof that rounding works; clicking a pin
      selects it and records no placement; at 375px the frame shrinks to 278×278 with no
      horizontal overflow; and the Overview fallback renders the plan with **`threeChunksFetched:
      0`**, so RM-032's property survives.
      **`FloorPlanView` is not deleted and not changed.** It remains correct where it is — the
      `care` pack's own WebGL-unavailable fallback, inside the site it was surveyed for.

- [x] **RM-032** ~~The 3D scene becomes a site-gated pack.~~
      **DONE 2026-08-27.** `3edca87`. `SpatialView` loads a pack only when the site declares one.
      *Verified both ways in a browser*, because the claim is about what the network does: with
      the pack declared the canvas renders and `three` is fetched; with it null the notice renders
      and **`threeChunksFetched` is 0** — measured from `performance.getEntriesByType`, not
      inferred.
      *Stated precisely rather than overclaimed:* the chunk is still **built** — the dynamic
      import is in the module graph and the entry references it as a lazy target, confirmed in a
      production build with the pack nulled. What a site without a pack avoids is **downloading**
      it, which is the cost that matters. Removing it from the build too would mean the site
      directory owning the import, a larger restructure than this phase needs.
      **The fallback is deliberately NOT `FloorPlanView`**, which is the obvious choice and is
      wrong: the 2D plan pins `co1..co7` to literal coordinates, so at another site it would draw
      that site's devices into this site's room — worse than drawing nothing, because it looks
      right. Until RM-031 the honest answer is to say no view is configured, and why.
      *Found on the way, and it is where RM-031 had to start:* `FloorPlanView` imports
      `LIGHT_PLAN` from `scene3d/geometry.ts`, so the 2D plan and the 3D scene share a geometry
      module.
      **IS IT FINISHED? Yes for what it claimed, and two things it did not do are recorded here
      rather than left to be discovered** (asked and answered 2026-08-28).
      *Done and verified:* a site without a pack downloads none of the 3D — measured in a
      browser, `threeChunksFetched: 0` — and an unrecognised pack name degrades to the plan
      rather than throwing. Since RM-031 that fallback is a real spatial view, not a notice.
      *Not done, deliberately:* `src/components/scene3d/` was never moved to `src/scenes/care/`
      as the phase plan proposed. The pack still sits among the shared components, which costs
      nothing at runtime and is a rename away whenever it is worth doing.
      *Not done, and this one has a consequence:* `SCENE_PACKS` in `SpatialView.tsx` is a literal
      map, so a second site that WANTS a 3D pack must edit a shared file. A site with
      `scene_pack: null` — every scaffolded site — needs no edit at all, which is why this did
      not block RM-033. It is the same shape as FI-017 and belongs with the provisioning work.

- [ ] **RM-033** Site provisioning — FI-002 and FI-003, now buildable.
      **PART-BUILT 2026-08-28.** `4fb431b` one-file ownership, `5e3b378` the scaffolder,
      `f1d0269` the mock. **This is Milestone 6, due June 2027**; what remains is the packaging
      and the written guide, which need decisions rather than code.
      **One of the plan's end-to-end criteria is answered by construction, not by a run.** It
      asked to "confirm the Pi never writes a row carrying the other site's id" — an observation
      from a throwaway second site. The codebase gives something stronger: every site-scoped write
      takes its value from `SITE.id` (`server/ingest.mjs`, `server/shapeRows.mjs`,
      `server/scheduler.mjs`'s scoped read), `SITE` has exactly one import path, and
      `test/site-config.test.mjs` fails any production module under `shared`, `src`, `server`,
      `node-red-bridge` or `scripts` that names a site directory at all. A literal id cannot be
      written because a literal id cannot be present. Checked 2026-08-31 by reading the guard's
      own walk rather than assuming its reach.
      *What that guarantee does not cover, for whenever the "shared cloud later" in the plan's
      decision 1 arrives:* **device ids are not site-namespaced.** `co1` and `l1` are ids, not
      paths, so two buildings in one Supabase project would collide on `devices.id` and
      `readings.device_id`. Harmless under one-project-per-building, which is the current
      architecture, and the first thing to fix if that ever changes.

      *Acceptance (unchanged):* a second site is stood up from the guide by someone who did not
      build this, without hand-editing a device id.

      **Done so far, and each of these was a real edit a second deployment would have had to
      make:**
      - **`shared/siteConfig.mjs` is now the ONLY module naming a site.** Its own header always
        claimed "one line"; `shared/registry.mjs` also imported `CIRCUITS` straight from the site
        directory, so it was two — and the one nobody would remember wires a new site to another
        building's circuits. `PHASE_MAP` is derived from that tree, so a missed edit would not
        fail. It would report the wrong phase totals, confidently.
      - **FI-017 closed: `BUILT_IN_DEVICES` moved to `shared/sites/<id>/devices.mjs`.** Twenty-one
        pieces of hardware on one building's walls lived in the file every deployment shares. The
        CT circuit map and the two-logical-meters-on-one-box note went with them — that is
        documentation OF THIS BUILDING, and leaving it shared is how the next site inherits
        another building's wiring as fact. `DPS_MAPS` stayed: those describe Tuya firmware.
      - **`npm run site:new <slug>`.** Scaffolds the directory; refuses to overwrite; validates
        the slug *before* creating anything, because the slug is interpolated into a path.
        **It does not activate the site** — repointing `siteConfig.mjs` would take a running
        building offline, every device id stopping resolving, from a command that sounds
        additive. It prints the three lines instead.
      - The template asserts as little as possible: devices and circuits start **empty**, not
        seeded with plausible examples, and the timezone starts at UTC — a placeholder that is
        also true. An empty circuit tree derives to empty phase lists, so a new site reads "not
        metered" rather than zero.

      **What doing it found, which is why it was worth doing rather than describing.** The plan's
      own end-to-end check — scaffold a site, point at it, run it — was carried out, and:
      - the generated Node-RED flow **followed the site**: 2 devices instead of 20, and zero
        references to `co1` or `l1`;
      - **`npm run mock` crashed.** `TypeError: Cannot read properties of undefined (reading
        'toFixed')`. The mock named CARE's four branch-meter context keys as literals and looped
        `1..7` for outlets and lights. That is worse than an ordinary fixture bug: the mock is how
        a second deployment is developed *before* it has hardware, which is exactly the position
        another SUC is in. Fixed and covered — see `mock-bridge/fixturePlan.mjs`.
      - the guard added an hour earlier **caught the next commit**: `site:new`'s usage example
        read `mmsu-coe-annex`, and once that directory existed the test failed
        `scripts/site-new.mjs names mmsu-coe-annex`. A usage string is indistinguishable from a
        module wired to a site. It was also a plausible-sounding MMSU college that does not
        exist, which is its own reason not to ship it.
      - the throwaway sites were **deleted, not committed**. A fabricated building in the repo
        would read as a real one; a worked example belongs in the guide.

      - **`docs/replication.md`** — the software half of the framework, written as a transcript
        of the run above rather than as a design. Its "What this does not cover" table is the
        point: a replication framework quiet about its gaps is worse than a short one.
        *Corrected 2026-08-31:* it claimed the steps were carried out "end to end", which was
        not true of two of them. Steps 8 (a second Supabase project) and 9 (a space tree for a
        new site) were described from reading the code and are now marked as such. A step nobody
        has walked is worth less than one somebody has, and a document going to other
        institutions has to say which is which.

      **What OPENING THE PAGE found, 2026-08-31, which reasoning about the code had not.**
      Everything above was verified through data: the registry, the flow, the mock, the tests.
      Then a deployment was pointed at a scaffolded site and the dashboard was actually looked
      at. Two defects, both in the last place anyone would check because neither is data:
      - **The chrome named one building.** `1c47554`. Five literals — the nav chip, the page
        subtitle, the hero title, a climate tile and the date line — so every deployment
        displayed *"MMSU CARE Office · NBERIC"* in its header. All now come from `SITE`;
        `WEATHER_TZ`'s literal `'Asia/Manila'` now comes from `SITE.timezone` rather than being
        a second copy of a fact the site already declares. `test/site-naming.test.mjs` guards it,
        and states its own limit: it scans tokens that cannot be ordinary English, so it is a
        floor rather than a ceiling.
      - **A building with no meters reported using 0 kWh.** `33591d9`. Live Demand, voltage and
        the Blue phase all correctly read "—" or "not metered"; the three energy tiles read
        `0.00 kWh`. `buildLatest` was right — the zero was manufactured a layer earlier by a
        `reduce(..., 0)` over an empty list and faithfully passed on. RM-024's rule at the layer
        that SEEDS a figure, which is where it is easiest to miss because nothing there looks
        like a claim about a building.

      **The test suites are this building's regression suite, not a conformance suite** —
      measured, and now written into the runbook so a new institution does not think it broke
      something. On a scaffolded empty site: frontend 746/747, bridge **414/482**, server
      **329/359**. A sampled failure reads `Cannot use 'in' operator to search for 'voltage' in
      undefined` — a fixture looking up a device id the new site does not have. The consequence
      is real and is listed as a gap: a new deployment has nothing that tells it its OWN site
      directory is coherent.

      **Decided and built 2026-08-31, on your answers:**
      - **`LICENSE` — MIT.** `9e85439`. The repo had been public from the start with none, which
        made it unusable by the very institutions Milestone 6 exists to serve: "public" and
        "reusable" are not the same thing. *The copyright holder line names the university and
        needs confirming against the funding agreement* — that is a legal fact, not a code one.
      - **`scripts/install.sh` (FI-003) — a script, not a card image.** `fb96069`. Dry run by
        default; every change goes through one `act()` so the plan cannot diverge from the run,
        and a test enforces that no `sudo` escapes it. It refuses to touch Wi-Fi, refuses to open
        the broker past loopback, writes no secrets and does not deploy the flow — each for a
        reason this project has already paid for. **Its apply path has since been rehearsed in a
        container** — see the apply-path entry above — but **has never been run end to end on a
        real machine**, because `systemctl` was stubbed there and no unit was ever validated by
        systemd. The file says exactly that and a test keeps it saying so; the guard was sharpened
        rather than dropped, because the blanket claim had become false while the useful half of
        it stayed true.
      - **`docs/physical-install.md` — a template with 12 marked gaps**, not a finished guide.
        Structure, the commissioning checklist and every trap are written; photographs, part
        numbers and torque figures are marked `〔FILL IN〕` rather than invented. Nothing in it
        has been reviewed by an electrician and it says that first.
      - **`server/ibems-dashboard.service`, captured.** The installer's dry run on the real Pi
        reported the unit "not in the repo" — it had been running for weeks, declared nowhere.
        The same exposure CLAUDE.md records for `findTimeout` and mosquitto: a host-only fact a
        rebuild loses with no diff. Verified byte-identical to the live unit.

      **FI-002 landed 2026-08-31 — `npm run preflight`, 12 tests.** `docs/replication.md` named
      this as its own biggest gap: *"Day-one network setup … partly written down in `CLAUDE.md`'s
      site facts, not yet a procedure."* It is now a command. It answers a different question from
      `site:check`: that one reads the site *directory* offline and asks whether a description of a
      building is coherent; this reads the *deployment* and asks whether this machine can see the
      building — credentials, database, vendor account, radio segment, bridge, services. A site can
      be perfectly coherent on a machine that will never reach a device.
      *The rule it exists to enforce:* **a check that could not be run is never reported as fine.**
      An unchecked required item leaves the deployment not-ready, because a green light nobody
      earned is what someone standing in an unfamiliar building will believe. Run on a workstation
      it reports four errors and one unchecked, which is the correct answer there.
      *It writes nothing* — no credential created, no flow deployed, no Wi-Fi touched — and
      **prints no secret**: the observation shape carries `set`/`empty`/`absent` and never a value,
      with a test that passes values in to prove they cannot reach the output. An **empty**
      credential counts as missing, since `.env.example` ships every key with an empty value and a
      copied-but-unedited file has all the right names and none of the answers. A check whose
      prerequisite already failed is **skipped**, not counted as a second error — a wall of red
      teaches people to skip the tool.
      *Hearing no device broadcasts names the 2.4 GHz trap outright*, this project's most expensive
      misdiagnosis. A bind failure on the discovery port reports **unchecked** rather than silence:
      Node-RED's own tuya nodes may hold that port, and calling it "no devices" would accuse the
      network of a fault it does not have.

      **`npm run site:sql` closed the `sites` row, 2026-08-31 — 9 tests.** `phase19_sites.sql`
      seeded one literal id, so a second institution had to hand-edit a migration; editing a
      migration that has already run somewhere is how two databases stop agreeing about what has
      been applied. The statement is now generated from `shared/sites/<id>/site.mjs`, so the id
      cannot drift from `SITE.id` — the one pairing that matters, since every site-scoped write
      references it and nothing else reports an orphan. **It prints and does not execute**, the
      same line `install.sh`, `site:new` and `preflight` hold, and it is idempotent because an
      operator unsure whether they ran it will run it again.
      *Verified against production, not only against tests:* the generated statement reproduces
      the live `sites` row field for field, policy jsonb included.
      *Guarded:* the id is slug-validated before interpolation, apostrophes in a building name are
      doubled (`St John''s Annex` is an ordinary name and an unescaped one ends the literal
      mid-statement), an absent policy emits `'{}'::jsonb` rather than a null the column rejects,
      and a site missing any required field throws rather than emitting SQL with `undefined` in
      it — that statement would not fail, it would run and write nonsense.

      **What is left:**
      - filling in `physical-install.md`'s twelve gaps, which needs a site visit;
      - nothing, for the `sites` row. `phase20_site_scoping.sql` still contains this building's
        id, and **checked rather than assumed**: its three `update ... where site_id is null`
        statements match nothing on a fresh database, and the three `set default` statements are
        **dropped again by `phase22_node_totals.sql`**. Applied in filename order the pair is
        self-correcting. An earlier draft of this entry said a new deployment should skip them,
        which was worse advice than the truth — skipping `phase20` leaves the columns absent.

      **A sweep, after the third time.** Finding the same defect three times meant looking for
      the rest of it rather than fixing one more instance: **thirteen further `toLocale*String`
      calls** formatted a building fact — a meter reading, a device's last report, a forecast
      day — in whatever zone the reader's laptop was in, and every one of them also hardcoded
      `en-PH`.
      *The distinction that shapes the fix, and it is not "pin the timezone everywhere".* A
      timestamp describing the BUILDING must read the same to everyone, and now does
      (`src/lib/siteTime.ts`). A timestamp describing THIS READER's own action — "saved at
      14:32", the control log — is a fact about their session, so their own clock is the correct
      frame; those three call sites keep it and say why. The locale is the reader's everywhere:
      how a date is spelled belongs to them, which instant it is belongs to the building.
      `formatMonth`'s `timeZone: 'UTC'` is deliberately left alone — it labels a bare date
      string, not an instant, and UTC is what stops `2026-07-01` reading as "June".
      *Guarded:* no frontend module may hardcode a locale (neuter-checked), and the helper must
      pin `SITE.timezone`. 757 frontend tests pass in UTC and at +08.

      **A third, one layer under the clock.** `weatherClient.ts`'s `parseSiteTime` parsed
      Open-Meteo's timestamps — which come back in the SITE's zone with no offset suffix — as the
      READER's local time. Measured: a reader in New York produced hour labels **twelve hours
      out**, a forecast about the building timestamped in their own day. To its credit the old
      comment stated the assumption rather than hiding it ("the display device runs in the site's
      own timezone"); it was true of the kiosk and false of everyone else, which is why it
      survived. The site's own `utc_offset_minutes` is appended now.
      **Two of the existing tests were timezone-dependent and could not have caught it** — they
      set the clock with a bare local string, so the test and the parser shifted together and the
      shared bug stayed invisible. Both are re-anchored to absolute instants. *Verified in five
      zones* (UTC, Manila, New York, London, Auckland): 13/13 in each. **Neuter-checked:** remove
      the offset and five tests fail under UTC while all thirteen still pass on a +08 workstation
      — which is the RM-022 shape exactly, and the reason this was checked in more than one zone.

      **Two more found by looking rather than reasoning, 2026-08-31.** Both were in the same
      place: the building's *location* was not a declared site fact, so shared code invented one.
      - **The Overview clock showed the READER's time under the BUILDING's place name.** Neither
        `toLocaleTimeString` nor `toLocaleDateString` passed a `timeZone`. Measured: a viewer in
        New York saw `00:20` while the building read `12:20`, presented as the building's. The
        kiosk in the room was right only by coincidence, which is why nobody noticed. Verified in
        a browser reporting `Asia/Shanghai`: the page now shows `05:29` for a site declaring UTC
        while the browser's own clock reads `13:29`.
      - **An unlocated deployment showed the CARE office's weather as its own.**
        `src/config/weather.ts` held these coordinates as its own defaults, so any site that had
        not set `VITE_WEATHER_*` got Batac City's forecast under its own name — a measurement
        about somewhere else, presented as being about the reader's building. `site-naming`'s
        guard could not catch it: "batac" is derivable from neither the site id nor its display
        name.
      *`SITE.location` now carries it* (`place`, `lat`, `lon`, or null), env vars still override,
      and there is **no fallback**. An unlocated site renders its own state and **makes no
      forecast request at all** — verified: `forecastRequestsMade: 0`, and no mention of Batac
      anywhere on the page. `site:check` validates the shape and warns when it is null.

      **`npm run site:check` — the conformance check, built 2026-08-31.** The suites in this repo
      are this building's regression suite; this is the one a second deployment runs against its
      own directory. Twenty-two checks over identity, devices and circuits.
      *Empty is a warning, wrong is an error*, and that is the whole design: a scaffolded site has
      no devices and no circuits by deliberate choice, so if empty failed, the command would be
      broken at the moment it is most needed and the first thing anyone would learn is to skip it.
      *The faults it exists for are the ones nothing else shows.* A circuit naming a meter that
      does not exist does not crash — `PHASE_MAP` is derived, so the phase total silently omits a
      meter and the screen looks right. Two devices sharing a `ctx` overwrite each other in the
      flow's context store and the dashboard shows one twice. Demonstrated against a site seeded
      with `mtr_lightning` for `mtr_lighting` and two switches on one state key: both named, exit 1.
      *It approves this building*, which is the test that stops it measuring the wrong thing.
      **`DEVICE_CLASSES` now exists as a value**, not only a `@typedef` that enforces nothing at
      runtime, and the typedef derives from it. `src/lib/types.ts`'s union is held to the same
      list — two copies of five strings were a silent drift waiting to happen, in the direction
      where a class added to one and not the other renders as a device the UI cannot type.

- [x] **RM-034** ~~There is no CI. Every test run is manual.~~
      **DONE 2026-08-27 — green on the first run, both Node versions.** `dad1a26`,
      `.github/workflows/ci.yml`. Lint, type-checked build, and all three suites on push and PR.
      **The Node versions did not match and nothing said so.** The Pi runs **22**, this
      workstation runs **24**, and no `engines` field declared either. That is RM-022's shape
      exactly — five server tests once passed on a workstation and failed on the Pi, green in the
      only place anyone looked. CI runs **both** rather than picking one, so the divergence is
      visible instead of latent, and `package.json` now declares the range CI proves.
      *It runs with no `server/.env`*, which is the configuration several of those tests actually
      want. Verified before writing the workflow — the local `.env` was moved aside and all four
      suites run clean — rather than discovered on a first red build.
      *A step asserts `server/data/` is empty afterwards.* That directory holds the live
      command-audit outage queue on the Pi, and a full `test:server` run once left a fabricated
      command there. `server/testStatePaths.test.mjs` guards it; this checks the guard held.
      *The roadmap reminder warns and never blocks*, deliberately: a failing check would train
      people to bypass it for a typo fix, which is worse than the drift it prevents.
      **What CI will not do is prove a fix works.** "A green test suite is not proof" is written
      down here, twice earned. It catches regressions; the live read-back stays mandatory.
      **AND IT BUILDS A DIFFERENT BUNDLE FROM THE ONE THE PI SERVES — found 2026-08-28, nearly
      reported as a regression.** The Pi's `index` chunk is **564.84 kB**; the same commit on a
      workstation builds **337.29 kB**, with every other chunk byte-identical (same content
      hashes). The cause is not the machine: `src/config/supabase.ts` reads
      `import.meta.env.VITE_SUPABASE_*`, Vite substitutes those at build time, and with them
      unset the ternary folds to `null` and rolldown drops `@supabase/supabase-js` entirely —
      227 kB of it. Confirmed by grepping both bundles: `GoTrueClient` appears only in the Pi's.
      *Two consequences worth having written down.* A bundle-size comparison across machines is
      not like-for-like unless both carry the same `VITE_*` values — this one looked exactly like
      a 227 kB regression. And **CI's runner has no Supabase env either**, so its build exercises
      the null-client path and can never catch a regression in the configured one.
      *Acceptance:* a push runs all three suites and a type-checked build, and a red suite is
      visible without anyone remembering to look.
      No `.github/` directory exists. Over 1,200 test declarations across three suites
      (`npm test`, `npm run test:bridge`, `npm run test:server`) and a public repository, and
      nothing runs them except a person who remembers to.
      Also add the ROADMAP-drift warning that the original documentation prompt proposed and
      nobody built: **warn, never block**, when a commit touches `src/` or `server/` without
      touching `ROADMAP.md`. And a `LICENSE`, a repository description and topics — all three
      are currently empty on a public repo.
      *Two hazards to handle in the workflow rather than discover:* `test:server` spawns real
      processes and binds ports, which a shared runner may not tolerate; and it writes under
      `server/data/`, which `server/testStatePaths.test.mjs` guards on the Pi but which should
      be confirmed on a clean checkout too.
      *What CI will not do:* prove a fix works. This project has "a green test suite is not
      proof" written down, twice earned. CI catches regressions; the live read-back stays
      mandatory.

---

## 3. Future improvements (backlog)

### Onboarding
- ~~**FI-001** (L) Zero-touch device discovery.~~ **Done 2026-08-25** — engine EX-039b, wizard
  EX-040b. Adding a device is now a form on the Devices page: pick the vendor device, name it,
  preview, enrol. The local key comes from the cloud, and both the registry entry and the flow
  nodes are written from one validated decision.
- ~~**FI-002** (M) Day-one setup wizard for a new building: network and vendor-account linking.~~
  **Done 2026-08-31 as `npm run preflight`** — see RM-033. **It became a check, not a wizard, and
  that was the finding.** A wizard implies collecting credentials, and the two that matter here
  cannot be collected by this system: `TUYA_ACCESS_SECRET` reaches hardware directly with nothing
  scoping it and must never be handled outside `server/`, and the network join is a Wi-Fi change
  that `CLAUDE.md` forbids doing remotely — a wrong SSID loses the host with nobody on site to
  recover it. What a second institution actually needs is not something to type into; it is a
  straight answer to "did that work, and what is still wrong". So it reads, reports and exits,
  and every failing line prints the next step for a person to take.

### Replication
- **FI-003** (L) Packaging so a second site can be stood up without redoing the wiring by hand: install script or card image, plus a physical-install guide. **Promoted into RM-033** (2026-08-26). Its blocker was never the packaging — it was that a "site" was not a thing the code had a name for. RM-027 gives it one.

### Reporting
- ~~**FI-018** (S) The baseline numbers exist and no artifact carries them.~~ **Done 2026-08-31**
  — `server/baselineReport.mjs` (pure), `server/baseline-report.mjs` (fetch and write),
  `npm run baseline:report`, 13 tests. **Milestone 1 asks for "a baseline energy dataset and
  benchmarking summary"; `demand:profile` computed the statistics and printed them to a terminal
  nobody keeps.** An artifact is a different deliverable from a statistic: it has a date on it,
  it can be compared against next quarter, and it can be handed to someone who was not in the
  room. Both halves are written together — the CSV is the exact input to the Markdown beside it,
  so the pair cannot drift and a reader can check the summary rather than take it.
  *This is `RM-024` / `EX-107` applied to a document rather than a dashboard*, and a document is
  where overstating is easiest, because a table looks finished whatever went into it. Coverage is
  stated **before** any figure it qualifies, and includes the longest single gap — 80% coverage is
  a healthy month with a few restarts or three weeks up and a week dark, and only the gap tells
  them apart. An hour nobody observed renders `—`, never `0`. A day the meters missed half of is
  marked *partial* with the hours it actually saw, so its kWh reads as a floor rather than a
  total. A window under 1000 readings or 3 building-days heads itself **"This is not a baseline
  yet"** rather than producing a table that looks like the real thing — three days because two
  cannot separate a weekday from a weekend, and the weekend is most of the distance between a
  building's peak and its floor.
  *Energy is read from the meters' own daily counter, not integrated from power samples.*
  Integrating across a gap invents the energy used during an outage, and those are precisely the
  hours least like the ones either side of them.
  *Both guards were neutered and confirmed to fail* — removing the timezone shift broke four
  tests, and forcing the thin-sample check off broke the fifth.
  *The report also states what it does not say*: it is not normalised by floor area or occupancy,
  because neither is recorded and a kWh/m² figure from an assumed area would be the most quotable
  number in the document and the least true.
  *Output is gitignored.* Dated artifacts belong with the submission; a repository accumulating
  stale copies is how the wrong quarter gets cited.

      **Reading the first real report back found two things the tests had not.** `b6701e7` and
      the commit carrying this entry. This is the project's own rule — a green suite is not proof — earning itself
      again, on a run over **11,629 readings, 56.1% coverage, longest gap 5,731 minutes**:
      - **A day nobody watched left no row at all.** 2026-08-18 sat between the 17th and the 19th
        and was simply absent, as were the 21st to the 23rd — the four dark days of the outage
        that ended on the 24th. Every other rule in this file renders a gap as an em dash; an
        absent row renders it as *nothing*, and a reader scanning a column of dates does not
        notice the date that is not there. That is the quietest possible way to lose an outage
        from a document that goes to the university. Blank days are now filled across the
        observed span, and **counted separately**: the three-day floor counts days that were
        actually watched, so one reading either side of a fortnight's outage cannot promote
        itself to a benchmark on the strength of the days nobody saw.
      - **The blank rows then rendered `—–—`** in the observed-hours column — a range from
        nothing to nothing, which reads as a typo rather than as absence.
      *The figures themselves corroborate.* 2026-08-29 and 08-30 come in at 1.54 and 1.26 kWh
      against 21.83 on the 27th: that is a Saturday and a Sunday, and it is exactly the
      weekday/weekend separation the three-day minimum exists to protect.

### Robustness
- ~~**FI-021** (M) Meter arrival tracking.~~ **Done 2026-09-01 — EX-141.** The entry that stood
  here was **wrong about the mechanism**, and the correction is the more useful record: it
  claimed the tracker keyed on value change and had no arrival signal, when the energy
  collector's sample-buffer depth `n` was in the signature all along and does move per message.
  What was actually wrong was narrower and worse. See EX-141.
- ~~**FI-019** (M) The bridge listens on every interface, including the device segment.~~
  **Done 2026-09-01 — EX-144.**
- **FI-020** (S) **A switch's freshness is unmeasurable, and the UI cannot say so.**
  `buildLatest` stamps `ts = now` for any device with no `ctx`, so a switch's staleness watchdog
  can never fire — the same "an always-fresh timestamp cannot look old" failure the meters were
  fixed for in EX-107. Nothing is currently wrong: a switch's `online` comes from
  `global.lightStatus`, a real per-switch connection signal, which is what does the work. But
  EX-133 gave switches a 30 s budget that *by construction* cannot be exceeded, and a budget
  that cannot fire reads like a guarantee. Either the flow's `lightStatus.lastSeen` (which
  exists, and is already carried in the mock's fixture) should feed `seenAt`, or the class
  should declare that it has no measurable freshness and the UI should say "not measured"
  instead of implying live. The second is smaller and more honest; the first is better.
- ~~**FI-013** (S) The Outlet tab never polls its devices.~~ **Done 2026-08-25** — EX-038b.
- **FI-009** (S) Narrow the three remaining whole-map store selectors — `FloorPlanView`, `AlertsPopover`, `EnergyBreakdownCard`. Left alone in the Phase 9 pass because each needs value-level rather than reference-level comparison to gain anything, and FloorPlanView genuinely reads every device.
- ~~**FI-010** (M) The 24h chart has the same offline-blindness the 7d/30d charts just lost.~~ **Done 2026-08-25** — EX-102. The ring buffer records `online` per sample and `pointValue` suppresses a point marked offline, so an unreporting device leaves a gap rather than a flat line. Needs a flow deploy to take effect.
- **FI-011** (S) Push delivery for the monthly report, once FI-005's channel exists. Reports
  are deliberately pull-only today — email or Google Sheets sync would put an SMTP credential
  or a service-account key on a deployment whose repository is public, to solve a problem the
  CSV download already solves in one step (File -> Import). Worth revisiting only as a second
  consumer of the alert channel, never as a reason to build one. Reasoning recorded in
  `docs/adr-001-timeseries-store.md`.
- **FI-012** (M) Partition `readings` by month if growth ever outgrows the current prune. The
  prune is a single unbounded `DELETE` in one transaction — fine at today's volumes, and the
  first thing to degrade as the table grows. Partitioning turns it into a `DROP TABLE` while
  staying inside RLS, Auth and the existing backups. See `docs/adr-001-timeseries-store.md`,
  which names this as the successor to reach for rather than a second datastore.
- ~~**FI-005** (S) An out-of-dashboard alert channel.~~ **Done 2026-08-25** — EX-103. Edge-triggered fleet alarm in the ingest daemon, delivered over ntfy (no account, no credential in a public repo). Set `NTFY_TOPIC` to enable; unset is a supported state.
- ~~**FI-015** (S) Serve the on-segment/absent split through the proxy so the Devices page can
  show it.~~ **Done 2026-08-26** — EX-128. Shipped as an endpoint plus a *conditional note*
  rather than the per-device column this asked for; the column needs a join the registry cannot
  currently make, which is FI-001. See EX-128.
- ~~**FI-016** (S) The Control page's outlet plan still pins `co1..co7` to literal coordinates.~~
  **DONE 2026-08-31.** `25cc516` the lookups, this commit the packs. It was bigger than the
  outlet plan: a guard written first (`test/device-ids-in-frontend.test.mjs`) measured **six**
  files, and they were **two different problems**.
  - **Four were singleton lookups by id** — `acu_main`, `sens_outside_temp`, `l1` — each really
    asking "the aircon", "the outdoor probe", "a lighting circuit" and answering with this
    building's name. At another site the climate tiles read `—` forever and the aircon buttons
    sent into nothing, silently. Fixed by selecting on `class` (`src/lib/siteDevices.ts`).
  - **Two were coordinate tables**, and they needed a pack rather than a lookup.
    `LightingMatrixCard` had the same defect as the outlet plan via `LIGHT_PLAN`, and both drew
    a room shell imported from the 3D pack's geometry — so **`partitionY` was measurably in the
    main chunk**, shipping this building's room dimensions to every deployment.
  **The Control plan is now a pack on RM-032's terms.** `src/components/control/plans/` loads
  only when `SITE.scene_pack` names it; `FloorPlanView` moved into `scene3d/` for the same
  reason, since it was a CARE plan in a directory named as though it were generic.
  *Measured after:* `partitionY`, `co1` and `co7` are **0** in the main chunk, and the pack sits
  in its own lazy chunks. With the pack nulled, **no pack chunk is fetched at all**.
  *The fallback is a sentence, not a second set of controls.* The first draft listed every device
  again — and the page's own tests caught it by finding two of everything, because
  `SwitchesListCard` and `OutletsListCard` already carry them. A site with no plan gets a note
  pointing at those lists; **23 controls remained reachable** with the pack off.
  *Verified on the live control surface, not only in tests:* pins land at the same percentages as
  the old `pct()` values (CO1 at 7.8125% = 25/320 exactly), 21 lamp cells and 7 row labels
  render, and clicking a puck posts one command logged as `Outlet 1 DP1 → off`.
  `src/components/control/OutletPlanCard.tsx` carries a third copy of the same survey, after
  `FloorPlanView` and `scene3d/geometry.ts` — and unlike those two it is **not** inside a scene
  pack, so it renders at every site. Found while closing RM-031, which built the replacement:
  `SpacePlanView` already draws a space's devices from data. The swap is small but not trivial,
  because the Control puck is an interaction (two commandable halves, pending state,
  corroboration) and not just a marker, so it needs the pin to accept children rather than a
  find-and-replace. *Until then, the honest statement is that the tree, the totals, the 2D plan
  and the 3D scene no longer name this building, and the Control page and `BUILT_IN_DEVICES`
  still do.*
- ~~**FI-017** (S) `BUILT_IN_DEVICES` never moved into the site directory.~~ **Done 2026-08-28**
  — `4fb431b`, with a derived guard: `test/site-config.test.mjs` fails if any of this building's
  device ids reappears in `shared/registry.mjs`, prose included. The generated flow came back
  byte-identical, which is the check that mattered. Original entry follows.
  ~~`BUILT_IN_DEVICES` never moved into the site directory.~~ `shared/registry.mjs`
  still holds this building's 21 devices inline, while `shared/sites/mmsu-nberic-care/` carries
  its identity, policy and circuits. RM-027 planned the move and it was not needed to make the
  rest of Track B work, so it was not done. A second site would edit the shared file — which is
  precisely the thing RM-033 has to make unnecessary. Mechanical: `registry.mjs` already composes
  `[...BUILT_IN_DEVICES, ...ENROLLED_DEVICES]`, so this is moving an array and changing one
  import.
- ~~**FI-006** (S) Wire `StaleDataBadge` into the remaining views that derive staleness inline.~~
  **Done 2026-08-31**, and it turned out not to be about the badge. 16 tests across
  `LiveDemandCard`, `MainPanelHealthCard` and `DsmThresholdsCard`.
  **Four components read `s.totals`; none applied the expiry rule that Analytics and Devices
  both use.** So `measured()` — written for the `co5` incident, where an outlet rendered
  `230.4 V / 2.23 A / 514 W` beside an OFFLINE badge — was never reaching the building's own
  figures. The feed goes quiet, the store keeps the last row, and the largest number on the
  dashboard carries on reading like a measurement. Now the demand figure, the three energy
  counters, the voltage and both phase currents go to `—` past five minutes.
  *The worst of it was not a number.* `MainPanelHealthCard` printed **BALANCED** and "Red and
  Yellow are within a comfortable range of each other" — a claim about the building's electrical
  state *right now* — from whatever row happened to be in the store. Expiring the inputs retires
  the sentence and the pill with them, and the phase bars no longer draw a width for a value the
  card will not print. A full bar beside an em dash is the same lie in a different medium.
  *`DsmThresholdsCard` is where it mattered most*, because it is the page where someone decides
  whether to arm a mechanism that cuts power to a working building unattended. Its two errors are
  symmetrical: a **BREACHED** flag from a ten-minute-old row is a false alarm, and **OK** from
  that same row is a false all-clear. There are now four states rather than two — `OK` had been
  standing in for three different situations, and a green word carries reassurance whichever one
  produced it.
  **The fourth was found by looking at the page, not by a test.** With the card rendering against
  the mock, the readout said `Live: 13.9 A max phase` beside a status of **NO READING** — the
  reading was there; the *threshold* was unset. Two absences with two different fixes, one a
  missing number on that very form and the other a bridge that has stopped reporting, so they get
  two words: **NO LIMIT SET** and **NO READING**, both muted rather than green. The unit tests
  had agreed with the conflation because they only ever set thresholds.
  **The badge itself was the wrong instrument and is deliberately not used.** `LiveDemandCard`
  already carries a LIVE/STALE/RECONNECTING pill; adding a second "stale" flag beside it would
  have put two freshness indicators in one card. The pill was reporting only the *link* — messages
  were arriving, so it said LIVE while the totals row underneath had stopped advancing. Those are
  different facts and the one a reader looking at "1.23 kW" needs is the second, so the pill now
  answers both and is a live region, which it was not: a span that silently swaps its text
  announces nothing, and a figure going stale is the most important state change on a monitoring
  dashboard.
  *`FloorPlanView` was left alone on purpose.* It already dims per-device via SVG opacity, and
  `StaleDataBadge` renders a `div` — it cannot wrap SVG. Announcing staleness on the plan needs a
  different mechanism and is not this item.
  *Neuter-verified:* forcing `isReadingExpired` to `false` failed 8 of the 16.

### Accessibility
- ~~**FI-007** (S) `--good` on `--good-soft` measures 4.45:1 against the page background.~~
  **Done 2026-08-31**, and the entry understated it. FI-007 read this as one token's latent
  hazard — *"passes everywhere it currently renders, but will fail the first time a green badge is
  placed directly on the page."* Extending FI-008's guard to the composition rather than the token
  showed **it was already live in three of the four dark-theme semantics**, on `.badge--*`, which
  the shared `Badge` component renders across the app.
  **Why a badge is the worst case in the palette.** `.badge--good { background: var(--good-soft);
  color: var(--good); }` — the tint is translucent, so it composites onto whatever surface the
  badge sits on and pulls that surface *towards the text colour*, which is the one direction that
  destroys contrast. Every pair lost between 0.4 and 1.5 against its plain-surface figure.
  Measured worst cases before: dark `--bad` **3.75:1**, dark `--blue` **3.63:1**, dark `--good`
  **3.97:1**, light `--warn` and light `--blue` **4.27** and **4.24**.
  **Lowering the tint alpha could not fix it, which is the finding that changed the approach.**
  Solved numerically: light `--warn` and dark `--blue` stay under AA *even at alpha 0*, because
  those text tokens sit at 4.24–4.58 on the darkest flat surface before any tint exists. So the
  text tokens moved instead — darker in light, lighter in dark, 1–7 per channel in light and
  13–20 in dark, same hue throughout. Every shift also *raises* contrast on plain surfaces, so
  nothing was traded away to buy this.
  *One tint did move, for a different reason.* Dark `--red-soft` derived from `--red` while the
  light theme's derives from `--red-bright`. That inconsistency was self-defeating: the chip
  lightened further every time `--red` was lightened, pushing badge text back under AA exactly
  when the text colour was raised to clear it. Dark now follows the light convention.
  *Verified in a real browser on the actual `.badge--*` elements*, not only in the file — light
  good/warn/bad **4.85 / 4.83 / 5.44**, dark **4.62 / 5.81 / 4.56**, all over `--bg-surface-2`,
  the worst flat surface.
  *`scene3d/tokens.ts` mirrors `--good` and `--warn` into Three.js materials and was updated with
  them*; its own drift guard reads the first occurrence in the stylesheet and confirms the pair.
  *The guard now covers seven text/tint pairs across both themes*, including the four the
  stylesheet does not compose today — a `-soft` token exists to be the background for its matching
  text colour, and that is the palette's contract whether or not a component has used it yet.

### Developer experience
- ~~**FI-008** (S) A contrast regression guard.~~ **Done 2026-08-31** — `test/contrast.test.mjs`,
  8 tests. Every text token measured against every surface that carries text, in **both themes**:
  8 × 8 × 2 = 128 pairs, held to WCAG AA 4.5:1. The palette cannot know what size type a token
  will be used at, so it is held to the normal-text bar rather than the 3:1 large-text one.
  **It found a real one on its first run.** Dark `--red` was `#e06155`, verified at 4.8:1 against
  `--bg-surface` and never against `--bg-surface-2` — where it measures **4.33:1**, under AA, on
  a surface twenty-odd rules use. Nothing rendered red text there yet, which is exactly the
  FI-007 pattern this file exists to get ahead of: passes everywhere it currently appears, fails
  the first time it is placed somewhere new. Raised to `#e6675b` (4.65:1 there, 5.13:1 on
  `--bg-surface`) — six per channel, below a visible difference and above the bar.
  *Confirmed in a real browser, not only in the file:* `getComputedStyle` on the live dark
  cascade returns `#e6675b` and the same two ratios to the hundredth.
  **And the first fix was incomplete, which the widened guard then caught.** `--bad` is a
  hand-copied duplicate of `--red` carrying the comment `= --red`; raising `--red` left the copy
  four lines away still at 4.33:1. It has to stay a duplicate — `scene3d/tokens.ts` mirrors it
  into a Three.js material and three.js cannot resolve `var()`, and the mirror's own drift guard
  reads the first `--bad:` in the file — so `--good`/`--warn`/`--bad` joined the measured set and
  the equality the comment merely asserted is now a test. A comment cannot notice a drift; a
  duplicate that nothing checks is a bug with a delay on it.
  **Deliberately measures pairs the app does not compose today.** Checking only current
  compositions would make this file agree with every latent hazard instead of finding them,
  which is how `--red` survived.
  *Deliberately not measured:* `--accent` (2.15:1 in light — the stylesheet ships `--accent-text`
  for exactly this reason) and `--faint`/`--faintest`, which are documented decoration-only.
  Asserting those would record a rule the palette already states rather than find anything.
  *Two parsing traps, both paid for while writing it, both now documented in the file.* `:root`
  also appears inside `@media (prefers-contrast: high)`, which redefines `--muted` and
  `--muted-2`; folding that in made `--muted` measure identically to `--txt` — a wrong number
  that looked entirely plausible. And a translucent token is not a colour until composited:
  `--glass` over `--bg-page` resolves to `rgb(251,252,253)`, the exact figure `src/index.css`
  documents for its own hand-verification, and a test asserts that agreement — which is what
  ties this file's arithmetic to the palette's.
  *The maths is self-tested* (black on white = 21:1, a colour on itself = 1:1, `#767676` on white
  = 4.54:1) so a passing palette cannot mean a broken formula, and **both halves were neutered
  and confirmed to fail** — the dark half by the real `--red` defect, the light half by a
  synthetic `--muted-2`.
  *What it does not do:* read the DOM. It measures the palette, not the page, so text on a
  gradient or an inline colour is still only findable in a browser — which is what found the
  1.14:1. `test/design-tokens.test.mjs` remains the cheaper guard beside it: that one catches a
  token name that never existed, this one catches a name that exists and cannot be read.

---

## 4. Known contradictions & doc drift

| # | Contradiction | Sources | Believed |
|---|---|---|---|
| ~~1~~ | ~~"Stage 1 is view-only…"~~ | — | **Resolved.** `README.md`'s Rules section now says "Control exists, but hardware dispatch is gated" and describes the audit-row-first ordering accurately. |
| ~~2~~ | ~~`package.json` `description` says "view-only"~~ | — | **Resolved.** It describes audited, gate-controlled dispatch. |
| ~~3~~ | ~~Architecture planning proposed MQTT + Home Assistant as the device layer~~ | — | **Resolved 2026-08-26 at the source.** The code was always right; the fix was to stop the planning doc from saying otherwise. `ibems-architecture-upgrade_2.md` (one level up, outside this repo) was rewritten: Home Assistant is now recorded as *not adopted*, MQTT as *not the device bus*, and both sit in a settled-decisions table so they are not re-proposed. It had been steering readers into planning around a component nobody was going to install. |
| 4 | Mosquitto is described as dropped, but the broker is installed and running on the Pi | planning docs vs. the live host | **Both, partially — and now measurably idle.** The bridge genuinely does not use MQTT; the broker is still installed, running, and subscribed to by one flow node. As of 2026-08-26 it carries **no traffic at all**: five minutes on every topic, zero messages (§5 Q2). So it is not a second device layer, it is a dependency nothing currently feeds — which is the thing to weigh before RM-026 chooses to route the inverter through it. **RM-026 has since chosen it**, so the broker acquires its first real consumer — and a liveness check on that topic is part of that work, not an extra, precisely because nothing noticed the last publisher going silent. |
| ~~5~~ | ~~`README.md` points at a Stage 1 plan path outside the repo~~ | — | **Resolved.** `README.md` now points at `ROADMAP.md` and the two in-repo docs. |

---

## 5. Unverified / needs confirmation

1. ~~**Why did every Tuya device drop at once?**~~ **Answered 2026-08-24, on site — and
   the earlier answer was wrong in a way that mattered.** It was recorded as a 2.4/5 GHz band
   mismatch. On site that turns out to be two faults: the Pi's SSID had **client isolation**
   (it could not reach a host on its own /24, which a band split cannot cause), *and* the
   devices had moved to Tuya protocol v3.4/v3.5 while the flow still declared 3.1/3.3. Only
   the second explains `mtr_co_yellow` dropping three days earlier than everything else. Both
   fixed — see RM-001.

2. ~~**Is the ESP32 still publishing its AC status?**~~ **Answered 2026-08-26: no.** The
   previous answer excused the silence — the ESP32 is 2.4 GHz and the Pi was on 5 GHz, so the
   outage explained it. That excuse is now gone: with the Pi back on the device SSID, a
   five-minute subscription to **every** topic on the local broker saw zero messages. The broker
   is running and the flow still subscribes to `nbric/ac/status`. So the ESP32 itself is silent,
   and has been for days with nothing noticing — which is the more useful finding, because it
   says any MQTT path here needs a liveness check to be trustworthy (see RM-026(b)).
3. ~~**Was the light token ever exercised against real hardware?**~~ **Answered 2026-08-25.**
   The operator toggled `l6` from the Control page and the physical fixture responded, with
   three `POST /api/command` calls logged `-> OK` and Node-RED showing `Connected to device!`
   for that node. Rotation was already confirmed (the old token is rejected); this closes the
   other half — the new token drives real hardware.
4. **Is there a backup of the Supabase project?** The repo now *configures* one — `npm run
   backup` and `docs/backup-policy.md` — but nothing has *verified* one. No restore has been
   tried, and whether Supabase itself takes a backup depends on a plan tier this pass could
   not check. See RM-006d.
5. ~~**Should `--good` be corrected pre-emptively** (FI-007), or left until a green badge actually
   lands on the page background?~~ **Answered 2026-08-31: the question had a false premise.** It
   was not waiting to fail — measuring the composition rather than the token showed three of the
   four dark-theme semantics were *already* under AA on the badges the app renders today. "Leave
   it until it fails" is only a real option when you have checked whether it has.
5b. ~~**Should device readings move to a purpose-built time-series database?**~~ **Answered
   2026-08-21, amended 2026-08-22** — including the stronger form of the question, "Supabase
   as the brain and InfluxDB as the engine, with Google Sheets for reporting". The answer is
   one Postgres store, with the triggers that would reverse it and the partitioning step to
   try first both written down: `docs/adr-001-timeseries-store.md`. The amendment records the
   measured evidence (auto-shed alone spans telemetry, thresholds, device config and the audit
   trail in one 15-second decision) and the one argument against that is not technical.
6. ~~**What retention period is wanted for `readings`?**~~ **Answered 2026-08-21: 30 days of
   per-minute resolution, with permanent hourly buckets behind it** (RM-006). Chosen by the
   operator so a year-scale energy claim stays defensible without the raw table growing
   without bound.
7. **Has the Analytics 7d/30d fix been seen in a real browser?** The truncation is fixed and
   unit-tested, but the end-to-end check needs RM-008 applied first, and needs a browser —
   the duplicate-CORS-header incident recorded in `server/proxy.mjs` was invisible to curl.
8. **Everything Phase 10-13 asserts about the live database is unverified.** This pass was
   written from a workstation with no Supabase credentials, no `psql` and no Docker, and the
   Supabase MCP connector was not authorised. Specifically unconfirmed: that the three new
   migrations parse and run; the project's plan tier and therefore whether Supabase takes any
   backup of its own (`docs/backup-policy.md` turns on this); current row counts; and whether
   the report timezone default (`Asia/Manila`) matches what the Tuya devices actually reset
   their daily counters on. The last one is worth a deliberate check — the report's energy
   figures depend on it, and it is invisible until a month is reconciled by hand.
   **RM-027 is where it gets fixed rather than merely checked:** the timezone is currently a
   SQL default AND a hardcoded UTC offset in `shared/buildLatest.mjs`, two places that can
   disagree with each other. It becomes one per-site value.
9. **Has the Reports page been seen with real data?** The coverage logic, the CSV serializer
   and the page's honesty properties are unit-tested (`ReportsPage.test.tsx` asserts that a
   sparse month cannot quote a bare total), but no report has been generated from real rows.
   Blocked on RM-009.

10. ~~**Is 16 °C an acceptable aircon setpoint here?**~~ **Answered by building it,
    2026-08-26.** The floor is 25, it lives in `SITE.policy`, and `validateCommand` enforces
    it server-side — so a request that never went through the dashboard is refused too.
    `ACU_MIN_C` was deliberately left at 16: that is what the IR library has codes for, a
    hardware bound, and a policy may narrow it but never widen it. **If 25 is wrong, one
    value in one file changes it.** Original question: `shared/commands.mjs` sets `ACU_MIN_C = 16`
    and validates it server-side, so the Control page can legitimately command it. The funded
    project plan's Key Features state the university's policy as **"not lower than 25 °C"**.
    Either the floor is wrong or the plan is describing an aspiration rather than a rule, and
    only the operator knows which. If it is a rule, RM-027's per-site policy is where it belongs
    — a UI that merely hides the option is not enforcement, and this system's own convention is
    that the bound lives beside the validator.

11. **Is occupancy-sensing hardware actually being bought?** The plan's Key Features list
    "lighting system controlled via motion sensors and timers". Timers exist. No occupancy or
    motion member exists in `src/lib/types.ts`'s `DeviceClass` union, and no such device is
    enrolled or visible in the vendor project. This is less a software gap than an unanswered
    procurement question, and the answer decides whether it is a phase or a footnote.

12. **Where is the baseline report?** Milestone 1 wants a "baseline energy dataset and
    benchmarking summary", and its two open checklist items are the last ones in Activity 1.
    `npm run demand:profile` computes the figures — it is what produced the DSM limits — but it
    prints to a terminal and leaves nothing citable behind. The Reports page already has the CSV
    serializer and the coverage-honesty logic this would need (EX-033, EX-034), so the gap is an
    output, not a calculation.
