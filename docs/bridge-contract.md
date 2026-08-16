# iBEMS Bridge Contract — Stage 1 (reads) + Stage 2 (mock-only writes)

**Status:** the four `GET`/`WS` endpoints below are read-only, always have been, and stay
that way on the Pi. **Phase L (Stage 2) added one write endpoint,
[`POST /api/command`](#post-apicommand-mock-bridge-only), to `mock-bridge/server.mjs`
only** — the Node-RED bridge that actually talks to the Pi's relays is untouched and has
no write path. See that section for the full contract and why it's scoped this way.

Two implementations satisfy the read contract and must stay identical:

| Implementation | Where | Purpose |
|---|---|---|
| Node-RED bridge | `node-red-bridge/bridge-flow.json` | Real data, runs on the Pi — reads only |
| Mock bridge | `mock-bridge/server.mjs` | Local development, no hardware needed — reads + the Stage 2 command path |

Both import `shared/registry.mjs`, so the device list can never drift between them.
`shared/commands.mjs` (the command contract) is imported by the mock and the test suite
only — **not** by `node-red-bridge/build-flow.mjs` — so the Pi build is unaffected by its
existence.

> **Schema alignment is load-bearing.** Field names below intentionally mirror the future
> Supabase `devices` / `readings` tables (architecture doc §3.2, §3.4) so Stage 3 is a
> data-source swap, not a rewrite. Renaming a field here means renaming it in
> `ibems-dashboard-stage1-plan.md` §2 and the architecture doc §3.4 **in the same change**.

---

## Timing

Derived from the live flow's real tick rates, not assumed. The Stage 1 plan assumed a
3-minute cadence; the injects driving that (`Trigger Every Set Mins`, repeat `180`) are
all `disabled: true`. What actually runs is `Update Main UI` and `Live UI & Energy Tick`,
both `repeat: 2`.

| Constant | Value | Source |
|---|---|---|
| WS push | 2 s | `Update Main UI` inject |
| History sample | 60 s | 1440 points = 24 h; matches the 60 s `Cron *` injects |
| Polling fallback | 15 s | 2 s is wasteful over HTTP; matches `Bems.html`'s proven default |
| Stale threshold | 30 s | 15× the push interval — tolerates a missed tick, still catches a dead device |
| Fetch timeout | 10 s | `Bems.html:1277` |
| Backoff cap | 120 s | `Bems.html:1316` |

---

## `GET /api/devices`

Returns the registry. Static for the lifetime of the process.

```json
[
  {
    "id": "co3",
    "display_name": "Outlet 3",
    "class": "outlet_dual",
    "room": null,
    "dps_map": "type_b",
    "sockets": ["CO3_1", "CO3_2"],
    "branch_circuit": "C.O Yellow",
    "status": "active"
  }
]
```

`class` is one of `outlet_dual | switch | meter | acu_ir | sensor_temp_humidity`.

> **Spec deltas to fold back into `ibems-onboarding-wizard-spec.md` §4:**
> - `class` needs a **`meter`** member. The spec's enum is
>   `switch | outlet_dual | acu_ir | sensor_temp_humidity`; the four CT meters fit none of them.
> - `room` is nullable and is `null` for every device. Nothing in the live flow records room
>   assignment — capturing it is precisely what the Phase 4.5 onboarding wizard exists to do.

---

## `GET /api/readings/latest`

One entry per device. Devices with no metering (switches, the IR aircon, the temp sensor)
omit `voltage`/`current`/`power_w` rather than reporting `0` — a missing reading and a real
zero are different facts and the UI renders them differently.

```json
[
  {
    "device_id": "co3",
    "ts": "2026-08-10T09:32:00+08:00",
    "voltage": 221.4,
    "current": 1.82,
    "power_w": 402.1,
    "energy_kwh_today": 3.11,
    "online": true,
    "state": "on",
    "socket_states": { "1": "on", "2": "off" }
  }
]
```

| Field | Type | Source (flow context) |
|---|---|---|
| `device_id` | string | registry `id` |
| `ts` | ISO 8601 +08:00 | `<ctx>_last_time`, else read time |
| `voltage` | number \| absent | `<ctx>_last_v` |
| `current` | number \| absent | `<ctx>_last_c` |
| `power_w` | number \| absent | `<ctx>_last_p` |
| `energy_kwh_today` | number \| absent | `<ctx>_energy` |
| `online` | boolean | `<ctx>_health` for metered devices; `switch` class — see below; `acu_ir`/`sensor_temp_humidity` — hardcoded `true` (no health signal exists for these) |
| `state` | `"on" \| "off" \| null` | see below |
| `socket_states` | object \| absent | `outlet_dual` only |

**`switch` online derivation:** `global.lightStatus[n].conn === 'CONNECTED'`, where `n` is
`state_key` with its `L` prefix stripped (`L3` → `3`). `lightStatus` is populated by the
Lighting Logic Hub — a real per-switch connection signal that previously existed but wasn't
read; switches used to report `online: true` unconditionally regardless of actual Tuya
connectivity. Falls back to `true` if no `lightStatus` entry exists for that switch (older
flow, or a bridge/mock snapshot that doesn't carry `health` at all) — an absent signal is
never turned into a false negative.

**`state` derivation by class:**

- `switch` — `bems_lights_state[state_key]`, e.g. `bems_lights_state.L3`
- `outlet_dual` — `"on"` if **either** socket is on in `bems_outlets_state.status`
- `acu_ir` — `ac_dash_state.power`
- `meter`, `sensor_temp_humidity` — `null` (not a switchable thing)

> **`state` and `socket_states` are transient device state, not readings.** The Stage 3
> `readings` table is `(device_id, ts, voltage, current, power_w, energy_kwh)` — no state
> column. At Stage 3 these move to a separate device-state concept; they are carried on this
> payload only because Stage 1 has one live feed, not two.

### Building totals

The same response carries a `_totals` pseudo-entry (leading underscore keeps it out of the
per-device list without needing a second endpoint):

```json
{
  "device_id": "_totals",
  "ts": "2026-08-10T09:32:00+08:00",
  "energy_kwh_today": 12.41,
  "energy_kwh_week": 61.88,
  "energy_kwh_month": 204.3,
  "total_power_w": 2951.0,
  "avg_voltage": 223.1,
  "phase_current": { "red": 6.1, "yellow": 4.9, "blue": null }
}
```

`phase_current.blue` is **`null`, not `0`**. `Calculate 3-Phase Totals` hardcodes
`currentBlue = 0` because no Blue-phase meter is installed. The UI must render this as
"not metered".

Totals read from `bems_energy_today` / `bems_energy_week` / `bems_energy_month`.

> **Known upstream quirk, not a bridge bug:** `bems_energy_today` sums only the four CT
> meters. The seven outlet accumulators (`co1_energy`…`co7_energy`) are excluded from the
> building total, and are not reset by `Midnight Auto-Reset` either. The bridge reports what
> the flow computes; correcting the flow is out of scope for Stage 1.

---

## `GET /api/readings/history?device_id=<id>&range=24h`

```json
{
  "device_id": "co3",
  "range": "24h",
  "points": [{ "ts": "2026-08-10T08:00:00+08:00", "power_w": 388.2 }]
}
```

`range` accepts `1h | 6h | 24h`. Unknown values fall back to `24h`.

> **This required new storage.** The Stage 1 plan assumed history could be read from
> "flow context arrays used for the current 24h charts". It cannot: `*_arr_v/_arr_c/_arr_p`
> are 3-minute *averaging* buffers that `Fetch Memory & Format` empties every cycle, and the
> injects driving them are disabled. The only other history lives inside `ui_chart` nodes
> (12 h, dashboard memory, no API).
>
> So the bridge maintains its own ring buffer: a 60 s inject samples every metered device
> into `flow.get('hist_<id>')`, capped at 1440 points, oldest dropped.
>
> **This is worthless without `contextStorage`.** `settings.js` has it commented out
> (lines 357–361), so context is memory-only and every restart wipes the buffer along with
> all energy accumulators. Enabling `localfilesystem` is a prerequisite — see §Deployment.

A freshly started bridge returns `points: []`. That is correct, not an error; the buffer
fills at one point per minute.

---

## `WS /ws/live`

Pushes the exact payload of `GET /api/readings/latest` — the same array, including
`_totals` — every 2 s. Same shape, same code path, no separate serializer.

The client falls back to polling `/api/readings/latest` every 15 s if the socket drops, and
upgrades back to WS on reconnect.

---

## `POST /api/command` — mock bridge only

**This endpoint exists only in `mock-bridge/server.mjs`. The Node-RED bridge that talks to
the real relays has no write path, and `node-red-bridge/build-flow.mjs` never imports
`shared/commands.mjs`.** If that ever changes, it's a real, separate decision — deploying
device control to hardware — not something to fall out of a refactor. `test/contract.test.mjs`
guards this boundary directly.

```json
// Request
{ "device_id": "co3", "socket": 1, "action": "on", "command_id": "optional-client-uuid" }

// Response — 202 Accepted, never 200
{
  "command_id": "optional-client-uuid",
  "device_id": "co3",
  "socket": 1,
  "action": "on",
  "target": "CO3_1",
  "accepted_at": "2026-08-11T09:32:04+08:00",
  "confirmed": false,
  "confirmation": "none",
  "note": "commanded state only — this device does not report relay state back"
}
```

**`action` is always absolute (`"on"`/`"off"`), never `"toggle"`.** A toggle would be
computed from a last-known state that's never confirmed by hardware; a double-fire on a
retry would flip a relay back to where it started. Absolute set makes every command
naturally idempotent.

**`socket` is required for `outlet_dual`, forbidden otherwise.** There is no whole-outlet
relay — `state` on an outlet reading is *derived* (`s1 || s2`), and the legacy Node-RED
`Format CMD` nodes only ever emit `{dps: 1 | 2, set}`. A UI wanting "turn off Outlet 3"
sends two commands.

**`202`, not `200`, and `confirmed: false` — always.** Nothing in this system, at any
layer, reads a relay's DPS position back from hardware (see `shared/registry.mjs`'s CT
circuit map — the meters measure current, not relay state). The old Node-RED dashboard's
`bems_outlets_state.status` was always optimistic UI state for exactly this reason. This
bridge is honest about that instead of pretending otherwise: the ack means "dispatched,"
not "verified," and the UI's "commanded, not measured" labelling (`OutletsView.tsx`) keys
off these two fields directly.

| Status | `code` | Cause |
|---|---|---|
| 202 | — | accepted |
| 400 | `invalid_body` / `invalid_action` / `not_commandable` / `socket_required` / `socket_not_applicable` / `invalid_socket` | malformed or semantically invalid request |
| 404 | `unknown_device` | `device_id` not in the registry |
| 405 | `method_not_allowed` | wrong verb for the route |
| 413 | `body_too_large` | body over 8 KiB |
| 415 | `unsupported_media_type` | `Content-Type` present and not `application/json` |
| 502 | `upstream_rejected` | `--cmd-fail=<id>` injection only |

Full validation matrix: `test/contract.test.mjs`. Transport-level behaviour (body parsing,
CORS preflight, the round-trip back through `GET /api/readings/latest`, failure injection):
`test/command.test.mjs`.

Command state is an in-memory override (`commanded` in `server.mjs`) that pins a relay/
switch key forever once set — a real relay stays where you put it, and the simulator's own
occupancy-driven baseline is overridden by any key that's been commanded at least once.
Restarting the mock clears every override.

---

## Deployment (Pi)

Two `settings.js` changes are required. Both are currently commented out.

```js
// ~line 357 — REQUIRED. Without this, context is memory-only: every Node-RED
// restart zeroes the history ring buffer and all energy accumulators.
contextStorage: {
    default: { module: "localfilesystem" },
},

// ~line 201 — required only for LAN builds served from another origin.
// Not needed in dev: Vite proxies /api and /ws (see vite.config.ts).
// Stays GET-only: the Node-RED bridge has no write route to allow. If a Pi write path
// is ever built, this becomes "GET,POST,OPTIONS" — the mock's own CORS handling
// (server.mjs's OPTIONS branch) is the reference for what that needs to look like.
httpNodeCors: { origin: "*", methods: "GET" },
```

Then import `node-red-bridge/bridge-flow.json` (Menu → Import). It adds one new tab and
modifies nothing existing.

> **Do not port-forward port 1880.** Node-RED here has no `adminAuth` and no `httpNodeAuth`,
> and `flows.json` stores every Tuya `deviceKey` in plaintext — exposing the port hands over
> full control of all 21 devices. BEMS LAN only. Remote access is Stage 4, with auth.
