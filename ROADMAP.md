# iBEMS — Feature State & Roadmap

**Last audited:** 2026-08-25 (UTC)
**Audited at commit:** `82cf265`
**Audit method:** static read of the working tree, plus **on-site inspection at CARE office** —
live SSH, a Wi-Fi survey from the Pi's own radio, and packet-level capture of the devices' Tuya
discovery broadcasts.
The Phase 10-13 entries below were added from a workstation with no database access — see
§5 Q8 for exactly what that leaves unverified.

> This repository is **public**. No tokens, keys, passwords, hostnames, IP addresses, or
> Supabase project identifiers may appear in this file. Where a deployment detail matters,
> describe it generically ("the Pi", "the tailnet address").

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

- [x] **EX-100** Supabase Auth with a login screen; the proxy verifies the caller's own token — `src/components/auth/LoginPage.tsx`, `server/proxy.mjs`
- [x] **EX-101** Command audit rows attributed to the real signed-in user, inserted with the caller's token so RLS grants it — `server/proxy.mjs`
- [x] **EX-102** Remote access over the tailnet, verified working from off-site
- [x] **EX-103** Anon key only in the browser bundle; the service-role key is read solely by the ingestion daemon — `src/config/supabase.ts`, `server/.env.example`

### Testing & tooling

- [x] **EX-120** 494 frontend tests (vitest) — `src/**/*.test.ts(x)`
- [x] **EX-121** 189 bridge/contract tests, including assertions that the generated flow contains no write nodes and no MQTT — `test/`
- [x] **EX-122** 174 server tests against real spawned processes and hand-rolled fake HTTP servers, no mocking library — `server/*.test.mjs`
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
      **Analysed in `docs/adr-002-device-recovery-path.md`.** A Tuya device holds two
      independent paths — inbound local TCP, and an outbound connection it keeps open to Tuya —
      and they fail separately. An ESP device with an exhausted socket table is unreachable
      locally while its cloud connection stays healthy, which is exactly "hung here, fine in the
      app". Measured support: two nodes hold two sessions to each of the two shared meters (16
      sessions for 14 devices), discovery hammered them at 2,520 failed attempts per 30 min
      before `findTimeout` was fixed, and Tuya currently reports ~12 online against the bridge's
      ~8.
      **Proposed: cloud dispatch as a fallback**, retried when a local command fails. Local stays
      primary — faster, works without internet, no vendor dependency. Cloud is the path that
      exists precisely when local has failed.
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
      `NBRIC IR Blaster` and `Outside Temp` came back **NOT IN PROJECT** from
      `npm run tuya:devices`. They can never work — the ids in the flow belong to no device this
      account can see, which is why they have never announced and never will. Either they were
      removed from the Smart Life account, or they belong to a different one.
      This is also why `sens_outside_temp` has no real telemetry: `acu_main` and
      `sens_outside_temp` both read `ac_dash_state`, which the IR blaster feeds.

- [ ] **RM-012** `l6` (Light Switch 6) transmits but cannot be reached — a one-way link.
      *Acceptance:* `ip neigh` resolves its address, and it stays online across an hour.
      **Diagnosed 2026-08-24, and it is not a configuration fault.** It broadcasts discovery
      normally (its id appears in the UDP 6667 survey), but a direct probe returns
      `EHOSTUNREACH …:6668` at *every* protocol version, and its address shows `FAILED` in the
      Pi's ARP table while a healthy peer on the same AP resolves. So the device transmits and
      the Pi cannot send anything back to it — no key, version or timeout setting can fix that.
      Generating ~150 discovery timeouts every 2 minutes, by far the noisiest node.
      Likely RF range, a power-save state, or a stale address. **Needs eyes on the fixture:** is
      it powered, has it been moved, where is it relative to the access point.

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
- [ ] **RM-006c** Assign load-shed tiers. **Thresholds done 2026-08-24; tiers are the operator's.**
      *Acceptance:* at least one device has a shed group, a threshold is set, and auto-shed is on.
      **Limits written, `auto_shed` deliberately left OFF:** `max_total_kw 2.21`,
      `max_phase_current 15.4` — 25% above a measured peak of 1,767.8 W / 12.30 A over 1,877
      readings (`npm run demand:profile`). A breach is now *detected and reported* on the
      dashboard while nothing switches on its own, which is the monitoring value with none of
      the risk. Both are editable on the Automation page; the operator expects to revise them,
      since the peak depends on what happens to be connected and tested at the time.
      **Tiers deliberately unassigned.** Auto-shed can reach switches, outlets and the aircon
      now that `DISPATCH_CLASSES` covers all three and the gate is open, and it never restores —
      so which circuits the building may lose unattended is a facility decision, made in the
      Devices page's Edit dialog rather than inferred from data.
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

