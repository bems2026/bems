# iBEMS Dashboard — Stage 1

Local, live-data (Node-RED bridge), view-only. See:

- [`docs/bridge-contract.md`](docs/bridge-contract.md) — the JSON contract, single source of truth
- [`C:\Users\g16\BEMS\ibems-dashboard-stage1-plan.md`](../ibems-dashboard-stage1-plan.md) — original Stage 1 plan
- The implementation plan this repo follows (Phases A–F) is `ibems-onboarding-wizar-agile-donut.md` in the Claude plans directory.

## Layout

```
shared/registry.mjs        canonical device registry — edit this, nothing else
shared/buildLatest.mjs     the readings-payload transform, shared by both bridges
node-red-bridge/           generated Node-RED flow (`npm run build:flow` to regenerate)
mock-bridge/                local fake bridge, same contract, no hardware needed
test/                      contract tests — guard against mock/bridge drift
```

## Quickstart

```bash
npm run mock            # starts the fake bridge on :1880
npm test                # contract tests
npm run build:flow      # regenerate node-red-bridge/bridge-flow.json after editing shared/
```

If a previous mock is still holding the port: `npm run mock:stop`.

## Rule

**Never hand-edit `bridge-flow.json`.** It's generated from `shared/registry.mjs` and
`shared/buildLatest.mjs`. Edit those, then `npm run build:flow`. `npm test` fails loudly
if the two drift apart.
