# iBEMS — Feature State & Roadmap

**Last audited:** 2026-08-21 (UTC)
**Audited at commit:** `b8e7159`
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
- [x] **EX-046** Log rate limit for the bridge unit, so a device-discovery failure loop cannot evict the journal's history — `server/nodered-log-ratelimit.conf`

### Bridge & hardware

- [x] **EX-060** Node-RED flow generated from a single canonical device registry; never hand-edited — `shared/registry.mjs`, `node-red-bridge/build-flow.mjs`
- [x] **EX-061** Deploy script that refuses to write unless the live flow's tab ids/labels match what generation assumed — `node-red-bridge/deploy.mjs`
- [x] **EX-062** Read-only health check safe to run at any time — `node-red-bridge/verify.mjs`
- [x] **EX-063** Tuya health-signal repair: devices can now actually report disconnected, and a disconnected meter contributes nothing to totals rather than its frozen last reading — `node-red-bridge/fix-tuya-health-signals.mjs`, `shared/buildLatest.mjs`
- [x] **EX-064** Light API token rotation, moving a hardcoded plaintext token to an environment variable and closing the fail-open branch — `node-red-bridge/rotate-light-api-token.mjs`
- [x] **EX-065** Real hardware dispatch for lights, gated closed by default; the proxy refuses to start if the gate is open with no token — `server/proxy.mjs`
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

- [ ] **RM-001** Restore the site network link between the Pi and the Tuya devices.
      *Acceptance:* `GET /api/readings/latest` reports `online: true` for the metered devices, and building totals stop reading `null`.
      **Blocked — requires on-site or router access.** All 18 devices with a health signal stopped responding on 2026-08-20 at 15:27 local; local discovery times out for every device. The Pi has since also lost its own uplink for ~7 minutes without rebooting (uptime unbroken), so whatever is failing is progressing beyond the devices to the Pi's link as well.
- [ ] **RM-002** Verify the rotated light token against a real fixture.
      *Acceptance:* a light physically changes state in response to one command. **Requires eyes on the fixture** — switches carry no metering context, so there is no telemetry-based confirmation.
- [ ] **RM-003** Open the hardware-dispatch gate (`HARDWARE_DISPATCH_ENABLED=true`) and confirm a real relay responds.
      *Acceptance:* a light toggles from the UI, its audit row reads `dispatched`, and outlet/ACU commands still read `dry_run`. **Requires someone watching the hardware.** Config is already staged; this is a one-word edit plus a proxy restart.
- [ ] **RM-004** Re-check anomaly detection for false positives once real telemetry resumes.
      *Acceptance:* a week of live-varying data with no unexplained alerts on the cyclical-load branch meters. The current zero-alert result is not evidence — the meters have been returning frozen values.
- [ ] **RM-005** Decide whether Mosquitto is still load-bearing or can be decommissioned.
      *Acceptance:* a recorded answer. Checkable remotely by subscribing to all topics for a short window; only escalate on-site if a live publisher appears.
- [ ] **RM-006** Data retention: automatic cleanup so `readings` does not grow without bound, and a backup policy for the Supabase project.
      *Acceptance:* a documented, scheduled policy; old rows aged out on a defined schedule.
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
- **FI-004** (S) Per-class dispatch for outlets and the ACU. Neither has a hardware endpoint today; the proxy already isolates the rule to one constant, so this is additive.
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

1. **Why did every Tuya device drop at once?** The Pi kept its uplink and internet while losing sight of essentially every host on its own subnet. Access-point client isolation, an SSID or VLAN change, and a power event affecting the devices' AP all fit what is observable remotely. Which was it?
2. **Is Mosquitto still carrying the original sensor feed**, or is it vestigial? (RM-005)
3. **Was the light token ever exercised against real hardware?** Rotation is confirmed — the old token is rejected — but no fixture has been observed responding to the new one.
4. **Is there a backup of the Supabase project?** Nothing in this repo configures or verifies one.
5. **Should `--good` be corrected pre-emptively** (FI-007), or left until a green badge actually lands on the page background?
6. **What retention period is wanted for `readings`?** The right answer depends on the reporting window the project needs to defend, which is not recorded anywhere in this repo.
