# Phase F — LAN Integration Runbook

**Status as of this writing: the Pi is not reachable from the dev machine that built this
repo** — no gateway route to it, no `raspberrypi.local`/`raspberrypi` mDNS response. This
runbook exists so that the moment it *is* reachable (this session or a future one), Phase F
is a handful of commands instead of a re-derivation of the whole plan.

**Two things in this runbook need the Pi's filesystem or console, not just network
reachability, and neither can be scripted from here:**
1. Editing `settings.js` (`contextStorage`, `httpNodeCors`)
2. Restarting Node-RED to pick that up

Everything else is scripted and safe to run repeatedly — see the tooling table below.

---

## Tooling

| Script | Mutates anything? | Purpose |
|---|---|---|
| `npm run verify:pi -- --host=<ip>` | No | Runs the Stage 1 plan §6 "Against the Pi" checklist over HTTP/WS. Safe to run any time, deployed or not. |
| `npm run deploy:pi -- --host=<ip>` | No (dry run by default) | Fetches the live flow via the Admin API, checks it's safe to deploy onto, prints a diff. |
| `npm run deploy:pi -- --host=<ip> --apply` | **Yes** | Actually POSTs the bridge tab. The only command in this repo that writes to a live system. |

`deploy.mjs` refuses to write unless three checks pass — read `node-red-bridge/deploy.mjs`'s
header comment for the detail, but the short version: the four tabs the generated collectors
attach to (Energy Monitoring, Outlet, Switch, Aircon) must exist on the real Pi with the
exact ids/labels `build-flow.mjs` assumed, there must be no node id collision, and it won't
silently double-deploy — a second run without `--force` just reports "already deployed" and
exits 0.

---

## Steps

### 1. Confirm reachability
```bash
npm run verify:pi -- --host=<pi-ip>
```
Expect every check to **FAIL** right now — nothing is deployed yet. What you're actually
checking here is just: does `reachable` say PASS? If yes, the Pi is on the network and
Node-RED is listening on :1880.

If it fails: confirm the Pi's IP (`hostname -I` or your router's client list), confirm
Node-RED is actually running there (`systemctl status nodered` or however it's started),
confirm nothing's blocking port 1880 between here and there (VPN/Tailscale routing, a
firewall rule).

### 2. Dry-run the deploy
```bash
npm run deploy:pi -- --host=<pi-ip>
```
This is the step that catches the one real unknown in this whole plan: **the tab ids in
`node-red-bridge/build-flow.mjs`'s `SOURCE_TABS` were read from a dev copy of `flows.json`
on the machine that built this repo, not from the actual Pi.** If the real Pi's tabs have
different ids (a different flows.json history, a re-import, anything), this dry run aborts
loudly and tells you exactly which tab mismatched — it does not guess or attach to the wrong
tab.

If it aborts here: SSH into the Pi, read the real `~/.node-red/flows.json`, find the actual
`{"type":"tab", ...}` entries for Energy Monitoring/Outlet/Switch/Aircon, update
`SOURCE_TABS` in `build-flow.mjs` to match, `npm run build:flow`, and re-run this dry run.

If it passes: read the printed plan (node count, which tabs get collectors) before
continuing. This is the last point before anything is written.

### 3. settings.js — the one manual step

Needs SSH or console access to the Pi itself; nothing here can reach its filesystem.

```js
// settings.js, ~line 357 — REQUIRED. Without this, every Node-RED restart wipes the
// history ring buffer and all energy accumulators (bems_energy_today/week/month, every
// coN_energy). contextStorage is commented out by default.
contextStorage: {
    default: { module: "localfilesystem" },
},

// ~line 201 — only if the dashboard will be served from a different origin/device than
// the bridge itself (the normal case once this isn't just localhost-to-localhost dev).
httpNodeCors: { origin: "*", methods: "GET" },
```

Restart Node-RED after saving. Do not skip the restart — these are load-time settings.

### 4. Deploy
```bash
npm run deploy:pi -- --host=<pi-ip> --apply
```
Same safety checks as step 2, then a `POST /flows` with `Node-RED-Deployment-Type: nodes`
(only the new/changed nodes restart — nothing on the four existing tabs gets touched or
restarted) and the `rev` read moments earlier, so a concurrent edit in the Node-RED editor
produces a clean 409 instead of silently clobbering it. Runs `verify.mjs` automatically
afterward.

### 5. Full verification
```bash
npm run verify:pi -- --host=<pi-ip>
```
Everything should **PASS** now. Two things this script cannot check remotely (see its own
output — it prints this reminder every run):
- **`contextStorage` actually surviving a restart.** Restart Node-RED on the Pi, then
  re-run `verify:pi` and confirm `energy_kwh_today` in the `_totals` row didn't reset to
  near-zero. This is the literal DoD from the Stage 1 plan §6 ("Restart Node-RED → energy
  totals survive").
- **`points.length` growing over time.** The ring buffer fills at 1 point/min — run
  `verify:pi` again an hour later and expect `/api/readings/history` to show ~60 points
  instead of 0.

### 6. Point the dashboard at it
```bash
# .env (copy from .env.example)
VITE_BRIDGE_HTTP_URL=http://<pi-ip>:1880/api
VITE_BRIDGE_WS_URL=ws://<pi-ip>:1880/ws/live
```
```bash
npm run dev
```
Then work through the rest of the Stage 1 plan §6 DoD by hand: `SystemGauges`/`EnergyTotals`
cross-checked against the existing `node-red-dashboard` at the same moment, `StaleDataBadge`
confirmed by actually stopping one device's Tuya polling, reachable from a second device on
the BEMS LAN, old dashboard still running untouched.

---

## Guardrails (unchanged from the rest of Stage 1)

- Still no `POST` endpoints anywhere in the bridge — `deploy.mjs` only ever adds the tab
  from `bridge-flow.json`, which has none.
- Do not port-forward port 1880. Nothing on this Pi has `adminAuth` or `httpNodeAuth`, and
  `flows.json` holds every Tuya `deviceKey` in plaintext — the same reasoning `deploy.mjs`'s
  own Admin API access relies on (no auth needed) is exactly why this must stay LAN-only.
- `node-red-dashboard` stays live and untouched — every check above assumes it's still
  running in parallel, and `deploy.mjs`'s tab/collision checks exist specifically to
  guarantee this deploy can't disturb it.
