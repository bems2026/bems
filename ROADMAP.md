# iBEMS — Feature State & Roadmap

**Last audited:** 2026-08-21 (UTC)
**Audited at commit:** `48c3333`
**Audit method:** static read of the working tree, plus live inspection of the deployed Pi over SSH

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
- [x] **EX-007** Control page: lighting matrix, outlet plan with per-socket pucks, switch/outlet lists, IR command centre, session command log — `src/components/control/`
- [x] **EX-008** Devices fleet table with per-device comm state and metadata editing — `src/components/devices/DevicesView.tsx`, `src/components/devices/DeviceMetaEditor.tsx`
- [x] **EX-009** Automation page: Supabase-backed schedules and DSM thresholds — `src/components/automation/`
- [x] **EX-010** Weather cards from Open-Meteo (no API key) — `src/components/weather/`
- [x] **EX-011** Alerts bell merging staleness watchdog and anomaly alerts under one acknowledge set — `src/components/layout/AlertsPopover.tsx`
- [x] **EX-012** Manual dark theme with WCAG-checked token overrides — `src/index.css`, `src/stores/themeStore.ts`
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

### Auth & security

- [x] **EX-100** Supabase Auth with a login screen; the proxy verifies the caller's own token — `src/components/auth/LoginPage.tsx`, `server/proxy.mjs`
- [x] **EX-101** Command audit rows attributed to the real signed-in user, inserted with the caller's token so RLS grants it — `server/proxy.mjs`
- [x] **EX-102** Remote access over the tailnet, verified working from off-site
- [x] **EX-103** Anon key only in the browser bundle; the service-role key is read solely by the ingestion daemon — `src/config/supabase.ts`, `server/.env.example`

### Testing & tooling

- [x] **EX-120** 376 frontend tests (vitest) — `src/**/*.test.ts(x)`
- [x] **EX-121** 93 bridge/contract tests, including assertions that the generated flow contains no write nodes and no MQTT — `test/`
- [x] **EX-122** 48 server tests against real spawned processes and hand-rolled fake HTTP servers, no mocking library — `server/*.test.mjs`
- [x] **EX-123** Schema guard tests asserting RLS shape per migration — `test/device-config-schema.test.mjs`, `test/phase8-anomalies-schema.test.mjs`
- [x] **EX-124** Operational scripts encoding the real workflow — `package.json` (`mock`, `verify:pi`, `deploy:pi`, `ingest`, `build:flow`, `rotate-light-token:pi`)

---

## 2. Current roadmap (active execution)

- [ ] **RM-001** Put the Pi back on the same 2.4 GHz network as the field devices.
      *Acceptance:* `GET /api/readings/latest` reports `online: true` for the metered devices, and building totals stop reading `null`.
      **Blocked — requires on-site access. Root cause known: a Wi-Fi band mismatch.** The Tuya
      field devices join 2.4 GHz only; the network the Pi is on is 5 GHz. Every symptom follows
      from that — the Pi keeps internet and remote access, yet sees exactly one other host on its
      own subnet and times out local discovery for all 18 devices. All 18 stopped responding on
      2026-08-20 at 15:27 local.
      *Do not attempt this remotely.* Re-pointing the Pi's Wi-Fi over SSH risks losing the host
      outright if the SSID or credentials are wrong, with nobody on site to recover it.
      Once the band is corrected, expect no code change to be needed: the bridge resumes
      discovery on its own, and `online` flips back without intervention.
- [ ] **RM-002** Verify the rotated light token against a real fixture.
      *Acceptance:* a light physically changes state in response to one command. **Requires eyes on the fixture** — switches carry no metering context, so there is no telemetry-based confirmation.
- [ ] **RM-003** Open the hardware-dispatch gate (`HARDWARE_DISPATCH_ENABLED=true`) and confirm a real relay responds.
      *Acceptance:* a light toggles from the UI, its audit row reads `dispatched`, and outlet/ACU commands still read `dry_run`. **Requires someone watching the hardware.** Config is already staged; this is a one-word edit plus a proxy restart.
- [ ] **RM-004** Re-check anomaly detection for false positives once real telemetry resumes.
      *Acceptance:* a week of live-varying data with no unexplained alerts on the cyclical-load branch meters. The current zero-alert result is not evidence — the meters have been returning frozen values.
- [ ] **RM-005** Decide whether Mosquitto is still load-bearing or can be decommissioned.
      *Acceptance:* a recorded answer. **Mostly answered 2026-08-21.** A live listen showed the
      only clients on the broker were Node-RED's own connections, and the only traffic was the
      MQTT twin talking to itself — since removed (EX-068), along with a stale retained message
      on its topic. What remains is one subscription: the ESP32 AC sniffer, which received
      nothing. That is *not* proof it is retired, because the ESP32 is a 2.4 GHz device and the
      site is currently on 5 GHz (RM-001). **Re-check once the band is fixed: if the ESP32 still
      publishes nothing, Mosquitto has no remaining user and can go.**
