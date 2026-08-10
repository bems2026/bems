# iBEMS Dashboard — Stage 1

Local, live-data (Node-RED bridge), view-only. See:

- [`docs/bridge-contract.md`](docs/bridge-contract.md) — the JSON contract, single source of truth
- [`docs/phase-f-runbook.md`](docs/phase-f-runbook.md) — deploying to the real Pi once it's reachable
- [`C:\Users\g16\BEMS\ibems-dashboard-stage1-plan.md`](../ibems-dashboard-stage1-plan.md) — original Stage 1 plan
- The implementation plan this repo follows (Phases A–F) is `ibems-onboarding-wizar-agile-donut.md` in the Claude plans directory.

## Layout

```
shared/registry.mjs        canonical device registry — edit this, nothing else
shared/buildLatest.mjs     the readings-payload transform, shared by both bridges
node-red-bridge/           generated Node-RED flow (`npm run build:flow` to regenerate),
                            plus deploy.mjs/verify.mjs for the real Pi (see phase-f-runbook.md)
mock-bridge/                local fake bridge, same contract, no hardware needed
test/                      bridge/mock contract tests (Node's test runner)
src/                       React + Vite + TS frontend — Overview, Floor Plan, and Trends
                            are all live against the bridge (Phases C–E complete)
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
- **Stage 1 is view-only.** No `POST` endpoints, no control wiring, no toggles anywhere
  in this repo. That's Stage 2.
