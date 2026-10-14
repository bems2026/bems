---
title: ADR-0017 — Logging is the edge's: it keeps every minute, marks what it cannot trust, and the cloud and reports follow
status: Accepted
date: 2026-10-14
evidence: [E-254, E-255, E-256, E-257]
---

# ADR-0017 — Logging is the edge's: it keeps every minute, marks what it cannot trust, and the cloud and reports follow

**Status:** Accepted · **Decided:** 2026-10-14 · **Decided by:** the operator ("ensure logging stays throughout as
long as the 2.4 GHz connection stays"), on the RM-163 plan. **Builds on:** ADR-0011 (the edge archive is the raw
record) and ADR-0015 (the request budget).

## Context

- **The outage.** From 7 to 14 October the device network had no internet: its mobile uplink ran out of data, and
  came back slow, about 11 to 13 KB/s up [E-254, E-255].
- **The edge kept logging.** It archived every minute throughout. The cloud got nothing after 7 Oct 15:29, and
  about 203,000 rows waited [E-256].
- **The CT meters' values froze inside the devices.** All four answered every poll with identical figures for 2.5 to
  6 days. Neither a refresh request nor a Node-RED restart revived them; a power cycle did [E-256, E-257].
- **Two of them sat at 0 W.** Both freeze rules exempt an idle channel, so five days of stuck readings were stored as
  measurements, and nobody was told any meter was frozen [E-256].
- **The upload could not cross the slow link.** A fixed 10-second timeout met 1.3 MB batches, so every upload failed
  [E-255].
- **Reports ran ahead of their data.** When the link answered, ingest built the day reports for 7 to 13 Oct from a
  cloud that ended on 7 Oct, and counted them current [E-256].
- **The clock.** The edge has no battery clock, and a restart without internet would stamp minutes at a stale time.

## Decision

- **The archive is the record, and is never paused.** The cloud is a copy that catches up.
  - Uploads adapt to the link: a timeout halves the batch, and only a quick upload doubles it.
  - While the edge owes more than an hour of rows, it uploads every minute. The health row keeps its own cadence.
- **A value the edge cannot trust is kept and marked, never stored as a measurement.**
  - A circuit meter holding every value, voltage included, for 12 hours is frozen at any power (`STILL_AFTER_MS`),
    beside the two earlier rules.
  - When a freeze is first seen, ingest marks the archive back to its start and re-sends any of those minutes the
    cloud already has.
  - The operator is told once, with the cure: a power cycle of the meter's supply.
  - `npm run archive:flag-frozen` applied the same rule to the outage backlog before it uploaded.
- **Reports follow the edge.**
  - A day, week or month is not built while the edge still owes rows from it.
  - A period built before late rows arrived is built again once they are up (`server/lateData.mjs`).
- **The kiosk says when the cloud is behind** (`CloudBacklogNote`), so a gap in the reports reads as "on its way",
  not "lost".
- **The clock.**
  - A timer saves it every minute, so a restart without internet resumes within a minute of the cut.
  - If ingest starts before the clock has synchronised, it re-times what it archived once the clock steps.
  - A battery RTC module is recommended.

## Alternatives considered

| Option | Why not |
|---|---|
| Keep the meters live without the cloud through the local protocol (REFRESH, session reconnects) | Tried on the frozen meters: neither a REFRESH nor a Node-RED restart (fresh sessions) moved them; only a power cycle did [E-257]. The REFRESH poll stays because it costs nothing. |
| Treat a stuck meter as offline | It is reachable and answering; "offline" would send the operator to the network, not to the meter. A frozen flag says what is true. |
| Drop frozen minutes from the archive | The archive keeps what the devices said. Marked, a stretch can be judged later; deleted, it cannot. |
| Lower the still rule to an hour | Healthy meters held one reading for up to 535 minutes before the outage [E-256]. Twelve hours is above that; tightening waits for 48 hours of fresh data. |
| Regenerate reports by hand after an outage | It is the step that was forgotten here, and a report built early looks current. |
| Upload faster by default | The request budget (ADR-0015) is sized for 5-minute uploads; catch-up applies only when far behind. |

## Consequences

- **A meter freeze costs a site visit**, but no longer costs the record. It is marked from its start, announced
  once, and visible on the page.
- **Reports wait during a backlog.** That can be hours after a long outage, and the kiosk note says why.
- **Catch-up spends more requests for a while.** Up to about 1,400 a day extra while it lasts, then back to about 500.
- **New files on the edge:**
  - `server/data/report-late.json` (the late-upload record);
  - archive backups from the correction;
  - the clock-save timer, which must be installed by hand.
- **Rows the cloud already had when a freeze was found are sent again.** The upload is an upsert, so this is safe.

## What would change this answer

- **The meters gain firmware or a replacement that measures without the vendor cloud.** The still rule then becomes a
  safety net, not the main signal.
- **A smart relay on the meters' supply** would let the edge power-cycle a frozen meter itself.
- **The site gains a reliable uplink and a UPS.** The catch-up and clock paths would then rarely run, but they stay:
  they cost nothing idle.
