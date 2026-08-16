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
