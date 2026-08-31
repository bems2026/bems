# Running Claude on the Pi — session brief

**Paste this to start a session:**

> Read `docs/pi-session-brief.md` and `CLAUDE.md`, then run the first-moves checks in the brief
> and tell me what you find before proposing anything.

---

## Why this file exists

`CLAUDE.md` describes the project. This describes **being on the Pi**, which is a different job
from working on it remotely.

Sessions so far have run over SSH from a workstation. That works for reading and for editing the
repo, but the two most valuable actions on 2026-08-25 — writing the live Node-RED flow and
restarting Node-RED — were a hand-off each time: one was blocked by the remote sandbox, and one
took two attempts because the deploy script reported success while doing nothing. Here, both are
ordinary local commands.

**So: do not propose SSH, and do not hand a command back to the operator that you can run.** The
authority section below says which those are.

> **Amended 2026-09-01.** A remote session from the Windows workstation over the tailnet did the
> whole of that list unaided: `systemctl restart`, three live flow writes (`deploy:pi --force
> --apply`, `fix-health:pi --apply`, `poll-outlets:pi --apply`), a `git pull`, `npm run build`,
> all three suites on the Pi, and a real relay dispatch. So the sandbox limitation above is no
> longer the constraint it was, and a remote session should NOT assume it must hand these back.
>
> What has not changed is the *authority* boundary below — a flow write still needs asking, from
> either place — nor the value of being on the Pi, which is the journal, the network and
> `flows.json` being local rather than a round trip away. Two traps are specific to the remote
> case: paths are the **Pi's** (`/home/bems/bems`, not the workstation checkout), and a
> multi-line search/replace written on Windows will not match a CRLF file, which fails silently
> and looks like a no-op rather than an error.

---

## Your authority here

Decided by the operator, 2026-08-25.

**Do freely — no need to ask:**

- Read anything: `journalctl -u nodered|ibems-*`, `GET /flows` via the admin API, the readings
  endpoint, `server/.env`, the network (`nmcli`, `iw`, `ip neigh`), Supabase through the
  existing scripts.
- `sudo systemctl restart nodered` and the `ibems-*` services. This is the single highest-value
  action available and it is reversible — see *Restart before you suspect hardware* below.
- Run the repo's test suites, `npm run build`, `npm run build:flow`.
- Any script in its **dry-run** form (they all default to it): `deploy:pi`, `quiesce:pi`,
  `enroll:pi`, `remove:pi`, `tuya:devices`.

**Ask first — every time:**

- **Writing the live flow**: `deploy:pi --apply`, `quiesce:pi --apply`, `enroll:pi --apply`,
  `remove:pi --apply`, or any `POST /flows`. Back up `~/.node-red/flows.json` first, always.
- **Dispatching to hardware** — anything that moves a relay, including a "harmless" no-op.
- **`git commit`, `git push`**, or editing `.env` files.

**Never:**

- `git add -A` in this repo. Enumerate paths. The repo is public.
- Change the Pi's Wi-Fi. A wrong SSID loses the host and nobody may be on site.
- Hand-edit `node-red-bridge/bridge-flow.json`. It is generated.
- **Widen the MQTT broker back to all interfaces.** It is bound to loopback on purpose
  (2026-08-26) — see the Broker row below. If something off-host genuinely needs to publish,
  add a listener bound to the LAN address *with a `password_file`*; do not edit the loopback
  listener to `0.0.0.0`, which is the state that was removed.

---

## State as of 2026-08-26, with the evidence

Do not trust this section past its date — re-run the first-moves checks. It is here so you know
what *was* true and what has already been ruled out.

