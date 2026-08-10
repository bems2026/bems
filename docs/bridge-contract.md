# iBEMS Bridge Contract — Stage 1

**Status:** read-only. There are no `POST` endpoints and there will be none in Stage 1.

Two implementations satisfy this contract and must stay identical:

| Implementation | Where | Purpose |
|---|---|---|
| Node-RED bridge | `node-red-bridge/bridge-flow.json` | Real data, runs on the Pi |
| Mock bridge | `mock-bridge/server.mjs` | Local development, no hardware needed |

Both import `shared/registry.mjs`, so the device list can never drift between them.

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
| `online` | boolean | `<ctx>_health` |
| `state` | `"on" \| "off" \| null` | see below |
| `socket_states` | object \| absent | `outlet_dual` only |

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
httpNodeCors: { origin: "*", methods: "GET" },
```

Then import `node-red-bridge/bridge-flow.json` (Menu → Import). It adds one new tab and
modifies nothing existing.

> **Do not port-forward port 1880.** Node-RED here has no `adminAuth` and no `httpNodeAuth`,
> and `flows.json` stores every Tuya `deviceKey` in plaintext — exposing the port hands over
> full control of all 21 devices. BEMS LAN only. Remote access is Stage 4, with auth.
