# Documentation

Ten documents. They fall into three groups, and the fastest way in is to read the group you
actually need rather than the list in order.

## Start here

| Document | Read it when |
|---|---|
| [`bridge-contract.md`](bridge-contract.md) | You are touching anything the bridge emits. It is the single source of truth for field names — the mock and the real Node-RED flow are both held to it. |
| [`storage-contract.md`](storage-contract.md) | You are touching the database. Additive to the bridge contract, never a rename of it. |
| [`pi-session-brief.md`](pi-session-brief.md) | **You are working on the Pi itself.** Fleet state, what you may do without asking, the first-moves checks, and the traps this project has already paid for. Working on the repository and working on the deployment are different jobs. |

## Standing it up somewhere else

| Document | Read it when |
|---|---|
| [`replication.md`](replication.md) | You want iBEMS in another building. Written as a transcript of a run that worked, marking which steps were executed and which were only read from the code, with a table of what it does not cover. |
| [`physical-install.md`](physical-install.md) | You are mounting CT clamps, relays or the IR blaster. **A template with its gaps marked**, not a finished guide — every `〔FILL IN〕` needs a person on site. |
| [`phase-f-runbook.md`](phase-f-runbook.md) | You are deploying the flow to a real Pi for the first time. |
| [`backup-policy.md`](backup-policy.md) | You want to know what is backed up and what a restore will not give you. Documented; the restore has never been performed. |

## Decisions and design

| Document | Read it when |
|---|---|
| [`adr-001-timeseries-store.md`](adr-001-timeseries-store.md) | Someone proposes InfluxDB, a split store, or Google Sheets. Accepted 2026-08-21, amended to answer both follow-ups. |
| [`adr-002-device-recovery-path.md`](adr-002-device-recovery-path.md) | A device stops responding and the only known recovery is a walk to the breaker. Proposed, not accepted. |
| [`floor-plan-design.md`](floor-plan-design.md) | You are working on customisable floor plans. Describes the shape of the work; `ROADMAP.md` stays the source of truth for what is actually built. |

## Also

- [`assets/`](assets/) — the README's illustrations, and the two scripts that regenerate them.
- [`../ROADMAP.md`](../ROADMAP.md) — feature state, in far more detail than any of the above.
  Start at §0.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — the working rules.
