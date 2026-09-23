---
title: System map (as observed)
purpose: The Phase A inventory — repository, processes, ports, flow, command path and data — that later chapters are written from
audience: [integrator]
status: Draft
last_verified: 2026-09-23
applies_to: repo 2f4c570 · edge checkout fcb1ff6
evidence: [E-010, E-011, E-017, E-018, E-019, E-021, E-022, E-023, E-025, E-026, E-041, E-047, E-050, E-051, E-052, E-054, E-055, E-056, E-057, E-058, E-059, E-060, E-061, E-062, E-063, E-064, E-065, E-066, E-067, E-068, E-070, E-071, E-074, E-080, E-081, E-084]
---

# System map, as observed on 2026-09-23

This is inventory, not explanation. Each chapter explains its own part. Pilot-site names appear here
because this is the audit of the pilot. The manual's chapters generalise them.

## 1. Repository (A1)

| Path | Tracked files | Purpose |
|---|---|---|
| `shared/` | 23 | The canonical device registry (`registry.mjs`) and shared transforms. `shared/sites/<site>/` describes one building. E-063 |
| `node-red-bridge/` | 56 | The flow generator (`build-flow.mjs`), its output (`bridge-flow.json`), deploy, verify and capture, and about 30 dry-run-first scripts that patch the live flow |
| `mock-bridge/` | 3 | A local fake bridge that follows the same contract as the real one, so development needs no hardware |
| `server/` | 140 | The ingest, proxy and scheduler daemons and their helpers, the systemd units and timers, and the server tests |
| `src/` | 450+ | React frontend: `components/` (by page), `lib/` (pure logic), `stores/` (zustand), `config/bridge.ts` (the only bridge address) |
| `supabase/` | 50 | `schema.sql`, 47 `phase*.sql` migrations and the rehearsal and restore scripts |
| `scripts/` | 7 | `install.sh`, `preflight.mjs`, `site-new.mjs`, `site-check.mjs`, `site-sql.mjs`, `rf-survey.mjs` and `rehearse-install.sh` |
| `test/` | 107 | Bridge and contract tests (`node --test`) |
| `docs/` | 12 + assets | The contract documents, runbooks and ADRs (E-072) |
| `.github/` | 4 | CI (`ci.yml`), the PR template and two issue forms |

**Frontend (E-060, E-061).** React 19.2, Vite 8, TypeScript 5.9, Tailwind 4 and zustand 5. There is no router library:
`App.tsx` renders one page from nav state, and the pages are Overview, Analytics, Control, Devices, Automation, Reports
and Settings, behind a login page. Live data arrives over a WebSocket; history and configuration come from the database
through its client library under row-level security. Every bridge address is resolved in `src/config/bridge.ts`.

**Generator (E-062, E-052).** `shared/registry.mjs` feeds `build-flow.mjs`, which produces `bridge-flow.json` (42 nodes).
Those nodes are the bridge tab plus a three-node collector on each hand-built tab. `deploy.mjs` is a dry run by default.
With `--apply` it appends to the live flow, and `--force` first removes the nodes it emitted before. The four hand-built
tabs (Energy, Outlet, Switch, Aircon) are **not** generated. Their dp parsers are generated separately
(`fix-dp-parsers.mjs`) from `shared/deviceCapabilities.mjs`.

**Environment names (E-067, E-042).** The names only are listed in the ledger. None of the values appear anywhere in this audit.

## 2. Processes on the edge (A2)

