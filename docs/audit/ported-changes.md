---
title: Ported changes
purpose: Every change made while porting the two handbook chapters to Markdown, with its reason and evidence
audience: [integrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo afa5aaf
evidence: [E-022, E-040, E-051, E-056, E-065, E-076, E-110, E-111, E-112, E-113, E-114, E-115, E-116, E-117, E-118, E-119, E-120, E-121, E-122, E-123]
---

# Ported changes

The two handbook chapters are **authoritative on content**. The rule for porting them (prompt §2, CONTEXT) was: keep
their structure and content, and change content only where the audit proves it wrong. Each row below is one change.

**Kinds of change:**
- **Audit:** the audit proved the original wrong, or incomplete about iBEMS as built.
- **Format:** a manual-wide requirement (R2, R3, R8, R9), or the move from HTML to Markdown.
- **Scope:** a disposition decision.

**Recommendations were left alone.** Where the handbook *recommends* a value and iBEMS as built differs, the
recommendation is unchanged and an "As built in iBEMS" note is added beside it.

## Chapter 1 → `docs/01a-device-roles.md`

| ID | Where | Change | Kind | Evidence |
|---|---|---|---|---|
| PC-01 | "Worked example" | Removed from this chapter and moved to `99-worked-example.md`, where it is re-verified. | Scope: site specifics live in one chapter only. | E-051 |
| PC-02 | "Where this fits the project plan" | Removed. | Scope: disclosure decision, 2026-09-23. | — |
| PC-03 | Front matter, contents list, "Chapter 1 of 5" | Replaced by the manual's front matter and the site's own navigation. The companion-chapter pointers now name the manual's files. | Format | — |
| PC-04 | §3 intro and each catalogue entry | Added a "Supported in iBEMS" status line to each of the 12 types (R8). Four are field-validated. The temperature and humidity sensor is implemented but not validated: its pilot device was never installed, and the room reading comes from the IR hub. Seven are "Planned: no device class yet", and the solar inverter's logger is not on the network. | Format (R8) + Audit | E-110, E-051, E-040, E-125 |
| PC-05 | §3.4 Air-conditioner commander | Added an "As built" note. The hard range is 16–30 °C, set by the IR library, not the 16–26 °C in the diagram, and site policy holds its own floors. The recommended values are unchanged. | Audit | E-112, E-113 |
| PC-06 | §6 Device states, "Short wait" | **Changed** "15 × poll interval, about 30 s with a 60 s poll" to "2.5 × the device's reporting interval (150 with a 60 s poll)". The original contradicted itself (15 × 60 s is not 30 s). On the live system, a 30 s budget on a 60 s poll flagged healthy devices as late twice a minute. An as-built note was added. The long wait (300 s) and offline (600 s) values were confirmed and kept. | Audit | E-110, E-111 |
| PC-07 | §7 Troubleshooting table | Reshaped from three columns to R2's five by adding "Check that tells the causes apart" and "How to confirm it held". The six rows and their causes are unchanged. Added the as-built notes on the automated restart and on ARP rather than ping, and linked outage recovery. | Format (R2) + Audit | E-022, E-056, E-117, E-118, E-119 |
| PC-08 | §5 Installing, "Before any work" | Extended to R9: a licensed electrical practitioner under the Philippine Electrical Code, and isolation, lockout and tagout before any work. Linked the panel procedure in `01-field-devices.md`. | Format (R9) | — |
| PC-09 | §4 Choosing what you need | Added a note that the occupancy, daylight, air-quality and Source rows need types with no iBEMS device class yet. The table itself is unchanged. | Audit | E-110 |
| PC-10 | Every figure | 4 static SVGs and 12 script-rendered function block diagrams were redrawn as Mermaid. The catalogue lived in the page's `DEVICES` data, not its HTML. Every label, block, input, output and feedback path is kept. The icons are not carried. | Format | E-116 |
| PC-11 | Tables and diagram outputs | Units moved into headers and labels, per R3: state thresholds in seconds; °C, %RH, lux, ppm, W, h in the output labels. | Format (R3) | — |

## Chapter 2 → `docs/X2a-control-strategy.md`

| ID | Where | Change | Kind | Evidence |
|---|---|---|---|---|
| PC-20 | Intro and §8 | "A 29-test commissioning manual" and the "0 / 29" counter were stale static text. The page's own test data holds **33**. With PC-29 the manual now has **34**. | Audit | E-114 |
| PC-21 | §1 trigger-by-strategy figure | Redrawn from an SVG matrix as a table, with the same cells. | Format | — |
| PC-22 | §3.3 "The rules, in full" | The column is renamed "Recommended value", with units in the header (R3). **The Floor row lost "Also the floor a person's manual request is refused below".** In iBEMS the floor a person's request is judged against is a separate site-policy value, and a request below it is not refused (PC-28). An "As built" note records what matches (deadband, step, 600 s default, freeze, hold-and-report) and what does not: the hard range is 16–30 °C, and the pilot's rule uses 300 s. | Audit + Format | E-112, E-113, E-120 |
| PC-23 | §3.4 Rule-based and policy-based control | Added an "As built" note. iBEMS enforces the comfort policy on **rule targets**, refused unless a written reason is recorded. A one-off setpoint below policy is sent with a recorded warning, and only the hardware range refuses. The handbook's principle and examples are unchanged. | Audit | E-112, E-120, E-121, E-123 |
| PC-24 | §3.5 Demand-side management | Added an "As built" note: every row of the settings table holds, and the shed unit is a socket. | Audit | E-123 |
| PC-25 | §3.6 Predictive and optimising control | Kept in place with a status line, `Planned, not built`, citing the rolling-statistics anomaly detector. **This differs from `5s-disposition.md`, which said to move it to `94-roadmap.md`.** The section describes a strategy the handbook itself rules out of scope, not an iBEMS feature, and the six-strategy list is the chapter's structure. `94-roadmap.md` indexes it instead. | Format (R8) | E-076 |
| PC-26 | §4 Priority ladder | Redrawn from an SVG ladder as a numbered table, with the same seven levels and wording. | Format | — |
| PC-27 | §5 Control flow | Redrawn as Mermaid, with the same seven stages and both refusal paths. Added an "As built" note. iBEMS writes the record first, carrying the gate's decision (`dry_run` or `dispatching`), so steps 3 and 4 are one. Verification (step 6) happens in the browser, by reconciling against the next readings. | Audit + Format | E-065, E-115, E-122 |
| PC-28 | Test T1.3 | **Expected result changed.** The handbook expects a setpoint below the policy floor to be refused. iBEMS as built refuses only outside the hardware range, and sends a below-policy setpoint with a recorded warning. The test now checks both behaviours. | Audit | E-120 |
| PC-29 | New test T4.11 | Added: saving a comfort rule below the policy floor is refused without a written reason and accepted with one. This tests where iBEMS actually enforces the refusal the handbook asks for. | Audit | E-121 |
| PC-30 | Suite T4 preamble | Added: T4.1–T4.3 apply only where that sensor role is installed, and iBEMS has no device class for them yet. | Audit | E-110 |
| PC-31 | §8 mechanics | The in-browser tick counter (`localStorage`) is not carried. Each suite is now a printable table with ✓ and "By" columns, and the sign-off counts 34. | Format | — |
| PC-32 | §3.2, §3.3, §3.5 and §7 illustrative charts | The script-drawn illustrative charts (the deadband drift, the setpoint walk, the day with and without a demand limit, and the layered savings) are **not redrawn**. Their captions are kept, marked "Illustrative — not measured data" (R4). They were never measurements, and a redrawn curve would look like one. | Format (R4) | — |

## Not changed, and checked

These statements were checked against the audit and hold as written: the six roles, and "never S where C is needed";
"a silent device shows nothing, never a zero"; shed-only and one tier per check [E-123]; that schedules must be
attributed [E-121]; record-before-dispatch [E-065, E-122]; the setpoint-reset tolerance, step and default wait [E-112];
and the long-wait and offline thresholds [E-111].
