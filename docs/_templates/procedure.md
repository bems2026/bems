### <Verb> <object> — e.g. "Install the ingest service"

<!-- One procedure = one outcome. Explanation belongs in the chapter's "What it is" section; link to it instead of
     pausing here (R7). Every step is ONE action with ONE expected result (R1). -->

**Precondition.** <What must already be true, e.g. "the edge server boots and is on the device network". Link the
procedure that makes it true.>

**Who.** <Role, e.g. integrator. For panel work: a licensed electrical practitioner — add the danger callout below.>

<!-- Include for any electrical work (R9):
!!! danger "Electrical work"
    Performed or directly supervised by a licensed electrical practitioner under the Philippine Electrical Code. The
    circuit is isolated, locked out, tagged and proven dead before work begins.
-->

| Step | Action | Expected result |
|---|---|---|
| 1 | <one action, with the exact command in a code block below if there is one> | <what you see if it worked> |
| 2 | | |

```bash
# working directory: <where this runs, e.g. the repository root on the edge server>
<command>
```

**Done when.** <An observation, e.g. "`systemctl is-active ibems-ingest` prints `active` and a row lands in `readings`
within 60 s".>

**Rollback.** <How to undo it if it is reversible, step by step; or "Not reversible — <why>, so <what to check first>".>

**If it fails.** <Link the fault-matrix row in this chapter's "How it fails" that covers it.>

**Tested.** <Date, and where the procedure was actually run — or "Untested: described from the code" (DoD).>
