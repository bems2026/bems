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
| `readings_hourly` | `readings` rows aged past the retention window, aggregated in Postgres | Whenever a retention pass finds something older than `INGEST_RETENTION_DAYS` (checked every 6h) |
| `anomalies` | `server/anomalyStats.mjs`, on a flagged tick | Only when a reading is flagged |

## Retention — Phase 9

`readings` grew unbounded until Phase 9: one row per device per 60s tick, forever, with
nothing ever deleting one (130,367 rows after 4.7 days of operation, ~27,700/day for 20
devices). That is a correctness problem, not a tidiness one — when the storage ceiling is
reached it is ingestion's own writes that start failing.

**The policy:** keep `INGEST_RETENTION_DAYS` (default 30) of per-minute resolution; roll
everything older into permanent hourly buckets in `readings_hourly`. Steady state is roughly
830k rows in `readings` and 175k rows/year in `readings_hourly`, both bounded.

`server/retention.mjs` calls `roll_up_and_prune_readings(p_before)`
(`supabase/phase9_readings_hourly.sql`) from the ingest daemon's own loop. Three properties
worth not re-deriving:

- **The rollup and the prune share one transaction**, because a delete that commits without
  its rollup destroys the data permanently.
- **`p_before` is truncated to an hour boundary**, so a partial hour is never rolled up and
  then completed from a fragment on the next pass.
- **The trigger is stateless.** There is no last-run file and no cron: each pass asks the
  database whether anything is older than the window and acts on the answer, so a restart
  can neither double-run nor skip it.

## Reading history — never `select` the raw table

Long-range history is read through the **`readings_buckets` RPC**
(`supabase/phase9_history_buckets.sql`), never a plain `select` on `readings`. Two reasons,
both learned the hard way:

- **PostgREST silently caps every result at `db-max-rows`** (1000 on this project) and gives
  no signal that it did — no error, no flag, just a shorter array. A `select` with
  `order by ts asc` therefore returned the *oldest* 1000 rows: a "7d" chart drew 17 hours of
  data ending four days in the past, with axes and a plausible curve. An explicit
  `limit=20000` still returns 1000, so this cannot be fixed client-side.
- **The RPC averages only online samples** (`filter (where r.online)`), so a disconnected
  meter's frozen last wattage produces a gap rather than a flat, real-looking line — the
  same invariant `shared/buildLatest.mjs` enforces for building totals.

The RPC **raises** rather than truncating when asked for more buckets than it will return.
An implicit limit from an external service is not a contract, and this is the read-path twin
of the write-path lesson in the Phase 6 section below: PostgREST reports both a truncated
read and an RLS-blocked write as ordinary success.

On the frontend, `deviceStore.history` is **tagged with the range it was fetched for** and
read only via `historyFor()`, because one untagged map was shared by writers asking for
24h, 7d and 30d — so a mismatch now renders as a gap instead of one range's points being
charted under another's label.

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

## Phase 10 — reading across the retention boundary

Phase 9 built `readings_hourly` so long-range history would survive the 30-day prune, and
`server/retention.mjs` has been filling it. **Nothing read it.** `readings_buckets` selects
from `readings` alone, so the archive was write-only: invisible while every query still landed
inside the raw window, and "the history is gone" the first time one didn't.

**`readings_archive(p_device_id, p_since, p_until, p_bucket_seconds)`**
(`supabase/phase10_history_archive.sql`) is the read path. It merges both tables and returns
one series, so a caller never has to know where the boundary currently sits. Three properties
worth not re-deriving:

- **The rollup wins the seam.** `roll_up_and_prune_readings` is atomic, so an hour should
  never exist in both tables — but it uses `on conflict do nothing` precisely because raw rows
  for an already-rolled-up hour *could* come back. A naive union would count that hour twice
  and silently double a total.
- **Coarser buckets are weighted by each hour's own `online_sample_count`.** Rolling hourly
  averages up to a day is an average of averages; a flat `avg()` treats an hour with 3 online
  samples as equal to one with 60, which is wrong in exactly the situation this site is in
  most often — partial coverage during an outage.
- **The bucket floor is one hour, and asking for less RAISES.** `readings_hourly` has no
  sub-hour grain, so a smaller bucket would be real inside the raw window and fabricated
  outside it, with nothing in the response to tell them apart.

Buckets are epoch-aligned, so an 86400-second bucket is a UTC day, not a local one. Callers
needing calendar boundaries handle that themselves.

## Phase 11 — retention for what Phase 9 left behind

RM-006 was scoped to `readings`. Two tables kept growing: `building_totals` at one row per
minute (~525k/year, and **read by nothing**), and `anomalies` per detection. Same failure mode
Phase 9 existed to prevent — ingestion's own writes failing at the storage ceiling.

- **`building_totals` is rolled up, not simply pruned.** It holds `energy_kwh_week`,
  `energy_kwh_month` and the per-phase currents — the building-wide figures a report has to
  quote, which exist nowhere else. `building_totals_hourly` is its permanent form.
- **`anomalies` is pruned outright at 365 days**, no rollup: it is derived from readings that
  are themselves retained, and a count-per-period belongs in a report, not a second table.