## 3. Future improvements (backlog)

### Onboarding
- ~~**FI-001** (L) Zero-touch device discovery.~~ **Done 2026-08-25** — engine EX-039b, wizard
  EX-040b. Adding a device is now a form on the Devices page: pick the vendor device, name it,
  preview, enrol. The local key comes from the cloud, and both the registry entry and the flow
  nodes are written from one validated decision.
- **FI-002** (M) Day-one setup wizard for a new building: network and vendor-account linking.

### Replication
- **FI-003** (L) Packaging so a second site can be stood up without redoing the wiring by hand: install script or card image, plus a physical-install guide.

### Robustness
- ~~**FI-013** (S) The Outlet tab never polls its devices.~~ **Done 2026-08-25** — EX-038b.
- **FI-009** (S) Narrow the three remaining whole-map store selectors — `FloorPlanView`, `AlertsPopover`, `EnergyBreakdownCard`. Left alone in the Phase 9 pass because each needs value-level rather than reference-level comparison to gain anything, and FloorPlanView genuinely reads every device.
- **FI-010** (M) The 24h chart has the same offline-blindness the 7d/30d charts just lost: the bridge's ring buffer and `HistoryPoint` carry no `online` field, so a device offline for a day still draws its frozen last wattage. Fixing it means regenerating and redeploying the live Node-RED flow — a layer-1 change on load-bearing hardware, so it needs explicit approval, not a quiet follow-up.
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
- **FI-005** (S) An out-of-dashboard alert channel. Deliberately deferred once, but a multi-hour device outage went unnoticed because the only place it would have surfaced was a screen nobody was looking at.
- **FI-006** (S) Wire `StaleDataBadge` into the remaining views that derive staleness inline, so freshness is announced consistently rather than re-implemented per card. *(Partly addressed 2026-08-21: every view now shares one wall-clock tick and one stale-dim constant per medium, but the badge itself is still not used everywhere.)*

### Accessibility
- **FI-007** (S) `--good` on `--good-soft` measures 4.45:1 against the page background (4.99 on a card). It passes everywhere it currently renders, but will fail the first time a green badge is placed directly on the page. The same page-versus-card split already required `--warn-on-page`.

### Developer experience
- **FI-008** (S) A contrast regression guard. Three separate AA failures were found by measuring during this audit; nothing currently prevents a fourth.

---

## 4. Known contradictions & doc drift

| # | Contradiction | Sources | Believed |
|---|---|---|---|
| ~~1~~ | ~~"Stage 1 is view-only…"~~ | — | **Resolved.** `README.md`'s Rules section now says "Control exists, but hardware dispatch is gated" and describes the audit-row-first ordering accurately. |
| ~~2~~ | ~~`package.json` `description` says "view-only"~~ | — | **Resolved.** It describes audited, gate-controlled dispatch. |
| 3 | Architecture planning proposed MQTT + Home Assistant as the device layer | planning docs vs. `shared/registry.mjs` + `test/contract.test.mjs`, which asserts the generated flow contains no MQTT | **The code.** The simpler design was chosen deliberately; MQTT/HA was abandoned. |
| 4 | Mosquitto is described as dropped, but the broker is installed and running on the Pi | planning docs vs. the live host | **Both, partially.** The bridge genuinely does not use MQTT; the broker is a survivor of the pre-Stage-1 flow. See RM-005. |
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

2. **Is the ESP32 still publishing its AC status?** (RM-005) Nothing arrived during a live
   listen, but the ESP32 is a 2.4 GHz device and the site is on 5 GHz, so the outage fully
   explains the silence. Answerable only once RM-001 is fixed. Everything else that used
   Mosquitto has now been removed.
3. **Was the light token ever exercised against real hardware?** Rotation is confirmed — the old token is rejected — but no fixture has been observed responding to the new one.
4. **Is there a backup of the Supabase project?** The repo now *configures* one — `npm run
   backup` and `docs/backup-policy.md` — but nothing has *verified* one. No restore has been
   tried, and whether Supabase itself takes a backup depends on a plan tier this pass could
   not check. See RM-006d.
5. **Should `--good` be corrected pre-emptively** (FI-007), or left until a green badge actually lands on the page background?
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
9. **Has the Reports page been seen with real data?** The coverage logic, the CSV serializer
   and the page's honesty properties are unit-tested (`ReportsPage.test.tsx` asserts that a
   sparse month cannot quote a bare total), but no report has been generated from real rows.
   Blocked on RM-009.
