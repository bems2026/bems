# iBEMS — Feature State & Roadmap

**Last audited:** 2026-08-24 (UTC)
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

- [ ] **RM-010** Apply `supabase/phase13_device_functions.sql`, then deploy the frontend.
      *Acceptance:* `device_config` has a nullable `functions text[]` with the
      `device_config_functions_valid` CHECK, and the Devices page's Functions fieldset saves and
      reloads.
      **Order matters and is not optional.** `src/lib/supabaseDeviceConfig.ts` now selects
      `functions` by name; against a table without the column PostgREST fails the whole select,
      which takes room, category, load-shed group and display-name overrides down with it. The
      pages themselves degrade safely — an empty config map means every device falls through to
      its class default, which is exactly today's behaviour — but the metadata editor would be
      broken until the column exists. Apply first, deploy second.

- [ ] **RM-001a** Two devices remain offline. A physical check, not a code change.
      *Acceptance:* each is either restored or recorded as decommissioned in the registry.
      `co5` and `co6` do not announce on the LAN at all, so no protocol or timeout setting can
      reach them; they also read 0 V before the outage. Most likely unplugged or unpaired.
      *Corrected twice as evidence arrived, which is worth noting for how the next one is read:*
      this entry first listed five devices and blamed a stale local key for `l6`/`l7`. Both
      connected once the raised `findTimeout` gave them enough attempts. It then listed three,
      and `co3` recovered on its own shortly after. Devices came back for hours after the fix —
      so a device still dark an hour later was not evidence of a second fault, only of a slower
      retry. 18 of 20 are now online.
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
- [ ] **RM-006c** Assign load-shed tiers and set DSM limits before auto-shed can do anything.
      *Acceptance:* at least one device has a shed group, a threshold is set, and auto-shed is on.
      Nothing is configured today, so the mechanism is live but inert by design. Note that only
      lights can currently be shed, which limits how much load it can actually drop.
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
- **FI-001** (L) Zero-touch device discovery, so adding a device does not require extracting vendor keys by hand. The current metadata editor covers labelling existing devices, not adding new ones. Only worth doing if manual key extraction proves a recurring pain.
- **FI-002** (M) Day-one setup wizard for a new building: network and vendor-account linking.

### Replication
- **FI-003** (L) Packaging so a second site can be stood up without redoing the wiring by hand: install script or card image, plus a physical-install guide.

### Robustness
- **FI-013** (S) The Outlet tab never polls its devices. The 7 `Cron O*` injects drive schedule
  logic and the 180 s triggers feed Google Sheets; nothing sends `{operation:'GET'}` to an outlet
  node, so an outlet reading only advances when the device spontaneously pushes. EX-039 stops the
  dashboard *presenting* the resulting gap as fact, but the data is still missing. The fix is one
  inject plus one function wired to all 7 outlet nodes — deliberately deferred rather than
  hand-added, because it belongs in `build-flow.mjs` with the rest of the device nodes (FI-001),
  not in a hand-built tab that a regeneration would wipe.
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
