# iBEMS — project orientation

Intelligent Building Energy Management System for the CARE office. React frontend, a
Node-RED bridge to Tuya hardware, Node.js daemons, and Supabase for storage.

**This repository is public.** Never commit tokens, keys, passwords, hostnames, IP
addresses, or Supabase project identifiers — in code, in docs, or in commit messages.

> **Standing this up for another building? `docs/replication.md`** is the software half of the
> replication framework (Milestone 6), written as a transcript of a run that worked rather than a
> design — including a table of what it does not cover. `scripts/install.sh` does the machine
> setup (dry run by default; its apply path is untested), and `docs/physical-install.md` is the
> hardware guide, currently a template with its gaps marked rather than hidden.
> **`npm run preflight` is the day-one check** — credentials, database, vendor account, the local
> radio segment, the bridge, the services — and it reports what it could not check rather than
> passing it. `npm run site:check` is its offline sibling: that one reads the site *directory*,
> this one reads the *deployment*.

> **Running on the Pi itself? Read `docs/pi-session-brief.md` first.** It carries the current
> fleet state, what you may do without asking, the first-moves checks, and the traps this
> project has already paid for. Working *on* this project and working *on the Pi* are different
> jobs — the Pi has the live flow, the logs, the services and the network, and none of them are
> in this repository.

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
  network, so the Pi must sit on the same 2.4 GHz L2 segment as the devices — **and that segment
  must not have client isolation** (see below). Putting the Pi on a 5 GHz SSID leaves it with
  working internet and remote access while every device reads `online: false` and building
  totals read `null` — which looks like a code fault and is not.
- **The field devices speak Tuya protocol v3.4/v3.5, not 3.1/3.3.** Verified 2026-08-24 by
  decrypting their own UDP 6667 discovery broadcasts: the 4 branch meters and all 7 light
  switches announce **v3.5**; CO1/CO2/CO4/CO7 announce **v3.4**. A node declaring the wrong
  version fails as `find() timed out`, which reads exactly like a network fault and is not one.
  `tuyapi 7.7.1` supports both. Check what a device *announces* before believing what the flow
  *declares*.
- **Devices broadcast every 5.0 s, so `findTimeout` must be well above that.** It shipped at
  1000 ms, giving each discovery attempt roughly a 1-in-5 chance and producing thousands of
  timeouts an hour. Now 10000 ms. If discovery ever gets flaky again, measure the broadcast
  interval before suspecting the network.
- **`findTimeout` and `tuyaVersion` live only on the live flow, not in this repo.** They sit on
  the four hand-built source tabs, which `build-flow.mjs` does not generate. **`deploy:pi` does
  NOT revert them** — it reads the live flow and *appends* the bridge tab
  (`merged = baseFlows.concat(bridgeNodes)`), removing only bridge-tab nodes on `--force`; the
  source tabs pass through untouched, and none of the other flow scripts rewrite tuya node
  properties either. The real exposure is narrower and quieter: nothing in the repo *declares*
  these values, so nothing verifies them. Restoring an older `flows.json`, rebuilding the Pi, or
  a hand-edit in the Node-RED editor loses them with no diff and no alarm — and the symptom is
  every device going offline, which reads as a network fault. Back up `~/.node-red/flows.json`
  before any flow write, and see `node-red-bridge/live-flow-baseline.json` for what the values
  should be.
- **A device that looks physically unreachable may just be a stuck Node-RED node. Restart
  Node-RED before suspecting hardware.** On 2026-08-24 `l6` was diagnosed as an RF/range or
  stale-address problem — `EHOSTUNREACH …:6668` at every protocol version, ARP `FAILED`, and a
  roadmap entry saying it needed eyes on the fixture. On 2026-08-25
  `sudo systemctl restart nodered` reconnected it within two seconds (`Found device, going to
  connect` -> `Connected to device!`), and the real fixture then toggled from the app. The same
  restart took the fleet from 9/21 to 14/21 online. A tuya node that has given up stays given
  up, and its symptoms are identical to a device that is unplugged or out of range — so this
  costs a walk to the breaker, or a day of believing a hardware fault that is not there.
  Restart first; only if the device is still dark is the hardware suspicion earned.