| Process | Entry | Listens on | Talks to | Supervised by | Restart |
|---|---|---|---|---|---|
| Node-RED 4.1.8 | `node-red-pi` | loopback:1880 (admin API and http-in) | Field devices (Tuya LAN protocol), Google Sheets API | `nodered.service` (system) | on-failure, 20 s |
| Ingest daemon | `server/ingest.mjs` | — | Bridge on loopback; the database (service role) | `ibems-ingest.service` | on-failure, 10 s |
| Proxy | `server/proxy.mjs` | all interfaces:8080 (HTTP + WS); UDP 6666/6667/7000 (LAN presence) | Bridge on loopback; the database's auth keys; the vendor cloud (optional fallback) | `ibems-proxy.service` | on-failure, 10 s |
| Scheduler | `server/scheduler.mjs` | — | The database (schedules, thresholds, rules); the bridge, via the audited path | `ibems-scheduler.service` | on-failure, 10 s |
| Dashboard | `serve -s dist -l 5183` | all interfaces:5183 | — (static files) | `ibems-dashboard.service` | on-failure, 10 s |
| Kiosk | Chromium `--kiosk` | — | Dashboard on loopback | `ibems-kiosk.service` (**user** unit, lightdm autologin) | always, 5 s |
| LAN map | `server/lan-map-learn.mjs` | UDP (passive, 30 s) | — | `ibems-lan-map.timer` | 10 min |
| Fleet recovery | `server/fleet-recover.mjs` | — | Restarts Node-RED via `sudo -n` when a device is reachable but its node has given up | `ibems-fleet-recover.timer` | 5 min |
| Wi-Fi preference | `server/wifi-prefer.mjs` (root) | — | NetworkManager | `ibems-wifi-prefer.timer` | 5 min |
| Mesh watchdog | `/usr/local/bin/tailscale-watchdog.sh` | — | tailscaled | `tailscale-watchdog.timer` (**not in repo**) | 2 min |
| MQTT broker | Mosquitto 2.0.21 | **0.0.0.0:1883, anonymous** (F-001) | — (no enabled client) | `mosquitto.service` | on-failure |

The daemons start after `nodered.service` (`After=`), with Node.js v22.23.2 (E-017, E-021, E-022, E-023, E-025, E-028).

## 3. Ports and exposure, generalised (A2)

| Port | Protocol | Bound to | Who reaches it | Authentication |
|---|---|---|---|---|
| 1880 | HTTP/WS | loopback | The proxy and ingest only | Node-RED `adminAuth` on the admin API. The http-in nodes have none, and are safe only because of the loopback binding. |
| 8080 | HTTP/WS | all interfaces | Browsers on the LAN; the mesh Serve on `/api` and `/ws` | Session JWT, verified offline, or break-glass |
| 5183 | HTTP | all interfaces | Browsers on the LAN; the mesh Serve on `/`; the kiosk | None: static files only. Data needs 8080. |
| 443 (mesh address only) | HTTPS | mesh interface | Tailnet members | Tailnet membership, then the app's own login |
| 1883 | MQTT | **all interfaces** | Anyone on the LAN or device segment | **None** (F-001) |
| 5900 | VNC | all interfaces | Anyone on any segment | PAM, using the service account's password (F-007) |
| 22 | SSH | all interfaces | LAN and mesh | Key-based. Password auth unverified (F-008). Tailscale SSH is also on. |
| 111 | rpcbind | all interfaces | LAN | — (unused service, F-014) |
| 6666, 6667, 7000 | UDP | all interfaces | Device discovery broadcasts (inbound) | — |

## 4. Live flow (A3)

| Tab | Nodes | Purpose | Entry points | Cadence |
|---|---|---|---|---|
| Energy Monitoring - Set time | 43 | Three CT meters (branch circuits), parsers and 3-phase totals. Accepts capability writes. | `POST /capability/:deviceId` | 60 s meter poll; 180 s Sheets append; 2 s UI tick; midnight reset |
| Outlet | 108 | Seven dual-socket outlets: parsers, logic hub, per-outlet cron (reading empty arrays) | `POST /outlet/:target` | 60 s poll; 180 s Sheets; per-outlet 60 s cron check |
| Switch | 84 | Seven light switches: logic hub, per-switch cron (reading empty arrays) | `POST /light/:id` | 60 s poll; per-switch 60 s cron check |
| Aircon | 30 | IR hub, room temperature and humidity, and the AC Master Logic that builds IR frames | `POST /acu` | 60 s hub poll gate; 2 s UI tick |
| Deye Solar Inverter | 0 | Empty placeholder for RM-026 | — | — |
| iBEMS Bridge (Stage 1, read-only) | 28 | **Generated.** Collects from every tab, then serves devices, latest, history and the WS push. Tracks arrivals, value freezes and the energy day base. | `GET /api/devices`, `GET /api/readings/latest`, `GET /api/readings/history`, WS | 2 s push; 60 s history sample |