| | |
|---|---|
| Fleet | **15/21 online.** `co1`–`co3`, `co7`, all seven lights, all four meters. |
| `co4`–`co6` | **All three need power cycling.** `co4` and `co6` are absent from the segment (no ARP entry). `co5` *is* on the segment and answers ARP — the static-`deviceIp` remedy was actually tried on it 2026-08-26 and it refused every TCP connection, so **ARP is not reachability** and it needs power too. **Re-run `npm run tuya:macs` immediately before the trip:** the split moved twice inside one hour on 2026-08-26. |
| Broker | **Mosquitto is loopback-only since 2026-08-26** (`127.0.0.1` and `::1`), anonymous, and the websockets listener is retired. It previously listened on every interface with `allow_anonymous true` on the device segment. **This config lives only in `/etc/mosquitto/` — nothing in the repo declares it**, same exposure shape as `findTimeout`: a rebuild or package upgrade restores the permissive default silently. Timestamped `.bak` files sit beside both config files. Node-RED (the only client, on `localhost`) is unaffected; **anything off-host now gets `Connection refused`**, which is what RM-005's ESP32 would hit and what forces RM-026's bridge to use host networking. |
| `l6` | Recovered. Was written up as an RF/hardware fault; a Node-RED restart reconnected it in two seconds and the operator then toggled the real fixture. Only its one-hour stability window is unproven (RM-012). |
| IR Blaster, Outside Temp | Not in the Tuya cloud project, never connected. **Quiesced** (`disableAutoStart`), so they no longer retry every 10 s. `acu_main` and `sens_outside_temp` now honestly report `online: false`. Reversible with `quiesce:pi --undo`. |
| Cloud dispatch fallback | **Works** — verified against `co1` at `{ok:true}` in 972 ms while it was locally unreachable. Covers all 14 commandable devices. |
| `server/data/` | **Live state, not scratch.** `jwks.json` is the cached signing key that lets sessions be verified while the internet is down; `command-audit-buffer*.ndjson` is the outage queue of command audit rows waiting to reach Supabase (one file per writing process — the proxy and the scheduler). Files here with rows in them mean **Supabase was unreachable and `ibems-ingest` will drain them**, not that something is broken. Empty is the normal steady state. Do not delete them: each row is a relay that moved. |
| Commands offline | **They work.** Since 2026-08-26 a real Supabase session is verified locally against the cached key, and the audit row is written to the buffer above before dispatch, so an internet outage no longer removes control of a fleet that is entirely local. Applies to manual, scheduled and auto-shed commands. Break-glass sessions stay **view-only**. The Control page shows the backlog when it is non-zero. |
| Services | `nodered`, `mosquitto`, `ibems-proxy`, `ibems-dashboard`, `ibems-ingest`, `ibems-scheduler` — all active. |

---

## First moves on any session

Run these before proposing anything. They take under a minute together.

```bash
systemctl is-active nodered ibems-proxy ibems-dashboard ibems-ingest ibems-scheduler

# Timeouts PER DEVICE. A bare `grep -c` counts the whole fleet and tells you nothing —
# that mistake was made on 2026-08-25 and produced a wrong conclusion.
sudo journalctl -u nodered --since "-10 min" | grep "find() timed out" \
  | grep -oP "tuya-smart-device:\K[^]]+" | sort | uniq -c | sort -rn

curl -s http://127.0.0.1:1880/api/readings/latest | head -c 400

npm run tuya:devices   # the cloud's view beside the bridge's — the local/cloud split IS the diagnosis
```

The local-vs-cloud comparison is the one that decides what kind of problem you have:

- **local down, cloud up** → the device is fine, the local path is not. A restart may fix it;
  cloud dispatch can command it meanwhile.
- **local down, cloud down** → genuinely off the network. Power-cycle. Nothing here helps.
- **both up** → not a connectivity problem; look at the flow or the app.

---

## Traps this project has actually fallen into

Each of these cost real time. They are not hypothetical.

**Restart before you suspect hardware.** `l6` had a written diagnosis — `EHOSTUNREACH` at every
protocol version, ARP `FAILED`, "needs eyes on the fixture". Nobody went, and a restart fixed it
in two seconds. A tuya node that has given up stays given up, and looks exactly like a device
that is unplugged. The same restart recovered five devices. Only if a device is still dark
afterwards is the hardware suspicion earned.

**`deploy:pi` needs `--force` when `bridge-flow.json` was regenerated.** Without it, it used to
print *"already deployed. Nothing to do."* and exit 0 — indistinguishable from success. It now
compares content and exits 1 telling you to use `--force`, but the habit matters: after
`build:flow`, the deploy is `--force --apply`.

**Back up `~/.node-red/flows.json` before any flow write.** `findTimeout` and `tuyaVersion` live
*only* on the live flow's four hand-built source tabs. Nothing in the repo declares them, so
losing them produces no diff and no alarm — and the symptom is every device going offline, which
reads as a network fault.

