# Contributing

This repository runs a building. Most of the rules below exist because something here already
went wrong once, and each one names what it cost.

Read [`CLAUDE.md`](CLAUDE.md) first — it is the project's full orientation, and this file is the
short form of the parts a contributor has to know. If you are working **on the Pi itself**, read
[`docs/pi-session-brief.md`](docs/pi-session-brief.md) instead: that is a different job.

## Getting it running

No hardware needed.

```bash
npm ci
npm run mock          # fake bridge on :1880 — identical contract, synthetic snapshot
npm run dev           # app on :5183, proxying /api and /ws to the mock
```

The port is deliberately not 5173, so it can never shadow another Vite project on the same
machine. On the Pi, 1880 is Node-RED — use `npm run mock -- --port=1881`.

## Before you push

```bash
npm run lint
npm run build         # tsc -b && vite build — catches what vitest's type-stripping misses
npm test              # frontend (vitest)
npm run test:bridge   # bridge/contract (node --test)
npm run test:server   # server (node --test)
```

CI runs all five on **Node 22 and 24**. Both, because the Pi runs 22 and development happens on
24 — five server tests once passed on a workstation and failed on the Pi, and the suite was
green in the only place anyone looked.

> [!WARNING]
> **`npm run test:server` spawns real processes and writes under `server/data/`.** On a
> deployment that directory holds the live command-audit outage queue. A full run once left a
> fabricated command there that the ingest daemon would have uploaded into the production audit
> trail. There is a guard, and CI asserts it held — but do not run this suite on the Pi.

## The rules

- **The default branch is `master`.** Do not create or rename branches.
- **Never hand-edit `node-red-bridge/bridge-flow.json`.** It is generated from
  `shared/registry.mjs` and `shared/buildLatest.mjs`. Edit those, run `npm run build:flow`.
  `npm run test:bridge` fails loudly when the two drift.
- **The only place a bridge URL appears is `src/config/bridge.ts`.** Same rule for Supabase in
  `src/config/supabase.ts`.
- **Nothing under `src/` may import a server credential.** The browser bundle carries the
  RLS-constrained anon key and nothing else.
- **Update [`ROADMAP.md`](ROADMAP.md) in the same change** as any feature, significant fix,
  architecture change, or deletion. It is the single source of truth for feature state, and a
  convention with no reminder decays — CI warns, deliberately without blocking.
- **Stage `ROADMAP.md` by explicit path. Never `git add -A` in this repository.** Three env-file
  backups holding live credentials once sat untracked in the Pi's checkout, one `git add -A` away
  from a public repository.
- **Never commit** a token, key, password, hostname, IP address, or Supabase project identifier —
  in code, in docs, in a screenshot, or in a commit message. See [`SECURITY.md`](SECURITY.md).
- **TDD**: a failing test, confirmed failing, then the smallest implementation that passes.
  Server and bridge code has **no external dependencies and uses no mocking library** — tests
  spawn real processes and hand-roll fake HTTP servers. Keep it that way.
- **Prefer the existing design tokens in `src/index.css`** over new colour values, and check
  contrast in **both** themes. Several tokens pass on a card and fail on the page background.

## Two things a green suite does not prove

**That a fix works.** A change has shipped green here and changed nothing in the building, more
than once. CI catches regressions; reading the live system back stays mandatory.

**That it is deployed.** Deploying is two separate acts, and neither is implied by a commit —
`server/` and `shared/` changes need the daemons restarted, because Node loads a module once;
`src/` changes need a build, because the kiosk is served from `./dist`. Both have already
produced a "the code is right but the system disagrees" hour.

## Opening an issue

Use [the templates](.github/ISSUE_TEMPLATE/). If a *device* is misbehaving rather than the
software, take the device-fault one — its questions are the ones that have historically told a
network fault apart from a code fault, and answering them first has more than once saved a walk
to the breaker.