- 19 Tuya nodes (E-051). **No `catch` nodes** (E-054). No subflows. 11 Sheets append nodes (E-058). One disabled
  MQTT-in node (E-030). One `solarman-device` config node polling an absent logger (E-040).
- **Context (E-059, E-057).** Each hand-built tab keeps its devices' parsed state in its own flow context. The
  generated collectors are the only reader of that state from outside the tab. The schedule arrays are empty and
  nothing writes them. The one global key is `lightStatus` (Switch tab).

## 5. Command path, screen to device (A3 + A1)

1. A person presses a control. The browser `POST`s to the proxy with its session token (on the LAN, or through the mesh Serve at `/api`).
2. The proxy verifies the session offline, against cached signing keys, and validates the command (E-066).
3. `auditedDispatch` **records the `commands` row first**. No record means no dispatch. "Recorded" means durably
   written somewhere the site controls. If the database is unreachable, the row goes to a local audit buffer
   (`server/auditQueue.mjs`) and dispatch proceeds, so a WAN outage does not remove control of the building. The proxy
   reports the backlog as `audit_buffer_pending`, and it is uploaded when the link returns (E-065, E-078).
4. **The interlock.** If `HARDWARE_DISPATCH_ENABLED` is not `true`, or the device class is not in `DISPATCH_CLASSES`
   (`switch`, `outlet_dual`, `acu_ir`), nothing is sent. On this edge the gate is **open** (E-041).
5. `dispatchLight.mjs` maps the command to the flow's own endpoint, `/light/:id`, `/outlet/:target`, `/acu` or
   `/capability/:id`, and authenticates with `LIGHT_API_TOKEN`. The proxy refuses to start if the gate is open and the token is unset.
6. The Tuya node sends the command to the device on the LAN. If local dispatch fails and a vendor fallback is configured,
   the vendor cloud is used instead (`dispatchCloud.mjs`). The audit row records `via` as `local` or `cloud`.
7. **Acknowledgement.** The recorded outcome is Node-RED's HTTP status, which says the flow accepted the command. It is
   not the device's own confirmation, and rows carry `confirmation: none`. What the device actually did is seen only when its
   state next arrives by push or 60 s poll. The IR hub never echoes a send (E-084, the `commands` sample, CLAUDE.md).

Scheduled, auto-shed and aircon-loop commands enter at step 3 from `scheduler.mjs` (E-071).

## 6. Data (A4)

| Table | Rows (2026-09-23) | Written by | Retention |
|---|---|---|---|
| `readings` | 858,691 | ingest, every 60 s per device | 30 days per minute, then rolled up hourly (E-070) |
| `readings_hourly` | 3,773 | the rollup function | permanent |
| `building_totals` | 43,313 | ingest, every 60 s | 30 days, then rolled up hourly |
| `building_totals_hourly` | 190 | the rollup function | permanent |
| `anomalies` | 8,539 | ingest (z-score **and** IQR must agree) | 365 days |
| `commands` | 1,727 | proxy and scheduler, before dispatch | never pruned: it is the audit trail |
| `period_reports` / `period_building_reports` | 900 / 45 | report generation (ingest) | permanent |
| `monthly_reports` / `monthly_building_reports` | 20 / 1 | report generation | permanent |
| `schedules`, `dsm_thresholds`, `acu_rules`, `acu_loop_state` | 23, 1, 1, 1 | the app (configuration) and the scheduler (loop state) | current state |
| `devices`, `device_config`, `socket_config`, `space_nodes`, `sites`, `site_ui_prefs` | 20, 14, 14, 4, 1, 1 | migrations and the app | current state |
| `ingestion_health` | 1 | ingest (heartbeat) | current state |
| `energy_tariffs`, `emission_factors` | 0, 0 | the app (Reports) | — |

Sizing inputs measured so far: about 28,600 `readings` rows a day for 20 devices (E-081). **Bytes per row and the plan's cap are
still open (Q-01).** Gaps are absent rows (E-082). Offline rows are flagged and may hold a stale value (E-083).
