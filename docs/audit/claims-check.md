---
title: Claims check (C1–C13)
purpose: Verdicts on the documentation prompt's last-known claims, each traced to evidence
audience: [integrator, administrator]
status: Draft
last_verified: 2026-09-23
applies_to: repo 2f4c570 · edge checkout fcb1ff6
evidence: [E-019, E-021, E-025, E-026, E-028, E-030, E-032, E-041, E-047, E-052, E-053, E-054, E-057, E-058, E-060, E-061, E-062, E-063, E-064, E-065, E-066, E-068, E-069, E-071, E-074, E-075, E-076, E-080, E-084, E-103, E-104]
---

# Claims check

These are the claims the documentation prompt carried over from earlier sessions. **Seven of the thirteen are wrong in
whole or in part.** The manual is written from the verdicts below, not from the claims.

| # | Claim | Verdict | What is actually true | Evidence |
|---|---|---|---|---|
| C1 | The 2026-08-18 revision dropped MQTT/Mosquitto, Home Assistant and TimescaleDB. | **Partly refuted** | Home Assistant and TimescaleDB are gone. No HA service and no PostgreSQL server exist on the edge, and ADR-001 keeps the time series in the hosted Postgres. MQTT is gone **as a device transport**: the only MQTT client node in the flow is disabled. **Mosquitto itself was not dropped.** It is installed, enabled and running, and since 2026-09-17 it has listened anonymously on all interfaces (see F-001). The revision date, 2026-08-18, was not checked. | E-032, E-064, E-030, E-028, E-025 |
| C2 | Node-RED talks HTTP/WS directly to the frontend and to an ingestion daemon (`server/ingest.mjs`). | **Partly refuted** | The ingest daemon does read Node-RED directly on loopback. **The frontend never does.** Node-RED listens only on loopback. The browser reaches it through the authenticated proxy on the LAN, or through the mesh network's HTTPS Serve, which also points at the proxy. Only the proxy may reach 1880. | E-074, E-019, E-025, E-026, E-047, E-061 |
| C3 | The device registry is static and config-driven: `shared/registry.mjs`. | **Confirmed** | `shared/registry.mjs` is fed by a per-site directory, `shared/sites/<site>/{site,devices,circuits}.mjs`, which one line in `shared/siteConfig.mjs` selects. | E-063 |
| C4 | The flow generator is JavaScript (`node-red-bridge/build-flow.mjs`), with merge-safe and standalone variants. | **Partly refuted** | The generator exists and is JavaScript. There is **one** output, `bridge-flow.json`, which `deploy.mjs` merges by appending it to the live flow. **No standalone variant exists.** The output also places collectors on the four hand-built tabs, which the generator does not otherwise own. | E-062, E-052 |
| C5 | The tables are `devices, readings, building_totals, ingestion_health, commands, schedules, dsm_thresholds`. | **Refuted (incomplete)** | Those seven exist, but `schema.sql` plus 47 migrations define **23 tables**. Among the rest are hourly rollups, period and monthly reports, anomalies, the space tree, sites, device and socket configuration, tariffs, emission factors and aircon rules with their loop state. | E-064, E-080 |
| C6 | Control actions pass through `server/proxy.mjs`, audit-logged, with `HARDWARE_DISPATCH_ENABLED=false`. | **Partly refuted** | Every control action goes through one record-then-act module, `server/auditedDispatch.mjs`, which the proxy **and** the scheduler both use. The audit row is written before dispatch. **The flag is `true` on the edge** (observed, and not changed — G7). Commands have reached hardware since 2026-08-24: 1,727 audit rows, most with status `dispatched`. | E-065, E-071, E-041, E-084 |
| C7 | Supabase Auth with a break-glass path; remote access via authenticated proxy plus mesh network. | **Confirmed** | Email/password Supabase Auth, with sessions verified offline by the proxy and a break-glass login keyed on a stored hash. Remote access is tailnet-only HTTPS Serve to the proxy and dashboard, and Funnel is off. | E-066, E-026, E-047 |
| C8 | Web app pages are Overview, Analytics, Control, Devices and Automation, served from the edge server. | **Partly refuted** | Seven pages: those five plus **Reports** and **Settings**, behind a login gate. They are served from the edge by `serve` on 5183. | E-060, E-021 |
| C9 | Automation is Node-RED only (schedule subflow, global context); there is no separate rule engine. | **Refuted** | Schedules live in the database. `server/scheduler.mjs` fires them through the audited path, and the same daemon runs demand auto-shed and the aircon room-target loop. Node-RED's own schedule arrays are empty and nothing writes them. The flow has no subflows. | E-071, E-057, E-054, E-084 |
| C10 | The refactored "Phase 0" flow may never have been deployed, and the edge may be running an older flow. | **Refuted** | All 42 nodes the generator emits are live, with zero non-layout differences. The caveat: the four hand-built source tabs are not generated, and the committed baseline of them is stale. For those tabs, the live flow is the only authority (see F-012). | E-052, E-053 |
| C11 | A spreadsheet (Google Sheets) archive exists as secondary logging. | **Confirmed** | 11 enabled append nodes (4 meters, 7 outlets) run every 180 s. Whether it keeps up with the API's quota and per-sheet cell limits was not measured. | E-058; quota: Unverified |
| C12 | The formal plan names n8n, Prisma, Render, Vitest, GitHub Actions, Modbus/BACnet and predictive analytics, and some may not exist as built. | **Mixed** | **Present:** Vitest and GitHub Actions. **Absent:** Prisma, Render, Modbus and BACnet. n8n was trialled and decommissioned on 2026-08-16. **Not predictive:** anomaly detection is rolling statistics, where z-score and IQR must agree. Each absent item is a roadmap or ADR entry, not a feature. | E-068, E-069, E-075, E-032, E-076 |
| C13 | Earlier docs and the tracker reference components that no longer exist. | **Confirmed — and the reverse too** | The legacy HTML anatomies count "six routes" and "ten stores". The architecture and full-stack plans outside the repo still discuss Home Assistant and MQTT. The **opposite** error is more dangerous. Four current documents (`ROADMAP.md` EX-131, `CLAUDE.md`, `SECURITY.md`, `pi-session-brief.md`) and the System Dossier describe a loopback-only broker that no longer exists. | E-103, E-104, E-028 |

## Consequences for the manual

- The prompt's §5 model holds. The dispatch description must say **enabled, as observed on 2026-09-23**, with its
  interlock and sign-off (G7). It must not describe the gate as closed.
- Automation (X2) is realised in `server/scheduler.mjs` and the database, not in Node-RED. The ADR list in the prompt
  (§9, ADRs) needs one change: "dropping MQTT/Mosquitto" becomes "MQTT is not a device transport, while the broker
  remains, reserved for the inverter bridge". It is written only after F-001 is resolved.