- **`commands` is deliberately exempt.** It is the audit trail for every attempt to move a
  relay. `test/phase11-totals-retention-schema.test.mjs` asserts nothing deletes from it, so a
  later "finish the job" pass has to argue with a failing test rather than a comment.
- The prune predicates are now indexed (`readings_ts_idx`, `anomalies_ts_idx`). `readings`'
  only index led with `device_id`, which cannot serve a `ts`-only predicate — every retention
  pass had been seq-scanning the whole table.

All three passes run from the ingest daemon's own loop, each guarded so one table's failure
cannot stop the other two.

## Phase 12 — monthly reports

`generate_monthly_report(p_month, p_tz)` writes `monthly_reports` (per device) and
`monthly_building_reports` (building-wide). `server/reports.mjs` decides which months need
one, using the same **stateless trigger** as retention: ask which complete months have no
report row, rather than remember what was done. It waits a grace period after a month ends,
because buffered rows flush late and the rollup runs every six hours, so a month reported at
00:01 on the 1st can be missing its own last hours.

Three things that are easy to get wrong here:

- **Energy is a sum of daily maxima, never an average.** `energy_kwh_today` is a cumulative
  counter that resets at local midnight, not a rate.
- **Days are grouped in the site's timezone** (`Asia/Manila` by default). Grouping in UTC
  would split every device-day across two report-days and undercount the month's last day.
- **Coverage travels with every figure.** Each row carries `online_sample_count` and
  `expected_sample_count`, and nothing may present the energy figure without the ratio. A
  device offline for most of a month still produces a real, small, confident-looking number —
  the same class of error as the truncated chart Phase 9 fixed. With the field devices down
  since 2026-08-20 (RM-001), this is the current state of the data, not a hypothetical.

Reports are **pull, not push**: read in-app and downloadable as CSV. There is no email or
webhook delivery, deliberately — that would put an SMTP credential or an API key on a
deployment whose repository is public, to solve a problem a download button already solves.

## Phase 19/20 — site identity (RM-027)

Until this phase nothing stored here recorded **which building it came from**. `dsm_thresholds`
and `ingestion_health` were singletons — `check (id = 1)`, commented "One building, one Pi" —
and `building_totals` was keyed by `ts` alone. Two deployments could not share a project, and
neither could be told apart in an export.

`sites` is the fix, and `shared/sites/<id>/site.mjs` is its counterpart in code:

| Column | Why |
|---|---|
| `id` | A slug, not a uuid. It is also the directory name under `shared/sites/`, and appears in exports and log lines, so a human has to be able to match them up without a lookup. |
| `display_name` | What the UI shows. |
| `timezone` | IANA zone. Consumed by `generate_monthly_report`'s `p_tz`, which decides what counts as a day. |
| `utc_offset_minutes` | The same fact as a plain number. **Deliberate duplication:** the payload transform is inlined into a Node-RED function node with no imports and no guaranteed full-ICU build, so it cannot resolve a zone name. `test/site-config.test.mjs` measures the zone at two instants six months apart and fails if the two disagree — which is what makes carrying it twice safe rather than merely convenient. A site in a DST-observing zone cannot describe itself honestly this way, and that test is where it finds out. |
| `policy` | The operator's own rules, as jsonb rather than columns: they are the building's rules, not the schema's, and adding one must never require a migration. First entry is `acu_min_setpoint_c`. |

**`acu_min_setpoint_c` is not the same fact as `ACU_MIN_C`** in `shared/commands.mjs`, and
conflating them is the mistake this split exists to prevent. `ACU_MIN_C` is what the live flow's
IR library has codes for — a hardware bound, identical at every site. The policy floor is what
the building permits, and it can only ever narrow that range, never widen it: `validateCommand`
checks the hardware bound first for exactly that reason.

`site_id` is now `not null references sites(id)` on `dsm_thresholds`, `ingestion_health` and
`building_totals`. The two singleton constraints are gone, replaced by `unique (site_id)` — the
same guarantee scoped correctly rather than globally. Dropping the singleton *without* that
replacement would have allowed a second row for the same site, and the app's
`.eq('site_id', …).maybeSingle()` would have begun throwing.

**`building_totals` keeps its `(ts)` primary key.** Widening it to `(site_id, ts)` is the correct
end state for a shared project, but `roll_up_and_prune_building_totals` and
`building_totals_hourly` were built against the current shape (Phase 11), and changing a primary
key underneath working rollup functions does not belong in the same migration that introduces the
column. Deferred to RM-030, which reopens aggregation anyway. Until then the constraint that
actually holds is operational rather than declared: **one Pi writes this table.** That is true
today and is worth knowing rather than assuming.

Applied in order, `phase19` before `phase20` — the foreign keys target the first.

## Backups

`server/backup.mjs` (`npm run backup`) exports the rows that cannot be reconstructed. It is
**not** a `pg_dump`: no schema, no policies, no functions, no `auth.users` — those live in
`supabase/*.sql` under version control. The raw, pruned tables are deliberately excluded;
their permanent form is the hourly rollups, which are exported.

See [`backup-policy.md`](backup-policy.md) for the restore procedure and, importantly, for
what a restore will **not** give you.
