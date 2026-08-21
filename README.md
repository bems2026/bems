# iBEMS Dashboard

Live data via the Node-RED bridge, Supabase-backed history, and audited device
control. See [`ROADMAP.md`](ROADMAP.md) for the current feature state and what is in
flight; the notes below cover layout and how to run it.

- [`docs/bridge-contract.md`](docs/bridge-contract.md) — the JSON contract, single source of truth
- [`docs/phase-f-runbook.md`](docs/phase-f-runbook.md) — deploying to the real Pi once it's reachable
- [`docs/adr-001-timeseries-store.md`](docs/adr-001-timeseries-store.md) — why the time-series store is Postgres and not InfluxDB
- [`docs/backup-policy.md`](docs/backup-policy.md) — what is backed up, what a restore will not give you

## Layout

```
shared/registry.mjs        canonical device registry — edit this, nothing else
shared/buildLatest.mjs     the readings-payload transform, shared by both bridges
node-red-bridge/           generated Node-RED flow (`npm run build:flow` to regenerate),
                            plus deploy.mjs/verify.mjs for the real Pi (see phase-f-runbook.md)
mock-bridge/                local fake bridge, same contract, no hardware needed
test/                      bridge/mock contract tests (Node's test runner)
src/                       React + Vite + TS frontend — five tabs (Overview, Analytics,
                            Control, Devices, Automation) plus Reports, which lives in the
                            nav's account menu rather than the tab bar
server/                    the ingestion daemon, the authenticated proxy that fronts the
                            bridge, and the systemd units for both plus the office kiosk.
                            the retention/report passes, and the backup export.
                            `npm run ingest`, tests via `npm run test:server`.
                            See docs/storage-contract.md.
supabase/                  schema.sql, then the phase migrations in order — apply once
                            against a new project
```

## Quickstart

Two terminals:

```bash
npm run mock             # fake bridge on :1880
npm run dev              # frontend on :5183, proxies /api and /ws to the mock
```

Deliberately not port 5173 — this repo sits alongside other Vite projects on the same
machine and must never shadow another dev server's default port.

```bash
npm test                 # frontend unit tests (vitest) — includes bridgeClient's
                          # backoff/stale-detection logic and a TIMING drift guard
npm run test:bridge      # bridge/mock contract tests (node --test)
npm run lint              # eslint
npm run build             # tsc -b && vite build
npm run build:flow        # regenerate node-red-bridge/bridge-flow.json after editing shared/
```

If a previous mock is still holding the port: `npm run mock:stop`.

## Against the real Pi (Phase F)

```bash
npm run verify:pi -- --host=<pi-ip>              # read-only health check, safe any time
npm run deploy:pi -- --host=<pi-ip>               # dry run — no writes
npm run deploy:pi -- --host=<pi-ip> --apply       # actually deploys
```
Full walkthrough: [`docs/phase-f-runbook.md`](docs/phase-f-runbook.md). `deploy.mjs` is the
only script in this repo that writes to a live system, and it refuses to unless the real
Pi's tab ids/labels match what `build-flow.mjs` assumed and there are no node id collisions.

## Rules

- **Never hand-edit `bridge-flow.json`.** It's generated from `shared/registry.mjs` and
  `shared/buildLatest.mjs`. Edit those, then `npm run build:flow`. `npm run test:bridge`
  fails loudly if the two drift apart.
- **The only place a bridge URL appears is `src/config/bridge.ts`.** Don't hardcode one
  elsewhere.
- **Control exists, but hardware dispatch is gated.** `POST /api/command` validates every
  command and writes an audit row before anything else happens. Whether it then reaches
  real hardware depends on `HARDWARE_DISPATCH_ENABLED`, which is off unless a deployment
  explicitly sets it. Lighting, outlets and the aircon all have real endpoints now (EX-051);
  the UI says which classes are actually live rather than implying all of them are — see
  `src/components/control/dispatchScope.ts`.
- **Never open the dispatch gate without someone watching the hardware.** It is the one
  setting in this repo that can physically move a relay.
