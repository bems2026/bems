# iBEMS Storage Contract — Phase 3 (Supabase)

Companion to [`docs/bridge-contract.md`](bridge-contract.md), which stays the single source
of truth for field names — this doc's schema is **additive**, never a rename. The full
layered-architecture rationale (why Supabase, why a narrow `ibems-server` instead of a
general backend, the full phased rollout) lives in the approved architecture plan at
`/home/bems/.claude/plans/dreamy-herding-lemur.md` — outside this repo, so copy the
relevant sections here if this doc needs to travel with the code. This doc covers only the
storage layer's wire contract.

## What writes here

**Only `server/ingest.mjs` writes to `devices`, `readings`, `building_totals`, and
`ingestion_health`**, via the Supabase service-role key (bypasses RLS). Nothing else has
insert/update access to those four tables — see the RLS policies in `supabase/schema.sql`.
The frontend and any future `ibems-server` command-gate code only ever `select` from them
(`commands`/`schedules`/`dsm_thresholds` are the exception — the frontend writes those
directly via `@supabase/supabase-js` + RLS, once Phase 5's auth lands).

## Table -> bridge-payload mapping

| Table | Populated from | Cadence |
|---|---|---|
| `devices` | `GET /api/devices` | Once at ingest startup, then every `INGEST_DEVICE_SYNC_MS` (default 5 min) |
| `readings` | `GET /api/readings/latest`, per-device entries | Every `INGEST_POLL_MS` (default `TIMING.HISTORY_SAMPLE_MS` = 60s, matching the bridge's own ring-buffer sample rate) |
| `building_totals` | `GET /api/readings/latest`'s `_totals` pseudo-entry | Same as `readings` |
| `commands` | App-originated command attempts (Phase 6+) | On write |
| `schedules` | App-originated schedule edits (Phase 6+) | On write |
| `dsm_thresholds` | App-originated threshold edits (Phase 6+) | On write |
| `ingestion_health` | `server/ingest.mjs`, every tick | Every `INGEST_POLL_MS`, best-effort (not buffered on outage) |

## Deliberate omissions (mirror `bridge-contract.md`'s own honesty about what's absent)

- **`readings` has no `state`/`socket_states` column.** `bridge-contract.md` is explicit
  these are transient device state, not readings — carried on the live payload only
  because Stage 1 has one live feed, not two. This table preserves that boundary.
- **`building_totals.phase_current_blue` is `NULL`, never `0`.** No Blue-phase meter is
  installed — see `shared/registry.mjs`'s `PHASE_MAP`. `server/shapeRows.mjs` is tested
  (`ingest.test.mjs`) to never coerce this to zero.
- **No `device_state_events` table.** Explicitly deferred — see the architecture plan.
  State is transient per the bridge contract; don't persist it speculatively.

## Outage behavior

If Supabase is unreachable, `server/ingest.mjs` buffers pending `readings`/
`building_totals` writes to a local NDJSON file (`server/ingestBuffer.mjs`, path via
`INGEST_BUFFER_PATH`) and drains it oldest-first on reconnect — see that file's header and
`docs/phase-f-runbook.md`-style DoD in the architecture plan's Phase 3. `ingestion_health`
is *not* buffered — it's a derived status snapshot, not data, and the next successful tick
corrects it.

## Environment

See `server/.env.example`. `SUPABASE_SERVICE_ROLE_KEY` must **never** be given a `VITE_`
prefix or otherwise land in `.env` at the repo root — that file feeds the browser bundle.
Server-side secrets live only in `server/.env`, read by `server/ingest.mjs` directly, never
bundled.

## Phase 6 — command audit, and schedules/DSM config

**`POST /api/command`** — `server/proxy.mjs`'s `handleCommand`, not the frontend directly.
Validates via `shared/commands.mjs` (the same pure contract the mock bridge uses), then
inserts one `commands` row per attempt using the CALLER's own verified Supabase token (RLS
`authenticated` grants the insert; the proxy holds no elevated key for this — see that
file's header). `status` is `'dry_run'` unless `HARDWARE_DISPATCH_ENABLED=true`, in which
case it's `'dispatched'` — either way, nothing is actually forwarded to the real bridge yet
(Phase 7 adds that route). Break-glass sessions get `403 break_glass_cannot_command`: there
is no `auth.users` row to set `requested_by` to, and a command with no real requester is
worse than no command at all for audit purposes.

**`GET /api/capabilities`** — `{hardware_dispatch_enabled: boolean}`. The mock always
returns `false` (see `mock-bridge/server.mjs`); a real deployment does too until Phase 7
explicitly sets `HARDWARE_DISPATCH_ENABLED=true`. `src/stores/capabilitiesStore.ts` loads
this once at app start; `ControlPage.tsx`'s dispatch banner treats both `false` and
not-yet-loaded (`null`) as "closed" — it never claims dispatch is open before a real
response confirms it.

**`schedules`/`dsm_thresholds` reads and writes go straight from the browser to Supabase**
via `@supabase/supabase-js` + RLS (`src/lib/supabaseConfig.ts`) — no proxy hop, same as
Phase 4's history reads. `src/stores/contextStore.ts` translates to/from the flat
`global.schedule.<device>.<field>` / `global.dsm.<field>` key shape every Automation
component was already built against (Node-RED's former global-context convention), so none
of those components needed to change for this migration — only `contextStore.ts`'s
`load`/`save` internals did.

- `schedules.rule` is `{on, off, days}` (same `HH:MM` / 7-char `'1'/'0'` encoding the old
  context values used), `enabled` maps to the UI's "armed" toggle. One row per device
  (`socket` is always `NULL` for this app — see `supabase/phase6_schedules_config.sql`'s
  partial unique index; nothing in the current UI schedules a socket independently).
- `dsm_thresholds` is the existing Phase 3 singleton (`id = 1`), extended with
  `care_acu_trigger_c` — the ACU's ambient trigger setpoint (`global.trigger.care_acu_on`
  in the old flat context) is a second building-wide scalar with nowhere else to live.
