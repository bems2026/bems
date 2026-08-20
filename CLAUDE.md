# iBEMS — project orientation

Intelligent Building Energy Management System for the CARE office. React frontend, a
Node-RED bridge to Tuya hardware, Node.js daemons, and Supabase for storage.

**This repository is public.** Never commit tokens, keys, passwords, hostnames, IP
addresses, or Supabase project identifiers — in code, in docs, or in commit messages.

## Layout

```
shared/            canonical device registry + shared transforms. Edit here, nothing else.
node-red-bridge/   generated flow, plus deploy/verify/rotate scripts for the real Pi
mock-bridge/       local fake bridge, same contract, no hardware needed
src/               React + Vite + TypeScript frontend
server/            ingestion daemon, authenticated proxy, systemd units
supabase/          schema.sql plus phase migrations, applied in order
test/              bridge/contract tests (node --test)
```

## Running it

```bash
npm run mock             # fake bridge on :1880 (--dispatch=switch to preview live dispatch)
npm run dev              # frontend on :5183, proxies to the mock
npm test                 # frontend (vitest)
npm run test:bridge      # bridge/contract (node --test)
npm run test:server      # server (node --test)
npm run build            # tsc -b && vite build — catches what vitest's type-stripping misses
npm run build:flow       # regenerate the flow after editing shared/
```

## Site facts worth never re-deriving

- **The Tuya field devices are 2.4 GHz-only.** The bridge discovers them over the local
  network, so the Pi must sit on the same 2.4 GHz L2 segment as the devices. Putting the Pi on
  a 5 GHz SSID leaves it with working internet and remote access while every device reads
  `online: false` and building totals read `null` — which looks like a code fault and is not.
- **Schedules are Supabase's, not Node-RED's.** The Automation page writes to Supabase and
  `server/scheduler.mjs` fires them through the gated, audited command path. Node-RED's own
  cron schedules read flow context (`sched_N`, `outlet_sched_N`, `ac_sched`) and bypass both
  the gate and the audit trail — those arrays are currently empty and should stay that way for
  lights, or both would fire.
- **The app stores schedule days Mon..Sun; `Date.getDay()` is Sun..Sat.** Converting between
  them is a rotation, not an offset, and it lives in exactly one place
  (`schedulePlan.appDayIndex`). Getting it wrong yields a schedule that looks healthy and
  switches the office lights on the wrong day.
- **Never change the Pi's Wi-Fi remotely.** A wrong SSID or credential loses the host with
  nobody on site to recover it.

## Conventions

- **The default branch is `master`.** Do not create or rename branches.
- **Never hand-edit `node-red-bridge/bridge-flow.json`.** It is generated; `npm run test:bridge` fails if it drifts from `shared/`.
- **The only place a bridge URL appears is `src/config/bridge.ts`.**
- Server and bridge code has **no external dependencies** and uses **no mocking library** — tests spawn real processes and hand-roll fake HTTP servers.
- TDD: failing test, confirm it fails, minimal implementation, green, commit.
- Prefer existing design tokens in `src/index.css` over new colour values, and check contrast in **both** themes — several tokens pass on a card but fail on the page background.

## ROADMAP.md maintenance (non-negotiable)

`ROADMAP.md` is the single source of truth for this project's feature state. Before you end
any session in which you added a feature, fixed a significant bug, changed architecture, or
deleted code, you must update it in the same change:

- tick the roadmap items you completed and move them into "Existing features" with their evidence path;
- add anything new that isn't listed;
- delete entries for code that no longer exists;
- refresh the `Last audited` header.

Never assert a feature you have not opened the file for. Never put secrets, tokens, or
hostnames in this file — the repo is public. Stage `ROADMAP.md` by explicit path; never
`git add -A` in this repo.
