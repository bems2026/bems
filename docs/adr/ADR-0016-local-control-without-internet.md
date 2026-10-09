---
title: ADR-0016 — Without internet, a local sign-in can switch the building, under a named account
status: Accepted
date: 2026-10-09
evidence: [E-172, E-240, E-254]
---

# ADR-0016 — Without internet, a local sign-in can switch the building, under a named account

**Status:** Accepted · **Decided:** 2026-10-09 · **Decided by:** the operator ("ensure that even without internet
connection able to log in to the dashboard and execute local control"). **Amends:** the break-glass row of
[X1](../X1-security.md), which made a local sign-in read-only.

## Context

- **What happened (E-254).** On 2026-10-09 the device network lost its internet: its uplink ran out of mobile data.
  The edge dropped off the mesh, and the kiosk was signed out.
- **The sign-in page then blocked anyone at the kiosk.** Every account sign-in answered "Failed to fetch", and the
  local sign-in never appeared. The building could be seen and switched from nowhere, while every device on the LAN
  worked.
- **Two faults in the browser made it so:**
  - `supabase-js` returns a network failure as an `error` value (an `AuthRetryableFetchError`). It does not throw it.
    The page offered the local sign-in only from a `catch`, so it never did.
  - An account session that could not refresh was signed out, whether the service had refused or could not be
    reached.
- **The local sign-in could only look.** It was read-only because a command's audit row needs a real account
  (`commands.requested_by` references `auth.users`), and the local session has none (E-172).
- **The record-keeping already worked offline.** Since ADR-0014 a person's command is recorded on the edge first.
  When the database cannot be reached, the record waits in the outage queue, and ingest uploads it with the service key
  [E-240].

## Decision

- **The edge names the account a local sign-in acts for.** That is `BREAK_GLASS_USER_ID` in `server/.env`, the
  operator's own account id.
  - With it, a local sign-in's commands are validated, gated and dispatched as anyone else's.
  - Each is recorded on the edge under that account, with "local sign-in" in its note. It goes straight to the outage
    queue: there is no account token to insert with. Ingest uploads it when the internet returns.
  - Without it (unset, or not a uuid), a local sign-in stays read-only, as before.
- **Wrong local passwords lock an address out.** Five from one address in 15 minutes lock it out for 10 minutes
  (`LOCAL_LOGIN_LOCKOUT_MS`). The address is the socket's own, never a forwarded header. The journal records each
  outcome (F-027).
- **The page always offers the local sign-in.** It leads with it when the account service cannot be reached.
  - A network failure is recognised in every shape `supabase-js` reports it, and an account sign-in that hangs for
    15 seconds counts as one.
  - A local sign-in is kept across a kiosk reload until it expires.
  - An account session that cannot refresh offline is not thrown away. It is retried each minute, and the kiosk
    returns to it by itself when the internet does.
- **The scheduler keeps its last configuration on the edge.** It is kept in
  `server/data/scheduler-config-cache.json`, and a scheduler that restarts without internet runs from it.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep the local sign-in read-only | It leaves the building switchable from nowhere for as long as the internet is down. That is what happened. |
| A local account per person on the edge | A second user directory to keep in step with the account service. A command would need an id the database knows anyway. |
| Store the account password on the kiosk, and sign in with it automatically | A credential on a screen in a shared office, and it still needs the account service to answer. |
| Let the scheduler and the wall switches carry the building | They do, but nobody on site could act on anything they did not already cover. |

## Consequences

- **The local password now unlocks control, not just a view.** It deserves the same care as an account password:
  stored with the other credentials and rotated when someone who knows it leaves (X1). The lockout makes guessing it
  over the device network slow.
- **Every local command is attributed to one account,** whoever stood at the screen. The note marks it as a local
  sign-in, so the audit trail tells the two apart. Who in person is not recorded; that is the cost of having no
  internet.
- **A local session is held in the kiosk's browser storage** for up to 12 hours. The account session already is.
- **The scheduler file is configuration, not secrets:** schedule rules, thresholds, tiers and aircon rules. Like the
  rest of `server/data/`, it must never be deleted by hand.

## What would change this answer

- **The site gains a second operator who must be told apart offline.** Then give each person a local password mapped
  to their own account id.
- **The device network becomes reachable by people outside the operator's control.** Then put the local sign-in
  behind the kiosk alone: accept it only from the edge itself.