- **A ping that gets no reply is not evidence of client isolation.** This was concluded twice
  on 2026-08-24/25 from the Pi being unable to ping a Windows laptop on the same /24, and both
  times it was wrong: Windows Firewall defaults to `BlockInbound` and drops ICMP echo, so the
  test cannot distinguish a filtered host from a blocked network. **Use ARP instead** — if
  `ip neigh` resolves the other host's MAC, layer 2 is working whatever ICMP does. On the
  device SSID the Pi resolves other clients fine, so there is no isolation there.
- **The devices live on a dedicated 2.4 GHz SSID**, whose profile is saved on the Pi at
  `autoconnect-priority 30`; `nmcli con show` on the Pi names it. Putting the Pi on the general
  office 5 GHz SSID leaves it with internet and remote access while every device reads
  `online: false` — which looks like a code fault and is not.
- **There is a Tuya developer account with a cloud project, and a Smart Life account.** That
  changes what is possible: the cloud API returns every device's id **and local key**, so
  enrolment need not ask a human to copy secrets between browser tabs, and it reports the
  cloud's own online state — reached over the internet rather than the local subnet, which is
  what makes it a diagnosis rather than a second opinion. `npm run tuya:devices` compares the
  two views.
  **`TUYA_ACCESS_SECRET` is the most sensitive credential in this system** — ahead of the
  Supabase service-role key, because it reaches hardware directly and no RLS scopes it. It
  lives only in `server/.env` on the Pi, is read only by `server/` code, and must never be
  imported by `src/`: the browser bundle carries the anon key and nothing else, on purpose.
  Set `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, and `TUYA_REGION`. **This project is `sg`**
  (`openapi-sg.iotbing.com`), measured rather than guessed — the console says "Singapore Data
  Center", which is not a code, and newer data centres live on a different domain from the older
  ones. A wrong host fails as `sign invalid`, indistinguishable from a bad secret; an *unenabled*
  one still issues a token and then refuses business calls, which is why the probe verifies with
  a real listing call rather than a token.
- **Schedules are Supabase's, not Node-RED's.** The Automation page writes to Supabase and
  `server/scheduler.mjs` fires them through the gated, audited command path. Node-RED's own
  cron schedules read flow context (`sched_N`, `outlet_sched_N`, `ac_sched`) and bypass both
  the gate and the audit trail — those arrays are currently empty and should stay that way for
  lights, or both would fire.
- **The app stores schedule days Mon..Sun; `Date.getDay()` is Sun..Sat.** Converting between
  them is a rotation, not an offset, and it lives in exactly one place
  (`schedulePlan.appDayIndex`). Getting it wrong yields a schedule that looks healthy and
  switches the office lights on the wrong day.
- **Mosquitto listens on loopback only, and that is deliberate — do not widen it.** Until
  2026-08-26 it listened on every interface with anonymous access, on the same 2.4 GHz segment
  as the field devices, so anything associated to that SSID could read every topic and publish
  to any of them. It is now bound to `127.0.0.1` and `::1` (both families: `localhost`
  resolves to either on this host, and a single listener silently locks out whichever the
  resolver prefers). The never-used websockets listener is retired.
  **This lives only in `/etc/mosquitto/` on the Pi — nothing in this repo declares it**, which
  is the same shape of exposure as `findTimeout` above: a rebuild or a package upgrade
  restores the permissive default with no diff and no alarm. Timestamped `.bak` files sit
  beside both config files.
  **The consequence for anything new that publishes:** a client that is not a process on the Pi
  cannot reach the broker. **RM-026's Deye bridge must therefore run with host networking**, or
  it needs a listener bound to the LAN address *with a `password_file`* — which is the correct
  way to reopen it, and matters because that bridge can WRITE to the inverter. The same applies
  to RM-005's ESP32 if it is ever revived. Widening the loopback listener back to `0.0.0.0` is
  reinstating the problem, not configuring the feature.
- **Auto-shed sheds, it never restores.** Switching load off unattended is recoverable by a
  person; switching it back on is not. Restoring is deliberately manual.
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