- [ ] **RM-006** Data retention: automatic cleanup so `readings` does not grow without bound, and a backup policy for the Supabase project.
      *Acceptance:* a documented, scheduled policy; old rows aged out on a defined schedule.
- [ ] **RM-006c** Assign load-shed tiers and set DSM limits before auto-shed can do anything.
      *Acceptance:* at least one device has a shed group, a threshold is set, and auto-shed is on.
      Nothing is configured today, so the mechanism is live but inert by design. Note that only
      lights can currently be shed, which limits how much load it can actually drop.
- [ ] **RM-007** Sign in once on the office kiosk so it leaves the login screen.
      *Acceptance:* the kiosk shows the dashboard and stays signed in across a reboot. The session-refresh fix (EX-021) is what keeps it there.

---

## 3. Future improvements (backlog)

### Onboarding
- **FI-001** (L) Zero-touch device discovery, so adding a device does not require extracting vendor keys by hand. The current metadata editor covers labelling existing devices, not adding new ones. Only worth doing if manual key extraction proves a recurring pain.
- **FI-002** (M) Day-one setup wizard for a new building: network and vendor-account linking.

### Replication
- **FI-003** (L) Packaging so a second site can be stood up without redoing the wiring by hand: install script or card image, plus a physical-install guide.

### Robustness
- **FI-005** (S) An out-of-dashboard alert channel. Deliberately deferred once, but a multi-hour device outage went unnoticed because the only place it would have surfaced was a screen nobody was looking at.
- **FI-006** (S) Wire `StaleDataBadge` into the remaining views that derive staleness inline, so freshness is announced consistently rather than re-implemented per card.

### Accessibility
- **FI-007** (S) `--good` on `--good-soft` measures 4.45:1 against the page background (4.99 on a card). It passes everywhere it currently renders, but will fail the first time a green badge is placed directly on the page. The same page-versus-card split already required `--warn-on-page`.

### Developer experience
- **FI-008** (S) A contrast regression guard. Three separate AA failures were found by measuring during this audit; nothing currently prevents a fourth.

---

## 4. Known contradictions & doc drift

| # | Contradiction | Sources | Believed |
|---|---|---|---|
| 1 | "Stage 1 is view-only. No `POST` endpoints, no control wiring, no toggles anywhere in this repo." | `README.md` Rules section vs. `src/components/control/`, `POST /api/command` in `server/proxy.mjs`, and `dispatchLightCommand` | **The code.** Control shipped; dispatch for lights exists and is gated, not absent. |
| 2 | `package.json` `description` still says "view-only" | `package.json` vs. same evidence as above | **The code.** |
| 3 | Architecture planning proposed MQTT + Home Assistant as the device layer | planning docs vs. `shared/registry.mjs` + `test/contract.test.mjs`, which asserts the generated flow contains no MQTT | **The code.** The simpler design was chosen deliberately; MQTT/HA was abandoned. |
| 4 | Mosquitto is described as dropped, but the broker is installed and running on the Pi | planning docs vs. the live host | **Both, partially.** The bridge genuinely does not use MQTT; the broker is a survivor of the pre-Stage-1 flow. See RM-005. |
| 5 | `README.md` points at a Stage 1 plan path outside the repo | `README.md` | Stale link; the plan is not in version control. |

---

## 5. Unverified / needs confirmation

1. ~~**Why did every Tuya device drop at once?**~~ **Answered 2026-08-21: a Wi-Fi band
   mismatch.** The devices are 2.4 GHz-only and the Pi's network is 5 GHz. See RM-001.
   Separately, the Pi lost its *own* uplink for about seven minutes on 2026-08-21 and recovered
   without rebooting (uptime unbroken, boot id unchanged) — a distinct, transient event, not the
   same fault, and not evidence of a worsening one.
2. **Is the ESP32 still publishing its AC status?** (RM-005) Nothing arrived during a live
   listen, but the ESP32 is a 2.4 GHz device and the site is on 5 GHz, so the outage fully
   explains the silence. Answerable only once RM-001 is fixed. Everything else that used
   Mosquitto has now been removed.
3. **Was the light token ever exercised against real hardware?** Rotation is confirmed — the old token is rejected — but no fixture has been observed responding to the new one.
4. **Is there a backup of the Supabase project?** Nothing in this repo configures or verifies one.
5. **Should `--good` be corrected pre-emptively** (FI-007), or left until a green badge actually lands on the page background?
6. **What retention period is wanted for `readings`?** The right answer depends on the reporting window the project needs to defend, which is not recorded anywhere in this repo.
