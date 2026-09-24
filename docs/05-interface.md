---
title: User interface
purpose: Use, administer and troubleshoot the web application and its kiosk (L5)
audience: [operator, administrator, integrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo f0c7267
evidence: [E-004, E-023, E-025, E-026, E-060, E-061, E-065, E-066, E-071, E-076, E-082, E-110, E-111, E-115, E-152, E-163, E-165, E-168, E-169, E-170, E-172, E-173, E-174, E-175, E-176, E-177, E-179, E-180, E-181, E-182, E-183, E-184, E-185]
---

# User interface

The web application is how a person sees the building and acts on it. **It holds no state of its own.** The readings
belong to the bridge, the history and the rules to the database, and the commands to the proxy's audit trail. The
browser shows them and asks for changes. One build serves the wall kiosk, a browser on the site network and a remote
browser over the mesh network.

How a reading reaches the screen and how a click reaches a relay are traced in
[00 § Following one reading and one command](00-overview.md#following-one-reading-and-one-command). Where each service
runs is in [00 § What runs where](00-overview.md#what-runs-where).

## What it is

### Architecture

| Aspect | As built | Evidence |
|---|---|---|
| Rendering | A single-page application: React 19.2, Vite 8, TypeScript 5.9, Tailwind 4. Charts use recharts; the 3D model uses three. | E-060 |
| Routing | **The URL hash is the route**, read by a small hand-written hook; there is no router library. `#control` opens Control. A second segment names a tab (`#automation/time`), so a tab survives a reload and can be linked. A hash that names no page leaves the current page alone. | E-060 |
| State | Sixteen zustand stores. **The device store holds only what the bridge said.** A command's pending state is kept separately, so an optimistic value never passes for a reading. | E-060, E-115 |
| Data fetching | One live connection opens at the root for the app's lifetime. It fetches the device list, opens `/ws/live`, and loads the database-backed stores once. Pages then read the stores. History is fetched per page. | E-173, E-181 |
| Errors | **Every page has its own error boundary**, keyed on the route, so a fault in one page leaves the navigation and every other page working. Each chart has its own inline boundary, which redraws when the next data arrives. The message says it is a display fault only: collection, scheduling and the audit trail run as separate services. | `src/components/common/ErrorBoundary.tsx` [E-060] |
| Build | `npm run build` type-checks and writes `dist/`. The build reads the database address and public key from the checkout's root `.env` files, **and those two values also switch sign-in on** (see [How to configure](#how-to-configure)). | E-180 |
| Hosting | On the edge itself. `ibems-dashboard` serves `dist/` on port 5183, and the proxy serves `/api` and `/ws` on 8080. Nothing is hosted in the cloud except the database and its sign-in service. | E-025, E-026 |
| Updates | The page checks every 5 minutes whether the server hands out a newer bundle. **The kiosk reloads itself** once it has been untouched for 60 s. Any other viewer is offered a reload, because they may be mid-command. | E-173 |

**Where the browser sends requests.** `src/config/bridge.ts` is the only place a bridge address appears. It derives the
address from how the page itself was reached, not from a value baked in at build time:

- over `https:` (the mesh path), same-origin `/api` and `/ws`;
- over `http:`, the proxy on port 8080 of the same host;
- with no database configured, Node-RED on 1880, which is loopback-only on the edge.

The upshot: one build is correct from every address [E-061].

### Where the data comes from

| Data | Source | Refresh | Evidence |
|---|---|---|---|
| Live readings, device state | The bridge, through the proxy | Pushed every 2 s over the socket. If the socket drops, polled every 15 s, backing off to 120 s, while the socket is retried. | E-173 |
| 24 h history | The bridge's own ring buffer | Re-read every 60 s | E-181 |
| 7 and 30 days | `readings_buckets` in the database | Every 5 min | E-165, E-181 |
| 1 year | `readings_archive`, across the 30-day boundary into the hourly rollups | Every 30 min | E-165, E-181 |
| Schedules, thresholds, comfort rules, device and socket configuration, spaces, page cards | Database tables, loaded once at the root | On load and after each save | E-181 |
| Alerts | Anomalies (every 60 s), capability episodes (every 5 min), device staleness (continuous) | as shown | E-181 |
| Reports | `period_reports` and its building twin, plus `readings_archive` for per-circuit series | On opening a period, and again when a pending period falls due | E-181 |
| Weather | Open-Meteo, with no key | Every 10 min. It is the only call to the public internet other than the database, so "unreachable" is a normal state for it. | E-181 |

### The pages

Five pages are in the tab bar: they answer "what is happening now". Reports and Settings are reached from the account
menu, because they are read at other times, by other people [E-060].

| Page (route) | Purpose | What it shows | Controls | Without its data |
|---|---|---|---|---|
| **Overview** (`#overview`) | The building at a glance | Live demand; energy today, this week and this month; phase currents and their balance; energy by branch; a 3D model of the room; weather; the last 24 h of demand; device status counts; the active schedules; indoor and outdoor climate | **Quick Control** sends real commands: aircon on and off, and a light switch | A chart with no points says "No data". "Nothing armed" when no schedule is armed. |
| **Analytics** (`#analytics`) | Trends and consumption | Power, voltage and current by branch and by outlet. Data-quality badges on each chart: live, estimated, gaps, frozen. Each branch meter and each outlet. Metered against total (the untracked load). Totals by space. Ranges 24 h, 7 d, 30 d, 1 y. | Parameter and range choices; read-only | Without the database, only the 24 h range exists, and *By space* says there is no stored history [E-174] |
| **Control** (`#control`) | Manual overrides | Bulk actions (lights off, outlets off, aircon off), each behind a confirmation. The lighting and outlet plan, if one is drawn for the site. Every switch, every outlet socket, and the IR aircon with mode, setpoint, fan and swing. How commands reach the devices. A command log for this session. | Switch any relay; send an aircon state | Each relay is marked `NOT DISPATCHED` when dispatch is closed [E-174] |
| **Devices** (`#devices`) | The fleet | One row per device: class, voltage, current, power, last seen, communication, state | *Add device* (enrol, import keys); *Manage* per device: its capabilities, its metadata, and Remove for devices added through the app [E-179] | A skeleton while the list loads; the list is retried until it arrives [E-183] |
| **Automation** (`#automation/summary`, `/time`, `/state`, `/events`) | Rules that act unattended | **Summary:** what is armed, what fires next, what automation did in the last 24 h. **Time-Driven:** schedules per relay, on a week timeline. **State-Driven:** demand thresholds and load-shed tiers. **Event-Driven:** aircon room-temperature rules. Cards for what is not installed, each naming its blocker. | Add, arm, disarm and delete rules, then *Save changes* | A banner says when saved rules cannot reach hardware on this deployment [E-174] |
| **Reports** (account menu, `#reports`) | Finished days, weeks and months | Overview, Circuits, Usage patterns and Compare tabs. A coverage banner: how much of the period was recorded. Cost and emissions once a rate is set. | Period picker; *Export*: a PDF, or one of four CSVs (building by day, devices for the period, devices by day, every reading) | Without the database it says reports need stored history, "rather than an empty table that would look like a month with no consumption" [E-174] |
| **Settings** (account menu, `#settings`) | How this deployment is described | Account, Spaces, Floor plan, Page cards, Building policy, Tariff & emissions | Edit each section | — |

**Settings does not switch hardware**, and says so. *Building policy* holds one rule today: the coldest room
temperature an automatic aircon rule may aim for. The number shown is the one the proxy is enforcing at that moment,
which differs from the stored one if the database is unreachable (`src/components/settings/PolicySection.tsx`) [E-179].

### Design rules that carry meaning

Every state below has one look, used on every page. Learn these and the rest of the app reads itself.

| State | What you see | Rule behind it | Evidence |
|---|---|---|---|
| **Missing data** | "—" in a figure, a break in a line, "No data" on an empty chart; "Not metered" for a phase with no meter | A gap is never drawn as zero. A total that cannot be computed is shown as not computable. | E-082, E-168 |
| **Stale reading** | The figure dims and a *stale* flag appears; on a floor plan, a dot. Screen readers hear a sentence naming the device and its window. | Each device has its own window: 2.5 × its reporting cadence. That is 150 s for outlets, meters and the aircon, and 30 s for switches and the room sensor. After 300 s its figures are withdrawn. After 600 s the bridge marks it offline and it leaves the totals. | E-110, E-111 |
| **Held value** | A notice naming the meter, the value it repeated and for how long, while it reported online | A repeated reading is not a live measurement. The energy shown is the meter's own register. | E-152, E-174 |
| **Command in flight** | The control shows it is sending, then confirming | Success is silent: the pending state is dropped once the feed reports the new state, so the real reading shows through. Confirmation needs a *fresh* reading; a frozen one that happens to match does not count. | E-115, E-173 |
| **Command failed** | A red message on the control, in words | Each refusal is named for its cause (below). "The device did not report the new state" is shown only when the device reported after the command. Otherwise the message says whether the command landed is unknown. | E-115, E-183 |
| **Refused by the interlock** | `NOT DISPATCHED` on relays; "Saved rules do not reach any hardware on this deployment" on Automation | A closed interlock still records the command, as a dry run, and says so | E-174, E-065 |
| **Edge unreachable** | The header pill: `LIVE`, `LIVE (POLL)` when the socket fell back to polling, `RECONNECTING`, `OFFLINE`. Amber when connected but silent for 30 s. | Readings stay on screen but go stale by the rules above. The app keeps retrying by itself. | E-173 |
| **Command path** | A note on Control: whether commands go over the local network only or may fall back to the vendor cloud, and any device that recently needed the cloud | A command that only landed through the cloud is a success that means the device stopped answering locally, the earliest warning of a failing device | `src/components/control/DispatchPathNote.tsx`, [ADR-002](adr-002-device-recovery-path.md) |
| **Display fault** | "This page stopped responding", with *Try again* | Only the view failed | [Architecture](#architecture) |

The refusal messages, by the proxy's code [E-115]:

| Code | Message (abridged) |
|---|---|
| `device_offline` | The device is offline: the bridge has no connection to it. The command was still logged. |
| `bridge_unreachable` | The bridge could not be reached. The command was still logged. |
| `bridge_rejected` | The bridge refused the command: check the bridge token and the flow. |
| `no_dispatch_route` | This deployment cannot command a device of this kind. |
| `audit_log_unreachable` | Nothing was sent: the audit trail could not be written. |
| `break_glass_cannot_command` | Local sign-in is view-only. |

### Access modes

| Mode | How it is reached | Sign-in | Notes |
|---|---|---|---|
| **Wall kiosk** | The edge's own display, 800 × 480 touch [E-175]. Chromium in kiosk mode opens `http://127.0.0.1:5183/`, and the API goes to the proxy on loopback. | A normal account; the session is kept in the kiosk's own browser profile | A systemd **user** unit. It waits for the display server and for the dashboard to answer, then starts Chromium; `Restart=always`. It needs the desktop's autologin: without it the screen stays at a greeter [E-023]. Kiosk mode hides the browser's controls. It is not an operating-system lock, but a closed kiosk comes back within 5 s. |
| **Site-network browser** | `http://<edge-address>:5183/`. The API is the proxy on port 8080 of the same host. | A normal account | Plain HTTP: no TLS protects the session token, so anyone who can read that network's traffic can read it. The dashboard and the proxy listen on every interface, the device segment included [E-025]. Prefer the mesh path for people ([X1](X1-security.md)). |
| **Remote** | `https://<edge-name>.<tailnet>.ts.net/`, on the mesh network only. Serve routes `/` to the dashboard and `/api` and `/ws` to the proxy. Nothing is published to the public internet. | A device on the tailnet **and** a database account | E-026, [02](02-network.md) |
| **No database** | Development only: a build without the database variables | **None** | Pages render from the bridge alone, and only on the edge itself, because Node-RED listens on loopback. Never deploy it: see [How to configure](#how-to-configure) [E-180]. |

**Sign-in** is email and password against the database's sign-in service [E-066]. **Break-glass** is a local
password, checked by the proxy, for when that service cannot be reached. The login page offers it only after a network
error. It gives a 12-hour session that can **read but not command**, and that ends if the proxy restarts [E-172].

**There are no roles.** Every signed-in account may do everything the database allows: arm schedules, set demand
limits, change device configuration, and switch any load [E-163, E-170]. Who holds an account is therefore the whole
access policy. See [Administration](#administration-guide) and [X1](X1-security.md).

## What you need

| Item | Specification that matters |
|---|---|
| The edge, running `ibems-dashboard` and `ibems-proxy` | [03](03-edge.md) |
| A database project with the schema applied | [04](04-data.md) |
| An account for each person | Created by an administrator. Sign-up is off (E-176). |
| For the kiosk | A display on the edge (800 × 480 is the tested size), and desktop autologin for the service account |
| For remote access | The person's device on the mesh network ([02](02-network.md)) |
| A browser | The build targets ES2022. Only Chromium is verified: the kiosk's (151) and the one used for these checks. Firefox and Safari are `[UNVERIFIED]`. [E-175] |

## How to install

**Precondition.** The edge is installed ([03](03-edge.md)), and the database is set up with this site's row
([04](04-data.md#how-to-install)).

| Step | Action | Expected result |
|---|---|---|
| 1 | In the checkout's root, create `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (the public key; see [03](03-edge.md#serverenv) for where the values come from). Set `VITE_WEATHER_*` only if the weather should come from somewhere other than the site's declared location. | The file exists and is ignored by git |
| 2 | `npm run build` | It finishes without type errors and writes `dist/` |
| 3 | `sudo systemctl enable --now ibems-dashboard` (the installer does this) | `curl -sf http://127.0.0.1:5183/ >/dev/null && echo ok` prints `ok` |
| 4 | Kiosk: install the user unit as its header says (`cp server/ibems-kiosk.service ~/.config/systemd/user/`, `systemctl --user daemon-reload`, `systemctl --user enable --now ibems-kiosk`), and set desktop autologin for the service account | The display shows the sign-in page, then the Overview once signed in |
| 5 | Remote: `tailscale serve` with `/` to 5183, and `/api` and `/ws` to 8080 ([02](02-network.md)) | The mesh address opens the sign-in page |

**Done when.** A signed-in browser shows `LIVE` in the header and every device on Devices has a *last seen* within its
window.

**Rollback.** `sudo systemctl disable --now ibems-dashboard` and `systemctl --user disable --now ibems-kiosk`. Nothing
else depends on them.

**Tested.** Steps 2–4 are what runs on the pilot today [E-023, E-025]. A fresh install from this list has not been run.

## How to configure

| Setting | Where | Default and effect |
|---|---|---|
| **Database address and public key** | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in the checkout's root `.env.local`, read at **build** time | **Required for production.** Without them the app asks for no sign-in at all [E-180]. After changing them, rebuild. |
| Weather location | `VITE_WEATHER_LAT`, `VITE_WEATHER_LON`, `VITE_WEATHER_PLACE` | The site's declared location. With neither, the card says it is unconfigured rather than borrow a city. |
| Bridge address override | `VITE_BRIDGE_HTTP_URL`, `VITE_BRIDGE_WS_URL` | **Leave unset in production.** A baked address works only from the one network path it names [E-183]. |
| Optional cards | *Settings → Page cards* (`site_ui_prefs`) | Shown |
| Spaces and floor plan | *Settings → Spaces*, *Settings → Floor plan* | Empty |
| Room-temperature floor for automatic rules | *Settings → Building policy* | The site's build value |
| Tariffs and emission factors | *Settings → Tariff & emissions*, each with a source | None: reports show no cost until one is set ([04](04-data.md#how-to-configure)) |
| Theme | The sun and moon button in the header | Light. A manual choice, not the system setting, remembered per browser [E-175]. |

## How to verify

| Check | How | Pass looks like |
|---|---|---|
| Served | `curl -sf http://127.0.0.1:5183/ >/dev/null && echo ok` on the edge | `ok` |
| The kiosk runs the current build | `curl -s http://127.0.0.1:5183/ \| grep -o 'assets/index-[^"]*'` against the newest `dist/assets/index-*.js` | The same name [E-004] |
| Sign-in is required | Open the site-network address in a private window | The sign-in page, not the Overview |
| Sign-up is off | The provider's sign-in settings; or, on the edge, the auth service's public `/auth/v1/settings` | "Allow new users to sign up" is off; `disable_signup: true` [E-176] |
| Live | The header pill | `LIVE`, not amber |
| Stale marking works | Unplug one outlet, or watch one reported offline | Its figures dim and are flagged within its window (150 s for an outlet) |
| A command confirms | Toggle a light you can see. Then, in the database's SQL editor (read-only): `select status, via, requested_at from commands where device_id = '<id>' order by requested_at desc limit 1;` | The light changes, the control settles without a message, and the row reads `dispatched` [E-065] |
| Remote | The mesh address from a device on the tailnet | The same page, `LIVE` |

## How to operate

### User guide

**Read the dashboard.** Start at the Overview. *Live Demand* is what the building draws now. The three phase figures
and their balance note show whether one phase carries more than the others. *Device Status* counts what is reporting.
A dimmed figure with a *stale* flag is old, not current. A notice about a held reading means that meter repeated
itself, so trust its energy register, not its watts.

**Find yesterday's consumption.** Open *Reports* from the account menu, choose *Day*, and step back one day. A day's
report is made shortly after it ends. Until then, the page says when it is due rather than showing nothing
(`shared/reportSchedule.mjs`, ROADMAP RM-138). The coverage banner says how much of the day was recorded. For a single circuit, open the *Circuits* tab. For a quick look
without a report, Analytics' *Energy* card shows today, this week and this month by branch.

**Switch a load.** On *Control*, press the switch or the socket. The control shows the command in flight, then settles
on the state the device reports. A red message names what went wrong (see the refusal table). The bulk buttons
at the top (lights off, outlets off, aircon off) ask for confirmation first. Overview's *Quick Control* sends the same
commands for the aircon and one light.

**Set a schedule.** *Automation → Time-Driven*. Choose a relay, then *Add schedule*. Set *On at*, *Off at* and the
days, arm it, and press *Save changes*. **An unarmed schedule never fires.** The week timeline draws only armed
schedules, because "nothing armed" and "always off" would otherwise look the same. The scheduler on the edge fires it
through the audited path; the browser need not be open [E-071]. Schedules and rules belong to the site's operator:
change them only on the operator's instruction.

**Set a demand threshold.** *Automation → State-Driven → DSM Thresholds*. Enter a maximum phase current (A) and/or a
maximum total draw (kW). The default response is to warn and wait for a person. Arming **auto-shed** asks for
confirmation, because it switches load off unattended, and it cannot be armed until at least one relay has a shed
tier. Assign tiers in the *Load-shed tiers* list on the same tab: group 1 sheds first, "Never shed" protects a load,
and unassigned means never shed. **Auto-shed sheds, it never restores**: switching back on is a person's decision
([X2a](X2a-control-strategy.md)). A device's Metadata tab edits the same tier, and **its hint wrongly says nothing sheds
from it** (F-028).

**Interpret a shed event.** *Automation → Summary → What automation did in the last 24 hours* lists every unattended
command: schedules, auto-shed and the aircon loop, with the time and the status. A shed row names the relay it switched
off, and its note names the tier and the limit that was breached (`auto-shed <tier>: <breach>`) [E-185]. To restore,
switch the load back on from Control once the demand is understood.

**Interpret an alert.** The bell in the header gathers four kinds [E-185]:

- a device whose reading went stale;
- unusual power, flagged by the ingest daemon only when two statistical tests agree [E-076];
- a fleet-level row when many devices stopped together. It carries the remedy: restart Node-RED before suspecting
  hardware;
- a device whose command only landed through the vendor cloud.

*Ack* hides an alert in this browser until the page is reloaded. It changes nothing on the device, and the alert returns
on reload if the cause remains.

**Export data.** *Reports → Export*. Choose the PDF, or a CSV: the building by day; each device for the period; each
device by day; or every reading. Older hours in the last one are hourly averages, and a month of it is a large file.
Cost appears in the exports once a rate is entered, and emissions once a factor is.

### Administration guide

**Add a user.** Sign-up is off, so an administrator adds each account from the database provider's dashboard
(*Authentication → Users*, invite by email) [E-176, E-177]. **Every account can switch every load** [E-163], so invite
only people who should, and record who holds one ([X1](X1-security.md)). Roles do not exist: one account per person,
never a shared login, is the only separation there is.

**Remove a user.** Delete the account in the same place. **If the person ever sent a command or saved a setting, the
database refuses the deletion**, because the audit trail names them [E-184]. That is intended. Ban the account instead
(the provider's admin `ban_duration`), and change any shared credential the person knew, including the break-glass
password.

**Add a device.** *Devices → Add device*. The whole procedure, with keys and verification, is in
[01 § How to install](01-field-devices.md#how-to-install).

**Rename or reassign a device.** *Devices → Manage → Metadata*: *Display name override*, *Space* (defined under
*Settings → Spaces*), *Room*, *Category*, then *Save metadata*. This changes how the device is described, not what it
controls.

**Change a policy limit.** The room-temperature floor for automatic aircon rules is on *Settings → Building policy*.
Demand limits are on *Automation → State-Driven*. The floor applies to the next command the proxy validates. The
scheduler picks up a changed demand limit at its next refresh, within 60 s [E-071].

**Take a device out of service.** In this order, because the app's *Functions* boxes only hide a device and **stop
nothing** [E-182]:

1. Disarm or delete its schedules (*Automation → Time-Driven*), and any aircon rule that commands it.
2. Set its shed tier to *Not classified* (*Automation → State-Driven*).
3. Switch it to the state it should stay in, from Control.
4. Untick its Functions on the Metadata tab, so the pages stop listing it.
5. To remove it entirely: the *Remove* tab, for a device added through the app, which previews the flow nodes it will
   delete ([01](01-field-devices.md)). A built-in device is removed from `shared/registry.mjs` in code.

**Break-glass sign-in.** For when the sign-in service is unreachable and someone must see the building. On the sign-in
page, after a failed attempt that reports a network error, choose *try local sign-in instead* and enter the
break-glass password. The session reads but cannot command, lasts up to 12 h, and ends if the proxy restarts [E-172].
The password is hashed into `BREAK_GLASS_PASSWORD_HASH` in `server/.env` with `server/hashBreakGlassPassword.mjs`.
Store the password with the other credentials ([X3](X3-operations.md)), and rotate it when someone who knows it leaves.
The proxy logs each attempt but not its outcome, and nothing limits repeated attempts (F-027, Q-18).

### Accessibility

| Aspect | As built | Evidence |
|---|---|---|
| Contrast | Every text colour meets WCAG AA against every surface it may land on, in both themes; a test enforces it. The palette is checked, not each composed page. | E-175 |
| Touch targets | 44 px minimum on a coarse pointer (the kiosk's touchscreen), enforced by a test after a typo once removed it from twelve controls | E-175, E-183 |
| Small screens | Measured at 360 px, 768 px and 800 × 480: no pop-up wider than the screen. The navigation wraps to two rows below 860 px. | ROADMAP RM-141, E-175 |
| Motion and contrast preferences | Reduced motion and high contrast are honoured | E-175 |
| Screen readers | A skip link to the content; focus moves into each new page; stale readings are announced | `src/App.tsx`, E-175 |
| Colour | No circuit is told apart by colour alone | ROADMAP RM-139 |

## How it fails

| Symptom | Likely cause | Check that tells the causes apart | Fix | How to confirm it held |
|---|---|---|---|---|
| Kiosk screen blank or "This site can't be reached" | The kiosk unit is not running, the dashboard is not serving, or autologin is off | `systemctl --user status ibems-kiosk` (note `--user`); `systemctl status ibems-dashboard`; `curl -sf http://127.0.0.1:5183/`; does the display show a greeter? | Start whichever is down. Restore autologin. | The Overview on the display after a reboot |
| Dashboard renders, every figure "—" | The bridge or the proxy is down, or the edge left the device segment | The pill says `RECONNECTING` or `OFFLINE`; `systemctl status ibems-proxy nodered`; [02](02-network.md#how-it-fails) | Restart the service that is down, or restore the network | `LIVE`, figures within their windows |
| Values stale with no warning | Should not happen: staleness is judged per device by the clock. If it does, suspect a **held** value (the device repeating itself), or an old build on the kiosk | Is there a held-reading notice? Compare the served bundle with the newest build (How to verify). | A held meter: [01](01-field-devices.md#how-it-fails). An old build: it reloads within 5 min once idle. | The figure moves, or the notice appears |
| Control button does nothing | Read the red message first. Interlock closed (`NOT DISPATCHED`), break-glass session, device offline, or a polled device that has not reported yet | The message's wording (refusal table); the newest `commands` rows for the device | Per the message. A device polled every 60 s can take that long to show its new state. | The control settles; the row reaches `dispatched` |
| Login fails | Wrong password; the account does not exist (sign-up is off, so a new person needs an invitation); the email is unconfirmed; the sign-in service is unreachable | The error text; whether the page offers local sign-in (that means a network error) | Reset the password, invite the person, or use break-glass to view | The Overview |
| A chart shows zero where data is missing | Should not happen: gaps are drawn as breaks. A zero means a real 0 W reading, or a query that ignores `online` | Analytics' data-quality badge (gaps, frozen); [04](04-data.md#query-cookbook), query 7 | If it is a query: filter `online` (F-013) | A gap, not zeros, on a known outage |
| Works on the site network, not remotely | The remote device is off the tailnet, Serve is not routing, or the build has a baked bridge address | `tailscale serve status`; `tailscale status` on the remote device; `VITE_BRIDGE_*` in the build's `.env` files | Rejoin, fix Serve, or rebuild with the overrides unset | The mesh address shows `LIVE` |
| Works remotely, not on the site network | Port 8080 or 5183 unreachable from that network, or client isolation | `curl -s -o /dev/null -w '%{http_code}' http://<edge-address>:8080/api/devices` from that network (`401` means reachable) | [02](02-network.md#how-it-fails) | The page shows `LIVE` |
| The app opens with no sign-in | A build without the database variables [E-180] | The account menu has no sign-out; `grep -c VITE_SUPABASE_URL .env.local` in the checkout | Restore `.env.local`, rebuild | The sign-in page |
| "This page stopped responding" | A display fault in one page | The detail line in the box | *Try again*, or reload. Report it with the detail line. | The page draws |

## Field issue log

Site specifics are in [99](99-worked-example.md).

| Date | Symptom | Root cause | Fix | Evidence | Lesson |
|---|---|---|---|---|---|
| 2026-08-31 | A device-offline refusal read as "bridge not reachable"; the diagnosis went wrong for a fortnight | The message was chosen from the HTTP status alone, not the proxy's code | One message per refusal code | E-183 | A message that names the wrong subsystem is worse than none |
| 2026-09-02 | The office display showed week-old software through four deploys | A single-page app never reloads itself | The build watch; the kiosk reloads itself when idle | E-183 | A screen nobody touches is never refreshed |
| 2026-09-02 | Stale flags covered most of the floor plan on the 800 × 480 display | The flag was wider than the pin it labelled | A dot on plans; the spoken warning unchanged | E-183 | Measure on the real display |
| — | Mesh viewers stuck on "Reconnecting" while the bridge was healthy | A build baked with the edge's LAN address | The address comes from the page's own origin | E-183 | One build must work from every path |
| — | Every page empty while the header said `LIVE` | The first device-list fetch failed once and was never retried | Retried on the polling backoff | E-183 | A one-time fetch needs a retry too |
| 2026-09-24 | Anyone could create an account | Sign-up was left open, with no role below "signed in" | Sign-up turned off; accounts by invitation | E-169, E-176 | Who can sign in is the access policy, when there are no roles |

## What to keep on the shelf

| Item | Why |
|---|---|
| A list of who holds an account, and when each was added | There are no roles; the list is the access control |
| The break-glass password, stored with the other credentials | The only way to see the building when the sign-in service is down |
| A spare display cable and power supply for the kiosk | The display is the system for most people in the room |
| The mesh address, written where the operator can find it | Remote access without it means a site visit |
