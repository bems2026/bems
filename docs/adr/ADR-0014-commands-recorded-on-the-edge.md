---
title: ADR-0014 — A person's command is recorded on the edge first, and the database is told after
status: Accepted
date: 2026-10-03
evidence: [E-240]
---

# ADR-0014 — A person's command is recorded on the edge first, and the database is told after

**Status:** Accepted · **Decided:** 2026-10-03 · **Decided by:** the operator, on the RM-157 plan ("plan and implement
what's best"). **Amends:** the order in `server/auditedDispatch.mjs` as the proxy uses it. The contract "no record, no
command" is unchanged.

## Context

- **The complaint.** Opened remotely over the mesh, the Control page showed a yellow state on every switch, and
  switching felt much slower than it used to [E-240].
- **The yellow is the "Switching" state.** RM-147 (2026-09-29) drew it as an amber pulsing edge. Before that, a lamp in
  flight looked exactly like a lit one, so the wait had never been visible.
- **The wait is mostly the database.** A person's command waited for up to three requests to Supabase before its relay
  was even asked:
  - the sign-in check, cached for a minute;
  - the audit row, written with status `dispatching`;
  - the outcome, written into that row after dispatch.

  Measured from the edge, one request takes about 0.43 s, and 0.86 s on a cold connection [E-240]. On 2026-10-02 the
  audit insert alone took 1.5–3.2 s, and one row never received its outcome.
- **The same path was a single point of failure.** Log ingestion went over the Free plan's 1 GB on 2026-10-03. A
  restricted project answers 402 to everything, and both the audit insert and the sign-in check read any non-2xx answer
  as a refusal. A restriction would have refused every command in the building, and signed out every remote viewer,
  while the devices on the LAN worked.

## Decision

- **A person's command is recorded on the edge first.** The record is appended to
  `server/data/command-audit-inflight.ndjson` and flushed to the card before the relay is asked. If it cannot be
  written, the command is refused (`createLocalFirstAudit`, `server/auditQueue.mjs`).
- **The outcome is written into that record. Then the proxy answers, and uploads one row carrying the outcome.**
  - The upload uses the caller's own token, as before.
  - If the upload fails for any reason, the record moves to the outage queue (`command-audit-buffer.ndjson`).
    `ingest.mjs` drains that queue every minute with the service key.
  - A record a crash left on the edge goes to the same queue at start-up, as it stood.
- **An answer is a refusal only when it judges this caller or this row** (`isRefusal`).
  - 402, 408, 425, 429 and 5xx are the service unable to answer. They are treated like a connection that never got
    through.
  - The sign-in check falls back to the cached-key signature check. The scheduler buffers its record.
- **The scheduler is otherwise unchanged.** Nobody waits on it, and its records still go to Supabase first.

## Alternatives considered

| Option | Why not |
|---|---|
| Answer after dispatch and write the outcome in the background, keeping the insert first | It saves one request of the three, and leaves the click hostage to the database's speed and to a restriction. |
| Insert and dispatch at the same time | It breaks "no record, no command": the relay could move with no record anywhere. |
| Keep the order and hide the amber pulse | The wait would still be there. The pulse is the honest signal (RM-147); the fix is to make it short. |
| Lengthen the sign-in cache | RM-149 left that to the operator. A longer cache keeps a signed-out user's access alive for longer. |

## Consequences

- **The click waits only for the sign-in check (when its one-minute cache is cold) and the relay.** The amber pulse
  lasts until the next live reading confirms the new state: up to 2 s.
- **Commands reach Supabase about half a second after the answer.** The aircon loop's manual hold (`manual_hold_s`)
  still sees a manual command within its next one-minute read, as before.
- **One request per command instead of two.** No follow-up update, and no `dispatching` row in the database unless a
  command really was interrupted.
- **Who may command is not weakened.** The database rule the insert met was `auth.role() = 'authenticated'`. The proxy
  has already asked Supabase's auth service about the same token before recording. That check is stricter: it also
  notices a sign-out.
- **A crash between a successful upload and clearing the record duplicates that row** when the record is recovered. That
  window is about a millisecond and a duplicate is visible. A lost record of a relay that moved would not be.

## What would change this answer

- **A per-user permission on commanding** (operators and viewers, say) belongs in the proxy before the record, not only
  in a database policy the click no longer waits for.
- **A second writer to the in-flight file** would need the rotation protocol the outage queue uses.
