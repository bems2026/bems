---
title: 5S disposition (Phase S1 — Sort)
purpose: One row per doc-like file, saying what happens to it, what content is carried forward and where it lands
audience: [integrator, administrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo 8575a26 · workspace folder as of 2026-09-24
evidence: [E-023, E-028, E-052, E-060, E-064, E-070, E-072, E-076, E-100, E-101, E-102, E-103, E-104, E-105, E-106]
---

# 5S disposition — Sort

**Planning only. Nothing listed here has been moved or edited.** Moves happen in S2, after GATE S approves this table.

## Dispositions

| Disposition | Meaning |
|---|---|
| **Port** | Carry the whole document into Markdown, keeping its structure. Change content only where the audit proves it wrong, and log each change in `ported-changes.md` with its evidence ID. |
| **Mine** | Take only the sections named. Re-verify each fact against the evidence ledger before reuse. Then archive the original. |
| **Archive** | Nothing carried forward. Move the original to the archive with a README line saying where its content lives now. |
| **Keep** | Stays where it is, unchanged except for the edits named. |
| **Leave** | Not documentation, or not this work's to touch. |

Standing decisions (2026-09-23 and 2026-09-24):
- Files **outside the repository stay outside git**. Their archive is the workspace's own `archive/2026-09-legacy/`,
  reached with `mv`, not `git mv`.
- No `project/TRACKER.md`: `ROADMAP.md` is the only tracker.
- The public manual names the site but carries **no funding, milestones, deadlines or budgets**.
- Files inside the repository that code or tests reference **never move** (E-072).

## A. Workspace folder (outside git, untracked)

| File | Disposition | Target | Content kept (sections → chapter) | Not carried (and why) |
|---|---|---|---|---|
| `iBEMS-Handbook-01-Field-Devices.html` | **Port** | `docs/01a-device-roles.md` | Everything, in order: "The typical field device" (incl. "The device record"), "The six device roles", "Device catalogue" (12 function block diagrams, redrawn as Mermaid or kept as SVG), "Choosing what you need", "Installing" (gets an R9 danger callout), "Device states", "Troubleshooting" (reshaped to R2's five columns), "Improving over time". | **"Worked example"** is site-specific and moves to `99-worked-example.md`, re-verified against E-051: 3 meter nodes carry 4 logical meters. **"Where this fits the project plan"** is milestone and checklist content, excluded by the disclosure decision. Occupancy-sensor guidance stays as generic guidance, labelled with its status: iBEMS has no occupancy device class (R8). |
| `iBEMS-Handbook-02-Control-Strategy.html` | **Port** | `docs/X2a-control-strategy.md` | Everything: "Two questions, not one", "The four triggers", "The six control strategies" §3.1–3.5, "Priority — which input wins", "Control flow, trigger to relay" (checked against E-065 and E-078), "The load state machine", and "Test manual" (as a printable table with a sign-off block). | **§3.6 Predictive and optimising control** moves to `94-roadmap.md` as `Planned`, with a one-line pointer left behind (R8, E-076). "What good control looks like" stays, labelled *Illustrative — not measured* (R4). The in-browser tick counter (`localStorage`, E-105) is not carried. **Its "0 / 29" counter disagrees with "Thirty-three tests"**, so the count is established at port time and logged. |
| `iBEMS-Conceptual-Framework.html` | **Mine** → archive | `00-overview.md`, `05-interface.md` | "Hardware and software conceptual framework" (each layer's physical half and program half) → 00 architecture. "What goes in, what happens, what comes out" → 00, with the project-narrative framing removed. "Simplified web application architecture" and "Frontend and backend architecture" → the 00 deployment diagram and 05 architecture. | "Features and pages" counts six pages; there are seven (E-060), so it is rebuilt from the code. |
| `iBEMS-System-Dossier.html` | **Mine** → archive | `00-overview.md`, `99-worked-example.md`, `adr/` | "Five layers, one canonical registry, one authenticated door" (layer responsibilities, the command path, settled decisions) → 00, and the ADR list. "The rules that generated most of the features" → 00 principles. "Twenty logical devices on a three-phase panel where one phase has no meter" → 99 (site) and 04 (the null-not-zero rule). "What the system does today, in plain terms" → 00 feature status, re-verified. "One Pi on site, one public repo, one Supabase project" → 99, **with its host name and every identifier stripped**. | The **first section** (the funded programme) and **"Four months ahead … behind on the paperwork"** (milestones) fall under the disclosure decision. **"Every verified feature, by domain"** restates `ROADMAP.md` as it stood on 27 Aug, so the manual cites IDs instead. **"Track A"** duplicates ROADMAP §0. **"The replication refactor"** is RM-027 to RM-034, mostly built; it is cited by ID in 90 and 94. The broker line is false (E-104). |
| `iBEMS-Full-Stack-Anatomy.html` | **Mine** → archive | `03-edge.md`, `04-data.md`, `05-interface.md`, `X1-security.md`, `X2-control-logic.md` | "The stack, end to end" → 00/03. "Sign-in and session security" (incl. "The 401 story") → X1. "Frontend module layering", "The live data pipeline" and "State" → 05 architecture. "The command path, end to end" → X2 and diagram 3. "The server tier" → 03. "The honesty model" → 04 and 05 design rules. "Configuration, addressing and secrets" → 02 and X1. "Accessibility and the kiosk" and "Build, bundle and tests" → 05. | "The six routes" and "the ten stores" are stale (E-060). **"The data layer and RLS"** describes "thirteen tables through phase18"; there are now 23 through phase47 (E-064), so 04 is rebuilt from the schema and only the RLS reasoning is kept. "What the app still needs" is a ROADMAP restatement. Test counts are stale. |
| `iBEMS-Dashboard-Anatomy.html` | **Mine** → archive | `05-interface.md` | Only what Full-Stack-Anatomy lacks: the longer "Design system" section (tokens, themes, contrast) and "Accessibility and the kiosk" (the wall-display half). | Every other section duplicates Full-Stack-Anatomy, which is mined instead. The same stale counts apply. |
| `iBEMS-Field-Device-Playbook.html` | **Mine** → archive | `01-field-devices.md`, `X2-control-logic.md`, `91-troubleshooting-index.md`, `99-worked-example.md` | "Diagnosing a device that has gone dark" (the diagnostic ladder) → 01 fault matrix and 91. "Commissioning and acceptance tests" (pass is something a person can witness) → 01 acceptance and X3. "Standing rules" (never cut the aircon's power; shed, never restore) → X2, re-verified. "When a device changes state" → 01 and 05, with thresholds re-read from the code. "Which paradigm drives which device" → X2. "Device-by-device management" → 99, because its cards are per-site devices. | "The six control paradigms" and "the two loops" overlap Ch.2's triggers, and Ch.2 is authoritative. |
| `ibems-tracker.html` | **Archive** | `archive/2026-09-legacy/` | — | Milestone data (disclosure). It prefers `localStorage` over its own file (E-105). `ROADMAP.md` is the tracker. **Settled at GATE S (2026-09-24):** it is used now and then for reporting, but has not been updated in weeks. It is archived rather than left in place, so a stale status is not reported by accident. The archive's README says to take status from `ROADMAP.md` and the workbook, and explains the `localStorage` trap. |
| `ibems-architecture-upgrade_2.md` | **Mine** → archive | `00-overview.md`, `90-replication.md`, `adr/`, `03-edge.md` | §2 "Design principles" → 00. §3.2 "Decisions that are settled" → the ADRs. §5 "Target architecture" (two trees, site as a first-class object, per-site policy, the staged spatial layer, what is not built) → 90, re-verified against RM-027 to RM-032. §1 "What the original hand-built flow got wrong" → the 03 field-issue log. | §4 and §6 are funded-plan framing (disclosure). §7 "Migration path" is ROADMAP IDs, so they are cited. **Settled at GATE S (2026-09-24):** it is archived once 00, 90 and the ADRs have absorbed it, and until then it stays in place. |
| `ibems-fullstack-roadmap.md` | **Archive** | `archive/2026-09-legacy/` | Its §5 "Deliberately not doing" is cited as supporting evidence for the ADRs, by line, not copied. | It says itself that it defers to `ROADMAP.md`. |
| `ibems-reports-prompt.md` | **Archive** | `archive/2026-09-legacy/` | — | A completed work instruction. Its outcome is RM-137 to RM-143. |
| `ibems-reports-prompt-review.md` | **Archive** | `archive/2026-09-legacy/` | — | As above. **Holds one mesh address** (E-102). The archive is outside git, and the file is never copied anywhere public. |
| `iBEMS-Documentation-Prompt.md` | **Archive** | `archive/2026-09-legacy/` | — | v1, superseded by v3 (which lives outside the workspace). |
| `Readme project front.txt` | **Mine** → archive *(changed at S2, 2026-09-24)* | `99-worked-example.md` | **"The fleet"** is the one section the repo's `README.md` lacks: a table of 7 outlets, 7 lighting circuits, 4 branch meters, 1 aircon and 1 outdoor sensor. It goes to 99, re-verified against `shared/sites/…/devices.mjs` and E-051. | Everything else was carried into `README.md`. Its credits line names the institution, which the repo's README deliberately does not (disclosure decision). |
| `iBEMS-General-Project-Plan.xlsx`, `iBEMSGeneralProjectPlan.xlsx`, `iBEMS-Functionality-Test-Log.xlsx` | **Leave** | — | The test log may be **read**, never edited, when porting Ch.2's test manual. | Reported to the university. This work never moves or edits them. |
| `~$iBEMSGeneralProjectPlan.xlsx` | **Leave** | — | — | Excel's lock file for an open workbook. It is not a document. |
| `archive/README.md` and its 6 files | **Keep** | — | — | Already archived. S2 adds one line to `archive/README.md` pointing at the new `2026-09-legacy/README.md`. |
| `Assets/*.jpg` (2 images) | **Leave** | — | — | The institution's banner and logo. They are not documentation, and they are **not used in the public manual**. |

## B. Repository (tracked)

| File | Disposition | Target | Edits, and when | Why it stays |
|---|---|---|---|---|
| `README.md` | **Keep** | — | Phase D adds a link to the manual. | The front door |
| `CLAUDE.md` | **Keep** | — | Phase D adds "Documentation conventions". F-005 is re-verified after the broker change. | Read by a test (E-072) |
| `CONTRIBUTING.md` | **Keep** | — | — | Read by a test |
| `ROADMAP.md` | **Keep** | — | RM-145 is updated at each gate. | The source of truth; the manual cites its IDs. |
| `SECURITY.md` | **Keep** | — | F-005 is re-verified after the broker change. | — |
| `.github/PULL_REQUEST_TEMPLATE.md` | **Keep** | — | Phase D adds "Docs updated, or not needed because …". | — |
| `docs/README.md` | **Keep, rewritten** | `docs/README.md` | S2 turns it into the manual's front page: navigation, a reading path per role, and a status table. Its current table of documents becomes the **Reference** section. | It is the directory index, and becomes `index` in the site build. |
| `docs/bridge-contract.md` | **Keep** | Reference | — | Referenced by code and a test. Current (E-052). |
| `docs/storage-contract.md` | **Keep** | Reference | — | Referenced by code. Current (E-070, E-083). |
| `docs/pi-session-brief.md` | **Keep** | Reference | S3: the dated "State as of …" sections go under a *History* heading (F-016). The restart map, which a test reads, is not touched. `test:bridge` runs after the edit. | Read by a test |
| `docs/replication.md` | **Keep** | Reference | — | Referenced by `install.sh`, `preflight` and `site-sql`. `90-replication.md` links to it. |
| `docs/physical-install.md` | **Keep** | Reference | — | Read by a test. Its 12 gaps are closed only by a site visit (Q-13). |
| `docs/phase-f-runbook.md` | **Keep** | Reference, labelled *Historical* | — | Referenced by `proxy.mjs` and `rotate-light-api-token.mjs` |
| `docs/backup-policy.md` | **Keep** | Reference | The X3 phase adds the edge-credential practice (F-002, E-079), with locations only. | Referenced by code and a test |
| `docs/outage-recovery.md` | **Keep** | Reference | — | Referenced by `preflight` |
| `docs/adr-001-timeseries-store.md` | **Keep** | Indexed from `docs/adr/README.md` | — | Linked from ROADMAP and `docs/README.md`. Moving it buys nothing. |
| `docs/adr-002-device-recovery-path.md` | **Keep** | Indexed from `docs/adr/README.md` | — | Referenced by 9 code files |
| `docs/floor-plan-design.md` | **Keep** | Reference, labelled *Design* | — | A design document, whose state is in ROADMAP (RM-035 to RM-037) |
| `docs/assets/README.md`, `docs/assets/src/*.html` | **Keep** | Excluded from the site | — | Sources and scripts for the README images |
| `docs/audit/*.md` | **Keep** | Excluded from the site | Extended, never replaced | This work's evidence |
| `index.html` | **Leave** | — | — | Vite's app entry, not documentation |

Every doc-like file in both locations appears exactly once. That is 25 outside the repo (the archive's README and its 6
files share one row) plus the 2 images, and 23 in it. Checked with `find`, excluding `node_modules`, and `git ls-files`.

## Target tree

```
ibems-dashboard/                         (the repository — public)
  README.md  CLAUDE.md  CONTRIBUTING.md  SECURITY.md  ROADMAP.md     kept; edits as above
  mkdocs.yml                             Phase D
  docs/
    README.md                            manual front page: navigation, reading paths, status table
    00-overview.md                       new (B)
    01-field-devices.md                  new (B)
    01a-device-roles.md                  ported Handbook Ch.1 (S2)
    02-network.md  03-edge.md  04-data.md  05-interface.md                new (B)
    X1-security.md  X2-control-logic.md  X3-operations.md                  new (B)
    X2a-control-strategy.md              ported Handbook Ch.2 (S2)
    90-replication.md  91-troubleshooting-index.md  92-glossary.md
    93-governance-compliance.md  94-roadmap.md  99-worked-example.md      new (C)
    adr/
      README.md                          index: ../adr-001, ../adr-002, then ADR-0003 onward
      ADR-0003-…md …                     new (B), each checked against the audit first
    diagrams/*.mmd                       the six §5.2 figures
    _templates/                          procedure, fault-entry, device-role-card, adr, field-issue, chapter-spine (S4)
    audit/                               this audit; raw/ is gitignored
    bridge-contract.md  storage-contract.md  pi-session-brief.md  replication.md
    physical-install.md  phase-f-runbook.md  backup-policy.md  outage-recovery.md
    adr-001-timeseries-store.md  adr-002-device-recovery-path.md  floor-plan-design.md
                                         Reference: unmoved (E-072)
    assets/                              unchanged; excluded from the site

<workspace>/                             (the folder that holds the repository — never in git)
  archive/
    README.md                            + one line pointing at 2026-09-legacy/
    2026-09-legacy/
      README.md                          one line per file: what it was, where its content lives now
      ibems-tracker.html  ibems-fullstack-roadmap.md  ibems-reports-prompt.md
      ibems-reports-prompt-review.md  iBEMS-Documentation-Prompt.md     moved in S2, 2026-09-24
      iBEMS-Handbook-01-Field-Devices.html  iBEMS-Handbook-02-Control-Strategy.html
                                         after their port (S2)
      iBEMS-Conceptual-Framework.html  iBEMS-System-Dossier.html  iBEMS-Full-Stack-Anatomy.html
      iBEMS-Dashboard-Anatomy.html  iBEMS-Field-Device-Playbook.html
      ibems-architecture-upgrade_2.md  Readme project front.txt
                                         after the chapters that mine them (B, C)
  *.xlsx, Assets/                        untouched
```

The two handbooks are archived **after** they are ported, and the mined documents **after** their chapters are written.
Until then they stay where they are, so every source is still readable while it is being used. So S2 moves only the
**Archive** rows. The **Port** and **Mine** originals follow at the end of the phase that consumes them, which keeps G8's
rule that nothing is lost in between.

## Deviations from the prompt's defaults, and why

| Prompt default | This plan | Reason |
|---|---|---|
| `git mv` the legacy files into the repository's `archive/` | `mv` them into the workspace's own `archive/` | They were never in git. Committing them would publish funding content and a mesh address (decided 2026-09-23). |
| `ibems-tracker.html` → `project/TRACKER.md` | Archive, and no tracker in the repository | A second tracker is how the last three drifted. `ROADMAP.md` is the one. |
| Planning and spec `.md` → `project/plans/` | Mined, then archived outside git | They carry funded-plan content, and the repo stays site-generic. |
| ADRs in `adr/ADR-NNNN-*.md` | New ones there. `adr-001` and `adr-002` stay put and are indexed. | `adr-002` is referenced by 9 code files. Changing code is out of scope. |
| Handbook "Worked example" stays in Ch.1 | Moves to `99-worked-example.md` | The prompt's own rule: site specifics live in one chapter only. |