**A green test suite is not proof.** Twice on 2026-08-25 a fix shipped green and changed nothing:
once because the data shape was assumed rather than read (`ac_dash_state` holds a `"--"`
placeholder, not `{}`), once because the deploy silently skipped. **Neuter the fix and confirm
the test fails**, then read the live system back.

**HTTP 2xx from Node-RED is not proof a relay moved.** The endpoint answers when it *accepts* the
message; the tuya node fails afterwards. This is fixed in `dispatchCommand`, but the same shape
will recur anywhere a queue is mistaken for a result.

**A ping with no reply is not client isolation.** Windows drops ICMP by default. Use `ip neigh` —
if ARP resolves the MAC, layer 2 works.

**ARP is not reachability either.** Answering ARP proves the device's *network* layer is alive,
not that a Tuya session can be established. `co5` answered ARP throughout 2026-08-26, accepted a
correct static `deviceIp`, and then refused every TCP connection for six minutes — the address
was correct and useless. ADR-002 describes exactly that state. So "on the segment" means *try the
free remedy first*, not *no power-cycle needed*.

**`localhost` is two addresses, and binding one of them silently locks out the other.** It
resolves to `::1` on this host as well as `127.0.0.1`, and the broker's logs show both in use, so
`listener 1883 127.0.0.1` alone would have cut off whichever the resolver happened to prefer that
day — presenting as a broker fault rather than a config one. The live config binds both families.
Validate any listener change on a spare port *before* it goes near the running service; a second
`mosquitto -c` on an unused port costs nothing and answers the question outright.

**A test can write into the live system's state.** `server/data/` holds the real command-audit
outage queue and the cached signing keys. On 2026-08-26 a full `npm run test:server` left a
fabricated `l1` command there — a row `ingest.mjs` would have uploaded into the **production**
audit trail, attributed to a test user. The harness closes its fake Supabase mid-command, and a
socket dying mid-request is indistinguishable from a real outage, so it buffered exactly as
designed. Fixed and guarded by `server/testStatePaths.test.mjs`, but the shape is worth
remembering: the brief tells you to run the suite on the Pi, so the suite must never write
anywhere the daemons read.

---

## The commands that matter

```bash
# Flow — dry run first, always; --force after any build:flow
npm run deploy:pi  -- --host=127.0.0.1 [--force] [--apply]

# Silence a permanently unreachable node (reversible with --undo)
npm run quiesce:pi -- --host=127.0.0.1 [--undo] [--apply]

# Devices in and out of the registry + flow, from one validated decision
npm run enroll:pi  -- --host=127.0.0.1 --list
npm run remove:pi  -- --host=127.0.0.1 --list

# Give a dark-but-on-segment device a static address (reversible with --undo).
# Free to try; NOT a guarantee — see "ARP is not reachability" above.
npm run set-device-ip:pi -- --host=127.0.0.1 [--undo] [--apply]

# Broker: confirm it is still loopback-only. Two rows, both loopback, nothing on 0.0.0.0.
ss -lnt | grep :1883

# Suites
npm test && npm run test:bridge && npm run test:server
```

Reading the live flow directly, when you need more than a script exposes:

```bash
node --env-file=server/.env -e '
import("./node-red-bridge/nodeRedAdmin.mjs").then(async (m) => {
  const a = m.createAdminClient({ host: "127.0.0.1", port: 1880, timeoutMs: 15000 });
  const { flows } = await a.getFlows(await a.login());
  console.log(flows.length, "nodes");
});'
```

Note `createAdminClient`'s `fetchWithTimeout` **prepends the base URL** — pass it a path
(`/context/flow/<tabId>/<key>`), never a full URL. The same trap in the frontend's `fetchJson`
produced a "vendor cloud could not be reached" error that looked like a credentials fault; there
is now a test guarding the frontend call sites (`src/lib/bridgeClientPaths.test.ts`).

---

## Where to look next

`ROADMAP.md` **§0 Triage** is the current priority list — blocked-on-site, waiting-on-time,
waiting-on-a-decision, and the build order. Every item expands under its own id further down.

`docs/adr-002-device-recovery-path.md` explains why cloud dispatch exists and, importantly, what
it cannot fix — which is exactly the state `co1`–`co6` are in.
