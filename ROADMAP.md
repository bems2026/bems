# iBEMS — Feature State & Roadmap

**Last audited:** 2026-09-23, 06:20 — **RM-142: the Reports page polished — charts drawn at the page's width, one legend, the estimate as a card.** **2026-09-22, 23:10 — FI-039 and FI-041 done; a transition never waits on a frame.** **22:45 — RM-137 to RM-141 pushed, CI green, deployed: the dashboard built on the Pi and `ibems-ingest` restarted 22:53 (read back).** **22:21 — RM-141: pop-ups that fit, measured signed in at 360, 768 and 800×480 — every surface 0 px over.** **21:47 — RM-140: the PDF waits for the circuit charts; the controls stay put; changes crossfade.** **21:40 — RM-139: no circuit told apart by colour alone; the status hues stay, measured.** **21:25 — RM-138: a report not made yet is said, not silent; the week of
14 Sept was not late** (settles 08:00 Wed 23 Sept). **21:13 — RM-137: a statement timeout is asked
again by itself** (the operator's Reports brief; §2's first section). **Earlier, 17:10 — the end-of-day list, by owner, is §0's first entry.** RM-136 was run
at 16:31 and read back: both notices are gone and checked in a browser. **Earlier, 17:00 — phase47 (FI-027)
applied at 16:19 and read back** — L.O Yellow's 22 Sept
records 527 minutes, not 895; the restatement also touched 8 August rows by rollup drift (energy and peak
unchanged). **Earlier, 16:40 — RM-136: a false "frozen" flag at every lights-on, the morning's hold
still in Node-RED's own copies, and a notice worded against the meter.** Built; one operator command left.
**Earlier, 16:00 — FI-027: a held minute is not a recorded minute.** `phase47`, built and
rehearsed (applied 16:19).
**Earlier, 15:20 — RM-135: the page accused L.O Yellow of losing 47% of its energy; it
was the morning's held watts in the integrator, and the page's freeze detection could not see the hold.**
Fixed in `detectFrozenRuns` and verified against the live bridge.
**Earlier, 15:00 — L.O Yellow was not frozen. The meters were never re-read:
RM-134.** Applied ~14:20 and read back at 14:21: 0 W / 0 A / `monitor`, nothing flagged frozen. The 396
held rows were scrubbed at ~14:50 and read back, and preflight reads `Ready` with every node polled. The lights went off while the Pi was rebooting, the meter's push of "0 W" reached nobody, and
unlike every outlet, switch and the IR hub, the three meters had no GET poll. The tuya node reads nothing
on connect, so a Node-RED restart could not help. RM-134 adds a registry-driven meter poll (dry-run clean
against the live flow, 301 → 303 nodes). It grounds the demux's idle rule in 0 A rather than the device's
`monitor` label, which the poll would start delivering every minute, and makes `npm run preflight` fail
when any tuya node is unpolled (`flow_polls`). **The panel power cycle in §0 is withdrawn** pending the
poll's result. RM-133's "full dp read" is corrected, and RM-077's L.O Red freezes are re-read.
**Earlier, 12:00 — RM-133:** a register clock the shared voltage cannot reset, deployed 11:27, flagging
the channel at 11:57, the flag stored with the row (FI-027's storage half). Earlier: the walkthrough: what is left, by who can do it (§0); the
preflight checks what lives only on the host and no longer fails on the optional cloud: RM-132; a
restore has been performed: RM-006d closed; the kiosk survived a cold boot signed in: RM-007 closed.**
`npm run preflight` now says `Ready` on this deployment with two warnings (the lapsed vendor trial,
19 of 20 devices), and three new checks cover what a rebuild loses with no diff — the persistent
journal, the three recovery timers, a static address on every tuya node. `npm run restore:rehearse`
took the day's export (19 tables, 12,960 rows) into a throwaway PostgreSQL 16, every count matched
the manifest and every row read back equal to what was exported; it found that the migrations seed
two rows and that `space_nodes` needs parents-first, both now in `docs/backup-policy.md`.

**Earlier the same morning — What an outage does to the field network, and what now
recovers it: RM-131; the director's aircon estimate charted: RM-130.** The operator's outage test of
the 21st was read back from the persistent journal: the Pi booted before the access point and joined
the office SSID; the devices flapped for an hour while the AP settled; then every switch, outlet and
the IR hub went silent to `find()` — while still associated, answering ARP and accepting TCP on 6668.
Discovery is the single point of failure. Deployed: a LAN map learned from the devices' own
announcements (`ibems-lan-map.timer`), `set-device-ip:pi --from-lan-map` and `--reservations`, a
recovery watchdog that restarts Node-RED only for reachable-but-offline devices
(`ibems-fleet-recover.timer`), the Wi-Fi watchdog at 90 s / 5 min, and `docs/outage-recovery.md`.
**Two operator actions remain:** make the devices announce once (power-cycle, or renew IoT Core) so
the map fills and the addresses can be set; then reserve them on the AP.

**Earlier the same day — Onboarding without IoT Core, and the aircon's own IR protocol: RM-126 to
RM-129.** The operator decided on 2026-09-17 that Tuya IoT Core is only for
extracting ids and local keys, not a dependency, and it had just lapsed — taking Add Device, rebind and
the aircon's mode/fan/swing with it. **Deployed by the operator 2026-09-22 (Aircon tab 06:49, build and
restart; the Pi then rebooted at 07:44) and read back at 07:55** — see §0. **Keys imported 08:51**: 17
devices, every key identical to its flow node's.
- **RM-126:** device facts come from three sources: keys imported from a key tool's export, what the
  device network announces (a passive listener in the proxy), and the vendor cloud only while it
  answers. `/api/tuya/devices` no longer fails with the cloud. Orphans for Rebind now need network
  silence AND a complete list without the device.
- **RM-127:** Add Device shows which sources answered, where each device's key comes from, and an
  **Import keys** panel. A device heard with no key says "Needs its key".
- **RM-128:** the sixteen captured IR codes decode as **TCL112AC** — cool / fan auto / swing off at
  16..30 °C, every checksum verified. The flow now builds any other state from one captured frame,
  so mode, fan and swing no longer need the cloud. Recommended over learning codes one at a time.
- **RM-129:** Home Assistant assessed and not adopted, with the reasons; the cloud-connection policy.

**Earlier on 2026-09-22 — The shared dual-channel meter trades its own channels, and the
reports gain a Daily period: RM-122 to RM-125, and RM-130.** The operator reported L.O Yellow, a lighting branch,
logging the outlets' daytime load since Saturday 19 September. Measured read-only against the stored
rows: the device reports its two CT clamps under each other's dp ranges for hours at a time — its own
`device_state<n>` goes to `monitor` on the channel reading 0 A, its own registers freeze on that side and
jump by thousands of kWh at each flip — while one tuya session feeds two parsers keyed on dp number, so
nothing here could have traded them. RM-019's session collapse removed a possible cause, not this one.
- **RM-122:** a demux node in front of the parsers, deciding from two facts the operator confirmed (the
  lighting branch cannot exceed 150 W; the outlet branch is never at 0 A) and renumbering the dps before
  anything reads them. Every stored row now says how its clamp was attributed. **Applied 2026-09-22
  04:26 and read back** — the demux node is live, the bridge tab redeployed, `channel_map` on both meters.
- **RM-123:** `npm run scrub:meters` corrects the stored rows with the same classifier and re-integrates
  the affected days' energy. **Applied 2026-09-22 04:33:** 5,748 rows rewritten (1,800 traded), verified by
  invariants — every affected row stamped, each day's high-water mark exactly the restated figure, and a
  re-run finds nothing to do. The bridge's `enacc_*` bases were corrected by hand at 05:14 (C.O week
  9.503 / month 112.055; L.O 0.758 / 13.958) and read back live.
- **RM-124:** applied by the operator at ~05:05; the daemon generated every settled day (08-16 → 09-21)
  and the page was read back at 800×480 in both themes.
- **RM-125:** done — `/etc/systemd/journald.conf.d/50-ibems-persistent.conf`, 200 MB bounded.
- **RM-124:** a Daily period beside Weekly and Monthly — `phase46`, the daemon, and the page's twenty-four
  hourly bars, whose sum is the day's headline by construction.
- **RM-125:** the journal was volatile and the Pi was rebooted twice on the 21st; nothing from the 19th
  survived.
- **RM-130 (FI-035 answered):** C.O Yellow also feeds the director's office aircon, in another room, at
  about two thirds of the branch — unmetered. Declared as an apportionment in the site file and reported
  as the estimate it is, on the Circuits tab and in the PDF; the measured charts are untouched.

**Before that, 2026-09-17 (evening) — The aircon's IR blaster was re-paired, and the system now knows
what it is: RM-114 to RM-121.** The operator re-paired it in Smart Life as a Lasco "Smart IR" hub and
pasted its new id and key into the `NBRIC IR Blaster` node by hand. Measured read-only the same day:
the node's key matches the vendor cloud's, the hub announces **v3.3** on the LAN (the flow's
declaration, now verified), and it carries only two sensors (dp 101 `temp_current`, dp 102
`humidity_value`) and an IR send/learn pair. The aircon's state (`switch_power`, `mode`,
`temperature`, `fan`, `swing`) lives on **"Air", a virtual remote in the vendor cloud** with no
network presence.
- **RM-114:** `buildLatest` would have shown the uninstalled Outside Temp ONLINE, carrying the indoor
  hub's humidity, the moment the hub reported. Fixed before the hub is woken.
- **RM-115:** every aircon command is one absolute state. It goes local-first, with the cloud for
  states the local IR library cannot express. Until the on-site test verifies the library, ON states
  go cloud-first.
- **RM-116:** `npm run aircon:pi` refactors the live Aircon tab, planned against the real flow and
  clean. **Not applied.**
- **RM-117:** `phase45` records the state sent. Rehearsed. **Not applied.**
- **RM-118:** Add Device could never have enrolled anything, because the cloud reports no protocol
  version. It now reads the version from the device's own broadcast, recognises IR hubs and virtual
  remotes, and gains **Rebind**.
- **RM-119:** the Control page's aircon panel.
- **RM-120:** the on-site acceptance test.
- **RM-121: the Tuya IoT Core subscription expired this afternoon.** Every cloud business call now
  answers `28841002`. Local control is unaffected; the cloud fallback, mode/fan/swing, Add Device and
  presence are not. **Renewing it is the first operator action.** See §0.

**Earlier the same day:** **The Reports page is rebuilt around the operator's report of 2026-09-16,
RM-090 to RM-099.** The week of 7 September gave L.O Yellow, a lighting circuit, 81.41 kWh: stored
readings kept the 2026-09-08 counter jump RM-052 fixed in the bridge, and a report sums each day's
high-water mark.
- **RM-090:** the page refuses any stored figure its circuit could not have drawn.
- **RM-091:** `phase42` bounds each hour's counter rise by the circuit's own power, in the generators and
  per day. **Applied by the operator on 2026-09-17 and read back**: the week of 7 September's L.O Yellow
  row is 4.617 kWh with 76.789 removed, the only row restated anywhere, and the building row is untouched.
  **RM-091a**'s `phase43` (the readings policies' role check, once per statement) was applied the same day:
  a signed-in month read went from 5.2 s to 3.3 s. **RM-091b** splits the page's daily-energy read into
  groups of four devices, each about a third of that statement.
- **RM-092/093:** branch circuits carry Lighting / Aircon / Others, and a report narrows to one.
- **RM-094/095:** each circuit's energy per day and power through the week or month, charted.
- **RM-096/097:** four tabs (Overview, Circuits, Usage patterns, Compare) with no statistician's words.
- **RM-098:** CSVs of devices by day and of every reading.
- **RM-099:** a Simple or Detailed PDF following the scope.

**RM-100 to RM-108, the same day, from a UI/UX audit of the page against the kiosk it actually has —
800×480, not the 1024×600 this file had been measuring against.** The control bar is one line at 800px
(58px, was ~117): the tabs are a strip of their own, the circuit select and the Circuits-tab chips are
one **Circuit** button with the uses as pills and the branches as a list (RM-102), and the period list is
a calendar of stored reports with the two jumps under it (RM-103). The hero KPI is the one lifted surface
(RM-104), a month's table keeps its column headers (RM-107), Export is the page's one primary action
(RM-108), and the building-level breakdown colours a circuit by its place in the panel rather than its
rank, so a refused meter no longer repaints its neighbours between weeks (RM-106). Measured in Firefox at
800×480, 375 and 800×1100 in both themes; every static guard and 1,959 + 1,107 tests green. What the
audit found already shipped and guarded — the 8-point grid, hairline tables, value-first tooltips,
shape-matched skeletons, 44px targets — it left alone; what the operator's brief asked for that this file
had already decided against (Tailwind, toasts, arbitrary date ranges, a gradient hero) was put to the
operator and kept decided.

**FI-028, the same day:** the dark theme's chart series are re-stepped into the dataviz lightness band.
Green, red and Analytics' sky blue keep their hue a step darker. Purple also moves toward magenta,
because dropping it to blue's lightness would have made the two indistinguishable for a deuteranope.
The light theme and the print palette already have that blue/purple collapse, recorded as **FI-029**.

**Later the same day, the Reports page was read signed in, and it holds.** The corrected L.O Yellow week,
the Circuits tab, the Lighting scope, the plain words, both new CSVs and both PDFs were checked against
the live project, with no statement timeouts, at 800×480 and 375 px in both themes. The read-back found
four defects, **RM-109 to RM-112**:
- at phone width the right third of every report chart was cut off;
- "Energy by use" counted three uses as "3 circuits";
- a week showed "10,082 of 10,080 minutes", because every ingest restart writes a second row into one
  minute;
- four charts said "observed" where the page says "recorded".

**FI-029** gives the light theme and the print palette a purple darker than their blue. All four fixes and
FI-029 are live and were read back on the kiosk's build. **RM-073 is done: phase44 was applied by the
operator and read back the same day.** Every stored report now counts distinct minutes that hold a
reading. The week of 2026-08-17 went from "Complete · 98%" to 16%, beside a note saying what the report
used to say.

**RM-113, the same afternoon: every PDF export on the kiosk failed** with "File 'Roboto-Medium.ttf' not
found in virtual file system". pdfmake's font file registered itself only if pdfmake had already
evaluated, and a rebuild changed which one evaluated first. The export now registers the fonts itself.

**Also 2026-09-17 — RM-089 closed.** In the 36.9 hours since the 2026-09-15 restart, ingest has logged
one "Supabase unreachable" and one failed device sync, 11 seconds apart, both aborted by the request's
own timeout rather than failing to connect, and no "fetch failed" at all. The week before logged 26–100 a
day, which would have given 40 to 150 in the same time.

**Also 2026-09-17 — EX-172:** the Windows workstation's intermittent `proxy.test.mjs` ECONNRESET was
Node 24.15.0 itself crashing the spawned proxy (libuv#5107). `server/nodeRuntime.test.mjs` now fails
the server suite on an affected runtime, so the workstation needs Node 24.16.0 or later.

**2026-09-16 — RM-090: the weekly report for 7 September said L.O Yellow, a lighting
circuit, used 81.41 kWh, and the page now refuses that figure.** The stored readings still carry the
2026-09-08 counter jump RM-052 fixed in the bridge, and a report sums each day's high-water mark. The
page checks every stored figure against the most its circuit could draw in the period, prints an
impossible one as "Not possible" and leaves it out of every total, share, chart, CSV and PDF, and says
"Corrected" beside a figure phase42 has repaired.

**Earlier, 2026-09-15 — RM-080: CO6 and CO7 were drawn in each other's places.** The
three code copies of the office layout are swapped and pinned; the two live `device_config` rows
still hold the old positions and need the statement in RM-080 run by the operator, so until then
the Control page and Settings → Floor plan disagree with the Overview. **RM-081 landed the same day:
the Reports page loads as six independent sections**, so a failed tariff read no longer hides five
charts that loaded, a hung query becomes a timeout with a Retry instead of an empty page, and a
period stored as 0 kWh from ten rows that held no reading says "not observed". RM-082 to RM-084
(layout, exports, charts) are planned in the same §2 section; **RM-082a has since landed** — a
headline row led by energy, tables built for reading, and the Reports CSS on a guarded 8-point grid —
and **RM-082b**, which puts every control in one sticky bar around a period stepper and draws loading
as the shape of what is coming. **RM-083a** builds the export's parts: sections a reader can choose (coverage and
the closing refusals locked on), a PDF assembled from them that now carries the key figures and never
prints a zero nobody measured, a simple one-row-per-day CSV, and filenames that do not depend on the
reader's locale. The drawer that offers them is RM-083b. **Read back signed in on live data the same
day:** the page, both themes' contrast and the kiosk and phone widths hold; the duration curve's query
times out for signed-in readers, which RM-081b contains to one chart and phase40 (RM-086) fixes —
**applied and read back: 448 ms where it was 3.5 s, and all five charts drawing signed in.**
**RM-084** closes the planned set: every report chart reads out its values under the pointer and from
the keyboard at one tab stop, with the PDF's drawings unchanged, and the Summary tab gains weekday
against weekend energy, the load factor and the overnight base load — each an em dash with its reason
when the period's data cannot carry it. **RM-082c** adds a Circuit select that narrows the device table,
the Circuits tab and the per-device CSV to one branch, read from the circuit tree; a share stays a share
of the whole building, and the page says the headline figures, findings and charts cannot be narrowed.
**RM-087** came out of checking the first real retention pass before it ran: the hourly totals rollup
never filled phase32's integrated columns, so from 2026-10-08 every pruned hour would lose the only
independent cross-check on the building total. `phase41_totals_rollup_integrated.sql` fixes it and is
rehearsed, and **applied and read back on 2026-09-16: 1.6 / 2.6 / 3.6 where the old function left
NULLs.** Nothing has been lost, and the
rows the first passes prune were exported and copied off the Pi beforehand. **RM-088** corrects the
branch wiring from the operator's own account: light switches L1–L4 are on L.O Red and L5–L7 on L.O
Yellow — which the site file had called the outdoor aircon unit — and the aircon is CARE ACU's only
load. **RM-089** gives every daemon's connections time for a lost packet to be retried, which the
Supabase dropouts ingest has logged all week point to. **FI-011** closes the last unblocked item in
the build order: a generated monthly report is now pushed through the alert channel EX-103 already
built, in wording that keeps the page's rules — a partial month's total is a floor, a stored zero
from nothing observed is not a measurement, and the stored share is never called readings coverage.
**FI-009 is closed the same day**, not done: of the three selectors it named, one no longer exists and
two read every device by design, so no unblocked coding item is left anywhere in this file.

**Previously audited:** 2026-09-14 — **RM-076 to RM-078, Analytics data quality**, from three operator
reports: L.O Red "reporting less than it measured", L.O Red reading differently on Overview and
Analytics, and blank strips in the branch and outlet charts. **The first was a false alarm** — the
meter froze, repeating one reading for up to fifteen hours while its own registers stood still, and the
legacy integrator counted the held watts; the bridge had published exactly what the meter said. The
second was two copies of one derivation. The third was real Node-RED restarts and one-sample health
flickers drawn as unexplained blanks, on top of charts that paired devices by array position rather
than by time. See the 2026-09-14 entry in §0. **Stage 2, RM-079 (the bridge side), is deployed to the live flow and
read back (2026-09-15)** — the bridge now stamps each sample's tick and flags a reading that has stopped
moving — and the three daemons that load `shared/buildLatest.mjs` were restarted onto it and read
back.

**Previously audited:** 2026-09-13 — **RM-072**, the Reports overhaul, in progress. The primitives have
landed: charts are a scene with two serializers rather than an SVG string, because putting a string
into the DOM would mean this codebase's first `dangerouslySetInnerHTML` and the first thing through
it would be operator-editable device names. The pdfmake spike is the part worth reading — three
findings that each cost an afternoon and none of which are in anybody's documentation. The print
palette's new on-white assertion rejected `--accent` on its first run, and two of that test's own
first assertions turned out to be measuring the wrong thing and passing. **§5 Q9 is answered by
measurement and struck**, which also unblocks **RM-042**. `phase37_report_series.sql` is applied, and **reading it back against the live project found four defects, every one of which made the building look better observed than it was** — see RM-072f and RM-072g. The one worth leading with is not in the new code at all: **the Reports page has been overstating its own coverage.** August 2026 reads 48%, and only **26.9%** of its expected minutes carry a real reading — 9,415 of the 21,421 "observed" samples are rows the meters wrote while observing nothing. Correcting the stored figure is **RM-073**, and it is a decision about restating published history rather than a task. Applying the fixes then turned up **RM-072h**: `create or replace` cannot change a function's OUT parameters, and `rehearse.sh` had only ever proved each migration against an EMPTY database — the one case a hand-applied migration never meets twice. **phase37 is applied and every check is green (RM-072i)**, and all five charts are drawing from it (RM-072j, RM-072k) — where looking at real data, rather than asserting on fixtures, rewrote a decision in nearly every one of them. The breakdown chart also turned up a fact about the building: **49.3 of the 51.1 kWh on the convenience-outlet branch is not attributable to any of the seven outlets beneath it**, which is RM-020 and RM-021 seen from the energy side. **phase38 and phase39 are both applied and
read back (2026-09-12).** The one to read is **RM-074**, which came out of the reporting work by
accident and is the most consequential thing in this audit: every table in the schema had been
granting `authenticated` the full privilege set since phase4 — not by anyone's decision, but
because that is what a Supabase project's default privileges do and a `grant` is additive. RLS
covers most of it; **it does not filter `TRUNCATE`**, and the table exposed was `commands`, the
audit trail deliberately exempt from every retention pass. It is now an equality invariant checked
for every RLS table by `rehearse.sh`, so a table added next year is covered without anyone
remembering. The measurement that matters: all 23 tables now refuse `anon` on a privilege error
where they previously returned `200 []`. **CI had been red for six pushes and is green again** (RM-072q): lint
failed first, so for that whole stretch CI ran neither the build nor any test suite.
**RM-075 hardens the backup** — 19 tables where there were 10, page keys covering whole primary
keys, restore order checked against the migrations — and along the way corrected RM-042's
evidence (its outlet rows disagree, because the legacy table predates RM-047b's correction) and
four stale claims that the space tree was empty. **The first real retention passes ran on 2026-09-15
18:39 UTC and 2026-09-16 00:39 UTC**, and every pruned row was checked against a raw export taken
beforehand: 180 device-hours, no mismatch, nothing left behind. See §0.
**EX-170 corrects the deploy note.** `CLAUDE.md` and the Pi brief named two services to restart
after a `server/` or `shared/` change, and there are three: `ibems-ingest` was left out. Measured
the same day, read-only, the Pi's ingest daemon was still running `shared/sites/` modules replaced
four days earlier. The restart map is now derived from the unit files and their imports, and
checked (`test/service-restart-map.test.mjs`). **Ingest was restarted at 12:40 and read back** —
a clean start, nothing due, no minute of readings lost — and no daemon now holds a module older
than its file.

**Previously audited:** 2026-09-10 — **RM-070 and RM-071**. RM-071 is a UI/UX overhaul of the
Automation page: rules now read as IF/THEN blocks, and auditing for it turned up a one-character CSS
typo that had been silently disabling the 44px touch-target rule **app-wide**, including on the
dialog that gates arming unattended load shedding. See the RM-071 section below; the measurement is
the part worth reading.

**Previously audited:** 2026-09-09 — **RM-059 to RM-069**, two parallel lines of work on the same
pages, merged. **RM-062 is the one to read**: the Automation page claimed hardware dispatch was
closed when it has been open, on the page that arms unattended load shedding. It was found twice
independently, from different directions — once by measuring the live Pi
(`HARDWARE_DISPATCH_ENABLED=true`, `dispatch=OPEN` at boot) and once by reading §0's own
instruction to arm shedding *from that page*. RM-062's three-state sentence is the one that
shipped, because "not confirmed yet" is a different fact from "closed" and the alternative
collapsed them.

RM-059 to RM-065 were a UI/UX pass over Devices and Automation. RM-061 came straight from the
operator looking at what RM-059 shipped: Details and Edit beside each other were the wrong shape,
and the fix was not to restyle them but to notice that one device had three doors — one
**Manage** button, one panel, three tabs. RM-060 started from a fault reported in words rather
than a ticket: on a schedule row you cannot tell which clock turns the device on and which turns
it off, worst on the kiosk where the column captions are `display: none` below 720px. RM-059
moved the Devices panels into a floating layer and turned up three defects on the way — an
enabled button wearing disabled styling at 2.3-2.6:1, a lapsed stylesheet invariant, and row
actions with no touch-target minimum on a touchscreen kiosk. RM-063 cut what the load-shed panel
says; RM-065 gave a schedule a Clear control and removed the ambient trigger.

RM-066 to RM-069 rebuilt what those pages could EXPRESS. A device could hold exactly one
schedule, enforced in the database, so writing a second window silently replaced the first; and
the page could not name a socket at all, so an outlet's two relays could never be scheduled
apart. Schedules are a stackable per-socket list now (RM-066), load-shed tiers follow (RM-067),
the aircon policy stops bounding the commanded setpoint and becomes the coldest permitted ROOM
temperature (RM-068), and RM-069 is the closed-loop controller that redefinition was needed for
— the thing RM-065 deferred when it removed the slider, noting that wiring it "stays a decision,
not a task". It is setpoint-only: it never powers a unit on or off, which is that concern
answered rather than overridden.

**Audited at commit:** `5d9ebbf` merged with `4713ef7`

**2026-09-01, and it changes what §0 says.** The headline claim below — that there is no
unblocked coding task left — was **wrong**, and it was wrong because the fault report that
contradicted it had been read as a network problem. A physical test reported an outlet toggle
failing with something like "bridge not reachable", outlet rows flapping between stale and live
while Node-RED showed the same devices connected throughout, and the Control page appearing to
block ON/OFF. All three were reproduced against the live Pi and were **one constant**:
`STALE_AFTER_MS` was 30 s for every device, while an outlet is polled once a minute by design.
See **EX-133** through **EX-140**. Two of those (EX-139, EX-140) are built and dry-run against
the live flow but **not applied** — they need a flow write. Two new backlog items were recorded
rather than fixed: **FI-019** (the bridge listens on every interface) and **FI-020** (a switch's
freshness is unmeasurable).
The lesson worth keeping is not about staleness. It is that "every unticked item is blocked on
something outside the code" was believed for a fortnight while a working outlet was being
reported as unreachable — because the misreport named the wrong subsystem and nobody re-measured.
**Landed since that audit, not re-audited:** a long session on 2026-08-31 — RM-006c's tier
editor, FI-018 (baseline report), FI-008 (contrast guard), FI-006 (totals expiry), FI-007 (badge
contrast), FI-002 (`npm run preflight`), RM-033's `npm run site:sql`, and the installer rehearsal
including its apply path. Each was verified on its own terms: suites on the workstation and the
Pi, CI, neutered guards, and a live read-back where one was possible. **The file below has not
been re-read against the tree since `b31caa2`**, so entries older than that date carry the
authority of that audit and no more. Saying which is which is cheaper than an audit that did not
happen.

> **PICKING THIS UP FRESH? Read §0 first, then this paragraph.** Every unticked item below is
> blocked on something outside the code: a person at the office, hardware that is not on the
> network, an operator decision, or elapsed time. There is no unblocked coding task left in
> Track B, and **since 2026-09-16 none anywhere**: FI-011 shipped, and FI-009 was closed after
> reading the code it names rather than reasoning about it again. Do not go looking for work in the
> code; the useful work now is on the building.
**Audit method:** static read of the working tree, plus **on-site inspection at CARE office** —
live SSH, a Wi-Fi survey from the Pi's own radio, and packet-level capture of the devices' Tuya
discovery broadcasts. The 2026-08-25 evening re-audit ran *on the Pi*: a passive listen on the
discovery ports, the cloud's per-device MAC joined against the Pi's ARP table, and the live flow
read back through the admin API.
The 2026-08-26 evening pass ran from a **remote** session, with every network check executed on
the Pi over the tailnet — ARP and a UDP broadcast mean nothing anywhere else. It re-verified
RM-026 twice and corrected three §0 claims that had gone stale, two of them within the same
day: see RM-026, RM-020 and EX-101. It also closed the gap in EX-130 — an internet outage had
been removing control of a device fleet that is entirely local, for scheduled and auto-shed commands
as well as manual ones — and settled RM-026's integration shape.
The Phase 10-13 entries below were added from a workstation with no database access — see
§5 Q8 for exactly what that leaves unverified.
The 2026-08-26 late pass was a **planning** pass, not a measurement one: no live check was
re-run, so nothing above its date should be re-dated on its authority. It added §2's **Track B**
(RM-027 – RM-034), the replication refactor, after an audit of what the codebase assumes about
being one building in one room. It also renumbered four entries — the Auth & security block
held a second EX-100 – EX-103, colliding with the alerts/command/chart/notification entries of
the same numbers, and is now EX-108 – EX-111. Every cross-reference in this file pointed at the
other four and none needed changing.

> This repository is **public**. No tokens, keys, passwords, hostnames, IP addresses, or
> Supabase project identifiers may appear in this file. Where a deployment detail matters,
> describe it generically ("the Pi", "the tailnet address").

---

## 0. Triage — what to do next


### 2026-09-22, 17:00 — end of day: the list, by who can do it (supersedes the 10:55 walkthrough)

**Today, done and read back.**
- The yellow meter was never frozen. RM-134: the meters are polled, the demux's idle rule is grounded in
  0 A, and the preflight checks every node is polled. The 396 held rows were scrubbed.
- RM-135 and RM-136: the page no longer accuses L.O Yellow. The morning's hold is gone from Node-RED's ring
  and integrators, the lights-on false flag is fixed at the bridge and on the page, and the notice now says
  the *reading* was held.
- FI-027 is applied as phase47.

At 16:36, after the 16:31 restart, 19/20 were online, nothing was frozen, and L.O Yellow read 0 W with its
register at 0.2947 against the integrator's 0.2915. The Overview and Analytics show no notice, checked in a
browser against the live bridge. `npm run preflight` reads `Ready` with every node polled.

**Operator, at the office or the AP — in order of value:**
1. **RM-026: put the Solarman logger on the device SSID.** Solar integration is Milestone 3, contractual,
   and due January 2027, and nothing can start without the logger on the network. The live
   `solarman-device` node still points at the logger's own hotspot address and times out every few minutes.
2. **A UPS on the AP and the Pi** (RM-131). This is what stops an outage from knocking the fleet off the
   network.
3. **The dual meter:** check Smart Life for a firmware update (free), then decide on two single-channel CT
   meters. The demux corrects the trade; only hardware ends it (RM-122).
4. **RM-120**, the aircon's on-site acceptance with the TCL112 generator.
5. **RM-016**, the outside temperature sensor: install it, or remove it from the registry.
6. **RM-033**, the twelve `〔FILL IN〕` gaps in `docs/physical-install.md`: a camera visit, plus the AP's
   make and model.

**Decisions:**
- **RM-006c**: which loads may shed.
- **RM-121**: renew IoT Core or not (optional).
- **RM-006d**: the scratch-project half of the restore check.
- **§5 Q11**: are occupancy sensors being bought? The funded plan promises motion-sensor lighting.
- **Milestone 5**: plan the usability study.
- **§5 Q12**: reconcile it with FI-018's `npm run baseline:report`, and produce Milestone 1's citable
  baseline summary.

**Waiting on time (read back tomorrow):**
- The 09-22 daily report, generated after ~01:00 under phase47, should record 527 minutes for L.O Yellow.
- `npm run check:meters -- --hours=24` should list nothing after 07:43.
- A day of polled `device_state` should show `monitor` only at 0 A, confirming RM-134's idle rule is safe
  on real data.
- The next lights-on after an idle stretch should raise no flag (RM-136).
- The next outage is RM-131's real test.
- **The week of 14 Sept report** at the first report pass after 08:00 Wed 23 Sept (RM-138; passes run six-hourly
  from the last `ibems-ingest` restart): the journal's `generated weeks 2026-09-14` and the row. The Reports work (RM-137–RM-141) is deployed and read back 22:53–22:56:
  the Pi at the pushed commit, the kiosk bundle rebuilt, `ibems-ingest` restarted after the pull (next passes 04:53, 10:53).

**Engineering, in order:**
1. **FI-034:** `readings_buckets` over 30 days takes 7.8 s. Add `p_until` or chunk it, then extend
   FI-027's rule to `readings_buckets` / `readings_archive` so the Analytics 7d/30d charts leave held watts
   out too.
2. **An ntfy notice** when the demux flips, a meter flag stands, or a poll stops being answered. The data
   is already corrected at source; this makes it seen the same hour.
3. **Per-channel freshness:** the parser stamps `<ctx>_last_time` on every message, whichever channel it
   carried. A stamp per channel's own dps would make a channel the device stops answering visible even with
   the poll (defence in depth for RM-134).
4. **FI-032:** store the IR hub's room temperature and humidity. The RM-069 loop acts on them.
5. **Restatements** should restate only for their own reason. phase47 also touched 8 August rows by rollup
   drift, harmlessly (FI-027). The restatement note's reason is phase44's wording; store a reason with it.
6. **`building_totals` for 07:43–14:21** on 09-22 still carries the held 39.8 W in `total_power_w`: extend
   `scrub:held` to the building rows.
7. **RM-083c:** PDF render (3.6–5.2 s on the Pi) into a worker. **FI-020:** switch freshness. **FI-026:**
   one-sample health flickers. **RM-042:** retire the legacy monthly tables.
8. **Prune the legacy `GSheet: Append to …` nodes**, which fail auth (Sheets was rejected in FI-011). This is
   a flow write, dry run first.
9. **Refactor:** fold `outletPollPlan` / `switchPollPlan` / `meterPollPlan` onto one helper, keeping the
   generated funcs byte-identical.
10. **A mock fault mode for a missed push**, so the page's held-reading handling can be exercised without
    the building.
11. Later: RM-085 arbitrary report windows, RM-070 daylight/blinds (needs hardware), FI-012 partitioning
    (when volume demands it), and Track B's replication gaps (Milestone 6, June 2027).

### 2026-09-22, 10:55 — the walkthrough: what is left, by who can do it

The system as it stands: nineteen tuya nodes reconnect by address, the demux keeps the yellow
meter's channels where the registry says they are (two flips caught this morning, both corrected
before the rows were stored), reports run daily/weekly/monthly with the director's aircon shown as
the estimate it is, the journal survives a reboot, three timers recover the network without the
cloud, `npm run preflight` reads `Ready`, and a backup has now been restored. What remains splits
cleanly by who can do it.

**Only a person at the office or the AP can do these, in order of value:**
0. ~~L.O Yellow's clamp is frozen — power-cycle the meter~~ **Do NOT power-cycle the yellow meter
   (RM-134, 2026-09-22 afternoon).** The clamp is very likely fine: channel 2 has been at 0 W since the
   lights went off during the Pi's 07:44 reboot, the meter's push of that change reached nobody, and
   nothing ever polled the meters, so the bridge kept 39.8 W. **Resolved ~14:20:** the operator applied
   the demux upgrade and the meter poll, and at 14:21 `mtr_lo_yellow` read 0 W / 0 A / `monitor` with
   the flag cleared. No power cycle is needed. The 396 stored rows that held the figure were scrubbed
   by the operator at ~14:50 and read back (RM-134). **Nothing remains for this item.**
1. ~~The access point~~ — **done 2026-09-22 12:42–13:05 by the operator, read back 13:25** (RM-131,
   RM-046). The AP is an aclink 4G/LTE router; its "Static DHCP Leases" now hold all 19 — the 18 tuya
   devices and the Pi — each at the address it already had, so nothing moved. Allocation Duration
   2 H → **24 H** (the Pi's next lease, 13:15:26, carried `dhcp_lease_time = 86400`). 2.4 GHz channel
   **fixed at 1**, bandwidth **HT20**, **Isolate Clients off**; SSID and security unchanged. Each Save
   dropped the fleet for about two minutes (12:42–12:45, 13:03–13:05); since 13:06 there have been no
   disconnects and no `find()` timeout, 19/20 online, every node's address agrees with its device's
   last announcement, no `ADDRESS DRIFT`, and the Pi never lost its association. The AP's make and
   model belong in `docs/physical-install.md`'s gap (RM-033).
2. **A UPS on the AP and the Pi** — the change that makes the outage failure not happen.
3. ~~Import the local keys~~ — **done 08:51** (RM-127 step 4, recorded at origin `e97aa5c`): 17 devices
   through Add Device → Import keys; the store is 0600 and every key matches its flow node by hash.
   Not in it: the CARE ACU meter (the workbook has no key for it) and the never-installed Outside Temp.
4. **RM-120** — the aircon's on-site acceptance with the TCL112 generator (RM-128).
5. **RM-016** — the outside temperature sensor was never installed; the one dark device of 20.
6. **The dual-channel meter (RM-122/RM-134):** check Smart Life for a firmware update for it (free),
   and decide whether to replace it with two single-channel CT meters (the `cz_ct_single` product on
   L.O Red / CARE ACU), which cannot trade channels. The demux corrects the trade; only hardware ends it.
7. **RM-026's Solarman logger onto the device SSID** — the contractual solar deliverable cannot start
   without it. The live flow's `solarman-device` node logs a socket timeout every few minutes meanwhile.

~~Apply phase47 (FI-027)~~ — **applied by the operator 2026-09-22 16:19 and read back** (FI-027).

~~One command on the Pi (RM-136)~~ — **run by the operator 16:31 and read back** (RM-136). The command, for the
next held reading:
```
ssh <user>@<host> 'cd /home/bems/bems && cp ~/.node-red/flows.json ~/.node-red/flows.json.bak-rm136-$(date +%F-%H%M%S) && npm run -s deploy:pi -- --host=127.0.0.1 --force --apply && sudo systemctl stop nodered && { npm run -s repair:held-context:pi -- --device=mtr_lo_yellow --from=2026-09-22T07:43:30+08:00 --to=2026-09-22T14:21:30+08:00 --apply; sudo systemctl start nodered; }'
```

**Decisions, not work:**
- **RM-006c** — which loads may shed first (`npm run shed:profile` has the numbers). The path is
  built and audited; nothing sheds until a tier is assigned.
- **RM-121** — renew IoT Core or not. Optional since RM-129; the preflight now says so (RM-132).
  What it would bring back: the relay fallback, `tuya:devices`, `tuya:spec`, the cloud's MAC join.
- **RM-006d, the rest** — a scratch Supabase project with a frontend pointed at it (steps 2, 6, 7 of
  `docs/backup-policy.md`). The restore itself is proven; this would prove the rendering.

**Waiting on time, watched by the timers:** the next outage is RM-131's real test
(`journalctl -t ibems-fleet-recover`); the next yellow-meter flip is the demux's
(`npm run check:meters`, and `capabilities.channel_map` on the stored rows).

**Engineering that is open and not urgent:** FI-034 (`readings_buckets` over 30 days: 7.8 s, chunk
or add `p_until`), RM-083c (PDF render 3.6–5.2 s on the Pi), RM-026 (Deye, contractual, needs the
logger on the SSID first), RM-070 daylight/blinds, RM-033's twelve `〔FILL IN〕` gaps in the
physical-install guide. **Added 2026-09-22 (RM-134 follow-ups):**
- ~~FI-027's second half~~ — built and rehearsed as phase47; applying it is above.
- FI-032: store the IR hub's room temperature, which the RM-069 loop acts on.
- An ntfy notice when the demux flips or a meter flag stands.
- Pruning the legacy `GSheet: Append to …` nodes, which fail auth in the journal; Sheets was rejected in
  FI-011.
- Folding the three poll plans onto one helper.

### 2026-09-22 (early morning) — the field network after an outage; two actions, in order

Read `docs/outage-recovery.md` first. **Done 2026-09-22 morning:** the operator power-cycled the office
at 07:42; the Wi-Fi watchdog returned the Pi to `BEMS` 4 s after its first check (07:46:34, against
5½ minutes the day before); the learner heard all 18 devices announce at 07:47:32 (and one meter had
already moved, `.228` → `.229`); the 18 addresses were written to the flow at 08:02 (`flows.json`
backed up beside it) and every node reconnected by address within a minute — **19/20 online**, the
only dark one the never-installed outside sensor. No node waits for a broadcast any more.

**The access point is done too (2026-09-22 13:05, read back 13:25)** — see the walkthrough above. As
written that morning, for reference:
**`npm run set-device-ip:pi -- --host=127.0.0.1 --reservations`** prints the MAC → address table
(18 devices; add the Pi at its current address); enter it as DHCP reservations, pin the 2.4 GHz
channel (RM-046 — it is on 1 and quiet today), lease ≥ 1 day, isolation off. Until the reservations
are in, an AP power cycle can renumber a device; the watchdog will say `ADDRESS DRIFT` in the
journal and `set-device-ip:pi --from-lan-map` re-pins it in one command. And the UPS the runbook
describes is the change that makes the whole failure not happen.


### 2026-09-22 (later) — onboarding without IoT Core and the aircon's protocol; what to deploy, in order

**Steps 1–3 done by the operator and read back, 2026-09-22 07:55 (read-only):**
- `aircon:pi` wrote `~ AC Master Logic` only, "Generator check passed", read back current; a later dry
  run says nothing to do. The backup is `~/.node-red/flows.json.bak-ircodes-` — **no date in the name**:
  the command ran from Windows PowerShell, which evaluated `$(date +%F)` locally and failed. Give such
  commands in single quotes.
- The kiosk serves a bundle with Import keys and the generated-frame text. The proxy holds UDP
  6666/6667/7000 (the LAN listener) and has served `/api/tuya/devices` from imported and LAN sources
  while the cloud reports `28841002`. Node-RED logged no `EADDRINUSE` beside it, nor beside RM-131's
  `ibems-lan-map` listener.
- **After the 07:44 reboot the fleet is back on the segment:** 18 broadcasters heard (10 × v3.5,
  7 × v3.4, 1 × v3.3), 19/20 devices online — all but the uninstalled Outside Temp — and no `find()`
  timeout in the six minutes before the read. The IR hub connected at 07:46; `acu_main` reads 28.4 °C,
  75 %, `stale_after_ms` 150000. `sens_outside_temp` reads offline with no humidity (RM-114 live).
- phase45's columns exist (RM-117).

**Step 4 done 2026-09-22 08:51 by the operator, and read back:** a CSV built from their device workbook
(17 devices: seven switches, seven outlets, the IR hub, the two physical meters with channels) went
through Add Device → Import keys, "lists every device" unticked because it is the site, not the whole
account. The proxy logged `added 17, updated 0, complete=false, 0 problem(s)`; the store is
`server/data/device-credentials.json`, 0600, 17 keys of 16 characters, each identical to its flow
node's (compared by hash). The CSV was deleted from the workstation and is not in the Recycle Bin.
Not in the store: the CARE ACU meter (`AREC ACU` — the workbook has no key for it; the flow does) and
the never-installed Outside Temp. No complete-list marker is set, so Rebind's orphan rule relies on
the cloud listing or a later whole-account export.

Still to do: step 6 (the on-site test, no longer blocked by the network).
The original list, for reference:

1. **Pull and build on the Pi**: `ssh <user>@<host> "cd /home/bems/bems && git pull --ff-only && npm run build"`.
2. **Dry-run the Aircon tab, then apply it with a backup (RM-128).** Expected: `~ AC Master Logic` only,
   with "Generator check passed":
   ```
   ssh <user>@<host> "cd /home/bems/bems && npm run aircon:pi -- --host=127.0.0.1"
   ssh <user>@<host> "cd /home/bems/bems && cp ~/.node-red/flows.json ~/.node-red/flows.json.bak-ircodes-$(date +%F) && npm run aircon:pi -- --host=127.0.0.1 --apply"
   ```
3. **Restart the three daemons** — the proxy loads four new modules and starts the LAN listener:
   `ssh <user>@<host> "sudo systemctl restart ibems-ingest ibems-proxy ibems-scheduler"`.
4. **Import the keys (RM-126/127).** On a workstation, export the Smart Life account's devices with a key
   tool (JSON or CSV with each device's id and local key; `tinytuya wizard`'s `devices.json` works), then
   Devices → Add device → Import keys, ticking "lists every device" for a whole-account export. Delete
   the export file afterwards. (On the Pi instead: `npm run keys:import -- <file>`, then `--apply
   --complete`.)
5. **RM-046's sequence at the access point** still stands from the entry below: the lights, outlets and
   IR hub have been off the segment since 09-21. Nothing in steps 1–4 can bring them back, and the
   aircon cannot be tested until the hub is.
6. **The on-site acceptance test (RM-120)**, now including a generated frame.

**Read back after 2–4 (read-only):** `/api/capabilities` has `acu_local_ir_protocol: "tcl112"`;
`/api/tuya/devices` answers 200 with `sources.lan.listening_since` set and `sources.cloud.status`
`unavailable` (code 28841002) while IoT Core stays lapsed; `GET /api/credentials` lists the imported
devices with `credential_length: 16` and no key.

### 2026-09-22 — the yellow meter trades its channels; what to deploy, in order

**All of it is deployed, 2026-09-22 04:26–05:20, approved by the operator.** The demux is in the live
flow (`flows.json` backed up beside it), the bridge tab redeployed, the rows scrubbed (04:33), phase46
applied by the operator (~05:05), the daemons restarted (04:59) and every settled day generated (08-16 →
09-21), the kiosk on the new bundle (`index-Dx5nAZxI.js`), the bridge's `enacc_*` bases corrected by hand
(05:14, context backed up beside it), and the journal made persistent (RM-125). The week of 09-14 settles
on 09-23 with the scrub already in it. `origin` is now SSH with a deploy key.

**What the read-back found, and it is not this work's doing:** the seven lights, seven outlets and the IR
hub have been off the segment since 17:54–18:11 on 09-21 — flapping after the 17:02 reboot, then gone. A
30 s passive listen hears exactly three broadcasters, the three physical meters, as on 2026-09-03
(RM-046, the access point after a power event). The IR hub's session had survived until the 05:14
Node-RED restart for the context edit; it is not re-found since, and `set-device-ip:pi` cannot help
because it needs the cloud, which RM-121's lapsed subscription refuses. Nothing here recovers them:
renew IoT Core (RM-121) so the tools work again, then RM-046's sequence at the AP.

FI-035 was answered the same morning: both — see RM-130.

**Read back after 1–2:** `npm run check:meters -- --hours=6` reads the STORED rows, which the demux now
corrects before they are written — so from the apply onward it should list nothing new. A flip it does
list is the demux not deployed, or its two premises no longer holding.

### 2026-09-17 (evening) — the IR blaster is re-paired; what waits on the operator, in order

The code is committed and every suite is green; nothing below is deployed. In order:

1. **Renew the Tuya IoT Core subscription (RM-121).** Tuya developer console → Cloud → Cloud Services →
   IoT Core → extend. Since about 18:58 local, every business call answers
   `code 28841002: IoT Core service subscription has expired`, while the token still issues. Until it is
   renewed:
   - the vendor-cloud fallback, the aircon's mode/fan/swing route, the Add Device list and
     `/api/tuya/presence` all fail;
   - `acu_cloud_route` reads `unresolved`, and the aircon panel disables states only the cloud can send
     and says why.

   Local control of every device is unaffected.
2. **Pull and build on the Pi**:
   ```
   ssh <user>@<host> "cd /home/bems/bems && git pull --ff-only && npm run build"
   ```
3. **Dry-run the Aircon tab refactor (RM-116), then apply it with a backup, as one line**:
   ```
   ssh <user>@<host> "cd /home/bems/bems && npm run aircon:pi -- --host=127.0.0.1"
   ssh <user>@<host> "cd /home/bems/bems && cp ~/.node-red/flows.json ~/.node-red/flows.json.bak-aircon-$(date +%F) && npm run aircon:pi -- --host=127.0.0.1 --apply"
   ```
   The script reads the flow back and re-plans it; it must say "Written and read back".
4. **Restart the three daemons**:
   ```
   ssh <user>@<host> "sudo systemctl restart ibems-ingest ibems-proxy ibems-scheduler"
   ```
5. **Apply `supabase/phase45_command_ac_state.sql`** in the Supabase SQL editor (RM-117). Until then the
   aircon state still lands in each command's note.
6. **The on-site acceptance test (RM-120)**, with someone watching the unit. It is the only thing that can
   flip `SITE.aircon.local_ir_verified`.

**Read back after 3–4 (read-only):**
- `acu_main` reads online with `room_temp_c` and `humidity_pct`, and its `ts` advances within the 60 s
  poll.
- `sens_outside_temp` still reads **offline with no humidity**.
- The fleet reads 19/20.
- The journal shows `NBRIC IR Blaster` connected, and `Outside Temp` still logs "Auto start probe is
  disabled".

### 2026-09-16 — a lighting circuit's week read 81.41 kWh; the report summed a counter jump

**The operator reported it: L.O Yellow, lighting only (L5–L7), was the biggest consumer in the week of
7 September.** It was not. Measured read-only against the live project:

- The stored `period_reports` row gives `mtr_lo_yellow` **81.406 kWh** with a peak of **251.2 W**.
  251.2 W for all 168 hours is 42.2 kWh.
- A period's per-device energy is **the sum of each local day's highest `energy_kwh_today`**
  (`phase27_period_reports.sql`, and `phase12_monthly_reports.sql` for the legacy table).
- On 2026-09-08 the register jumped **0.111 -> 67.391 at 02:36 while the circuit drew 49 W**, then to
  77.317 ten minutes later. That day's high-water mark, 77.502, is in the week. Its power integrates to
  0.708 kWh.
- RM-052/RM-053 fixed the bridge and its context. **The stored `readings` were never corrected**, and the
  week was generated on 2026-09-16 from them.

**How far it reaches.** Every stored device-day was scanned (raw since 2026-08-17, hourly since
2026-08-16, the 12 devices that record energy): **that day is the only contaminated one.** September's
monthly report is due about 2026-10-03 and would carry it.

**The fix, proven before it was written.** Credit each hour's rise of the counter only up to what the
circuit could have drawn in it — the day's peak power across the span, +10 % and 5 Wh — and past that,
credit the hour's measured power instead. Replayed over **all 250 live device-days, it changes exactly
one**: 2026-09-08 L.O Yellow, 77.502 -> 0.713 kWh. The corrected week is 4.617 kWh, and the four branches
then sum to 61.51 kWh against the building meter's own 61.73.

**What shipped the same day (RM-090):** the page, the CSV and the PDF refuse the stored 81.406 as "Not
possible". What waits is RM-091's `phase42`, applied by the operator, which fixes the generators and
corrects that one row — see §2.

### 2026-09-15 — the branch circuits are wired as the operator describes them, and live

**The operator confirmed what each branch carries (RM-088):** L.O Red is light switches L1–L4, L.O
Yellow is L5–L7, C.O Yellow is every outlet and whatever plugs into them, and CARE ACU is the aircon
and nothing else. The site file said otherwise in two places — all seven lights on L.O Red, and L.O
Yellow as "the outdoor aircon unit" — and the aircon's IR endpoint was on no branch. Corrected and
held by `test/site-branch-wiring.test.mjs`. The outside temperature sensor stays on no branch until
someone says what feeds it.

**RM-089 is the likely cause of the "Supabase unreachable" bursts.** Node gives each connection
attempt 250 ms; the Pi's IPv6 addresses fail at once, and a lost SYN is retried only after a second,
so one lost packet failed a whole request. Every daemon now allows 3.5 s. *(Confirmed and closed
2026-09-17: see its entry.)*

**Both deploy steps were run by the operator the same evening and read back.** The three services
restarted at 12:39 UTC onto `e414ab8`, with no error logged since. The regenerated flow was deployed from
the Pi itself — Node-RED listens on loopback, so `npm run deploy:pi -- --host=127.0.0.1 --force`, then
again with `--apply` — after `flows.json` was backed up, and its own verification passed 5 of 5. The
bridge's `/api/devices` serves L1–L4 on L.O Red, L5–L7 on L.O Yellow and `acu_main` on CARE ACU, and the
`devices` table matched at ingest's first periodic sync after the deploy (12:44 UTC). The sync at startup
had copied the old branches, because the services restarted before the flow was deployed. The same two
devices were offline before and after the deploy — `acu_main` and the outside temperature sensor, both
unpaired since RM-016.

**Swept afterwards, 2026-09-16.** `npm run preflight` on the Pi reads **Ready**, with one warning, and
that warning is the known pair: 18 of 20 devices reporting. Everything else passed — credentials, the
database, the vendor account, 17 devices broadcasting on the segment, the bridge answering, six units
active, and **the bridge still bound to loopback after the flow deploy**, which is the check worth
having after writing to a live flow. `npm run site:check` reads the corrected wiring as coherent: 20
devices across 6 circuits. Neither wrote anything.

### 2026-09-15/16 — the first real retention passes ran, and match the raw export; phase41 waits to be applied

**`supabase/phase41_totals_rollup_integrated.sql` is applied (RM-087), on 2026-09-16, and read back.**
Without it, the first retention pass to reach phase32's integrated series — 2026-10-08, thirty days
after the series began — would have stored NULL for every hour it pruned and deleted the rows that held
the value. The read-back in RM-087, run against the live database, returned 1.6, 2.6 and 3.6 where the
old function left NULLs, and its transaction rolled back: no row before 2026 in `building_totals`, no
bucket before 2026 in `building_totals_hourly`, and the oldest real rows unchanged.

**The first pass is due at 18:18 UTC tonight, not 15:52.** Retention asks every six hours from when the
ingest daemon started, and the oldest reading ages past thirty days at 15:52 UTC, so the 18:18 check is
the first to find anything. It rolls up and prunes 2026-08-16 15:00–18:00 — whole hours only, because
both rollups truncate the cutoff to the hour. Checked before it runs:
- **A backup and a raw export are off the Pi.** `server/backup.mjs` leaves out `readings` and
  `building_totals` by design, and those are exactly what a pass deletes. So every raw row from before
  2026-08-18 — 35,162 readings and 1,852 totals rows, each count matching the database — was exported
  beside the backup, and the directory was copied off the Pi with checksums matching file for file. That
  covers every pass until 2026-09-17.
- **The ingest buffer drains.** "Supabase unreachable, buffered (1 pending)" appears 26–100 times a day,
  all week; each is one write retried the next minute, and no buffer file is left behind.

**They ran, and they are right.** The 12:39 UTC restart (RM-088/RM-089) moved the six-hourly check, so
the first pass ran at **18:39 UTC** rather than 18:18 — retention asks every six hours from when the
daemon started. It rolled **60 device-hours into `readings_hourly` and pruned 2,520 raw readings**, plus
3 hours and 126 rows of building totals: 20 devices across the three complete hours of 16 August, which
is what a cutoff truncated to the hour should take. The 00:39 UTC pass took the next six hours (120
device-hours, 7,040 readings). **Checked against the raw export row by row:** 9,560 exported readings
became 180 device-hours, each bucket's sample count, online count and peak watts equal to the rows it
replaced, 0 mismatches, and no raw row left before the cutoff; the 478 exported totals rows became 9
hours on the same terms. The hourly buckets' integrated columns are empty, as they must be — these rows
predate phase32's series — which is exactly the case RM-087's phase41 fixes before 2026-10-08.

### 2026-09-15 — phase40 is applied; CO6 and CO7 are corrected

**`supabase/phase40_report_curve_speed.sql` is applied and read back** (RM-086). The duration curve
answers in 448 ms where it took 3.5 s, and signed in all five charts draw in about half a second
where the curve was cancelled by the statement timeout on every attempt.

**CO6 and CO7 (RM-080) are done.** The operator reports the physical installation has CO6 on the
right wall and CO7 on the partition. The three code copies are swapped and deployed, and the operator
ran the two-row statement; read back from the Pi, co6 is 0.9167 / 0.3396 and co7 0.75 / 0.1981, both
still in their room. The Control page's pins were not seen in a browser from here — the remote browser
could not reach the live bridge, which is also why device names read as ids there — so a glance at the
kiosk's Control page closes it.

### 2026-09-14 — L.O Red "reporting less than it measured" was a meter that froze, and the charts could not say so

**Three reports, one missing idea: nothing on the Analytics page knew when a sample belonged, or what
kind of sample it was.** The operator reported (1) Overview and Analytics both saying *"L.O Red shows
0.00 kWh against 0.30 kWh of its own power integrated over the same day (100 % missing) … energy going
missing between the meter and this page"*, (2) L.O Red reading differently on Overview's Energy
Breakdown and Analytics' "By branch", and (3) blank strips in the branch and outlet charts. Each was
measured before anything changed — the ring buffer, flow context and journals read on the Pi, and the
`readings` table read back. Operator decisions the same day: bridge gaps of two minutes or less and
band longer ones; never estimate energy for a frozen window; frontend first, bridge second (RM-079).

**RM-077 — the accusation was wrong.** The bridge publishes exactly L.O Red's own register
(`capabilities.today_acc_energy1` equals `energy_kwh_today`, day base 0). What disagreed was the
second opinion:

| local day | integrated from power | own daily register | own lifetime register Δ |
|---|---|---|---|
| 09-07 to 09-11 | 0.191 / 0.226 / 0.270 / 0.112 / 0.064 | 0.191 / 0.227 / 0.272 / 0.112 / 0.066 | agrees |
| 09-12 | **0.329** | **0.008** | **0.008** |
| 09-13 | **0.214** | **0.091** | **0.092** |

On 09-12 from 06:00 to 20:59 the meter repeated **19.1 W / 228.2 V / 0.576 A exactly** — one distinct
tuple an hour for fifteen hours — while both registers stood still. On 09-13 it held 13.3 W from 00:00
to 09:00 and 0 W / 208.1 V from 10:00 to 16:00; on 09-10, one tuple for 1,132 minutes. It reported
`online: true` throughout, because it kept sending messages. The legacy `Calculate 3-Phase Totals` node
multiplied the held 19.1 W by fifteen hours. No healthy meter held an identical power/voltage/current
tuple above 0 W for longer than 33 minutes in the same seven days — but the threshold that shipped on
that evidence was wrong for outlets, and live data corrected it the same day: see the last paragraph of
this entry.

**The meter itself needs attention: three freezes in four days.** By this project's own rule, restart
Node-RED (or that node) before suspecting hardware; if it recurs, power-cycle the meter at the panel.
Recorded against RM-013.

**RM-078 — two copies of one derivation.** Overview rounded rows to one decimal and took every
`meter`; Analytics rounded to two and took the `branches` group filtered by `monitoring`; neither
matched `BUILDING_METER_IDS`, which is what `_totals` sums.

**RM-076 — the blank strips.** The operator's Analytics screenshot matches 2026-09-07 16:31 by its own
energy figures, and its two gaps were **Node-RED being redeployed and restarted** that afternoon
(journal: `Updated flows` 15:50:10, `Stopping nodered.service` 15:50:43 and 16:25:55; ingest logged
`bridge unreachable` at 16:26:00) — real outages, drawn as unexplained blanks. The current buffer adds
single-sample `online: false` flickers between equal readings (CARE ACU 12:46, L.O Yellow 07:32, co1
14:08, co5 14:18) — a health flag, not an outage (FI-026). Underneath both, the ring stamps each sample
with the device's **arrival** time (`mtr_lo_red`: 298 intervals of 1–29 s and 347 of 90–129 s in one
day), and `buildChartRows` and `sumHistories` paired devices by array position.

**Verified in a browser** against `npm run mock -- --port=1881 --faults=flicker,offline,frozen,spike`
(new): the main chart reports 6 interpolated samples, 4 gaps and the frozen meter; the badge reads
"Live · Interpolated 6 min · Offline 4 windows · Frozen L.O Red"; both energy cards name the freeze and
neither accuses the branch; no inline error boundary tripped; no horizontal overflow at 375 px. **That
pass found a defect the tests had not:** a sum with one frozen contributor drew the frozen stretch as a
blank with no band (Energy Flow, Metered vs total). Fixed and pinned (`sumSlotSeries`,
`pairTotalAndMetered`). **Not verified:** the tooltip on hover — the browser pane was not on screen, so
the page drew no frames; its content is pinned by `ChartTooltip.test.tsx`.

**Deployed, read back, and the live data corrected the freeze threshold.** `1c74ae3` went green in CI
(node 22 and 24); the Pi fast-forwarded and rebuilt `./dist`, and its dashboard served the new bundle.
The signed-in page itself was not viewed from here. Running `lib/timeseries.ts` over the Pi's live 24h
buffers then did two things. It confirmed the grid on real data: every one-sample flicker on the four
meters was bridged (CARE ACU 12:46 and 07:40; four each on L.O Yellow and C.O Yellow), no spurious gap
window appeared, and no hole was invented where floor-binning would have invented 300–476 a meter. And
it **flagged co1 and co7 as frozen, wrongly**. The one-hour rule had been sized on the meters alone. The
outlets refresh power, voltage and current about once an hour; co1's own `add_ele` advanced twice inside
its flagged hour; and over seven days co1 held an identical tuple for 60 minutes or more nineteen times,
while no healthy run on any of the eleven devices reached 120. The threshold is now **three hours** —
about 3x the longest healthy run, under a third of the shortest fault (540, 657, 942 minutes) — and the
mock's `frozen` fault is four hours long to match.

### 2026-09-09 — the Automation page said it could not do what it was doing

**The defect worth leading with is not a bug, it is a claim.** `AutomationPage.tsx` carried
*"Staged, not yet dispatchable"* in its header and *"nothing on the real bridge reads these yet;
hardware dispatch is still gated closed"* in its save dialog. Both had been false since EX-047
shipped the scheduler daemon: those rows are read every 15 s and fired through the audited
command path. §0 of this very file simultaneously instructed the operator to *"open the
Automation page signed in, turn auto-shed on, and save"* in order to arm real hardware shedding.
A page that understates its reach invites somebody to experiment on a live building.

It now reads its reach from `/api/capabilities` through the same `dispatchScope` the Control page
uses — so it says "armed rules switch real hardware" or "dry runs — dispatch is closed" according
to what the deployment actually reports, and `null` (not yet answered) counts as closed.

**Three structural limits went with it.**

- **A device could hold exactly one schedule**, enforced by `unique (device_id)`. Writing a second
  window silently REPLACED the first, with nothing on screen to say the first had gone. Reported
  from use. `phase33` drops the constraint and makes `id` the only identity.
- **The page could not express a socket at all.** `supabaseConfig.ts` wrote `socket: null` and read
  `.is('socket', null)`, so an outlet's two relays could never be scheduled apart even though
  `shared/commands.mjs` has always insisted an outlet command must name one. `shared/commands.mjs`
  said this needed *"`UNIQUE(device_id, socket)` and a socket picker — see the roadmap"*, and no
  such roadmap entry existed. It does now, and the note was wrong about the constraint: per-socket
  UNIQUE is the same one-rule-per-thing blocker one level down.
- **The "Ambient Trigger Setpoint" slider was dead.** `global.trigger.care_acu_on` round-tripped
  browser → Supabase → browser for months; a whole-repo grep found no `server/` file that read it.
  RM-069 replaces it and `phase35` drops the column.

**What was NOT verified, and cannot be here.** RM-069's controller has never run against
hardware: `acu_main` and `sens_outside_temp` have never been paired (RM-016), so every rule
correctly holds on `acu_offline`. Its proof is a first-order room model driven for 200 ticks in
`server/acuLoopPlan.test.mjs`, asserting the setpoint settles rather than hunts, plus a second run
where the room cannot be cooled to target and the loop walks to the 16 °C floor, stops, and alerts
exactly once. That is the only evidence that exists and this entry says so rather than implying
a live test.

**All four migrations are APPLIED to the live project** (2026-09-09):
`phase33_schedules_stackable.sql`, `phase34_socket_config.sql`, `phase35_policy_room_target.sql`,
`phase36_acu_rules.sql`. **phase33's deploy order is load-bearing and was followed**: the frontend
was rebuilt and both daemons restarted FIRST, then the SQL was run. Old code against the new schema
fails on `ON CONFLICT (device_id)` and breaks every schedule save from a kiosk still serving the old
`./dist`; new code against the old schema only refuses a second rule per device. Both fail loudly,
so the ordering was a choice rather than a rescue.

**What the live database says, read back rather than assumed.** phase33's split turned 7 rows into
**17**: `acu_main|null`, `l1|null`, `l4|null`, `l6|null`, `l7|null`, and both sockets of co1–co5 and
co7 — each outlet's single whole-outlet rule became one rule per relay, sourcing the count from
`devices.sockets` rather than a hardcoded 2. `socket_config` backfilled from the device tiers,
including `co6`, which has a tier but no schedule. `sites.policy` now holds both
`acu_min_room_target_c` and `acu_min_setpoint_c` at 24 (expand, not yet contract), and
`dsm_thresholds.care_acu_trigger_c` is gone. `ibems-scheduler` restarted onto it clean —
`loaded 17 schedule row(s)`, with no `socket_config unreadable` and no `acu_rules unreadable`
warning, which is what proves phase34 and phase36 are actually being read rather than merely
present. **Stacking was then proved on the live table**: a second rule was inserted for `l1`
(2 rows), then deleted (204, back to 1). The insert is the load-bearing half — `unique (device_id)`
is a constraint, not a policy, so it would have refused that row whatever key was used, and it did
not. That delete did **not** prove the new DELETE policy, because it used the service-role key,
which bypasses RLS entirely.

**The browser path is now exercised, by the operator rather than by a test.** Between 22:41:16 and
22:41:51 local on 2026-09-09 the table went from 17 rows to 21 through a signed-in session: rules
created for `co6|1`, `co6|2`, `l2`, `l3` and `l5` — the five relays that had a shed tier but no
schedule — one every two seconds, each attributed to the operator's user id; `co1|1` updated; and
`acu_main`'s rule **deleted**, which is `schedules_delete_authenticated` doing its job under an
`authenticated` JWT. (The deletion is inferred rather than logged — `schedules` has no delete
audit — but the row was present in the verified 22:11 listing, absent afterwards, and no
service-role caller touched it.) Insert, update and delete from the page are all now real.

**Per-socket dispatch is proved on hardware, not just in tests.** At 22:40:04 and 22:41:06 a rule on
`co1` socket 1 fired `off` then `on`, and `commands` holds **one row each, `socket: 1`, with no
paired socket-2 row**. Compare 16:26–16:27 the same day, before the migration: every outlet firing
wrote a matched pair, because one `socket: null` row fanned out to both relays. The audit note also
changed shape — `schedule 05b5bce2-… due` where it used to read `schedule due` — so a firing now
names the rule that caused it.

Idempotency was proved by EXECUTION, not by reading the files. **`supabase/reapply.sh`** (new, the
sibling of `rehearse.sh`) takes a throwaway Postgres 16 container through `schema.sql` plus every
`phaseNN` in order, seeds a pre-phase33 whole-outlet row, and then applies phase33–36 a SECOND time.
The second pass is the interesting one — every constraint, policy, index and column already exists
and the split has already happened. It produced 3 schedule rows rather than 5, did not stamp over
the `socket_config` backfill, and left both policy keys present and equal. `rehearse.sh` cannot show
this: it applies each file once against a fresh database, so every `drop … if exists` finds nothing
and no guard is ever exercised. Several phase headers say "RE-RUNNING IS SAFE"; until now that was a
claim with no test behind it, which matters because with no migration runner the recovery from
"did this one already go in?" is to run it again.

### 2026-09-08 — the building total is the sum of its branches now, and that was the operator's idea

**RM-057.** After RM-056 the three periods still did not match: month 63.23 against 62.93, week
21.60 against 21.53, today 6.09 against 6.06 — all small, all the same sign, and all real. The
operator asked the question that had not been asked in three rounds of fixing this: *"why not
make it one source of truth"*, with every meter's consumption added up to give the building
figure, and a site declaring its own meters so the next building can do the same.

That is the right answer, and it was reachable at any point in the previous three faults.

**WHAT WAS WRONG WAS THE ARCHITECTURE, NOT THE ARITHMETIC.** The totals came from
`bems_energy_*` — the legacy flow's own two-second integration — while the per-branch split came
from each meter's own register. **Two derivations of the same four circuits**, rendered side by
side on two pages. Every energy fault this project has had lived in the gap between them:
RM-053's 5.4x, RM-047's fabricated outlet energy, RM-056's 38 % absorption showing as a 6.7 %
building-level shortfall. The totals are now the sum of the branch meters, so the headline figure
and the split are the same arithmetic done once and **cannot** disagree. Measured against the
mock immediately after: TODAY 26.53 / branch sum 26.53, WEEK 344.29 / 344.29, MONTH 1535.89 /
1535.89, and Overview's Live Demand and Energy Breakdown both 26.51.

**WHICH METERS ADD UP TO A BUILDING IS A FACT ABOUT WIRING.** Not "every device of class
`meter`": `co_yellow` is the convenience-outlets branch and the seven outlet devices plug into
it, so that set would count the same watt-hours at the branch and again at the socket.
`buildingMeterIds()` takes the **topmost metered circuits** of the declared tree — every metered
circuit with no metered ancestor — which counts a metered sub-panel once and leaves the branches
beneath it as detail. Derived from `shared/sites/<id>/circuits.mjs`, so **a second building gets
its totals by writing its own circuits file and changing nothing else.** That retires the last
thing `Calculate 3-Phase Totals` knew that this repository did not, and it is the replication
answer the operator asked for.

**ALL OR NOTHING, deliberately.** A period is null when any branch lacks a figure. A building
total short by a whole circuit with nothing on screen saying so is the shape of every fault
above; the UI already renders null as "No data" and the split as "not counted yet".

**THE OLD FIGURE IS KEPT, AND THAT IS THE LOAD-BEARING PART.** `energy_kwh_*_integrated` still
carries the legacy integration of the same circuits. It is no longer the headline, but it is the
only INDEPENDENT measurement of that load this system has — and RM-054's guard, pointed at the
summed total, would compare a number against itself. It now compares the split against the
integrated figure instead. Stored too (`phase32`), so both series survive.

**AND IT COST THE GUARD ITS ONE-SIDEDNESS ARGUMENT — see RM-058.** The old reasoning was that
the branches are a SUBSET of the building, so exceeding it is suspicious and falling short is
ordinary. Both figures now describe the same circuits, so a shortfall means something too — it
is exactly RM-056's signature. That direction is **not guarded**, and sizing it from one fault
would be the round number these thresholds exist to avoid.

### 2026-09-08 — the rate guard was deleting real energy, and the operator's "unsynced" report is what found it

**RM-056, and it is the one that matters on this page.** The operator reported Overview's Live
Demand "Today" and Energy Breakdown's "kWh today" disagreeing, and the same on Analytics. Both
were true — see RM-055 for the labelling half — but chasing *why* they disagreed found a fault in
the bridge, not in the frontend.

**The day baseline was absorbing real consumption, permanently.** Measured on the live bridge:

| | 13:33 | 14:09 | Δ |
|---|---|---|---|
| `mtr_arec_acu`'s own `today_acc_energy1` | 2.983 | 3.291 | **+0.308** |
| its own `total_energy1` (lifetime) | 43.069 | 43.377 | **+0.308** |
| its own power channel, integrated over the window | — | — | **+0.308** |
| **what the bridge published** | 2.652 | 2.843 | **+0.191** |
| its day baseline | 0.33079 | 0.44779 | **+0.117 — the missing energy** |

The meter agreed with itself three ways to the milli-kWh. The bridge threw 38 % of it away.

**THE MECHANISM IS A CLOCK MISMATCH, and it is the instructive part.** RM-052 added a rate
ceiling — no branch can add more kW-hours than `telemetry_bounds.power_w.max` allows in the
elapsed time — and it measured "elapsed" as *the gap since this node last ran*. But
`Energy day baseline` sits on the READ path (`bridge/read-latest`), so it runs on the 2 s WS push
and on every HTTP GET of `/api/readings/latest`. **The meter's counter is on a completely
different clock**: `mtr_arec_acu` advances in lumps of ~0.012–0.015 kWh every ~30 s. A 2 s gap
puts the ceiling at 25 kW × 2 s = **0.0139 kWh**, so an ordinary lump reads as an impossible jump
and is absorbed into the baseline — and a baseline is durable, so nothing gives it back.

**It scaled with how many people were looking at the dashboard.** Every extra client shortens the
read gap and tightens the ceiling. Watching the page harder deleted more energy from it.

**Why only the aircon.** The ceiling is per-lump, so it bites the branch whose lumps are biggest.
Over the same 24 h the other three published 99 %, 100 % and 100 % of their own registers;
`mtr_arec_acu`, the only branch above ~500 W, published 62 %. Its 0.012 lumps pass and its 0.015
lumps did not — measured sitting either side of the 0.0139 line.

**The fix is one line and the guard survives it:** timestamp the last CHANGE, not the last read,
so the span the ceiling is computed over is the span the increment actually accrued in. RM-052's
67.391 kWh jump is still caught at the same 2 s cadence — a test pins exactly that.

**What the fix does NOT recover, and why that needed a second act.** The day baseline re-anchors
at local midnight, so the absorbed energy clears itself tonight — but `ACCUMULATE_ENERGY` banks
the *published* daily figure into `weekBase`/`monthBase` at that same rollover, so an understated
day becomes a permanently understated week and month. **This is the RM-053 asymmetry again, one
layer up**: a wrong daily figure heals, and anything a downstream accumulator writes down does
not. So the baseline was repaired too, at 14:44, before the rollover — **0.448 kWh returned to
the aircon branch, and the branch sum now sits +0.28 % from the building's own counter against
RM-053's +0.31 %.** See RM-056b in §2 for the method and every check it refused to skip.

### 2026-09-08 — the page renders two figures that disagree, and now it says so

**RM-054.** RM-053 was visible on the Analytics energy breakdown for a day. What kept it
invisible to the SYSTEM is that `src/components/analytics/EnergySection.tsx` renders two
independently-derived quantities side by side and never compared them: the three tiles are the
building's own legacy flow counters, the "By branch" rows are per-device figures accumulated by
`node-red-bridge/energyAccumulator.mjs`. During the fault the branches summed to **99.546 kWh
against a building week of 18.4 — 5.4x — and the page showed both without comment.** The
component's own docblock said the two "need not agree exactly", which is true and was doing the
work of an excuse.

**WHAT IT DOES NOT DO IS THE POINT.** It does not try to make them equal. The boundaries differ,
the derivations differ, and the branch sum falling SHORT of the building total is normal — a
branch missing a reading is dropped from the sum, so under is where it is allowed to be. Only
the branches summing to more than the building they are part of is a fact about the data rather
than about what happened to be reporting, and that is the only direction the check looks.

**THE THRESHOLD IS MEASURED, not chosen for being round.** Two bars, both of which must be
cleared: a **25 %** proportional margin and a **0.5 kWh** absolute floor. Agreement between these
two derivations, every figure from this building:

| when | branches | building | branches/building |
|---|---|---|---|
| the week straight after RM-053's repair | 18.646 | 18.588 | **+0.31 %** |
| month, live 2026-09-08 13:32 | 61.907 | 61.957 | −0.08 % |
| week, same sample | 20.270 | 20.552 | −1.37 % |
| today, same sample | 4.746 | 5.086 | −6.68 % |
| today, the four meters' own 24 h power history integrated independently | 5.135 | 5.086 | +0.97 % |
| `mtr_co_yellow`'s whole day, 2026-09-02 (RM-052) | 8.057 | 8.0437 | +0.16 % |

The largest EXCESS ever measured healthy is about 1 %; the largest disagreement in either
direction is 6.7 %. **25 % is ~3.7x that, and it is also a physical quantity**: the legacy
two-second integrator behind the building counter accrues only while a meter reads healthy AND
while Node-RED is running, whereas each meter's own register counts through both, so every outage
lands in the branch sum and in nothing else. Over the 24 h before this was written the four
meters read `online: false` for 1.0–1.5 % of samples — but outages here are bursty and
maintenance stops Node-RED outright, as RM-053's own repair did. 25 % of a day is six hours of
the building counter recording nothing, longer than any stop this project has performed, and
`today` is the period where that share bites hardest.

**The floor exists because a ratio alone would shout every night.** Minutes after local midnight
both figures are a few watt-hours and any lag between them is a large multiple. 0.5 kWh is
upwards of an hour of this whole building's load (799.5 W at the sample above, 377 W averaged
across that day) — larger than any lag or rounding between the two derivations has produced, and
under 1 % of the 100 kWh per branch per day the site declares as physically possible.

**And it still catches what it was written for by two orders of magnitude:** RM-053's 99.546
against 18.4 is 17x the ratio bar and 162x the absolute one, so a fault ten times smaller than
that one still trips it. **A missing building total stays silent** — the tiles already say "No
data", and an absent counter is not a zero one to compare against.

### 2026-09-08 — the week and month carried it after the day was fixed

**RM-053.** The operator reported the Analytics energy breakdown giving L.O Yellow a huge share
— *"same scenario as before but this time is not in today but in weekly and monthly"*. They were
right again, and again it was a different cause. Measured off the bridge's own flow context:

| | week | month |
|---|---|---|
| **mtr_lo_yellow served** | **79.278 kWh** | **83.692 kWh** |
| its real consumption | ~1.5 | ~5.6 |
| its share of the four-branch split | **80 %** | **56 %** |

**RM-052 fixed the day and the week inherited it.** `weekBase` was 78.977 = 1.475 + **77.502** —
the day's bad peak, banked whole and to the milli-kWh. Repairing `energy_day_base` dropped the
published daily figure from 77.502 back to 0.301, and the accumulator's rule *"the counter went
backwards, so bank what it reached"* read that drop as a completed run. The same 77.502 would
have folded at the next local midnight if nobody had touched it; the correction changed **when,
not whether**.

**THE ASYMMETRY IS THE LESSON, and it is why this needed its own guard rather than trust in the
one upstream.** A wrong `energy_kwh_today` is transient — the next local midnight re-anchors it
and the dashboard heals itself, which is exactly what people saw happen. A wrong `weekBase` is
**durable**: it is a number this system wrote down and nothing recomputes. L.O Yellow's daily
figure was correct within hours of the fault and its week was still wrong a day later. Any
value a guard lets through, a downstream accumulator can make permanent.

**And the accumulator was the one energy path nothing could execute.** It lived as a 15-line
string constant inside `build-flow.mjs`. `energyDayBase.mjs` and `arrivalTracker.mjs` had both
already been extracted for exactly this reason; this one had not, and it was carrying a **second
fault nobody had noticed** — the period keys rolled *before* the completed day was folded, so
the day that ended a week was zeroed out of that week and added to the next. Off by one day, on
every device, at every boundary since it shipped. Measured exactly: `mtr_co_yellow`'s weekBase
read 9.720 = Monday's 8.165 + Sunday's 1.555.

**The independent check that says the repair is right:** the four branches now sum to 18.646 kWh
for the week against the building's own separately-derived 18.588 — 0.3 % apart. Before the
repair they summed to 99.546 against the same 18.4, and nothing anywhere compared the two.

### 2026-09-08 — L.O Yellow again, and the guard that was missing

**RM-052.** The operator reported today's energy wrong again on L.O Yellow — *"same scenario as
before"*, and they were right about the shape and it was a different cause. Measured the same
morning:

- **`mtr_lo_yellow` served 77.502 kWh for a day that integrates to 0.302** — 256x, on a circuit
  whose peak was 251 W. 77.5 kWh needs 3.2 kW held for 24 h.
- The day baseline was **correct**. Every meter's base was banked at 0 at local midnight, when
  every counter genuinely read 0. `energy_day_base` confirms it.
- phase28's `capabilities` jsonb — one hour old, and the first time this history has ever
  existed — showed `today_acc_energy2` flat at 77.502 while the circuit drew power.
- The stored series gave the exact moment: **0.111 -> 67.391 at 18:36 while drawing 49.1 W**,
  then 67.398 -> 77.317 ten minutes later. Two discrete register jumps, mid-day.

**The tracker re-anchored on a day rollover and on a counter going BACKWARDS. It had nothing to
say about one going forward implausibly** — which is exactly what this fleet's channel-2 register
does. The baseline was taken before the offset appeared, so `val - base` carried it through.

**AND IT SLIPPED UNDER THE EXISTING BACKSTOP, which is the instructive part.** The SAME physical
meter's channel 1 jumped to **3,676 kWh** the same day, was caught by `max_branch_kwh_per_day`
(100), fell back to the integrated value and read correctly all along — 0.74 against 0.697
integrated. Channel 2's 77.5 is *under* 100, so nothing rejected it. That is precisely the limit
`server/scrubTelemetry.mjs`'s own header states: a bound wide enough to be safe cannot catch a
value that is merely wrong. Only a bound on the RATE can, and the site already declares one.

### 2026-09-07 — every outlet was fabricating its daily energy. Fixed; see RM-047

All seven outlets accrued energy they had not used, every minute, from whenever the `add_ele`
accumulator shipped until this was found. **This is the operator's 2026-09-03 report — "the
energy breakdown in analytics goes wrong" — and it was still live four days later**, found while
sizing EX-166's bounds against real data rather than by anything that was looking for it.
Measured on the live bridge over a three-minute watch with no flow change and no device
connection:

- **co5 drew 0 W for the entire window** while its `energy_kwh_today` rose by exactly 0.0280 kWh
  once every 60 s — its `add_ele` value, stuck at 0.028 and re-added on every poll. That is a
  fabricated 1.68 kW on a socket that is switched off.
- **co1 accrued 1.460 kWh across 2026-09-06, a day it drew 0 W throughout.** 0.001 kWh × 1,440
  polls = 1.44, which is the whole of it.
- **co5 reported 72.427 kWh for 2026-09-06.** Its own power readings over the same day integrate
  to **2.268 kWh**, and its highest power ever recorded is 674 W — 16.2 kWh is the most it could
  physically consume in a day. Overstated 32-fold.

**The mechanism, confirmed at the source.** `dpParserPlan.mjs`'s outlet tail does
`if (fresh.add_ele !== undefined) energy += fresh.add_ele`. That is correct for a device-pushed
`dp-refresh`, where `add_ele` is genuinely "energy since I last told you". It is wrong for the
60 s poll, whose `data` event returns the device's whole retained dp table — including the last
`add_ele` it ever reported. `node-red-contrib-tuya-smart-device` emits **byte-identical message
shapes for both events** (`src/tuya-smart-device.js`: both `send` a bare
`{payload:{data,deviceId,deviceName}}`), so nothing downstream can tell a fresh increment from
its echo. The comment above the line — *"`add_ele` is energy SINCE THE LAST REPORT, so it
accumulates"* — is true of the protocol and false of the transport.

**Why the meters are unaffected:** `cz_ct_single`/`cz_ct_double` carry `today_acc_energy`
(`semantic: 'cumulative_daily'`), which `buildLatest` prefers. Re-reading a cumulative register
is harmless. `pc_outlet` has **no cumulative energy dp at all** — all 17 are switches,
countdowns, coefficients, diagnostics and the one increment — so an outlet has no register to
fall back to and the fix cannot simply mirror the meter path.

**The building total was not affected** (`_totals` is computed from the four CT meters:
11.44 kWh against the outlets' 71.4), so the fault was confined to the per-device breakdown —
which is exactly the surface that was reported as wrong.

**EX-166's scrub does not catch this and says so in its own header.** 72 kWh is inside a 100 kWh
bound; a bound narrow enough to catch it would start discarding real readings. This is fixed
where it is produced.

### 2026-09-03 — the power cycle was performed, and it is the top of this list now

The remedy RM-020 had been waiting months for was carried out, and **it made things worse**.
Measured the same morning from a remote session, on the Pi:

- **4 of 18 devices online** — all four logical meters, and not one outlet or light switch.
- **Only 3 Tuya discovery broadcasters** in a 30 s passive listen on UDP 6666/6667. The other
  fourteen are not on the air, so `find()` has nothing to find and a Node-RED restart cannot
  help — the RM-021 case, not the `l6` stuck-node case. A restart was tried at 11:14 and
  produced **zero** device connections in the following half hour.
- Every one of the fourteen **did** connect earlier the same boot and then dropped — CO4 fifty
  times, CO7 twenty-nine, L7 twenty-five — with 187 recorded disconnects and 12,386 Node-RED log
  lines in 3.6 h.
- **The vendor cloud sees the same flapping**, which is what makes this a network finding rather
  than a bridge one: five devices changed cloud state between two `tuya:devices` runs minutes
  apart. Tuya reaches them over the internet, not our subnet, so nothing in this repository can
  cause it.
- **The AP renumbered its LAN onto a different private /24 across the power cycle.** The Pi kept
  the same host number on both, so this is the router's configuration changing, not the Pi's. Its
  firmware dates from 2020-09-27 and the DHCP lease is 7200 s. That move is the one event
  coincident with the fleet loss and is where the next person should start.

**This is a network job, not a coding one.** See **RM-046**. Two things in this repository made
it noisier. The first is now fixed — discovery retried at a fixed 1 s with no back-off, which
`docs/adr-002-device-recovery-path.md` prescribed and nobody built; see **EX-160**
(`npm run backoff:pi`). The second is fixed too — 650+ `EHOSTUNREACH` to two addresses that
stopped existing when the subnet moved, because a node that has cached an address never returns
to broadcast discovery; see **EX-161** (`npm run stale-address:pi`), whose recovery path is built
and armed but has not yet had a live occurrence to act on.

The same morning's deploy also produced a live data fault, now fixed — see **EX-158**.


This file is long because the reasoning is the point; this section exists so that "what
now" does not require reading all of it. Everything here is expanded below under its own id.

### Everything outstanding, 2026-08-31 — the handoff list

*Superseded in part on 2026-09-01: see the header, and the two flow writes now waiting at the
end of this list. "None of them wait on code" was true of this list and not true of the system.*

Grouped by what each one waits on. Ids link to the entries
below, which carry the evidence.

**A person has to be at the CARE office**
- **RM-020** — `co4`, `co5`, `co6` need power cut and restored. The software remedy was built and
  tried on `co5` and did not work: the device answers ARP, accepts a static address, then refuses
  every TCP connection.
- **RM-021 / RM-012 / RM-013 / RM-018** — devices that need a physical look or a network rejoin.
- **RM-016** — re-pair the IR blaster and the outdoor temperature sensor. Both report
  `online: false` and neither is in the Tuya cloud project. **Their registry `status` still says
  `active`, which claims more than is true.**
- **RM-007** — sign in once on the office kiosk, then power-cycle it to learn whether it comes
  back signed in.
- **RM-033** — `docs/physical-install.md`'s **twelve `〔FILL IN〕` gaps**. Photographs, part
  numbers, breaker way numbers, and institutional answers. **None can be filled by inference**;
  taking the file to the office as a checklist is the intended use.

**An operator decision or action, remotely**
- **RM-006c — arm auto-shed.** Tiers are assigned. Two conditions gate it and **one action fixes
  both**: open Automation *signed in*, turn auto-shed on, and save. Setting the flag in the
  database alone arms nothing, because the shed actor comes from `dsm_thresholds.updated_by`,
  which is null. Read that entry before flipping it — `group_1` is the lighting, ~16 W of a 919 W
  demand against a 2.21 kW ceiling.
- ~~**Build the space tree.**~~ **Already built — this line was stale.** Measured 2026-09-13 with
  the service role: `space_nodes` holds a four-level tree (building, floor, wing, room — all
  created 2026-09-01) and all 14 `device_config` rows carry a `space_node_id`. What it has still
  not been is *seen by a signed-in session*, which remains the only check on the `authenticated`
  SELECT policy that a service-role probe cannot make.
- **RM-026** — join the Deye logger to the device SSID. Nothing can be built or tested until then,
  and this one is **contractual**: Milestone 3, due January 2027.
- **RM-006d** — perform a restore. A backup that has never been restored is not a backup.
- **Repository description and topics** — the description is set; **only 2 of 12 topics landed**.
  `gh` returns 404 because the CLI account has push but not admin. Owner account, web UI.
- **The funder workbook** — `iBEMS-General-Project-Plan.xlsx` was reconciled 2026-08-26 and has
  drifted. `ibems-tracker.html` was brought current on 2026-08-31; the workbook was deliberately
  left alone. Five specific changes are listed in the session notes, the first being that
  Checklist item 16 reads as though aircon control works today while item 7 says the IR needs
  re-pairing.

**Elapsed time**
- **FI-012** — partition `readings` *if* growth ever outgrows the prune. Conditional; not due.
- ~~**FI-011** — push delivery for the monthly report.~~ **Done 2026-09-16.** See its entry.

**The 2026-09-01 control-path work is fully applied** *(EX-133 – EX-144)*
All three flow writes landed and were verified live: the bridge rebuild carrying
`stale_after_ms`, the meter health rewiring, and the outlet poller's skip. Node-RED is bound to
loopback. The end-to-end check is closed — the operator toggled an outlet socket and a light from
the browser and saw no errors, with four `dispatched` / `via=local` audit rows to match. Nothing
from that pass is outstanding.

**Code, and deliberately not done**
- **FI-019** (the bridge on `0.0.0.0:1880`) and **FI-020** (a switch's freshness is
  unmeasurable) were found on 2026-09-01 and recorded rather than fixed — each entry says why.
- ~~**FI-009** is the only other unblocked coding task in the file.~~ **Closed 2026-09-16** after
  reading what it names: `EnergyBreakdownCard` holds no selector any more, and the other two read every
  device because that is what they draw and count. Its entry carries the evidence.

### Do this first, 2026-08-28

**`phase23_plan_coords.sql` is applied and verified live** — see RM-031. The ordering hazard it
carried is spent: `device_config` selects `plan_x,plan_y` and answers 200.

~~**The thing that would unlock the most is still not code: build a tree.**~~ **Stale — corrected
2026-09-13.** The tree exists, and has since 2026-09-01: four nodes from building to room, with
all 14 configured devices placed in it, measured with the service role. What is still unverified
is a signed-in session seeing it, which is the only check on the `authenticated` SELECT policy
that cannot be made from a service-role probe.

### The short version, 2026-08-26

The system is **healthy and honest**: 15/20 devices online, all five services up, ingestion
writing every minute, and the dashboard no longer reports readings it cannot actually observe.
**A counting note, measured 2026-08-31.** The fleet is **20 devices**, not 21. The bridge's
`/api/readings/latest` serves **21 rows** — the twentieth device plus the `_totals` pseudo-row —
and the row count has been read as a device count in several places in this file. `15/21` above
was that error and now reads `15/20`. Dated observations further down (`9/21 to 14/21`) are left
as they were written; EX-076 and EX-085 already say `20 devices` and are the ones that were right.

Three things stand between here and "finished":

1. **Three outlets need a person at the office** (RM-020) — `co4`, `co5`, `co6`. The
   software path was **built and tried on `co5` on 2026-08-26, and it did not work**: the
   device answers ARP, accepted a correct static address, and then refused every TCP connection.
   So all three need power. Membership still moves hourly — re-measure, never memorise — but the
   cheap remedy has now been tested rather than assumed.
2. **Auto-shed is built but inert** until someone says which loads may be shed first (RM-006c).
   This is the largest *finished* feature that does nothing yet, and it is one decision.
3. **The solar inverter is not on the network** (RM-026) — the integration is stubbed and
   cannot be tested until the logger joins the device SSID.

Everything else is small, and the build order below is honest about size.

### Blocked on someone being at the office

| Item | Why it is stuck |
|---|---|
| **RM-020** Power-cycle `co4`–`co6` | **SUPERSEDED 2026-09-03 by RM-042 — the power cycle was performed and it cost the rest of the fleet.** Before: `co4`/`co6` absent from the segment, `co5` on it and refusing every TCP connection after the static-address remedy (RM-021), operator unable to act during office hours. After: 4 of 18 devices online — all four meters, and nothing else. Do not read the rest of this row as current; the three outlets are no longer a separable problem from the other eleven. |
| **RM-007** Kiosk sign-in | Needs one interactive login at the physical screen. `ibems-kiosk` is inactive. |
| **RM-016** IR Blaster + Outside Temp | **Updated 2026-09-17: the IR blaster is re-paired and in the project (RM-114 – RM-121); only Outside Temp remains uninstalled.** Earlier: Re-pairing needs the devices and the Smart Life account. Quiesced meanwhile, so they cost nothing but still cannot report. **Confirmed by the operator 2026-08-31: neither has been set up.** Verified the same day against the live bridge — `acu_main` and `sens_outside_temp` both report `online: false` with no values, so the Climate card shows `—` and the IR card shows "no reading yet", which is the honest rendering. Their registry `status` is still `active`, which claims more than is true; worth revisiting when they are paired rather than churning it twice. |

### Blocked on hardware that is not on the network

| Item | Why it is stuck |
|---|---|
| **RM-026** Deye/Solarman inverter | The logger is **not on the device SSID**. Integration shape **decided: MQTT via a pre-built local bridge** — see the entry. **Re-verified twice on 2026-08-26 and still absent**, now with a census rather than a sweep: every neighbour MAC on the device subnet was diffed against the cloud's own device MACs, and **the only non-Tuya host on the segment is the router**. A UDP logger-discovery broadcast drew **no reply** (every datagram back was the Pi's own probe echoing). Its configured address is in the stick's own AP-mode subnet, which has no route from the Pi. The Node-RED side is a stub — one config node and one register node, wired to nothing — and no Solarman credentials exist, so the vendor-cloud route is not quietly available either. Nothing can be built or tested until the stick is joined to the device SSID. |
| **RM-005** ESP32 AC sniffer | Publishes nothing. The broker is running and the flow subscribes, but a five-minute listen on all topics saw **zero messages** — and this was on the correct 2.4 GHz network, so the old explanation ("the Pi was on 5 GHz") no longer covers it. The ESP32 itself is silent. **Note since EX-131:** the broker is now loopback-only, so reviving this needs a LAN listener with a `password_file` as part of the work — it was never reachable *and* used, so nothing was taken away. |

### Waiting on elapsed time, not on work

- **RM-012** — `l6` is reachable and controllable again; only its one-hour stability window
  is unproven.
- **RM-006d** — a restore has never been *performed*. Configured is not verified. Supabase
  itself is reachable (checked 2026-08-26).

### Waiting on an operator decision

- **RM-006c** — **load-shed tiers.** Thresholds are set and the whole shed path is built,
  tested and audited; it sheds nothing because no device has a tier. Which loads may drop
  first is a judgement about the building, not a technical question.
  **MEASURED 2026-08-31, and it reframes the decision — `npm run shed:profile`.** Over 14 days
  of office hours the building drew **919 W** of metered demand:

  | circuit | avg | share |
  |---|---|---|
  | C.O Yellow (outlets) | 561 W | 61.0% |
  | CARE ACU (aircon) | 305 W | 33.2% |
  | L.O Yellow (outdoor ACU) | 36 W | 4.0% |
  | **L.O Red (lighting)** | **16 W** | **1.8%** |

  - **Everything a relay can switch comes to 29 W — 3.1% of demand.** Auto-shed cannot hold
    this building under a threshold as it is currently instrumented, and planning should say so
    rather than discover it.
  - **The outlet branch draws 561 W and its seven switchable outlets account for 29 W**, so
    **95% of that circuit is on ordinary sockets** and cannot be shed at all. That gap is the
    untracked load the Analytics page already charts (EX-006); this is the first time it has
    been quantified against what shedding can reach.
  - **Lighting is 1.8%.** Shedding lights first — the intuitive order — takes the lights out of
    an occupied office to save about 16 W. It should be the LAST tier, not the first.
  - **The largest controllable load is the aircon at 33%, and it is not on a relay.** It is
    reached by IR setpoint and mode, so it sits outside the shed tiers entirely and is a
    separate lever (the funded plan's own policy floor, RM-027's `acu_min_setpoint_c`).
  - **A tier is PERMISSION, not size.** An outlet averaging 1 W may be 400 W the afternoon
    somebody plugs a kettle in. So tiers are still worth setting — but for what may be dropped,
    not for what is big today.

  **Naming corrected 2026-08-31, and three things deliberately keep the old spelling.** The
  branch meter's display name was `AREC ACU`; the operator confirms the IR-commanded aircon **is
  the CARE ACU** and that it has its own branch circuit, so the display name and the circuit are
  now `CARE ACU`. What did NOT change, each for a reason:
  - **`mtr_arec_acu`**, the device id — every historical `readings` row is keyed by it, and a
    rename orphans two months of real data;
  - **`ctx: 'arec'`**, the flow-context prefix the live Node-RED source tabs write
    (`arec_last_p`, `arec_energy`), which `build-flow.mjs` does not generate — renaming it stops
    collection silently;
  - **`TUYA_NODE_VERSIONS['AREC ACU']`**, keyed on the live tuya node's own `deviceName`. The
    node on the Pi is still called `AREC ACU` (verified against `flows.json`), so renaming the
    key would make `findSettingsDrift` report a node that exists as missing.
  A display name costs nothing to correct; an identity costs the record. Whoever renames the
  Node-RED node one day should change the third of these in the same breath, and leave the first
  two alone forever.

  **AN EDITOR EXISTS NOW — Devices → Load shedding.** The tiers were settable only one device at
  a time, in the per-device metadata panel, with no view of what they added up to; the decision
  this entry calls "the highest-value single one" was one nobody could see the shape of.
  `src/components/devices/LoadShedPanel.tsx` shows every relay-controlled device with its tier,
  saves on choice, and — the part that matters — shows **all three conditions `shedPlan` actually
  applies**, not just the tier: assigned, dispatchable, and currently on. An editor showing only
  the first would let somebody tier a fleet that cannot be commanded and believe the building was
  protected; `inertCount` names that gap out loud.
  *It refuses to offer a tier for anything that cannot be shed, and says why instead.* The aircon
  is the largest controllable load here and has no relay — leaving it silently out of the list
  would read as an oversight, leaving it in would be a lie.
  *`src/lib/shedTiers.ts` is pure and mirrors `server/shedPlan.mjs` rule for rule.* A UI showing a
  different set from the thing that switches power would be worse than no UI, because it would be
  believed.

  **Still the operator's call, and now a better-posed one.** What is needed is not a wattage
  ranking but an answer per device: *what is plugged into co1–co7, and which lighting circuits
  serve areas with daylight?* Three of the seven outlets (`co4`–`co6`) have barely reported in
  two weeks (RM-020), so their averages mean nothing and their tiers should be set on what they
  feed rather than on what they have measured.

### Migrations — all applied

**`supabase/phase47_held_minutes.sql` (FI-027) was applied by the operator on 2026-09-22 at 16:19 and read
back the same afternoon** — see FI-027. `phase45` and `phase46` were applied on 2026-09-22 (RM-117, RM-124).
**`supabase/phase44_recorded_minutes.sql` (RM-073, RM-111) was applied by the operator on 2026-09-17 and
read back the same day** — see RM-073.
**`supabase/phase43_readings_policy_speed.sql` (RM-091a) and `supabase/phase42_bounded_device_energy.sql`
(RM-091) were both applied by the operator on 2026-09-17 and read back the same day** — see those entries.
Every earlier migration is applied, the latest before them
`phase41_totals_rollup_integrated.sql` (RM-087) on 2026-09-16, read back the same day, and
`phase40_report_curve_speed.sql` (RM-086) on 2026-09-15, read back the same day.
`phase27_period_reports.sql` was applied 2026-09-08; `period_reports` holds 80 rows and
`period_building_reports` 4, regenerated at the moment
of applying — which means they were built from the outlet energy AFTER RM-047b's correction
rather than the inflated figures, so August's per-device totals are the corrected ones.

**`supabase/phase31_readings_hourly_time_weighted.sql` was applied 2026-09-07, and the DEPLOYED
function was measured rather than taken on trust.** PostgREST cannot read a function's source,
and calling the rollup for real deletes raw rows — so neither "it exists" nor "run it and see"
was available. Instead the rehearsal's own discriminating fixture was seeded at **2020-01-01**,
decades before this building's oldest reading (2026-08-16), and rolled with a cutoff that could
only select those rows. It returned **`power_w_avg = 700`** — a plain mean gives 340 and an
uncapped weight 927.27, so that single number proves both the weighting and the 300 s cap are
live. Every fixture row and the bucket it produced were then removed, and the cleanup verified:
zero rows before 2021, `readings_hourly` back to empty, oldest real reading unchanged.

**`supabase/phase30_ingestion_scrub.sql` was applied 2026-09-07 and is verified.** The three
columns are present and `updateHealth` is writing them. Worth recording because the deploy order
was the wrong way round and the design absorbed it: the daemon shipped first, detected the
missing columns from PostgREST's own error, said so once in the journal, and kept
`last_success_at` moving — measured 29 s old at the moment the columns did not exist. After the
migration landed the daemon needed a restart to stop downgrading, since it settles that question
once per process; that is the one manual step the design does not remove.

### The first capability write reached hardware — 2026-09-03

`co3`'s child lock was set from the app, locked and then unlocked, and every link was OBSERVED
rather than inferred: validation, an audit row carrying `capability`/`capability_value`, cloud
dispatch, and the new value coming back in the device's next reading both times.
`status=dispatched`, `via=cloud` — as designed, since settings have no LAN route (FI-022).

**The standard-instruction cloud path is now proven against real hardware.** The DP-instruction
path the two CT meter products need is still unobserved; `warn_power` would be the test, and it
arms a live circuit's over-power alarm.

**Two stale-deploy faults surfaced doing it, and neither was in the code.** `ibems-proxy` had
been running since Sep 1 and was still validating with a two-day-old `shared/commands.mjs`, so
the new verb came back `400 invalid_action` and the app rendered it as "This control is
misconfigured". And `dist` had been built 26 seconds before the last edit to
`capabilityWidgets.tsx`, so the kiosk was a revision behind. Both rules are now written into
`docs/pi-session-brief.md` and `CLAUDE.md`: a commit is not a deploy, `server/` and `shared/`
need a daemon restart, `src/` needs a rebuild.

**One claim was corrected by the evidence.** The capability ack said "this device does not
confirm the value back"; `co3` plainly does, in its next reading. The ack is still
`confirmed: false` — acceptance is not confirmation, and the reading is a separate later event —
but the note now says that instead of overclaiming. The relay note is unchanged: a relay
genuinely has no readback on this hardware.

### phase29 is applied and verified — 2026-09-03

**`supabase/phase29_command_capability.sql`** (EX-152) **has run**, checked the same three ways
phase18 was, because "a column exists" and "the migration ran" are different claims:

1. `capability` (text) and `capability_value` (jsonb) are served by PostgREST.
2. Both `comment on column` texts from the file itself come back in the OpenAPI description —
   which is what distinguishes the file having run from a column having appeared somehow.
3. The constraints reject: `commands_action_check` refuses `toggle`,
   `commands_capability_check` refuses `relay_status`, and `commands_capability_shape_check`
   refuses both a relay command carrying a capability and a `set` with no value. The positive
   half was proved without writing anything — a well-formed `set` + `child_lock` + `true` row
   cleared every CHECK and was stopped only by `commands_requested_by_fkey`, having been
   addressed to a user id that cannot exist. That foreign key was the backstop on every probe,
   so none of them could land: 0 rows written, 146 commands on record before and after.

**Capability writes are therefore live.** The dispatch gate was already open, so the child-lock
toggle and the alarm-threshold slider now reach real devices — through the vendor cloud only,
until FI-022 gives settings a LAN route. No capability command has been sent yet
(`action=set` rows: 0).

### The migration that was outstanding is applied

**`supabase/phase18_command_via.sql`** (EX-101) **has run.** This section previously said it
was still to be applied by hand; that was stale. Checked 2026-08-26 evening: the `via` column
exists, the migration's own `comment on column` text is served in the PostgREST OpenAPI
description — which is what distinguishes "the file ran" from "a column appeared somehow" — and
the newest command rows carry `via=local` while older ones are `NULL`, exactly as that
comment predicts.

So *which devices needed the cloud fallback this week* is now an answerable question, and the
first answer is a reassuring one: of the commands on record, the three dispatched since the
column landed all went **local**, with no cloud fallbacks.

### Build order — what to do next, largest value first

1. **RM-006c: the tiers are assigned; two things still gate auto-shed, and they share one fix.**
   All 14 shed-capable devices were classified on 2026-08-31 — lights as `group_1`, outlets split
   across `group_2`/`group_3` — so the classification gap is closed. What remains is **not just
   the `auto_shed` flag**: `server/scheduler.mjs` takes its shed actor from
   `dsm_thresholds.updated_by`, and `planShed` returns idle without one. That column is **null on
   the live row**, because the thresholds were written as the service role. So setting `auto_shed`
   directly in the database would arm nothing.
   **Both are fixed by the same action: open the Automation page signed in, turn auto-shed on, and
   save.** That stamps `updated_by` with a real user and sets the flag in one write. This is a
   property to rely on rather than a bug — a load-shed row is the last one anyone would want
   traced to an invented user.
   *Worth knowing before flipping it:* `group_1` is the lighting, ~16 W of a 919 W office-hours
   demand against a 2.21 kW ceiling, so the first shed step is the most visible action available
   and close to the least effective one. The tiers are editable on the Devices page.
2. ~~**FI-008 (S)** — a contrast regression guard.~~ **Done 2026-08-31**, and it found a real
   latent AA failure on its first run. See its entry.
3. ~~**FI-006 (S)** — wire `StaleDataBadge` into the views that still derive staleness inline.~~
   **Done 2026-08-31.** It was not a badge problem: four components read `_totals` and none
   applied the expiry rule, so the Overview's headline kW and the DSM breach flag were both
   drawn from whatever row was last in the store. See its entry.
   **Worth more since EX-107**: timestamps are now honest, so a staleness badge finally means
   something on metered devices instead of being permanently fresh.
4. **EX-096 device removal, end to end** — never run against a real device, because nothing
   has been enrolled yet. The first enrolment is also the first real test of the `switch` path
   fixed in EX-094.
5. ~~**FI-011 (S)** — push the monthly report through the alert channel EX-103 already built.~~
   **Done 2026-09-16.** See its entry: monthly only, and the wording keeps the page's rules.
6. ~~**FI-009 (S)** — narrow the three remaining whole-map store selectors.~~ **Closed 2026-09-16,
   not done:** the selectors it names are either gone or reading every device by design. See its entry.
7. **RM-026 Deye** — as soon as the logger is on the network; see its entry for the decision
   between the two integration shapes. Re-verified absent 2026-08-26 evening.
8. ~~**RM-027 (M)** — site identity.~~ **DONE 2026-08-27**: applied, deployed, verified live.
   Next in Track B is **RM-028**, the space tree.

**Track B — replication (RM-027 – RM-034), added 2026-08-26.** Everything above is this site;
Track B is every other site. It is listed after the small items because none of it is urgent,
and **before** it would once have been, because the argument that held it back has weakened.

That argument was "only worth starting once the first site is boring", and it was right when the
first site was on fire. It is now the wrong test: most of what remains here is blocked on a
person being at the office, on hardware joining a network, or on a week of elapsed time — none of
which is unblocked by waiting. Track B is the largest thing that can be worked on *while* those
resolve. It is also Milestone 6 of the funded project, due June 2027, and it is the deliverable
the whole thing was funded to produce.

FI-002 and FI-003 have not been dropped; they are RM-033, and they are last in the track because
they need the four schema steps before them to mean anything.

**Deliberately not doing:** the one-click bridge restart deferred from EX-100. It needs a
`sudoers` entry that would let any authenticated app user bounce the bridge, and the two
reasons to want it have both weakened — the fleet-drop alert now reports the drop, and the
Wi-Fi fallback that caused the worst outage is corrected automatically by EX-106.

### Worth knowing about the system's reach

**Local device control does not depend on the internet, and now neither does commanding it.**
The Tuya fleet is on the Pi's own segment and answers local keys; dispatch has always preferred
that path. Until 2026-08-26 the *audit* step did depend on the internet, which meant an outage
removed every control in the building — see **EX-130**. Sessions are now verified offline
against a cached public key and commands are recorded to a durable local buffer, with both
safety properties intact. Break-glass sessions remain view-only.

### The standing hazard

**RM-013** (devices leave the network and rejoin) is the root cause behind RM-020, RM-021,
RM-018 and much of RM-012. It is not closed and may not be closeable from this side — see its
entry for what was measured and what was ruled out. Two pieces of evidence sharpen it:
the six outlets did **not** drop together but fell away one at a time across a whole day; and
on 2026-08-26 the access point dropped its DHCP lease outright, taking the Pi with it. So the
hazard has two faces — devices leaving, and **the AP itself faltering** — and only the second
now has a guard (EX-106).

---

## 1. Existing features (verified)

Every entry below was confirmed by opening the cited path. Grouped by domain.

### Frontend — pages & shell

- [x] **EX-001** Hash-routed SPA shell with five pages, skip link, and per-route focus/scroll/title handling — `src/App.tsx`, `src/lib/useHashRoute.ts`, `src/components/layout/AppShell.tsx`
- [x] **EX-002** Shared page header with consistent action alignment across all five pages — `src/components/layout/PageHeader.tsx`
- [x] **EX-003** Overview as a bento grid: live demand, energy breakdown, device status counts, main-panel health, climate diagnostics, energy flow, next-up schedule — `src/components/overview/`
- [x] **EX-004** 3D office scene with an editable furniture/device layout, tokenised materials — `src/components/scene3d/`, `src/components/overview/SpatialView.tsx`
- [x] **EX-005** 2D floor plan view — `src/components/floorplan/FloorPlanView.tsx`
- [x] **EX-006** Analytics with 24h bridge history plus 7d/30d from Supabase, per-source cards, untracked-load comparison — `src/components/analytics/`
- [x] **EX-014** Error boundaries around the shell and each routed page, so a render fault cannot leave the kiosk on a blank screen with nobody on site — `src/components/common/ErrorBoundary.tsx`
- [x] **EX-015** One shared wall-clock tick for the whole app, replacing five independent 1s intervals; exactly one `setInterval` remains in the frontend — `src/lib/useNowTick.ts`
- [x] **EX-016** Number formatting with the "missing renders `—`, never 0" rule in one place, including `shareOfTotal` — `src/lib/format.ts`
- [x] **EX-007** Control page: lighting matrix, outlet plan with per-socket pucks, switch/outlet lists, IR command centre, session command log — `src/components/control/`
- [x] **EX-008** Devices fleet table with per-device comm state and metadata editing — `src/components/devices/DevicesView.tsx`, `src/components/devices/DeviceMetaEditor.tsx`
- [x] **EX-009** Automation page: Supabase-backed schedules and DSM thresholds — `src/components/automation/`
- [x] **EX-010** Weather cards from Open-Meteo (no API key) — `src/components/weather/`
- [x] **EX-011** Alerts bell merging staleness watchdog and anomaly alerts under one acknowledge set — `src/components/layout/AlertsPopover.tsx`
- [x] **EX-012** Manual dark theme with WCAG-checked token overrides — `src/index.css`, `src/stores/themeStore.ts`
- [x] **EX-028b** `GET /api/tuya/devices` on the proxy — the cloud’s view of the fleet
      without needing SSH, and the server-side surface the enrolment wizard needs (Part B),
      built once. **The card that rendered it on the Devices page was removed 2026-08-25** at
      the operator’s request: it restated what the fleet table already showed and spent a
      screen of prose doing so. The endpoint stays — the wizard’s device picker and its
      `claimed` flag are its real consumers, and `npm run tuya:devices` still prints it.
      `TUYA_ACCESS_SECRET` never leaves the proxy process: `server/tuyaFleet.mjs` copies fields
      in by **allowlist**, so a credential Tuya adds in a future API version is dropped by
      default rather than forwarded by default, and `assertNoSecrets` then throws on anything
      credential-shaped rather than stripping it — quietly filtering would hide a wrong edit to
      the allowlist until it resurfaced elsewhere. A deployment with no credentials gets 501 and
      the wizard says so plainly instead of half-working: not configured is not the same as broken.
      **Deliberately not joined per device, and deliberately not counted against the local
      total.** The registry carries no Tuya id, so the only sound join key does not exist on the
      frontend yet; and comparing the two counts instead is unsound, because several registry
      devices are two logical readers of one physical meter and two flow nodes have no cloud
      device at all. That exact mistake was made once already and produced a confident, empty
      verdict. Carrying the Tuya id into the registry is what makes the per-device join possible
      — which is FI-001's table —
      `server/tuyaFleet.mjs`, `src/lib/tuyaFleet.ts`
- [x] **EX-091** `fetchJson` call sites are checked by a test, not by review. `fetchJson` owns
      the base address (`BRIDGE_HTTP_URL`, which already ends in `/api`), so callers must pass a
      bare path. Both possible ways to get that wrong had shipped: `tuyaFleet.ts` passed a full
      URL and produced `/apihttp://…/api/tuya/devices`, which missed every proxy route, fell
      through to Node-RED and surfaced as **“The vendor cloud could not be reached”** — reading
      as a credentials or network fault for as long as the card existed; `enroll.ts` passed
      `/api/enroll` and produced `/api/api/enroll`, so the endpoint was never reachable at all.
      Neither is a type error and both survive a green suite, because the mistake is inside a
      string. The guard greps every call site and was confirmed to fail on the reintroduced bug
      before being kept — `src/lib/bridgeClientPaths.test.ts`
- [x] **EX-092** The Control page’s dispatch state moved from a page banner onto the cards it
      constrains. The banner was removed 2026-08-25 at the operator’s request: with all three
      classes dispatching it only ever read “every command on this page switches real hardware”,
      a paragraph announcing the absence of a problem. `SimulatedBadge` already carried the same
      fact per card and is strictly more precise, so `flagSimulated` dropped its `partial`-only
      gate and `SwitchesListCard` gained the badge slot outlets and the ACU already had. **The
      closed state is the one that needed care** — the banner used to own it alone, so removing
      it naively would have left a fully-closed gate with no signal anywhere; every card is now
      flagged instead of none. `dispatchScopeMessage` and its tests went with it.
      The companion “N devices are not shown here” note went too: all five it named are meters,
      the ACU and a sensor — classes that inherently have no control function — so it asked the
      operator to go fix a setting that was already correct.
      `src/components/control/SimulatedBadge.tsx`, `src/components/control/dispatchScope.ts`
- [x] **EX-093** The enrolment wizard says when it does not know what is already enrolled,
      instead of implying nothing is. `GET /api/tuya/devices` derives `claimed` by reading the
      live flow, which needs `NODE_RED_ADMIN_USER/PASS` — credentials the Tuya call itself does
      not use, so that read fails independently. It was wrapped in an **empty catch**, and on
      failure every `claimed` came back false, which is indistinguishable from an empty flow.
      Found on the Pi 2026-08-25: those two keys were in the repo-root `.env` but not in
      `server/.env`, which is the only file the unit loads (`EnvironmentFile=`). The endpoint
      returned all devices as unclaimed and the wizard offered **all 19 already-enrolled**
      devices as available — a wrong list that looks right, and the worst possible shape for
      this bug, because enrolment is the one screen where the list *is* the information.
      Fixed on the Pi, and now: the catch logs, the response carries `claimed_known`, and the
      wizard states the uncertainty rather than rendering a confident count.
      **`server/.env.example` gained the Tuya and Node-RED admin sections it never had**, so
      a rebuild cannot silently drop a key again — the root `.env.example` had described these
      as deploy-script-only, which stopped being true when the proxy began reading the flow.
      `server/.env.example`, `server/proxy.mjs`, `src/lib/tuyaFleet.ts`,
      `src/components/devices/EnrollWizard.tsx`
- [x] **EX-094** Two defects that made enrolment quietly wrong, both found 2026-08-25 by
      comparing the generated nodes against `live-flow-baseline.json` rather than against the
      tests — which had encoded one of them.
      **1. Only one output port was wired.** A `tuya-smart-device` in `event-both` mode emits
      data on port 1 and status on port 2, and every real node in the flow wires both to the
      same target. The planner wired port 1 alone, so `CONNECTED`/`DISCONNECTED` never reached
      the parser — its health branch could only ever set `isOnline` true via `else if (dps)`,
      and an enrolled device would come online once and never go offline again. That is the
      frozen-value class of failure this project has already paid for repeatedly.
      `test/enroll-plan.test.mjs` asserted the single-port shape, so the suite defended it.
      **2. `switch` was offered but unenrollable.** `ENROLLABLE_CLASSES` has always listed it
      and the wizard has always shown it, but `registryEntryFor` sets `ctx: null` for a light
      — correctly, since a light has no metering context — and the planner refused any entry
      without one. The form validated, then the plan step refused. Lights are 7 of 19 devices
      and the likeliest class to add, so this was the half of enrolment most likely to be used.
      Fixed with a light path in the planner: device -> `change` node tagging `msg.lightId` ->
      the existing shared `Collect status` function, which is **wired into, never modified**,
      so the additive invariants still hold. The light number is derived from the trailing
      digits of the device id, the same source `state_key` comes from, so the two cannot
      disagree; enrolment is refused outright when the collector is absent, rather than
      writing a wire to nothing.
      `node-red-bridge/enrollPlan.mjs`, `test/enroll-plan.test.mjs`
- [x] **EX-095** `planRemoval` / `validateRemovalPlan` — the mirror of enrolment, as pure
      functions. Removal invariants are the inverse of enrolment ones and need their own care:
      a subtractive write has a failure mode an additive one does not, because taking out a
      node that something still wires TO leaves a dangling reference which Node-RED **accepts**.
      The flow then loads and routes into nothing, reading as a dead device rather than a bad
      edit — so wires to removed nodes are cleaned, and the invariants reject any that are not.
      Node ids are derived rather than searched for: a `deviceName` is editable in the Node-RED
      editor, and matching on one would eventually remove the wrong node. The class is never
      consulted — every id enrolment could have created is listed and filtered by what is
      actually present, so removal cannot miss a companion by misreading the class. The
      strongest test is a round trip: enrol-then-remove is asserted to be the identity function
      on the flow, for a metered device and a lighting circuit alike.
      `node-red-bridge/enrollPlan.mjs`, `test/removal-plan.test.mjs`
- [x] **EX-096** Device removal, end to end — the other half of "add and remove devices", and
      the mirror of enrolment at every layer: `validateRemoval` beside `validateEnrollment`,
      `removeService.mjs` beside `enrollService.mjs`, `POST /api/remove` beside
      `POST /api/enroll`, `npm run remove:pi` beside `npm run enroll:pi`, and a Remove button
      beside Edit on each fleet row.
      **The write order is reversed, deliberately.** Enrolment writes the registry first, so a
      failed flow write leaves a device the app knows about but nothing polls — visible as NO
      DATA and fixed by re-running. Removal writes the FLOW first, which is the same rule read
      backwards: a failed registry write again leaves a device listed but not polled. The other
      order would leave hardware polled that nothing displays, and that is the state nobody
      notices. A test asserts the registry is untouched when the flow write fails.
      **Only enrolled devices are offered.** The built-in ones are hand-written in
      `registry.mjs`; a script editing hand-written source is what the separate generated
      module exists to avoid. Refusing one says "built-in", never "not found" — the two have
      different fixes, and the wrong word sends someone hunting a bug that is not there. No
      button is rendered at all for a built-in, rather than a disabled one that invites the
      click and then explains itself.
      **History survives and the UI says so.** `readings` is keyed by `device_id`, not by a
      foreign key into the registry, so removal deletes the device and keeps everything it
      measured. That is the question someone hesitating over this button actually has, so it
      is answered in the panel rather than left to be inferred.
      The panel previews on open rather than behind a button — there is one input, the row you
      clicked, so there is nothing to fill in first — and names the flow nodes that would go
      rather than counting them: a count answers "is this plausible", the names answer "is this
      the right device", which is the question that matters when the other side is real
      hardware. Applying stays behind its own confirm.
      `server/removeService.mjs`, `server/removeRoute.mjs`, `shared/enrollment.mjs`,
      `src/lib/removeDevice.ts`, `src/components/devices/RemoveDevicePanel.tsx`,
      `node-red-bridge/remove-device.mjs`
- [x] **EX-097** The aircon and the outside-temp sensor no longer report a fabricated ONLINE.
      `buildLatest` derived `online` from real evidence for meters (`src.h`) and, since the
      `lightStatus` work, for switches — but everything else fell through to a hardcoded
      `r.online = true`. That covered exactly the two devices fed by `ac_dash_state`:
      `acu_main` and `sens_outside_temp`.
      **It was live, not hypothetical.** On 2026-08-25 `journalctl -u nodered` showed the
      `NBRIC IR Blaster` and `Outside Temp` nodes in a permanent 10-second `find() timed out`
      retry loop — they are not in the Tuya cloud project and have never once connected
      (RM-016) — while `/api/readings/latest` reported both devices `online: true` carrying no
      measurement at all: `state: null`, no `temp_c`, no `room_temp_c`. A fabricated online is
      worse than a stale reading, because a stale one at least happened once.
      **The first version of this fix was wrong, and its tests passed anyway.** It checked
      `Object.keys(ac).length > 0`, on the assumption that a dead blaster leaves
      `ac_dash_state` empty. The mock populates it in full, so the assumption held in the
      suite and the fix shipped green — and changed nothing in production. Reading the live
      context off the Pi through the Node-RED admin API showed why: the flow seeds a
      **placeholder** rather than leaving it empty —
      `{power:"OFFLINE", setTemp:"--", roomTemp:"--", humidity:"--", outTemp:"--"}`.
      Every key is present, so key-presence was always going to say ONLINE.
      The rule is now "carries at least one real measurement": `num()` rejects `"--"` and
      `"OFFLINE"` and accepts `"25.4"`, so the placeholder reads offline and a real poll reads
      online, with no magic string to keep in sync. Any single field suffices — the blaster
      sends temperature and humidity on separate DPS, so demanding all of them would report a
      half-working device as dead. The empty-object case is still covered by the same test.
      The regression test now uses the exact object read off the live Pi, not an invented one.
      This is the same move the `switch` branch made when `lightStatus` turned out to be
      readable — except that branch stayed optimistic on a missing health map, because it
      really could mean an older flow. Here a placeholder is a positive statement that nothing
      has reported, so this one fails closed.
      `shared/buildLatest.mjs`, `test/contract.test.mjs`
      **Live on the Pi 2026-08-25.** `buildLatest.mjs` is inlined into the generated flow, so
      this needed `build:flow` plus a forced `deploy:pi`. Verified by reading the live flow
      back: the running `Build latest readings` node carries the new assignment, and both
      `acu_main` and `sens_outside_temp` now report `online: false`. Fleet online went 14 -> 12,
      which is exactly the two fabricated values disappearing and nothing else.
      Getting it deployed took two attempts, and the first failure is why EX-099 exists.
- [x] **EX-098** `npm run quiesce:pi` — stops a permanently unreachable tuya node retrying
      forever, without removing it. `NBRIC IR Blaster` and `Outside Temp` each call
      `findDevice()` every ~10 s in perpetuity, filling the Node-RED log with `find() timed
      out` and holding a discovery listen slot open for hardware that will never answer.
      Flips `disableAutoStart`, a field already present on every node in the flow, so this
      changes a value rather than introducing one. **Reversible** via `--undo`, which is what
      you want the moment either device is re-paired — nothing else has to be put back.
      **The invariants are strict because the target is.** These nodes live on the four
      hand-built source tabs that `build-flow.mjs` does not generate and nothing in the repo
      can restore. `findTimeout` and `tuyaVersion` exist ONLY there, and losing them presents
      as every device going offline — which reads as a network fault and has already cost days.
      So `validateQuiescePlan` asserts exactly one boolean changes on exactly the named nodes:
      a modified node that was not named is refused, a named node modified beyond
      `disableAutoStart` is refused, and any change in node count is refused. The undo path is
      checked by the same invariants with before/after swapped. Re-running is provably a no-op
      — the plan returns the original object rather than a copy when a node is already quiet.
      `node-red-bridge/quiescePlan.mjs`, `node-red-bridge/quiesce-dead-nodes.mjs`,
      `test/quiesce-plan.test.mjs`
- [x] **EX-099** `deploy:pi` compares the deployed bridge tab CONTENTS, not just its id.
      "Already deployed" was decided from the bridge tab id being present and nothing else, so
      a regenerated `bridge-flow.json` printed **"Nothing to do"** and exited **0** — which
      reads exactly like success. It silently skipped the EX-097 aircon fix on 2026-08-25:
      the operator ran the deploy, saw a benign message, reported it applied, and the live
      flow was still running the superseded rule. It was caught only by reading the live flow
      back through the admin API and diffing the two `r.online` assignments by hand. Every
      future flow change would have been skipped the same way.
      Now a content signature decides it, and a mismatch exits **1** with the exact command to
      fix it — verified against the real stale flow on the Pi, message and exit code both.
      The signature **deliberately ignores node ids and canvas coordinates**: `build-flow.mjs`
      numbers nodes sequentially and does not promise stability across a re-run, so including
      them would report drift on every regeneration and make `--force` the reflex. A check
      that always fires is the same failure wearing the opposite mask — both end with nobody
      reading the message. Wire *targets* are ids too, so only their count is compared; a pure
      rewiring would slip past, which is accepted because `build-flow.mjs` derives topology
      from the registry and a real topology change arrives with a node change beside it.
      `node-red-bridge/bridgeSignature.mjs`, `node-red-bridge/deploy.mjs`,
      `test/bridge-signature.test.mjs`
- [x] **EX-100** The alerts bell reports a *fleet* drop, and names the remedy.
      Per-device COMM FAULT rows already said what was down; nothing said what to do, and on
      2026-08-25 what to do was cheap and remote — a Node-RED restart recovered five devices,
      one of which (`l6`) had a written diagnosis calling it an RF/hardware fault that needed
      eyes on the fixture. Eight separate COMM FAULTs also read as eight problems when they
      are usually one, so the fleet row is listed first and reframes the rows beneath it.
      **The hard part is not counting offline devices, it is not crying wolf.** Two devices
      here are offline permanently by design (the quiesced IR blaster and outside-temp
      sensor), and counting them would hold the alert on forever — which is how a warning
      becomes furniture. `fleetStuck` splits on `online_samples`: a device seen up at any
      point in the 24h window CAN be up, so its being down now is a change; one never up in
      the window is not news and no restart will alter it. Evidence, not an exclusion list —
      a hardcoded list of "expected offline" ids would go stale the first time one recovered.
      Threshold is three simultaneous drops: one device is RM-013 being RM-013, and firing on
      that would mean firing most days.
      `src/lib/deviceConnectivity.ts`, `src/components/layout/AlertsPopover.tsx`

      **The one-click restart button was deliberately NOT shipped with it.** The proxy runs
      unprivileged, so a `POST /api/bridge/restart` needs a `sudoers` NOPASSWD entry, which
      would let any authenticated app user bounce the bridge. That may still be worth it —
      RM-018 alternative is a walk to a breaker — but the detection should be seen to be
      right before the privilege is granted, and there is now a second route that needs no
      privilege at all: Claude runs on the Pi (`docs/pi-session-brief.md`) and is authorised
      to restart services there. Revisit once the alert has been observed firing correctly.
- [x] **EX-101** How a command reached the hardware is now recorded and shown.
      `dispatchCommand` has always returned `via` — local, cloud or none — but it was folded
      into the audit row free-text `note` and nowhere else. That made the most operationally
      useful signal in the table unqueryable: you could not ask *which devices have needed
      the cloud fallback this week*, which is the question that identifies a device going bad
      **before** it goes dark.
      **Why it matters more than it looks:** a cloud-recovered command SUCCEEDS. The relay
      moves, the operator sees an ordinary confirmation — and the device has stopped
      answering on the LAN. Nothing distinguished that from a healthy command.
      Three places, one fact: `supabase/phase18_command_via.sql` adds the column (nullable,
      no backfill — a row written earlier genuinely does not know its path, and NULL says so
      where a guess would not; also distinct from `none`, which positively claims both paths
      were tried and both failed); the ack carries `via` so the page can react; and the alerts
      bell raises a row naming the device. The CHECK is narrow where `status` two columns over
      is deliberately free text — `via` is a closed set defined by the dispatch code, so a
      value outside it means the two have drifted, which is the thing worth catching. A test
      reads the literals out of `dispatchLight.mjs` rather than restating them.
      The recovery is held in `commandStore`, not the session command log, because a store
      must not import upwards from `components/control` — and because the bell already reads
      stores and owns acknowledgement, which is where a fault belongs.
      **Deployment order deliberately does not matter.** The migration is applied by hand, so
      there is a window where the code is live and the column is not — and PostgREST rejects
      an UPDATE naming an unknown column, which would have failed the outcome patch for EVERY
      command and left rows stuck at `dispatching`: the audit trail degrading quietly in order
      to add a nicety. The patch retries once without `via`, matched narrowly so a genuine
      outage still surfaces as an unrecorded outcome instead of being masked by a retry that
      drops a field and calls it success. A runbook note would have had to be read at exactly
      the right moment; this does not.
      **THE MIGRATION HAS RUN — verified 2026-08-26 evening.** §0 carried it as outstanding
      for longer than it actually was. Three pieces of evidence, because "the column exists" on
      its own would not distinguish the file having run from a column arriving some other way:
      the `via` column is present; the migration's own `comment on column` text is served
      verbatim in the PostgREST OpenAPI description, and only that file writes it; and the
      newest command rows carry `via=local` while everything older is `NULL`, which is
      precisely the boundary the comment describes.
      So the tolerate-a-missing-column retry above is now dead weight in the happy path. **Leave
      it there** — it is the guard for a rebuilt database or a second site, which is exactly the
      window it was written for, and it costs nothing until then.
      *First reading of the diagnostic this unblocked:* every command dispatched since the
      column landed went **local**, with no cloud fallbacks. Nothing to act on, which is the
      answer you want from a health query.
      `supabase/phase18_command_via.sql`, `server/auditedDispatch.mjs`, `server/proxy.mjs`,
      `src/stores/commandStore.ts`, `src/components/layout/AlertsPopover.tsx`
- [x] **EX-102** (FI-010) The 24h chart stops drawing a device that was not reporting.
      Every meter last known wattage is carried forward into each sample — that is what "last
      known reading" means — so a device offline all day filled the chart with a confident
      flat line. The 7d/30d charts lost that blindness earlier and the aircon ONLINE flag lost
      it on 2026-08-25; this is the same fix one layer down, where the samples are written.
      **One line in each of two places, because both halves have to agree.** The bridge ring
      buffer records `online` on each point, *conditionally* — a point from a bridge that
      never reported it has no flag, and that is unknown, not false. `pointValue` then
      suppresses a point only when the flag is explicitly `false`. Assuming the absent case
      either way would fabricate exactly what this set out to stop: assume online and the flat
      line returns; assume offline and real history is erased in the name of honesty.
      Fixed in `pointValue` rather than per chart because that is the single place a point
      becomes a plotted number, and every consumer already reads `undefined` as a gap.
      The contract tests were confirmed to fail with the generator change neutered.
      `node-red-bridge/build-flow.mjs`, `src/components/analytics/chartParams.ts`,
      `src/lib/types.ts`, `test/contract.test.mjs`
- [x] **EX-103** (FI-005) Alerts that leave the dashboard.
      A multi-hour outage went unnoticed because the only place it would have surfaced was a
      screen nobody was looking at. On 2026-08-25 six of seven outlets went off the network
      while the operator was at home, and nothing said so.
      **Edge-triggered, and that is the entire design.** The ingest daemon ticks every 60 s,
      so a level check would re-send the same notification every minute — six outlets down
      overnight is 480 messages, and the first thing anyone does with that is mute the
      channel, which is strictly worse than no alerting at all. `createFleetAlarm` returns an
      event only on a transition: once entering the state, once leaving it.
      It tracks which devices it has seen online, for the same reason `fleetStuck` splits on
      `online_samples` — the two permanently quiesced devices would otherwise trip the alarm
      at startup and hold it there forever. A device MISSING from a tick is not counted as
      down either: absence is a gap in the feed, and inferring failure from silence is how a
      bridge hiccup becomes a fleet alarm. And the alarm is only consulted on a cycle that
      actually reached the bridge — during a bridge outage we have no idea what the devices
      are doing, and reporting that as "every device dropped" would be the loudest possible
      way to be wrong.
      **ntfy, because this repository is public.** FI-011 rejected email and Sheets delivery
      precisely because a credential for either would sit in a file beside a public checkout.
      ntfy needs no account and no OAuth: the only secret is a topic name, and someone who
      guesses it can read notifications but cannot act on the building. Unset `NTFY_TOPIC` is
      a supported state, not an error — and it stays silent about being unset, or the journal
      would gain a line every time the fleet changed state on a site that never wanted this.
      Every send failure is caught: the daemon exists to record the building electricity, and
      being unable to push a notification about that is not a reason to stop.
      The message names the remedy, like the bell does — a notification that only says
      "something is wrong" costs a trip to the office.
      `server/fleetAlarm.mjs`, `server/notify.mjs`, `server/ingest.mjs`,
      `server/ingestCycle.mjs`, `server/.env.example`

      **Needs a flow deploy to take effect** — the ring buffer lives in the generated flow, so
      `build:flow` plus `deploy:pi --force --apply`. Until then no point carries the flag and
      the chart behaves exactly as before, which is the correct degradation rather than a bug.
- [x] **EX-040b** In-page enrolment wizard — the Devices page's "+ Add device" is real. Picks a
      vendor device the flow does not already poll, takes an id/class/name/room, previews, then
      enrols.
      **Validation runs client-side through the same `validateEnrollment` the server calls**, so
      the feedback while typing is the answer submit will give rather than an approximation. A
      form that accepts input the backend then rejects teaches people to ignore it.
      **Preview and apply hit the same endpoint**, differing only by a flag, so the preview
      cannot drift from the path that writes — and the preview exists precisely to be trusted.
      Enrol stays disabled until a preview has actually succeeded.
      *One bug found while building it:* the wizard first filtered candidates on
      `device.tuya_device_id`, a field `Device` does not carry — the browser has no way to know
      which vendor id backs which registry device. `claimed` is now derived server-side, where
      the flow can actually be read, and marked rather than filtered so "already enrolled" stays
      distinguishable from "not in the project".
      The local key is never sent to the browser; the summary carries its length —
      `src/components/devices/EnrollWizard.tsx`, `server/enrollRoute.mjs`,
      `server/enrollService.mjs`
- [x] **EX-041b** Enrolment logic exists once. `server/enrollService.mjs` is called by both the
      CLI and `POST /api/enroll`; two implementations would eventually disagree about validation
      or about what happens when the second write fails, and the symptom would be a device that
      half exists. Every dependency is injected, so the whole path is tested without a cloud, a
      Pi, or a filesystem — including the 409 case, which reports that the registry entry was
      already written so re-running is safe rather than looking like corruption.
      The endpoint is authenticated like every other route but deliberately **not** behind
      `HARDWARE_DISPATCH_ENABLED`: that gate governs moving a relay, and enrolling moves
      nothing. Conflating them would mean a site that has not opened dispatch could never add a
      device — backwards, since you enrol before you switch — `server/enrollService.test.mjs`
- [x] **EX-039b** Device enrolment — registry entry and flow nodes generated from one validated
      decision, with the local key fetched from the vendor cloud rather than copied between
      browser tabs. That manual step is most of what made FI-001 an L. The key never reaches a
      terminal; only its length is printed.
      A device is only real once **both** halves exist. Writing only one fails quietly: a device
      the app shows that never reports, or hardware the flow polls that nothing displays. The
      registry is written first deliberately — if the flow write then fails, the app shows a
      device that does not report yet, which is visible and recoverable; the reverse is not.
      `registry.mjs` now merges a generated data module rather than reading JSON at runtime
      (which would put `fs` in a module the frontend's own test imports) or being edited by a
      script. Built-in devices stay first so enrolling one cannot reorder a list that several
      places key off implicitly.
      Validation **refuses rather than guesses**, because a bad enrolment fails weeks later as a
      device reading offline forever — indistinguishable from a network fault. It refuses a
      vendor device already enrolled, one the cloud cannot see, an id that would not survive as
      a context key, and a protocol version the cloud did not report.
      *Deliberately not enrollable:* `meter` and `acu_ir`. A meter's identity is a logical
      channel chosen by which CT clamp sits on which circuit — an electrical decision a wizard
      cannot validate — and the ACU's IR command set is bespoke.
      The parser is generated from a template so a new device cannot get subtly different
      online-detection from its neighbours, carries the settings this project measured rather
      than library defaults, and stamps `_last_time` only when data actually arrived —
      `shared/enrollment.mjs`, `node-red-bridge/enrollPlan.mjs`, `npm run enroll:pi`
- [x] **EX-037b** Duplicate device sessions collapsed: 21 tuya nodes -> 19, one session per
      physical device. Two nodes carrying the same `deviceId` each held a TCP session to one
      device — the dual-channel yellow meter and the branch meter measuring the aircon. Halves
      the socket pressure on both, and exhausting that table is what leaves a device answering
      the cloud but not the LAN. Applied via a dry-run-by-default patch script whose plan is a
      pure function, so the dry run and the apply cannot drift —
      `node-red-bridge/sessionCollapsePlan.mjs`, `npm run collapse-sessions:pi`
- [x] **EX-038b** Outlets are polled every 60 s. Nothing in the flow had ever asked an outlet
      for its state, so a reading only advanced when the device happened to report a change.
      Because `readings` is keyed `(device_id, ts)` and ingestion upserts, a stalled timestamp
      overwrote its own row rather than adding one — `co1` recorded 40 samples against a
      switch's 60 in the same hour, and every per-outlet figure downstream inherited that.
      Verified after applying: outlet timestamps now advance within the poll cadence, where
      `co1` had been stalling 15+ minutes. This patch only ADDS nodes, and validation asserts
      every pre-existing node is byte-identical afterwards — an accidental rewire on a tab
      carrying live control logic would be far harder to spot than a missing node —
      `node-red-bridge/outletPollPlan.mjs`, `npm run poll-outlets:pi`
- [x] **EX-036b** Vendor-cloud dispatch as a **fallback**, tried only after a local command has
      failed. Solves the reported hang: a device whose inbound socket table is exhausted stops
      answering on the LAN while its outbound cloud connection stays healthy, which previously
      meant walking to a breaker. Local remains primary and the cloud is never reached when
      local succeeded — a test pins that ordering, because a control system that quietly started
      routing through a vendor would be a worse outcome than the hang it fixes.
      Command codes were read from the devices themselves (`GET /v1.0/devices/{id}/functions`),
      not guessed: `switch_1` for a lighting circuit, `switch_1`/`switch_2` per outlet socket.
      An outlet command with no socket is **refused rather than guessed**, since switching both
      would act beyond what was asked. `acu_ir` has no cloud route at all — its IR blaster is
      not in the cloud project (RM-016) — so no attempt is made that would bury the real local
      failure behind a misleading second one.
      The audit row records **which path moved the relay**: a command that only landed via cloud
      means the device stopped answering locally, and collapsing that into a bare `dispatched`
      would hide the one signal saying a device needs attention.
      Vendor ids are read from the live flow at startup rather than added to this repository,
      which is public; an unreadable flow disables the fallback instead of failing the proxy —
      `server/dispatchCloud.mjs`, `server/cloudDispatchConfig.mjs`,
      `docs/adr-002-device-recovery-path.md`
- [x] **EX-035b** Channel-interchange detector for the shared dual-channel meter.
      `mtr_co_yellow` and `mtr_lo_yellow` are two logical meters on one physical device, told
      apart only by which DPS range each is read from. Confirmed 2026-08-25 that they swap
      outright: `co` went 42 -> 1289 W in the same sample `lo` went 1285 -> 41 W, each taking
      the other's previous value.
      **Detects; deliberately does not correct.** Correcting means choosing which assignment is
      true, and nothing in the data settles it — both circuits are real loads that can be large
      or small. "The ACU is usually the bigger one" is a guess, and a guess applied silently
      inside measurements is how an unauditable figure reaches a report.
      Requires a real separation before calling a trade: two channels reading 43 W and 52 W
      change order constantly, and firing on those would bury the one event that matters —
      `shared/channelSwap.mjs`, `test/channel-swap.test.mjs`, `npm run check:meters`
- [x] **EX-032b** Devices page trimmed to what can be read at a glance: the fleet banner folded
      into the page subtitle (`20 devices · 10 online · N unstable today`, clause omitted
      entirely when nothing flaps), and the per-row note reduced to `16 drops today`.
      The percentage it replaced was measured over however much data existed rather than over
      the window, so `5% up` did not mean what it looked like — which is precisely why it needed
      a coverage qualifier trailing it. A number needing a caveat to be read correctly is the
      wrong number to show, and removing it removed the reason for the caveat: `uptimeRatio` and
      `connectivityCoverage` went with it. A count needs no denominator and at worst
      undercounts, which is honest — `src/components/devices/DevicesView.tsx`
- [x] **EX-033b** An offline device no longer displays readings. `co5` rendered `OFFLINE` beside
      `230.4 V / 2.23 A / 513.9 W`. **This reverses EX-039's own rule**, which keyed expiry on
      age alone because "a device that dropped a second after reporting still has a real last
      reading". That reasoning missed the mechanism: `shared/buildLatest.mjs` stamps `ts = now`
      and only overrides it when the device reports its own time, so an offline device's
      timestamp is **synthesized** — its age is not evidence of anything, and the age rule could
      never fire for it. The COMM badge is the fact; the figures were not —
      `src/lib/staleness.ts`
- [x] **EX-034b** `Sensors` added to the category vocabulary — `sensor_temp_humidity` is a real
      class here and could previously only be filed under `other`, which means "considered, none
      of these fit". `phase17` only widens what the CHECK accepts, so unlike `phase14` it needs
      no value mapping and is order-independent with the frontend. Applied and verified. The
      "frontend agrees with the constraint" assertion moved to the phase 17 test, because it
      pins the UI to one migration's vocabulary and must follow the newest or it fails the
      moment a category is added — `supabase/phase17_device_categories_sensor.sql`
- [x] **EX-027b** `npm run demand:profile` — the recorded building demand, so a DSM limit comes
      from evidence instead of a guess. Suggests a ceiling **above the observed peak**, not a
      percentile of it: a limit anchored inside normal operation sheds load on an ordinary busy
      afternoon. Refuses to suggest anything from under 500 readings, because a number drawn
      from a handful of samples is a guess wearing a decimal point and this system can act on it
      by switching off lights. Writes nothing.
      *Pagination is the load-bearing part.* The first pass asked for 4,000 rows, got exactly
      1,000, and computed percentiles over 53% of the data with nothing to indicate it — the
      same PostgREST cap `phase9_history_buckets.sql` and `server/backup.mjs` both exist to
      escape, walked into anyway. The true count is 1,877, and the difference is not cosmetic:
      the truncated peak was 1,577 W against a real 1,767.8 W, so a threshold derived from it
      would have sat ~12% low and shed load on a normal day —
      `server/demandProfile.mjs`, `server/demandProfile.test.mjs`, `server/demand-profile.mjs`
- [x] **EX-026b** `npm run tuya:devices -- --verify-keys` — checks every flow node's local key
      against the key Tuya holds, and reports only whether it matches. A wrong key does not fail
      loudly: the device is discovered, the connection is attempted, and it fails looking like a
      network fault. This project has already made that mistake — RM-001a first blamed a stale
      key for `l6`/`l7`, wrongly, because nothing could check.
      Neither key is printed and neither reaches the result object; the comparison runs on a
      per-run salted HMAC, so an accidental dump of an intermediate cannot leak one and two runs
      produce nothing correlatable. A bare digest would have been false comfort — a Tuya local
      key is drawn from a small enough space to be reversed from a candidate list.
      **First run, 2026-08-24: all 19 keys match.** That rules stale keys out as a cause of
      anything currently open, which is worth having as evidence rather than as an assumption —
      `server/keyAudit.mjs`, `server/keyAudit.test.mjs`
- [x] **EX-024b** Tuya cloud client, dependency-free, server-side only. Signing is pinned by
      test to the exact canonical string, because Tuya reports every signing mistake as a flat
      `sign invalid` with no indication of which half was wrong — the token request and a
      business request sign different prefixes, an empty body hashes to the SHA-256 of the empty
      string rather than to nothing, and the hex must be uppercase. Failures arrive as HTTP 200
      with `success:false`, the same shape as PostgREST's silent truncation and its RLS-blocked
      writes, so success is never inferred from a status code —
      `server/tuyaCloud.mjs`, `server/tuyaCloud.test.mjs`
- [x] **EX-025b** `npm run tuya:devices` — compares Tuya's cloud view of every device against
      the bridge's local view. The cloud reaches devices over the internet rather than the local
      subnet, so **disagreement between the two is the diagnosis**: cloud-online plus
      local-offline means the device is powered, joined and talking to Tuya while the Pi cannot
      reach it, which points at the access point; both offline points at the device. Read-only.
      Local keys are fetched only with `--keys` and even then only their length is printed —
      the values exist to populate a registry, not to be read off a terminal that may be pasted
      into an issue — `server/tuya-devices.mjs`
- [x] **EX-104** `npm run tuya:macs` — the third view, which closes what the cloud view leaves
      open. EX-025b tells "the device is off" from "the Pi cannot reach it", but it cannot split
      the first case, because a device can lose its *uplink* to Tuya while remaining perfectly
      well associated to the local AP. This joins Tuya's per-device MAC
      (`/v1.0/iot-03/devices/factory-infos`) against the Pi's own `ip neigh`: a resolved MAC
      means the device answered an ARP request, so layer 2 works whatever ICMP, UDP discovery or
      the cloud say — the reasoning `CLAUDE.md` already records for ruling out client isolation,
      applied per device. **The MAC is the only sound join key**: the cloud's `ip` field is the
      WAN egress address as of last contact, stale for exactly the devices in question and never
      mappable to a LAN address.
      It touches **no device and opens no connection**, which is the point — probing these
      directly costs their single local connection slot, and doing that is what wedged four of
      them on 2026-08-25.
      On first run it split RM-020's six power-cycle candidates into four that were still on the
      segment and two that were genuinely gone. Unresolved ARP lines (`FAILED`, `INCOMPLETE`)
      are deliberately **not** counted as presence — that inversion would reverse the entire
      conclusion, and the Pi's table carried such a line at the time; there is a test for it, and
      it was confirmed to fail when the guard is removed —
      `server/macPresence.mjs`, `server/macPresence.test.mjs`, `server/tuya-devices.mjs`
- [x] **EX-029b** An offline device no longer displays readings. `co5` rendered `OFFLINE`
      beside `230.4 V / 2.23 A / 513.9 W`. This **reverses EX-039's own rule** the day after it
      shipped: age alone was the test, on the reasoning that a device which dropped a second
      after reporting still has a real last value. That missed the thing that makes it wrong —
      `shared/buildLatest.mjs` stamps `ts = now` and only overrides it when the device reports
      its own time, so an offline device's timestamp is **synthesized**, its age is not evidence
      of anything, and the age rule could never fire for it. The COMM badge is the fact; the
      figures were not — `src/lib/staleness.ts`
- [x] **EX-030b** `sensor` added to the category vocabulary, so a real device class can stop
      being filed under `other` (which means "considered, none of these fit", not "no right
      answer exists"). `phase17` only *widens* the CHECK, so unlike `phase14` it needs no value
      mapping and is safe to apply in either order relative to the frontend. The "frontend
      agrees with the constraint" assertion **moved** to the phase 17 test: it pins the UI to a
      specific migration's vocabulary, so it must follow the newest one or it fails the moment a
      category is added, reporting a correct change as a broken one —
      `supabase/phase17_device_categories_sensor.sql`, `test/phase17-device-categories-sensor.test.mjs`
- [x] **EX-031b** `server/schemaProbe.mjs` — probing an applied-by-hand migration without
      leaving anything behind. `probeRejects` is genuinely read-only (a refused write changes
      nothing); `probeAccepts` cannot avoid writing, because acceptance is only observable by
      being accepted, so it captures the row first and restores it in a `finally` that runs even
      when the probe throws.
      **Written because a note was not enough.** Checking a constraint by writing a live value
      and remembering the restore afterwards was done twice on 2026-08-24 — the second time
      *after* the lesson had been recorded in RM-014. The fix for a mistake that survives being
      written down is to make the safe shape the convenient one —
      `server/schemaProbe.mjs`, `server/schemaProbe.test.mjs`
      *Postscript, 2026-08-25 — the tool existing was still not enough.* The same live-data
      probe was hand-rolled with `curl` a third time, against `device_config` again, without
      checking whether a helper already existed; a redundant and weaker copy of this module was
      then written and deleted. Two things generalise. Reaching for `curl` because it is one
      line is how a safe path gets bypassed — check `server/` for an existing helper before
      writing a probe. And ROADMAP's "Existing features" list is the index of what is already
      built: consulting it before adding a module is cheaper than discovering the duplicate
      afterwards from an id collision.
- [x] **EX-023b** Per-device connectivity on the Devices page: 24 h uptime and how many times
      each device changed state, plus one fleet line when any device is flapping. Built because
      RM-013 — devices disassociating from the access point — was invisible from the dashboard
      and took a packet capture on the Pi to find. The data had been there all along:
      `readings.online` is `boolean not null` and has been written every 60 s per device since
      ingestion started; nothing read it that way. Read-path only, no new storage.
      An RPC rather than a client query for two reasons that agree: 20 devices x 1440
      samples/day is ~28,800 rows against a 1,000-row PostgREST cap that reports nothing when it
      truncates (the phase 9 trap), and counting transitions needs `lag()`, which PostgREST has
      no equivalent for. Empty windows render `—` rather than 0%, because unknown uptime and
      "down all day" are different claims. A single transition is not flapping — a device that
      dropped once and recovered would otherwise flag on every ordinary restart, which is how a
      warning becomes something people stop reading. Steady devices render nothing at all —
      `supabase/phase15_device_connectivity.sql`, `src/lib/deviceConnectivity.ts`,
      `src/hooks/useDeviceConnectivity.ts`, `test/phase15-device-connectivity.test.mjs`
      *Amended within the hour, after its own output showed a flaw in it.* Outlets carry a
      device-reported `ts` (`buildLatest.mjs:72`), `readings` is keyed `(device_id, ts)`, and
      ingestion upserts — so an outlet whose clock stalls overwrites its own row rather than
      adding one, and its `samples` undercounts the window. The first version rendered "73% up"
      over 40 samples beside "58% up" over 60 as though they were one measurement. The RPC now
      returns `expected_samples` and the note carries coverage beside the figure, reusing
      `coverageOf` rather than restating its bands — the same rule `monthly_reports` applies so
      a barely-observed month can never quote a bare total.
      *Amended again 2026-08-25, and this time by removing rather than qualifying.* The uptime
      percentage is gone, along with the coverage qualifier that existed only to make it
      readable. A figure needing a caveat to be understood is the wrong figure to show; the row
      now reads `16 drops today`, and a count needs no denominator — at worst it undercounts,
      which is honest. The fleet banner went with it, its one fact folded into the page
      subtitle. `uptimeRatio` and `connectivityCoverage` were deleted, not left unused.
- [x] **EX-022b** Category vocabulary revised to how this site is actually laid out: Lighting,
      Aircon, Outlet, Branch Circuit, Critical, Others — replacing a generic building-management
      list (`hvac`, `office_equipment`, `kitchen`) with the groupings the CT map has always had
      and the category list never did. `coerceCategory` drops the retired values, so a row
      written before the migration reads as uncategorised rather than putting an option in the
      `<select>` that the CHECK would reject on the next save. A guard test pins the option list
      and the SQL CHECK to each other, making enforceable a comment `deviceConfig.ts` had only
      asserted — `src/lib/deviceConfig.ts`, `supabase/phase14_device_categories.sql`,
      `test/phase14-device-categories.test.mjs`
- [x] **EX-021b** Drift guard for the tuya node settings on the hand-built source tabs.
      `shared/tuyaNodeSettings.mjs` declares the expected `findTimeout` and per-node
      `tuyaVersion`; `test/tuya-node-settings.test.mjs` checks them against the committed
      `live-flow-baseline.json`, so a reverted timeout, a changed version, or a vanished node
      fails `npm run test:bridge` rather than surfacing as "every device is offline" — which is
      what it looks like otherwise. Each value is recorded with its provenance: the versions are
      the devices' own decrypted announcements, and the 10 s timeout is two of the measured 5.0 s
      broadcast intervals. The six nodes whose version could not be confirmed against a live
      announcement are listed separately, so an unverified value cannot pass as a verified one —
      `shared/tuyaNodeSettings.mjs`, `test/tuya-node-settings.test.mjs`
      *Verified against the running system:* re-capturing the live flow produced no diff.
      *Not proved:* that the live flow still matches later — the baseline is a snapshot, and
      `npm run capture-flow:pi` is what refreshes it.
- [x] **EX-019** Per-device **function** declaration — `control`, `monitoring`, `scheduling` —
      stored in `device_config` beside room and load-shed group, and driving which page lists a
      device. Previously a device's page membership was decided by its class in frontend code,
      which put a *site* decision inside a page: a light switch has control but no metering
      here, while the identical relay elsewhere might feed a metered circuit. `null` means "not
      configured" and falls through to a class default; `[]` is a real answer — "no role here" —
      and the two stay distinguishable all the way down to the nullable column.
      Defaults were chosen to reproduce the previous membership **exactly**, verified against
      the real registry: Control 15/20, Automation 15/20, Analytics 11/20, all identical to
      before. What changed is that each page now *names* what it left out and why, instead of
      omitting devices silently — the reason the missing switches read as a bug rather than a
      decision. Analytics keeps two independent gates: the operator's `monitoring` declaration
      and the catalog's `metered` fact, because a temperature sensor is monitored and still has
      no wattage to chart — `src/lib/deviceFunctions.ts`, `src/hooks/useDevicesFor.ts`,
      `supabase/phase13_device_functions.sql`, `test/phase13-device-functions-schema.test.mjs`
- [x] **EX-018** One device-class catalog replacing seven independent per-class tables, each of
      which answered part of "what is this class" and could drift alone: `SWITCHABLE_CLASSES`,
      `CLASS_ICON`, `DevicesView`'s `CLASS_ORDER`/`CLASS_FILTER_LABEL`/`CLASS_PILL_LABEL`,
      `AutomationPage`'s `FILTER_CLASS`, `AnalyticsPage`'s hardcoded `'branches' | 'outlets'`
      union, and `dispatchScope`'s `COMMANDABLE_CLASSES`. Adding a device class is now one entry
      plus whatever the type checker then demands, instead of a hunt through seven files where
      five failed *silently* — a missing filter chip or scope group renders nothing rather than
      erroring. `deviceIcons.ts` had already made this argument for icons alone; this is the same
      argument for everything else. Analytics groups are derived from the catalog and rendered
      through a presentation lookup **with a fallback**, so an unstyled group appears plain rather
      than disappearing. Characterization tests copy each replaced table verbatim and assert the
      consolidation changed no behaviour — `src/lib/deviceClassCatalog.ts`,
      `src/lib/deviceClassCatalog.test.ts`
      *Deliberately not folded in:* `server/dispatchLight.mjs`'s `DISPATCH_CLASSES`, which answers
      what this *deployment* can currently drive rather than what a class is, and already reaches
      the frontend through `capabilitiesStore`.
- [x] **EX-017** Control availability no longer depends on reading freshness. Reported on site
      2026-08-24: **outlets could not be switched at all.** Every outlet toggle carried
      `disabled={… || stale}`, and because nothing polls an outlet (FI-013) the reading is stale
      almost always — so an outlet was operable only in the seconds after it happened to push a
      change of its own accord. Lights escaped it purely because they report continuously.
      Telemetry and dispatch are different facts travelling opposite directions: a reading comes
      *from* the device, a command goes *to* it through the proxy and the bridge.
      `isCommandable` gates on `online: false` — a real refusal, since the bridge is saying it has
      no connection — and nothing else; `unknown` still gates a toggle that has no state to toggle
      from. `IrCommandCenterCard` had already declined to make this conflation, and is now the
      rule rather than the exception — `src/lib/socketView.ts`, and the four control cards
- [x] **EX-039** A reading past a 5-minute expiry renders `—` rather than its last figure,
      extending `format.ts`'s "missing renders `—`, never 0" rule to values whose *age* has made
      them meaningless. Found on site 2026-08-24: the Outlet tab's parser refreshes
      `<ctx>_last_time` on the device's **connection** event without touching the measurements,
      so a reconnected outlet served a four-day-old 235.9 V under a minutes-old timestamp while
      the device itself read 224.9 V — `online: true` throughout, so nothing downstream had cause
      to doubt it. Deliberately keyed on age alone, not `online: false`: a device that dropped a
      second after reporting still has a real last reading, and blanking it would discard the most
      useful number on screen exactly when it is needed — `src/lib/staleness.ts`
- [x] **EX-013** Per-reading freshness treatment: content dims, flag stays legible — `src/components/common/StaleDataBadge.tsx`, `src/lib/staleness.ts`

- [x] **EX-148** `src/lib/capabilitySchema.ts` — the frontend's view of what a device can do,
      **importing** `shared/deviceCapabilities.mjs` rather than mirroring it (the bridge generates
      its parsers from that same file, so a second copy here would be free to disagree with the
      thing producing the data). What it adds is the **channel resolution**: one physical
      dual-channel CT meter is two logical devices, and a component asking for `cur_power` must
      get its own channel. The other channel is excluded outright rather than deprioritised, so a
      value cannot fall through to a sibling branch circuit — neutering that filter fails four
      tests. Separates "what the hardware CAN do" from "what the reading currently carries", which
      is what lets a widget mount and show `—` instead of appearing and vanishing as packets
      arrive — `src/lib/capabilitySchema.ts`, `src/lib/capabilitySchema.test.ts` (13 tests)
- [x] **EX-149** `DeviceCard` — a device rendered from its capability schema instead of its class,
      composed from a widget registry (`widgetRegistry.ts`) keyed on what the PRODUCT declares.
      Adding a capability is now an entry in `shared/deviceCapabilities.mjs` plus a widget; no
      card is edited and no class is special-cased. Widgets: relay/sockets, live telemetry with
      sparkline, the device's own energy counters, child lock, the over-power alarm (slider
      bounded by the vendor's own min/max/step, inert until a capability command verb exists),
      countdown, the fault bitmap decoded to named bits, and the settings this system deliberately
      refuses to write. Dual-channel meters get a tab per channel — and the pairing is refused
      when more than one candidate exists, because the registry carries no physical-device id to
      join on and guessing would put two unrelated branch circuits under one card. Reached from
      the fleet table's Details button, rendered outside the row because that table is a strict
      nine-column ARIA grid whose row/column agreement is asserted by test. It sat BESIDE the
      table until RM-059 moved it into a floating `OverlayPanel` — the reason it cannot be an
      expanding row is unchanged; what changed is that "beside" also meant "above"
      — `src/components/devices/DeviceCard.tsx`, `capabilityWidgets.tsx`, `widgetRegistry.ts`,
      `DeviceCard.test.tsx` (16 tests).
      **VERIFIED IN A REAL BROWSER 2026-09-03**, against a scratch build talking to the mock
      bridge — and it found a bug that 14 passing tests had not. Opening Details on a second
      device while one was already open re-uses the same component instance, and
      `useState(device)` initialises once and never resyncs, so the card rendered the PREVIOUS
      device's body under the new device's tabs: the screenshot showed "CARE ACU IR" titled above
      C.O Yellow's two channels. The chosen channel is now held as an ID, which cannot outlive
      its device and still remembers the tab when you come back. Two regression tests, both
      confirmed to fail against the code they replace.
      A layout fault came out of the same pass: the panel is full page width, and rows laid out
      `space-between` put each label a screen's width from its value. Rows are a two-column grid
      now and the card is capped at 46rem. Checked in both themes.
      **For whoever renders this project in a browser next:** Chromium on this Pi accepts a CDP
      connection and then never answers a command, and its one-shot `--screenshot` fetches the
      HTML without parsing it — empty DOM, no asset requests — with Vulkan/dawn initialisation
      failing in its own log. **Firefox works**, driven over Marionette. No dependency was added;
      Node 22 has `net` and a built-in `WebSocket`. See `docs/pi-session-brief.md`
- [x] **RM-059** The Devices page's four panels — Details, Edit, Add, Remove — move into a
      floating `OverlayPanel` instead of rendering in normal flow above the fleet table. They had
      pushed the table down the page, so opening one took the row being acted on off screen at the
      moment it was acted on. `DeviceMetaEditor`'s docblock had argued a panel was safer than a
      modal, because its own save gate is an `aria-modal` alertdialog and two Escape handlers
      would fight over one keypress — a real objection, answered once in the primitive
      (`blockEscape` stands the panel's Escape handler AND its focus trap down while a nested
      dialog is up) rather than by keeping four panels in the document flow. Portals to `<body>`
      for the same reason EX-143 found: `.card` and `.top-nav` carry `backdrop-filter`, which makes
      them containing blocks for `position: fixed` descendants. Surface is `--pop-bg` (96%) rather
      than `--glass` (75%) — a translucent panel over a scrim over the page is a composite nothing
      has measured, and `--muted-2` sits at 4.9:1 with no margin to spend; `--pop-bg` is already in
      `test/contrast.test.mjs`'s surface set. Row state comes with it: a left rail in `--good` for
      a live, switched-on relay, and `--bg-surface-2` for offline/no-data. The demotion is a
      SURFACE change, never `opacity`, which would drag every text token in the row below the ratio
      the palette was computed at; stale is deliberately neither, because a stale row already
      blanks its numbers and carries a STALE badge, and a third freshness signal on one row is the
      mistake FI-006 caught in `LiveDemandCard`
      — `src/components/ui/OverlayPanel.tsx` (+`.test.tsx`, 10 tests), `DevicesView.tsx`,
      `DeviceMetaEditor.tsx`, `EnrollWizard.tsx`, `RemoveDevicePanel.tsx`, `src/index.css`.
      **Three defects found while doing it, all fixed here:**
      (1) **`+ Add device` was styled as a disabled control while being enabled.** Dashed
      `--faintest` border, `color: var(--faint)` at 2.3-2.6:1, `cursor: not-allowed` — left over
      from before EX-040b wired it to the enrolment wizard. The `--faint` token docblock cited this
      very button as its one permitted `color:` use, "a genuinely disabled control, which WCAG
      1.4.3 exempts"; the exemption had been covering an enabled control failing AA. Both the rule
      and the button are corrected, and `--faint` now has no `color:` use at all.
      (2) **The touch-target block had stopped being last in `index.css`.** Its own comment says it
      is "deliberately the LAST rule block in this file", because `padding-block` loses to any
      later same-specificity `padding` shorthand — and 2,354 lines had been appended after it.
      Nothing had broken yet (checked: the two `padding-inline` selectors have no later rules), but
      the invariant was gone. Moved back to the end, with the drift recorded in the comment.
      (3) **The row action buttons were never in that block.** `.devices-table__edit-btn`,
      `.devices-table__remove-btn` and `.devices-add-btn` had no coarse-pointer minimum — three
      small buttons in one `0.6fr` cell on a kiosk touchscreen, flush against each other with no
      gutter. They get `min-height: 44px` (height only: a 44px minimum WIDTH each would overflow
      the column, and this block's own rule is that the largest target which does not steal a
      neighbour's taps is the right one) plus a gap. `.automation-time-input` and
      `.automation-number-input` were missing too and are added. One dead selector removed
      (`.automation-shed-mode__switch`, zero uses since the control became a `quick-toggle`), along
      with `.enroll-wizard__cancel` and the panel chrome `OverlayPanel` now supplies.
- [x] **RM-060** **You could not tell which clock on a schedule row turns the device on and which
      turns it off.** `.automation-sched-row--head` is `display: none` below 720px — the CARE kiosk
      and every phone — so beneath that width the two `type="time"` inputs were adjacent, identical,
      and separated only by an `aria-label` a sighted operator never hears. Putting the office
      lights' ON time into the OFF field is a silent, plausible mistake that then fires at the wrong
      hour. Each clock now carries three channels: the word ON or OFF, a sunrise/sunset glyph, and a
      coloured rail (`--good` / `--border-strong`). Colour is never the only carrier — that fails a
      colour-blind operator and carries nothing under `prefers-contrast: high` — and the captions
      stay at every width, not only where the header vanishes. Reported by the operator, 2026-09-08
      — `src/components/automation/ScheduleRow.tsx` (+`.test.tsx`, 7 tests), `src/index.css`.
      **Error prevention on the same page, since these all save silently today and only announce
      themselves as behaviour that does not happen:**
      `scheduleProblems` (pure, in `automationMath.ts`, 9 tests) flags a row armed with no day
      ticked — `parseDays` returns all-false for an unset value, so a blank `days` string is a
      schedule that will never run, and the symptom presents as broken hardware rather than an empty
      field — a row armed with no ON time, and an ON equal to its OFF. It deliberately stays SILENT
      on an OFF earlier in the day than its ON (that is an overnight schedule, which is how a
      security light is configured), on an ON with no OFF (switching on and leaving it is a real
      choice), and on an unarmed incomplete row (that is a draft). Warnings that cry wolf get
      ignored.
      `DsmThresholdsCard` gains inline validation before the save: a limit at or below the present
      measured draw is breached the instant it is written, and a limit of zero is the same at its
      extreme — worth its own sentence because `readDsmThresholds` is explicit that "no limit
      configured" and "limit of 0" are different facts that look nearly identical on the form.
      **And auto-shed can no longer be armed while no device carries a shed tier**, which would arm
      a mechanism that can only ever do nothing while reading on the page as protection. Gated on
      ASSIGNMENT via a new `shedEligibleCount` (`shedTiers.ts`), not on what could act this minute:
      dispatchability and on-ness are transient and already reported as `inertCount`, but a tier
      nobody set cannot resolve itself. Disabled-with-a-reason rather than hidden, because the panel
      that fixes it is on this same page. The summary behind both the panel and the card is one
      `useShedSummary` hook now, so the editor and the arming control cannot drift into disagreeing
      about what is sheddable — `shedTiers.ts` opens by naming that exact failure.
      **AN ANNOUNCEMENT STORM, CAUGHT IN REVIEW AND FIXED.** The per-row note shipped first as
      `role="status"`, which was wrong for one specific reason: **`Arm all` stages `armed = true`
      across every filtered device in a single click**, so a dozen quiet rows can start warning
      simultaneously — a dozen polite live-region announcements a screen reader user can neither act
      on nor skip. The row note is no longer a live region; it is now the arm switch's own
      `aria-describedby` (two of its three cases are literally "armed without X", and the third only
      matters once armed), and the *count* is announced once by a single summary on the card,
      omitted entirely at zero. That is the shape WCAG guidance asks for — a summary that
      COMPLEMENTS inline field errors rather than replacing them — and it is the same
      "a counter that is almost always zero trains people to stop reading the line" rule EX-032b
      applied to the Devices page's unstable count. `brokenScheduleCount` counts broken ROWS, not
      problems: a row with two faults is one schedule to fix
      — `AutomationPage.test.tsx` (4 tests, new)
      — `src/components/automation/DsmThresholdsCard.tsx` (13 tests), `src/hooks/useShedSummary.ts`,
      `src/lib/shedTiers.ts`. Automation's pre-catalogue state also becomes skeletons rather than a
      sentence, matching Devices one tab away and staying inside `Skeleton.tsx`'s own rule.
- [x] **RM-061** **One button per fleet row, and one panel with tabs behind it.** Each row carried
      `Details`, `Edit` and — for an enrolled device — `Remove`: three buttons flush against each
      other in a `0.6fr` track of a nine-column grid, opening three separate surfaces that all
      answered questions about the same device. RM-059 had already had to give them a height-only
      touch target because a 44px minimum WIDTH each would overflow the column, which was the
      column telling us what the operator then said out loud. The row now has a single **Manage**
      button (accessible name carries the device — twenty rows of "Manage" tell a screen reader
      user nothing), and `DevicePanel` holds **Capabilities / Metadata / Remove** as tabs.
      Tabs rather than one longer panel because these are not sections of a document: capabilities
      are read live and change every couple of seconds, metadata is a form you submit, and removal
      is destructive with its own dry-run preview — stacking them would make the common case
      scroll past the rare one, and Remove is not something to scroll past. **Only the active tab
      is mounted**, so the live-reading subscription and the removal preview are not both running
      while you type in the other. **Remove is absent, not disabled, for a built-in device** — the
      same judgement `DevicesView` already made about the button it replaces.
      `role="tablist"` is honoured rather than decorative: roving tabindex (one tab stop, not
      three) plus Left/Right/Home/End. The panel's tabs are deliberately a DIFFERENT shape from
      `.device-card__tab`, because a dual-channel meter renders channel tabs *inside* the
      Capabilities tab and two tablists can be on screen at once — drawing them alike would say
      they were peers
      — `src/components/devices/DevicePanel.tsx` (+`.test.tsx`, 10 tests), `DevicesView.tsx`,
      `DeviceMetaEditor.tsx` and `RemoveDevicePanel.tsx` (both now body-only, their panel chrome
      removed), `src/index.css`.
      **Two changes to `OverlayPanel` fell out of it, both simplifications:**
      (1) **`blockEscape` is gone.** It was a prop every caller had to remember to pass so the
      panel would stand down while a nested `ConfirmModal` was up — a rule three components
      re-implemented and which `DevicePanel` would have had to plumb up through three children to
      satisfy. The panel can simply SEE the dialog (`ConfirmModal` renders in normal flow inside
      `children`), so it reads the DOM at keypress time instead. It cannot fall out of sync the
      way a prop can, and the callers got shorter.
      (2) **The focus trap counted controls Tab can never reach.** It collected every `button`,
      including `tabindex="-1"` and `disabled` ones — so the new roving-tabindex tablist would
      have put the trap's boundary on an element that is not a tab stop. Now filtered on
      `tabIndex >= 0 && !disabled`. Found by writing the test badly first: the initial version put
      the unreachable buttons in the MIDDLE of the panel, where the boundary logic never sees
      them, and passed against the broken code.
      A `toolbar` slot was added for the tablist, pinned between the heading and the scrolling
      body — tabs rendered inside `__body` scroll out of reach, which is the one piece of chrome
      that must not.
- [x] **RM-062** **The Automation page was telling the operator that nothing it saved could reach
      hardware, and that had been false for some time.** Two strings said it: the subtitle hint
      ("nothing on the real bridge reads or acts on these yet — that arrives once hardware dispatch
      opens") and the save confirmation ("hardware dispatch is still gated closed"). Measured on the
      live Pi 2026-09-08: `HARDWARE_DISPATCH_ENABLED=true` in `server/.env`, and `ibems-scheduler`
      logs `dispatch=OPEN schedulable=15 device(s)` at boot. So the one page that arms unattended
      load shedding was describing itself as inert. The wording is now DERIVED from
      `capabilitiesStore.hardwareDispatchEnabled` rather than asserted, and `null` is reported as
      "not been confirmed yet" rather than collapsed to "closed" — the same distinction
      `dispatchScope` already keeps. It also moved OUT of the ⓘ hint and onto the page: "Saved rules
      switch real hardware here" is the most consequential sentence on the screen, and a hint you
      have to open is where a footnote goes, not a warning
      — `src/components/automation/AutomationPage.tsx`, `AutomationPage.test.tsx` (4 tests covering
      open / closed / unknown / the confirmation).
      **The word "Supabase" is gone from the UI.** It named the vendor where the operator needed the
      consequence: "Write to Supabase" is now "Save changes", "Pending writes" is "Unsaved changes",
      and the save gate says what saving does and who it is recorded against. 24 strings across 16
      files, with a settled vocabulary — **"the account service"** for sign-in (already the wording
      `AccountSection` used), **"a settings store"** for configuration, **"stored history"** for
      readings and reports. The three RLS-refusal messages were the ones worth most care: PostgREST
      reports a row-level-security rejection as an ordinary success with zero rows, so these are the
      detectors from the Phase 9 lesson. They now say the one thing the operator can act on — "you
      are signed in with a limited local sign-in, which cannot save" — from a single shared constant
      so the sentence cannot drift across its three call sites, with the maintainer detail (which
      migration to check) moved into a comment where it belongs rather than onto the screen.
- [x] **RM-063** **The Load-shed tiers panel says less.** Its lede — "A tier is permission, not
      size … an unclassified device is not a volunteer" — was three sentences of argument sitting
      above the numbers it was arguing for, and the operator asked for it gone. Removed outright.
      The reasoning is not lost: it moved into `LoadShedPanel.tsx`'s docblock, where it explains the
      counts to whoever changes them rather than to whoever reads them. The rest of the panel's
      prose was cut to match — the ⓘ hint is two sentences instead of four, "an unclassified device
      is never shed, so these are not volunteers" is "these are never switched off", and the inert
      note drops "dispatch path" and "commandable" for "cannot be reached right now … works again
      once they come back". `reasonNotSheddable` lost its mechanism lecture too: the aircon now
      reads "controlled by its remote, not a relay — its power is never cut" rather than explaining
      IR and compressors to someone who only needs to know the omission was deliberate. Dead
      `.shed-panel__lede` rule removed. Browser-verified: the section is now a heading, four tier
      counts, the unclassified line, and a collapsed list of what cannot be shed
      — `src/components/devices/LoadShedPanel.tsx`, `src/lib/shedTiers.ts`, `src/index.css`,
      tests updated to assert the meaning rather than the old phrasing.
- [x] **RM-065** **Two of the three gaps RM-062 found on the Automation page, and the third
      deliberately not built.**

      **A schedule can be cleared.** Live on 2026-09-08 the table held seven rows, none enabled,
      several junk — `l6` was on 16:23 / off 16:22 with no day selected. Every field could be blanked
      by hand; nothing offered to do it at once. The control **stages** the blanks rather than
      deleting the row, and that is the design rather than a shortcut: a row of empty fields with
      `armed` off is already precisely what "no schedule" means to `server/scheduler.mjs`, so it
      needs no delete path against the settings store, and it goes through the page's own Save gate
      so the change is reviewable in Unsaved changes and attributable when it lands. Disarming is
      part of clearing — a blank rule left armed is exactly the "armed, but no day is selected" fault
      RM-060 warns about. Shown only on a row that has something to clear.

      **The ambient trigger setpoint is gone.** Nothing consumed `care_acu_trigger_c`: no daemon and
      no flow node read it, grepped across `server/`, `shared/` and `node-red-bridge/`. It was first
      labelled "Recorded only"; the operator's answer was that a control which does nothing should
      not be on the page at all, which is this project's own house rule. Removed: the heading, the
      slider, and the storage plumbing.

      **THE PLUMBING HAD TO GO IN BOTH DIRECTIONS AT ONCE, and that is the part worth keeping.**
      `dsmRowFrom` always sent `care_acu_trigger_c: num(merged[TRIGGER_KEY])` in the demand-limits
      `.update()`. Removing only the READ would have left `merged[TRIGGER_KEY]` undefined,
      `num(undefined)` returns `null`, and the next time anyone saved an unrelated demand limit the
      stored setpoint would have been silently wiped — data loss with no error, from a save nobody
      would connect to it. Dropping the column from the payload as well means the `.update()` never
      names it and the value stays exactly as it is in the database (27 °C), for whoever builds the
      rule. **Wiring that rule stays a decision, not a task:** it means transmitting aircon ON
      unattended, which carries the weight of arming auto-shed, and this project's standing rule is
      that shedding is automatic and restoring is not.

      **BUILT AND THEN REMOVED BEFORE IT SHIPPED: a per-row "last ran" line.** The third gap was
      that nothing said whether a schedule actually fired, though every dispatch has been recorded
      in `commands` with `source: 'schedule'` all along (108 rows on 2026-09-09). It was built —
      a pure shaper, a Supabase read, a hook, a line under each armed row — and on seeing it the
      operator cut it: a line under every device is the furniture this page had spent three commits
      removing. Recorded because the reasoning survives the code. The rows are still written and
      still readable; if the question is worth answering it belongs somewhere you go to ask it, not
      under every device.

      **A LAYOUT FAULT IN THE CLEAR CONTROL, FOUND BY MEASURING IT (2026-09-09).** The arm column
      was `56px`, sized when it held only the 44px toggle. Adding the Clear button beside it made
      the pair **75px** — measured in Firefox at 1440px: the button rendered at `x=685` while its
      own grid track started at `x=704`, so it overflowed by 19px and sat on top of the day chips,
      where a tap could land on the wrong control. It shipped that way. The track is `80px` now
      (23 + 8 + 44), and the 8px separation is what adjacent touch targets need — it had been coming
      from a flex `gap` of 4px PLUS a leftover 4px `margin-right`, two mechanisms doing one job.
      Re-measured at 1440x960, 800x480 and, in a sized iframe, 375 and 320px: no page overflow, no
      cell overflow, the button inside its own track, 8px gap at every width.

      Eight orphaned CSS rules went with the two removals
      — `src/components/automation/AutomationPage.tsx`, `ScheduleRow.tsx`,
      `src/lib/supabaseConfig.ts`, `src/index.css`, tests updated to guard the absences.
- [x] **EX-150** One relay control, replacing five. `SwitchesListCard`, `OutletsListCard`,
      `LightingMatrixCard`, `OutletPlanCard` and `MasterQuickActionsCard` each re-derived the same
      `controlView` → `busy`/`unknown`/`on` triple and then decided independently what `disabled`
      meant — **and three of them had genuinely different refusal rules**:
      `MasterQuickActionsCard` omitted `isCommandable`, so it was the one toggle in the app that
      stayed clickable for a device the bridge had reported offline; `LightingMatrixCard` omitted
      `unknown`, so a light that had never reported offered a toggle with no state to toggle
      *from*. That is the same shape as EX-017, where the staleness fix reached the `disabled`
      attribute but not the click handler. The rule now lives once, in `useRelayState`. Each
      toggle also subscribes to its OWN pending entry, where `OutletRow` and `OutletPin` used to
      select the whole `pending` map and re-render every socket on any command anywhere in the
      building — `src/hooks/useRelayState.ts`, `src/components/devices/RelayToggle.tsx`
- [x] **EX-151** The control cards honour `device_config.functions`. Only ControlPage's master
      actions did; the four cards filtered by class directly, so a device an operator had
      deliberately excluded was left out of "Lights off" and then handed its own toggle in the
      list below it — the one place the exclusion mattered most. `null` functions still means
      "nobody has said" and falls back to the class default, so a site that has never opened the
      editor is unaffected — `src/components/control/`, `src/hooks/useDevicesFor.ts`,
      `ControlPage.test.tsx`

### Frontend — state & data layer
- [x] **EX-171** *(2026-09-14)* Analytics data quality: one time grid, a quality for every sample, frozen-meter detection, one branch-energy derivation for Overview and Analytics, sync status, and an error boundary per card. See RM-076 to RM-078 in §2 — `src/lib/timeseries.ts`, `src/lib/branchEnergy.ts`, `src/lib/useBranchEnergy.ts`, `src/lib/dataQuality.ts`, `src/components/analytics/analyticsMath.ts`, `src/components/analytics/useAnalyticsHistory.ts`, `src/components/analytics/ChartTooltip.tsx`, `src/components/analytics/DataQualityBadge.tsx`, `src/components/common/ErrorBoundary.tsx`. **Deleted:** `src/components/overview/totalPowerSeries.ts` — `sumHistories` summed by array position; its offline rule lives on in `sumSlotSeries`.

- [x] **EX-020** Bridge resilience layer: abort timeouts, in-flight guard, exponential backoff, WS primary with HTTP-poll fallback — `src/lib/bridgeClient.ts`
- [x] **EX-021** Session-expiry recovery: a 401 triggers one token refresh, then falls through to the login screen instead of retrying a dead token forever — `src/lib/authToken.ts`, `src/stores/authStore.ts`
- [x] **EX-022** Optimistic command state with feed reconciliation and revert-on-failure — `src/stores/commandStore.ts`
- [x] **EX-023** Device catalogue, latest readings, totals and history store — `src/stores/deviceStore.ts`, `src/hooks/useLiveConnection.ts`
- [x] **EX-024** Operator-editable device metadata (room, category, load-shed group, display-name override, notes) — `src/lib/deviceConfig.ts`, `src/stores/deviceConfigStore.ts`
- [x] **EX-025** Anomaly fetch/store surfaced in the alerts bell — `src/lib/anomalies.ts`, `src/stores/anomaliesStore.ts`
- [x] **EX-026** Capabilities store reporting both the dispatch gate and which device classes actually reach hardware — `src/stores/capabilitiesStore.ts`, `src/components/control/dispatchScope.ts`
- [x] **EX-027** Relay corroboration and socket-view derivation, kept pure and unit-tested — `src/lib/relayCorroboration.ts`, `src/lib/socketView.ts`
- [x] **EX-028** DSM threshold maths and load-shed banner logic — `src/lib/dsm.ts`
- [x] **EX-029** Long-range history read as server-side time buckets, with a truncation guard that throws rather than returning a plausible-looking partial answer — `src/lib/supabaseHistory.ts`
- [x] **EX-031** History is tagged with the range it was fetched for and read only via `historyFor()`, so one range's points can never be charted under another's label — `src/stores/deviceStore.ts`
- [x] **EX-030** One retry/backoff schedule shared by the four Supabase-backed stores instead of four hand-copies — `src/stores/retrySchedule.ts`
- [x] **EX-032** *(deployed 2026-08-22)* Archive-backed 90d/1y ranges on Analytics, reading across the retention boundary through one RPC so the caller never has to know where it sits. The range set is 24h/7d/30d/1y — 90d was removed on request, and because `LongRange` and `ARCHIVE_RANGES` key every table that describes a range, the type system found each place it had to go — `src/lib/supabaseHistory.ts`, `src/components/analytics/AnalyticsPage.tsx`
- [x] **EX-033** *(deployed 2026-08-22)* Reports page: stored monthly figures per device and building-wide, with CSV export. Coverage is rendered beside every figure, so a barely-observed month can never quote a bare total — `src/components/reports/ReportsPage.tsx`, `src/lib/supabaseReports.ts`
- [x] **EX-036** Page-header actions can shrink, so the controls below the title wrap instead of being clipped off the edge. `flex: none` forbade shrinking, so on a 375px screen Analytics' toggle row rendered 722px wide with its Parameter and Scope groups unreachable, the Devices toolbar 833px and Control's button row 363px — all clipped rather than scrolled. One rule, three pages — `src/index.css`
- [x] **EX-038** The Devices fleet table becomes a two-section card per device below 720px — identity with its status chips on one line, a rule, then the readings with the action riding the end of them — instead of a 860px sideways-scrolling grid. Halves the card height and leaves no band spent on a single chip — scrolling right to read Power had taken the device's own name off screen. The nine `role="columnheader"` nodes are hidden visually but kept in the accessibility tree, so the row/column association EX-008 added survives — `src/components/devices/DevicesView.tsx`, `src/index.css`
- [x] **EX-037** Segmented controls stack full-width below 480px with 44px-tall targets, single-column card grids on phones, and `minmax(0, 1fr)` on the single-column fallbacks so a wide child cannot floor a grid column at its min-content width — `src/index.css`
- [x] **EX-035** *(deployed to the Pi 2026-08-22)* Account menu in the nav's right-hand cluster holding Reports and sign-out, keeping the tab bar at the five live operational views. Routes are derived from `ROUTE_ITEMS`, not the tab bar, so a page can leave the tabs without leaving the router — `src/components/layout/AccountMenu.tsx`, `src/components/layout/navItems.ts`
- [x] **EX-034** RFC 4180 CSV serializer with spreadsheet-formula neutralisation, a UTF-8 BOM for Excel, and missing rendered as empty rather than 0 — `src/lib/csv.ts`

### Server & ingestion

- [x] **EX-040** Ingestion daemon polling the bridge and writing devices/readings/building_totals/ingestion_health, with local NDJSON buffering on outage — `server/ingest.mjs`, `server/ingestBuffer.mjs`.
      Confirmed in production 2026-08-21: a real ~7-minute uplink loss buffered 8 rows, then flushed and cleared them on reconnect with no data loss (`buffered_row_count` back to 0, `last_error` null).
- [x] **EX-041** Authenticated proxy: the only process besides Node-RED allowed to reach the bridge; validates a session before forwarding — `server/proxy.mjs`
- [x] **EX-042** Break-glass local login for when Supabase Auth is unreachable; view-only, cannot issue commands — `server/breakGlass.mjs`, `server/hashBreakGlassPassword.mjs`
- [x] **EX-043** Command audit path: validate, dispatch, then record — a failed dispatch is logged as `failed`, never silently omitted — `server/proxy.mjs`
- [x] **EX-044** Rolling z-score/IQR anomaly detection with a noise floor substituted into the denominator rather than used as a skip-gate — `server/anomalyStats.mjs`
- [x] **EX-045** Systemd units for ingest, proxy, and the office kiosk display — `server/ibems-ingest.service`, `server/ibems-proxy.service`, `server/ibems-kiosk.service`
- [x] **EX-047** Scheduler daemon firing the Automation page's schedules through the same gate and audit trail as a manual click, attributed to whoever saved the schedule — `server/scheduler.mjs`, `server/schedulePlan.mjs`, `server/ibems-scheduler.service`
- [x] **EX-051** Outlet and aircon control endpoints on the flow, mirroring the light chain — `node-red-bridge/addDeviceEndpoints.mjs`
- [x] **EX-052** Dispatch routed per device class from one shared list, so capabilities, scheduling and shedding all cover the same classes — `server/dispatchLight.mjs`
- [x] **EX-053** Aircon setpoint end to end: bounded in the contract, carried by the command, selectable on the Control page — `shared/commands.mjs`, `src/components/control/IrCommandCenterCard.tsx`
- [x] **EX-049** Automatic load shedding on a DSM threshold breach — shed-only, one tier per evaluation, never touching Protected or unassigned devices; same gate and audit trail as any other command — `server/shedPlan.mjs`, `shared/dsmMath.mjs`
- [x] **EX-050** The Automation page records who saved a schedule or threshold, without which neither can fire — `src/lib/supabaseConfig.ts`
- [x] **EX-048** Light dispatch shared by the proxy and the scheduler rather than duplicated — `server/dispatchLight.mjs`
- [x] **EX-046** Log rate limit for the bridge unit, so a device-discovery failure loop cannot evict the journal's history — `server/nodered-log-ratelimit.conf`
- [x] **EX-054** Record-then-dispatch shared by the proxy and the scheduler, so a command cannot reach hardware without an audit row already written; both verify the affected-row count rather than trusting a 200 — `server/auditedDispatch.mjs`
- [x] **EX-055** `readings` retention: a 30-day raw window rolled into permanent hourly buckets, triggered statelessly from the database's own answer rather than a remembered timestamp — `server/retention.mjs`, `supabase/phase9_readings_hourly.sql`
- [x] **EX-056** The ingestion cycle is orchestration-tested with its I/O injected, and a bridge outage now reaches `ingestion_health` instead of only being logged — `server/ingestCycle.mjs`
- [x] **EX-057** Proxy upstream timeout for a bridge that accepts and then hangs, a bounded token-verify cache, and 502s that no longer echo the raw upstream error — `server/proxy.mjs`
- [x] **EX-058** Retention generalised over the table, covering `building_totals` and `anomalies` as well as `readings`, each pass guarded so one table's failure cannot stop the others — `server/retention.mjs`
- [x] **EX-059** Monthly report generation on the same stateless trigger as retention — "which settled months have no report, or one built before they settled?" — with a grace period so a month is never reported before its late-flushing rows land, and a report built too early rebuilt exactly once rather than frozen at partial data — `server/reports.mjs`
- [x] **EX-070** Supabase data export for the tables that cannot be reconstructed, explicitly paginated because a full page is what a silent cap also looks like; exits non-zero on a partial backup — `server/backup.mjs`, `npm run backup`

### Bridge & hardware

- [x] **EX-060** Node-RED flow generated from a single canonical device registry; never hand-edited — `shared/registry.mjs`, `node-red-bridge/build-flow.mjs`
- [x] **EX-061** Deploy script that refuses to write unless the live flow's tab ids/labels match what generation assumed — `node-red-bridge/deploy.mjs`
- [x] **EX-062** Read-only health check safe to run at any time — `node-red-bridge/verify.mjs`
- [x] **EX-063** Tuya health-signal repair: devices can now actually report disconnected, and a disconnected meter contributes nothing to totals rather than its frozen last reading — `node-red-bridge/fix-tuya-health-signals.mjs`, `shared/buildLatest.mjs`
- [x] **EX-064** Light API token rotation, moving a hardcoded plaintext token to an environment variable and closing the fail-open branch — `node-red-bridge/rotate-light-api-token.mjs`
- [x] **EX-065** Real hardware dispatch for lights, gated closed by default; the proxy refuses to start if the gate is open with no token — `server/proxy.mjs`
- [x] **EX-067** The live flow is under version control as a redacted structural baseline, and the capture tool refuses to write if anything survives redaction — `node-red-bridge/capture-live-flow.mjs`, `node-red-bridge/redactFlow.mjs`, `node-red-bridge/live-flow-baseline.json`
- [x] **EX-068** Dead-flow pruning: 426 -> 307 nodes, removing the legacy `/ui` dashboard, debug sinks and the MQTT twin. Closed an unauthenticated MQTT path that could switch real lights with no audit row and no dispatch gate — `node-red-bridge/cleanupPlan.mjs`, `node-red-bridge/prune-dead-flow.mjs`
- [x] **EX-066** Mock bridge implementing the same contract with fault injection (`--cmd-fail`, `--cmd-drop`, `--dispatch`) so every state is reachable without hardware — `mock-bridge/server.mjs`

- [x] **EX-107** `online` requires evidence that the device actually reported, not just that a
      socket is open. The tuya node's connection flag describes its own socket, and a socket
      whose peer vanished without a FIN stays "connected" indefinitely — so `buildLatest` now
      also derives when each metered device last reported, stamps `ts` with that rather than
      `now`, and withdraws `online` past `STALE_READING_MS`. Stamping `ts = now` was what let
      the frontend's staleness watchdog sleep through a total outage: an always-fresh timestamp
      cannot look old.
      **Arrival, not value change** — the distinction is the whole design, and the obvious
      version would have made the dashboard under-report the building. A live meter on an idle
      circuit repeats the same numbers indefinitely; keying on "the numbers stopped" marks it
      dead and `online: false` removes it from the building totals. Two channels of one physical
      meter proved it: one byte-identical at 0 W for ten minutes while the other swung 14 V.
      So the signal is the tab's sample buffer, which fills on every message whether or not the
      measurement moved. The outlet tab's own arrival stamp is preferred where it exists; the
      energy tab writes none, hence the generated `Track meter arrivals` step.
      Absent arrival information — a mock, or a flow predating the step — falls back to previous
      behaviour rather than inventing offline, which is the safe direction and is tested —
      `shared/buildLatest.mjs`, `node-red-bridge/build-flow.mjs`, `test/reading-freshness.test.mjs`
- [x] **EX-106** The Pi returns to its preferred Wi-Fi network by itself. A oneshot fired by a
      15-minute timer: if the highest-priority saved profile is in range and the Pi is on
      something else, it moves — and moves back if that does not work out.
      **The safety contract is the feature**, because the operator is usually remote and a Pi
      with no uplink cannot be recovered from a keyboard nobody is sitting at. It only ever
      moves *towards* the preferred profile, never away; it will not leave a working connection
      for one that is out of range or weak; a move counts as successful only if the Pi ends up
      associated to the target **and** can reach the internet, and anything less is reverted to
      whatever it was on before; if the revert also fails it tries every other saved profile
      before giving up; and a failed attempt starts a two-hour backoff so a half-broken AP
      cannot cause endless churn.
      "Preferred" is **derived** from `autoconnect-priority`, not configured. The operator has
      already expressed the preference by setting it, a second copy could disagree, and this
      repository is public and should not carry the site's SSIDs.
      Equal priorities are treated as *no* preference and refuse to move — otherwise two
      equally-ranked profiles would swap the radio on every tick, forever.
      The decision is pure and unit-tested (12 tests); each of the four guards above was
      confirmed to fail the suite when removed, including the ordering that makes the log name
      the real reason rather than hiding it behind the backoff.
      `touch /home/bems/.ibems-wifi-prefer.disabled` stops it, for when the Pi is deliberately
      parked elsewhere — `server/wifiPreference.mjs`, `server/wifi-prefer.mjs`,
      `server/wifiPreference.test.mjs`, `server/ibems-wifi-prefer.service`, `.timer`

- [x] **EX-141** Device capability catalogue — what each PRODUCT can do, keyed by capability
      profile rather than by device class, with dp number, access mode, kind, scale, unit, range
      and an explicit `writable` allowlist per capability. Every value was **measured** on
      2026-09-02 from the vendor's own device model rather than transcribed, via
      `/v1.0/devices/{id}/specifications` and `/v2.0/cloud/thing/{id}/model`.
      **It had to be keyed by product, not class:** the single- and dual-channel CT meters are
      both `class: 'meter'`, and dp 113 is `net_state` on one and `device_state2` on the other —
      a class-keyed table would map one product's network state onto the other's second channel,
      silently, on the half of the fleet that bills. Resolves the brief's standard-vs-DP rule by
      evidence: the light switch and the outlet answer `/specifications`, both CT meters refuse
      it outright (`code 2009: not support this device`), so the meters can only be addressed by
      dp — `shared/deviceCapabilities.mjs`, `test/device-capabilities.test.mjs` (17 tests)
- [x] **EX-142** `npm run tuya:spec` — re-reads the vendor device model and diffs it against the
      committed catalogue, so a firmware change that moves a dp or rescales a value fails a check
      instead of silently turning 225.4 V into 2254 V. Profiles are matched to products by
      **dp→code fingerprint**, not by product id, which keeps vendor identifiers out of a public
      repo and is a stronger claim anyway. It earned its keep on first run: it caught a
      keying bug in itself (both meters are category `cz`, so keying products by category made
      the second look already-claimed), a false unit mismatch (the vendor writes both `kWh` and
      `kwh` on one device), and two real vendor quirks now encoded — `device_state` spells idle
      as `close` on channel 1 and `idle` on channel 2, and `relay_status` has three different
      vocabularies depending on which vendor path served it — `server/tuya-spec.mjs`,
      `server/tuyaSpecDiff.mjs`, `server/tuyaSpecDiff.test.mjs` (10 tests)
- [x] **EX-143** Source-tab dp parsers generated from the catalogue instead of hand-written, as a
      pure plan + dry-run-by-default runner in the established `outletPollPlan`/`healthWiringPlan`
      shape. **This closes the same undeclared-state hole as `findTimeout`:** every dp the system
      reads was decoded by a hand-written function node on a tab `build-flow.mjs` does not
      generate, so what the building measures could change with no diff and no alarm — and had.
      The generator preserves every context key those nodes already wrote (the legacy `/ui`
      dashboard, `Calculate 3-Phase Totals` and the bridge collectors all read them, and none are
      in this repo), and adds one: `<ctx>_dp`, carrying every decoded capability by code. A
      refusal check blocks any write that would drop a key, change a node's wiring, or touch a
      node nobody planned. The Aircon tab's second writer of `arec_health` is reported rather
      than rewritten — `node-red-bridge/dpParserPlan.mjs`,
      `node-red-bridge/fix-dp-parsers.mjs`, `test/dp-parser-plan.test.mjs` (22 tests).
      **APPLIED LIVE 2026-09-02** (`flows.json` backed up first, twice). All 12 generated nodes
      confirmed present on the live flow and correctly wired; `tuyaVersion`/`findTimeout`
      survived byte-identically (10x 3.5, 7x 3.4, 2x 3.3, all findTimeout 10000) and the node
      count was unchanged at 275. No parser errors in the journal — the only errors are the
      pre-existing CO4/CO5/CO6 `find()` timeouts (RM-020) and the unrelated solarman socket.
      Ingestion wrote 20 readings + totals every minute straight through the restart with no gap
      and no buffered rows.
      **NOTE ON THE LIGHT SWITCHES:** their capabilities populate only when a switch actually
      reports dps, and nothing polls them — the same gap FI-020 records for their freshness, and
      the same one `outletPollPlan` was written to close for outlets (FI-013). As of the apply,
      the seven lights carry `state` and `online` as before but no `capabilities` yet. A switch
      poller mirroring `outletPollPlan` is the obvious follow-up; it needs another flow write.
- [x] **EX-144** Two live data faults fixed by EX-143, both found while measuring rather than
      reported: (a) the outlet parsers read `add_ele` at **scale 2 when it is scale 3**, and
      **assigned** it when it reports energy *since the last report* — so every packet discarded
      the day's total and replaced it with one small delta. `co3` drew 74.8 W all day and
      reported 0.08 kWh, and that number reached `readings` and the monthly reports. (b) Nothing
      reset an outlet's energy at midnight — `Zero Out Energy Memory` clears the four CT meters
      and no outlet — so `co<n>_energy` was a lifetime counter being served as "today". Both are
      covered by tests that execute the generated parser and were confirmed to fail against the
      code they replace
- [x] **EX-145** `energy_kwh_today` now prefers the meter's **own** `today_acc_energy<channel>`
      over the value the legacy two-second engine integrates from power. Integration is the
      mechanism behind the frozen-meter corruption fixed in Aug 2026; measured 2026-09-02,
      `mtr_co_yellow` had integrated to 8.0437 kWh while the meter itself said 8.057. The
      channel suffix is load-bearing — one physical meter is two logical devices. Outlets are
      unaffected (they have no such dp). The week/month accumulator banks whatever
      `energy_kwh_today` carried, so the two cannot disagree —
      `shared/buildLatest.mjs`, `test/capability-readings.test.mjs` (11 tests).
      **APPLIED LIVE 2026-09-02 and read back.** `mtr_co_yellow` reported
      `energy_kwh_today = 8.64`, exactly its own `today_acc_energy1`, where it had been serving
      an integrated 8.0437 against the device's 8.057 an hour earlier. `mtr_lo_yellow` took
      channel 2 correctly (`0.377` = `today_acc_energy2`), and `mtr_arec_acu`'s value went from
      the integrator's `5.260075499999954` to a clean `5.306`. The vendor's own arithmetic
      checks out on the wire: `total_energy1 + total_energy2 = 29483.156 + 10939.39 =
      40422.546 = all_energy`, exactly. Outlets carry all 17 of their capabilities including the
      fault bitmap and the calibration coefficients. A meter that has not reported its telemetry
      dps since the deploy still shows the integrated fallback, which is the designed behaviour
      and self-heals on its next report.
- [x] **EX-146** `npm run mock:stop` refuses to stop a process that is not a mock bridge.
      It killed the **live Node-RED bridge** on 2026-09-02: on the Pi port 1880 belongs to
      Node-RED, so `npm run mock` cannot bind there and `mock:stop` is exactly what the bind
      failure invites you to reach for. The dashboard, ingestion and scheduler all lost their
      data source at once and nothing said why. Now matched on the process's own command line,
      with `--force` for the deliberate case; verified against the live bridge, which it now
      declines to touch — `mock-bridge/stop.mjs`, `test/mock-stop-guard.test.mjs`

- [x] **EX-147** `supabase/phase28_reading_capabilities.sql` — telemetry history beyond volts,
      amps and watts: four promoted columns for the questions worth asking of the history
      ("which branch tripped its power warning", "did this outlet report a fault before it went
      dark", "was it on the local segment or the cloud when it stopped answering"), plus a
      `capabilities` jsonb for the long tail so a vendor adding a dp does not need a migration.
      All nullable, no backfill, no index yet — the natural query is already scoped by the
      existing `(device_id, ts)`. The CHECK vocabularies are pinned to the capability catalogue
      by test, in both directions, because a drift there shows up as a gap in the history rather
      than as an error. **AUTHORED, NOT APPLIED** — see §0 —
      `supabase/phase28_reading_capabilities.sql`, `test/phase28-reading-capabilities.test.mjs`

- [x] **EX-152** `supabase/phase29_command_capability.sql` — `action = 'set'` joins `on`/`off`
      rather than replacing them, so every existing row and both existing readers
      (`server/reports.mjs`, the Control page's command log) are untouched. Three CHECKs: the
      action vocabulary, the capability allowlist, and a shape constraint making a capability and
      its value arrive together or not at all. The allowlist is pinned to
      `shared/deviceCapabilities.mjs` by test in both directions.
      **APPLIED AND VERIFIED 2026-09-03** — see §0 for the three signals —
      `supabase/phase29_command_capability.sql`, `test/phase29-command-capability.test.mjs`
      (7 tests)
- [x] **EX-153** The command contract gains a second verb. `validateCommand` accepts
      `{action:'set', capability, value}` and enforces every bound from the vendor's own device
      model — type, range, and the device's own step, because offering 1550 W when the hardware
      quantises to 100 W would show the operator a number it never held. Three refusals matter
      more than the acceptance: a capability the device does not have; a capability the VENDOR
      marks writable and this system does not (`relay_status`, `switch_inching`, `cycle_time`,
      `random_time` — each installs unattended switching inside the device, invisible to the
      scheduler and unrecordable in the audit trail); and the other channel's code on a
      dual-channel meter, which would arm the wrong branch circuit. `not_commandable` no longer
      blocks a meter — that rule is about relay state, and a meter genuinely has none while still
      holding an alarm threshold worth setting — `shared/commands.mjs`,
      `shared/deviceCapabilities.mjs`, `test/command-capability.test.mjs` (16 tests)
- [x] **EX-154** Cloud dispatch splits by instruction set, which is the brief's rule made
      executable rather than described. `/v1.0/devices/{id}/specifications` answers for the light
      switch (`tdq`) and the outlet (`pc`); both CT meters (`cz`) refuse it outright with
      `code 2009: not support this device`. So a product with a standard instruction set is
      commanded by code at `/v1.0/devices/{id}/commands`, and one without goes through the
      thing-model property endpoint at `/v2.0/cloud/thing/{id}/shadow/properties/issue`. The
      choice is returned as a value (`instruction: 'standard' | 'dp'`) so a test asserts on it
      instead of pattern-matching a URL — `server/dispatchCloud.mjs`,
      `server/dispatchCapability.test.mjs` (9 tests)
- [x] **EX-155** The dispatch gate learns the difference between a relay and a setting.
      `DISPATCH_CLASSES` answers "which classes have a relay route" and correctly excludes
      meters; gating a capability write on it would refuse every meter setting on grounds that
      have nothing to do with it. A capability write is gated by the catalogue's `writable`
      allowlist instead, re-checked at the last line before hardware rather than trusted from
      validation upstream. `capability_needs_cloud` is its own failure code, distinct from
      `no_dispatch_route`: one means the device cannot be commanded at all, the other means
      settings have no LAN endpoint yet and the vendor carried them —
      `server/auditedDispatch.mjs`, `server/dispatchLight.mjs`, `server/proxy.mjs`,
      `server/proxy.test.mjs`
- [x] **EX-156** The two controls the brief named are live: the child-lock badge is its own
      toggle, and the anomaly-threshold slider is bounded by the vendor's declared
      min/max/step. Neither shows an optimistic value — the device does not confirm a setting
      back, so the reading stays the only thing that says what it holds and "sending…" is the
      honest intermediate. The slider commits on release rather than on every pixel of the drag,
      and its draft records what it was dragged against so a value the device rejected cannot
      linger looking committed. Held in its own store rather than `commandStore`, whose
      optimistic machinery is typed for `SwitchState` and reconciled against relay readings —
      `src/stores/capabilityStore.ts`, `src/components/devices/capabilityWidgets.tsx`,
      `DeviceCard.test.tsx`
- [x] **FI-022** Capability writes have no LOCAL route — they reach hardware only through the
      vendor cloud. The three existing dispatch routes (`/light/:id`, `/outlet/:target`, `/acu`)
      are hand-built `http in` nodes on the source tabs, and a fourth means writing to the live
      flow: a plan module in the shape `dpParserPlan` already establishes, plus a generator
      change, since `build-flow.mjs`'s `httpIn` hardcodes `method: 'get'`. Until then a site with
      `DISPATCH_POLICY=local-only` cannot write settings at all, and one without internet cannot
      either — both fail honestly, with `capability_needs_cloud` naming the missing path.
      `server/dispatchLight.mjs`'s `hasLocalCapabilityRoute()` is the single place that says so
      **RESOLVED 2026-09-09 — this entry contradicted itself.** It stood as `- [ ]` here while
      `- [x] **FI-022 — capability writes reach the meters over the LAN. 2026-09-08.**` stood
      further down the same file. The later entry is the true one; this checkbox was simply never
      ticked when the work landed. Ticked now. Found by RM-059's audit, not by anything failing.

- [x] **EX-157** A 60 s poller for the light switches, closing the half of FI-013 that fix left
      out. A `tdq` switch volunteers its relay state when it changes and essentially nothing else,
      so the countdown, power-on mode, switch type and inching setting it also holds never
      arrived: measured on the Pi, all seven lights were online and reporting **1 of the 7 codes**
      their profile declares, while every outlet and meter had a full set — the outlets only
      because `outletPollPlan` already asks them. Sending `{ operation: 'GET' }` makes the tuya
      node answer on the same output a spontaneous report uses, so `tag L<n>` and `Collect status`
      handle the reply unchanged.
      Ids are derived from the node NAME, not flow order — the live flow lists them 2,3,5,6,7,4,1,
      so position would poll each light under its neighbour's health entry, skipping the wrong
      device. A light already flagged disconnected is skipped; one with no health entry is polled,
      because refusing would keep a never-reporting light silent forever. Fires 25 s into the
      minute, offset from the outlet poller's 10 s, so fourteen queries do not land on one radio
      segment at once. Both neuters (ids-from-position, skip-unknown) confirmed to fail the right
      tests — `node-red-bridge/switchPollPlan.mjs`, `node-red-bridge/poll-switches.mjs`,
      `test/switch-poll.test.mjs` (12 tests).
      **APPLIED LIVE 2026-09-03**, flows.json backed up first. 277 nodes (+2), `tuyaVersion` and
      `findTimeout` byte-identical across all 19 tuya nodes, no new journal noise. Within a minute
      every light reported **7/7 codes** — `switch_inching: "AAAC"`, `switch_type: "flip"`,
      `relay_status` decoding through the alias table — matching what the vendor cloud reports for
      the same product
- [x] **EX-158** A meter's daily counter is published as an **increment from where it stood at
      local midnight**, not as an absolute, plus a plausibility ceiling under both energy
      sources. EX-145 was right that the device's own `today_acc_energy<channel>` beats the
      integrated value, and it verified that on 2026-09-02 — including `mtr_lo_yellow` reading a
      clean `0.377`. What it could not know is that the register is only "today's" for as long
      as the DEVICE agrees a day has ended.
      **Measured 2026-09-03, after the site power cycle.** The same channel-2 register read
      **3625.021 kWh** while channel 1 of the same physical meter read a normal **3.477**. It was
      incrementing correctly on top of that offset — `cur_power2` was a believable 119.6 W and
      the locally integrated `lo_yel2_energy` was 0.825 kWh, which a 90 s sample confirmed accrues
      at 120.0 W against a measured 119.3 W (ratio 1.01, and 1.00–1.06 across all four channels).
      So the meter was measuring correctly and its daily accumulator had been corrupted; the
      power cycle is the only event between `0.377` and `3625.021`.
      The consequences were not confined to a wrong number on a card. `energy_kwh_week` and
      `_month` are `weekBase + energy_kwh_today`, so both read ~3,626. `enacc_mtr_lo_yellow` had
      banked `lastToday: 3625.011` and would have folded it into `weekBase` at the next local
      midnight, where no later fix could have separated it out. And `readings` had been carrying
      the figure since **2026-09-03T02:04:00Z**, four minutes after the deploy, into the tables
      the period reports and the Milestone 1 baseline are built from.
      The fix is `node-red-bridge/energyDayBase.mjs`: a function node between the arrival tracker
      and the build step, recording where each `today_acc_energy*` register stood when the local
      day began and publishing the difference. It re-anchors on two events — the local day rolling
      over at the site's own offset, and the counter going backwards, which is a device-side reset
      or a reboot and must not yield a negative. The anchor is **seeded from the integrated
      value** rather than from zero, so deploying it mid-day does not reset a dashboard somebody
      is watching to 0 and lose the morning.
      `SITE.max_branch_kwh_per_day` (100) is the backstop under both sources: beyond it the
      integrated value is preferred, and if that is implausible too the field is **omitted** — the
      same "no data and zero watts are different facts" rule the rest of the file follows. Sized
      against a building whose whole metered load averages 919 W, so it catches 3,625 without
      second-guessing a busy day.
      Runs in the SAME pass as `buildLatest`, unlike `snap.energyAcc` which is a tick behind by
      construction because it consumes the built rows. Executed by its tests rather than
      pattern-matched, following `arrivalTracker.mjs`; both guards were neutered and confirmed to
      fail the right tests (3 for the baseline, 2 for the ceiling) before being believed —
      `node-red-bridge/energyDayBase.mjs`, `shared/buildLatest.mjs`,
      `shared/sites/mmsu-nberic-care/site.mjs`, `test/energy-day-base.test.mjs` (14 tests).
      **The general lesson, and it has now cost twice.** `shared/channelSwap.mjs` records the
      first time this dual-channel meter mis-attributed energy. Both faults are the same shape: a
      vendor register that is correct until it is not, trusted as an absolute with nothing
      independent to check it against. The integrated value is the second opinion this system
      already had and was not using.
- [x] **EX-159** Concurrent commands share one readings fetch instead of each making their own.
      The Control page's master actions fire one command per socket with no await and no
      concurrency cap — fourteen for the outlets, seven for the lights — and `readDeviceOnline`
      independently pulled the **whole** `/api/readings/latest` document before each dispatch. One
      button therefore put fourteen simultaneous HTTP requests through the same Node-RED event
      loop that services the tuya nodes. Found 2026-09-03 while diagnosing RM-046, on a fleet
      already flapping at the access point: the app was amplifying the fault it was being used to
      diagnose, and the operator's report was "some connect for a while, then after a few tests
      they drop".
      **Coalescing, not caching**, and the distinction is the whole point. `readDeviceOnline`'s
      docblock was right that a cached online flag from thirty seconds ago is the same fabrication
      the HTTP 2xx was, so no TTL was introduced and nothing is retained once a request settles.
      Only a currently-in-flight promise is shared, and it is cleared in `finally` so a failed
      fetch cannot wedge every later command onto a rejected promise. A second test asserts the
      freshness half directly — a device taken offline **between** two sequential commands is
      still seen, which a cache would have missed — and it passed both before and after the
      change, which is what makes it a guard rather than a restatement of the fix.
      `server/proxy.mjs`, `server/proxy.test.mjs` (2 tests, 48 in the file)
- [x] **EX-160** Exponential back-off on failed discovery — `npm run backoff:pi`. The item
      `docs/adr-002-device-recovery-path.md` prescribed ("Back off on failed discovery rather than
      retrying at a fixed rate forever") and nothing ever built, closed on the day it finally
      mattered. With fourteen devices off the air (RM-046) every one sat in a
      `find()` -> timeout -> retry loop at a fixed 1 s: **~230 journal lines a minute, 12,386 in
      3.6 h**, load average near 3.5, and not one attempt able to succeed, because `find()` only
      locates a device that BROADCASTS and a 30 s listen heard three of twenty.
      The loop period is `findTimeout + retryTimeout` — 11 s as shipped. Backing `retryTimeout`
      off to a 60 s cap makes it ~70 s, which is the whole of the reduction.
      **It does not edit `retryTimeout` on any node, and that is the design.** That value, with
      `findTimeout` and `tuyaVersion`, lives only on the four hand-built source tabs, is declared
      nowhere in this repository, and losing it produces no diff, no alarm, and every device
      reading offline. Rewriting it to reduce log volume would be reintroducing exactly that
      hazard. Instead the back-off is applied at RUN TIME through the vendor node's own
      `CONTROL` / `SET_RETRY_TIMEOUT` operation — read out of
      `node-red-contrib-tuya-smart-device@5.4.0` rather than assumed: `src/tuya-smart-device.js`
      assigns `node.retryTimeout` at :206-214, and that same field is read by the reconnect timer
      at :367 and the re-find timer at :547 and :600. So nothing on disk changes,
      `findSettingsDrift` and `live-flow-baseline.json` stay valid, and **a Node-RED restart
      returns every node to its declared 1 s** — the safe direction to fail.
      **How it knows** is a core `status` node scoped to the tuya nodes on its own tab, which
      needs no change to any of them. Not `<ctx>_health`: that is per-tab flow context and a
      function node has no cross-tab read, the constraint `build-flow.mjs` was shaped around. It
      keys on the status FILL (`green`/`red`/`yellow`, :324-350), not the text — the text is the
      error message and varies, the fill does not. `yellow` is transitional and is ignored, so the
      schedule cannot come to depend on how many times the vendor node happens to say
      "connecting".
      Two properties worth stating because they are what make it safe rather than merely quieter:
      the **first** failure sends nothing, since the schedule's first step IS the declared value
      and a device that blips once costs zero messages; and a device is reset to 1 s **the moment
      it reports connected**, so a returning device is not left on a minute-long retry. Four
      neuters — no cap, no reset, no send-on-change guard, unscoped status node — were each
      confirmed to fail the right tests before any of this was believed.
      `node-red-bridge/discoveryBackoffPlan.mjs`, `node-red-bridge/apply-discovery-backoff.mjs`,
      `test/discovery-backoff.test.mjs` (23 tests)
      **APPLIED LIVE 2026-09-03**, flows.json backed up first. 285 nodes (+8), `findTimeout` and
      `tuyaVersion` byte-identical on all 19 tuya nodes afterwards, all six services up, the four
      meters undisturbed. Measured per device rather than in aggregate, because aggregate is what
      hid the first attempt: `CO1`'s successive `find()` timeouts went **11 s, 11 s, 12 s, 18 s,
      42 s, 70 s** — exactly `findTimeout` plus a doubling retry, capped. Fleet-wide the journal
      fell from **210-257 lines a minute to 42**, an 83% reduction, and load average from 3.07 to
      1.53.
      **The first deploy changed nothing, and said so nowhere.** The controller read the reporting
      node from `msg.source`; Node-RED's runtime puts it at **`msg.status.source`**
      (`@node-red/runtime/lib/flows/Flow.js`, `handleStatus`). The id never matched, every output
      was null, no error was raised, and the retry interval stayed at 11 s. The tests passed
      because the harness built the message the same wrong way — executing the shipped source
      rather than pattern-matching it is worth nothing when the INPUT is invented, which is a
      sharper version of the lesson `arrivalTracker.mjs` records. Two tests now pin the shape, and
      reverting the read fails 15 of 23.
      **One measured surprise, harmless:** the vendor node emits **two** red statuses per failed
      cycle (`setStatusOnError` then `setStatusDisconnected`, both calling `node.status`), so the
      schedule advances about twice as fast as the one-red-per-cycle design assumed — reaching the
      cap in roughly four cycles instead of seven. The cap bounds it and a green still resets it
      fully, so this is faster quiet rather than a defect; worth knowing before anyone retunes the
      constants.
- [x] **EX-161** (was FI-025) A node whose cached address has stopped existing is made to
      rediscover — `npm run stale-address:pi`. Measured 2026-09-03 after the AP renumbered its LAN
      (RM-046): **325 `EHOSTUNREACH` to one address and 323 to another** in 3.6 h, both leases that
      had been valid that morning, while devices in the ordinary not-found state produced far
      fewer. `tuyapi@7.7.1` `index.js:996-1002` is why — once `find()` resolves an address it
      caches it ON THE INSTANCE and every later call returns `Promise.resolve(true)` without
      broadcasting. `find()` is the only thing that can discover a NEW address, so such a node can
      never recover from a DHCP change; and it is not an exotic state, it is the normal fate of
      any device that has ever been reachable and then gone away. EX-160's back-off slows that
      loop without correcting its aim.
      **The remedy is not the obvious control operation.** `RECONNECT` reuses the instance, cache
      and all. `CONNECT` runs the vendor node's `initTuya()` — `new TuyaDevice(connectionParams)`,
      a fresh instance, and `connectionParams.ip` is `node.deviceIp`, empty on every node here.
      `DISCONNECT` is sent first because `closeComm()` clears the pending find timer; without it
      `startComm()` sets a second and the loop doubles.
      **No Node-RED signal carries the socket error, which was established by reading all three
      candidates rather than assuming.** The status TEXT is `'Error : ' + JSON.stringify(error)`
      and stringifying an `Error` gives `{}`; a CATCH node never sees these because
      `Node.prototype.error` only routes to one when passed a second object argument
      (`Node.js:570`) and the vendor logger passes one (`utils.js:27`); the node's own status
      OUTPUT carries `{state}` and nothing else. The text exists only in the journal.
      So detection comes from the mechanism instead, and is better for it: **a find/connect cycle
      cannot complete faster than `findTimeout` unless `find()` short-circuited.** The node goes
      yellow when `findDevice` starts and red when the cycle fails; a real find spends the whole
      `findTimeout`, a short-circuited one falls through to a connect that fails in well under a
      second. The threshold is taken per device from that node's OWN declared `findTimeout` — one
      of the values that lives only on the live flow — so it tracks reality instead of quietly
      ceasing to match it. An absent or nonsense value falls back to the vendor default and never
      to zero, because a zero threshold would classify every cycle as a short circuit and restart
      the whole fleet.
      Self-limiting: after a recovery the node really broadcasts, so its next failure is
      full-length, which resets the streak. An absent device gets one attempt, not a loop. Three
      consecutive short cycles are required and no device may be restarted more than once a minute.
      `node-red-bridge/staleAddressPlan.mjs`, `node-red-bridge/apply-stale-address.mjs`,
      `test/stale-address.test.mjs` (28 tests)
      **APPLIED LIVE 2026-09-03**, flows.json backed up first. 293 nodes (+8), `findTimeout` and
      `tuyaVersion` untouched. **The controller is confirmed RECEIVING**, which is not the same as
      the deploy succeeding: `bems_stale_recovery` in flow context carries an entry for all 17
      non-quiesced device nodes, each with `yellowAt` cleared — and only a red processed after a
      yellow clears it, so the full cycle round-trip is proven. All 17 read `hits: 0`, i.e. every
      observed cycle took the full `findTimeout`: correct, because the 12:24 Node-RED restart had
      already rebuilt every `TuyaDevice` and no device is currently in the stale state. The Aircon
      tab has no entry because both its nodes are quiesced and emit no status at all.
      **NOT PROVEN: the recovery path itself has never fired against real hardware**, because the
      condition did not exist while it was deployed. It is covered by tests and seven neuters; it
      has not been seen to restore a live device. The next AP or DHCP change is the test.
      **Two attempts, and the first one taught the more useful lesson.** It used a catch node,
      deployed cleanly, raised no error, and received nothing whatsoever — the same silent no-op
      shape as EX-160's first deploy. It was caught only because this controller's state lives in
      FLOW context and an empty key on disk is visible. That is why it lives there and the
      back-off's does not: the back-off's state describes `node.retryTimeout`, which a restart
      resets, so persisting it would be a lie. Observability was chosen per fault, not by habit.
      **And three of the seven neuters passed on the first run** — the re-entered-yellow, bare-red
      and per-device-threshold tests were all asserting on an output that is null either way, and
      one passed only because a recovery had coincidentally zeroed the counter it checked. Running
      the shipped source is not enough on its own; the assertion has to be able to fail.
- [x] **EX-162** (was FI-024) The master actions dispatch at most four commands at once, and the
      premise the item was filed on was wrong. FI-024 said the hazard was device socket
      contention: `OutletPlanCard` fires both sockets of one physical device in the same instant
      and a Tuya device accepts one inbound session. **It is handled a layer down.** `tuyapi`
      serialises per device already — `index.js:410`, *"Queue this request and limit concurrent
      set requests to one"* — so there was never a race at the socket. Recorded here because the
      entry had been written from the documented constraint rather than from the library, and
      checking took ten minutes.
      **The real cost is on the proxy side and in the browser.** Every command independently
      writes an audit row BEFORE anything is dispatched — record-then-act, `auditedDispatch.mjs`
      — with a 5 s timeout against Supabase, and the browser abandons its own request after
      `COMMAND_TIMEOUT_MS`, also 5 s. Fourteen at once against a Pi makes a client-side timeout
      likely, and a timed-out command is shown to the operator as FAILED while the relay may well
      have moved. This project has twice been burned by a working command reported as a failure;
      a burst that manufactures that report is worth bounding. Four, so fourteen still drain in
      four rounds.
      **Two things had to be got right, and one of them the fix nearly broke itself.**
      `reconcile`'s 30 s leak guard measures from `issuedAt` to decide a command never reached
      the bridge, and `reportedSince` compares a reading against it. Stamping at QUEUE time would
      let the queue manufacture exactly the false failure the cap exists to prevent, so
      `issuedAt` is re-stamped at dispatch — which is also what both readers already meant.
      And **the uncontended path must not defer**: awaiting even an already-resolved promise
      costs a microtask, and nine `ControlPage` tests assert `sendCommand` is called
      synchronously on click. That is not test pedantry — it is the guarantee that a single
      command behaves exactly as it did before the cap existed. Only a contended one waits.
      A command superseded while still QUEUED is now dropped rather than sent: all-off then
      all-on no longer puts the off commands on the wire behind the on ones. That changed what
      the existing supersede test was exercising, so it now lets the first command reach the wire
      before superseding it — the late-ack case it was always about.
      Four neuters — no cap, no `issuedAt` re-stamp, no superseded-while-queued guard, leaked
      slot — each fail the right tests. The queue counter is module state that outlives
      `setState`, so `resetCommandQueueForTests` clears it between tests; without it one leaked
      slot made nine unrelated tests time out at once, which is how the leak was found.
      `src/stores/commandStore.ts`, `src/stores/commandStore.test.ts` (4 tests, 15 in the file)
      Frontend-only: no flow write, no deploy to the Pi needed beyond the dashboard build.
      **Confirmed deployed 2026-09-03**: `dist` was rebuilt at 16:01, a minute after the commit,
      the served bundle contains the cap, and nothing under `src/` has changed since.

- [x] **EX-163** The fleet alarm can now report an outage that started before the daemon did.
      **It could not, and that is not theoretical — it is why nobody was told about RM-046.** The
      fleet fell from 18 devices to 4 after the site power cycle and stayed there for **nine
      hours with no alert at all**, on a deployment where `NTFY_TOPIC` is configured and the
      channel works. `ibems-ingest` restarted at 07:51 with sixteen devices already offline, and
      `createFleetAlarm` only counts a device as down once it has seen that device UP — so none
      of the sixteen ever qualified, `down` stayed empty, and the alarm never armed.
      The module's own docblock claimed the opposite: that the in-process state resetting on
      restart *"re-arms the alarm — correct, because a restart is also when the operator is most
      likely to want to know the fleet came back up wrong"*. A restart **disarms** it, for exactly
      the devices that are already broken, which is precisely that case. The reasoning behind
      `everOnline` was sound — the quiesced IR blaster and outside-temp sensor would otherwise
      hold the fleet over threshold forever — and the conclusion drawn from it was backwards.
      `createFleetAlarm({ knownOnline })` is seeded from the devices that reported online in the
      last **7 days**, which the database already knows. Seven rather than all history so a
      decommissioned device cannot alarm for being absent, and long enough to cover a weekend
      plus a holiday. The furniture guard is intact by construction: a device that has NEVER
      reported online has no history and still cannot contribute.
      **A failed seed degrades to the old behaviour, never to alarming on everything** — it is a
      database read, databases are unreachable sometimes, and a read that fails must not
      manufacture a fleet alarm. Anything that is not an array of strings is ignored rather than
      trusted, and the daemon logs which of the two states it started in rather than leaving it
      to be inferred.
      Both guards were neutered and fail the right tests (3 for the bad-seed guard, 7 for the
      seeding itself) — `server/fleetAlarm.mjs`, `server/ingest.mjs`,
      `server/fleetAlarm.test.mjs` (6 tests, 17 in the file)
      **AND THE SEED ITSELF HAD THE SAME CLASS OF BUG, found within the hour by checking rather
      than trusting the log line.** It asked one bulk question — `readings?online=is.true&limit=20000`
      — and got **1,000 rows back out of 145,350 matching**, because PostgREST caps result sets
      server-side and says nothing about it. The distinct devices in that arbitrary slice were 15
      of 18, so the seed silently restored the blind spot for three devices. The daemon logged
      "seeded with 15 device(s)" and looked like a success.
      This project has met that cap twice before — `supabaseHistory.ts` carries `assertNotTruncated`
      and `demand-profile.mjs` paginates around it — which is what makes writing it a third time
      worth a test rather than a comment. `loadKnownOnline` now asks **one device at a time** with
      `limit=1`. Pagination would also work; per-device cannot be wrong, the fleet is twenty
      devices, and the answer no longer depends on how many rows a server decides to return.
      A device whose own query fails is omitted rather than assumed good — this feeds an alarm,
      and a wrongly seeded device would let a transient read failure raise a fleet alert.
      **Live after the fix: "seeded with 18 of 20 device(s)"** — and the two excluded are exactly
      `acu_main` and `sens_outside_temp`, which have never been paired. The furniture guard and
      the blind-spot fix are both doing their job, and the log line now names the denominator so
      a short seed is visible instead of plausible.

- [x] **EX-164 — LOCAL CONTROL RE-PROVEN ON A HEALTHY FLEET, 2026-09-03 20:39.** The proof that
      could not be run while the fleet was down (see the note under RM-046): every commandable
      device was locally unreachable, so any command would have taken the `local-first` cloud
      fallback and proved nothing about the LAN path.
      Two light commands issued from the browser by the operator, read back from the audit trail:
      `l1` and `l2`, both `status: dispatched`, both **`via: local`**, accepted in ~110 ms and
      ~300 ms. `via=local` is dispositive on vendor calls by construction — `dispatchCommand`
      only reaches the cloud when the local attempt has already failed.
      **Corroborated against the hardware rather than the ack**, which this project has twice been
      burned by: `global.lightStatus` — the flow's `Collect status` reading `dps['1']` off the
      device — showed `L1 on=false` and `L2 on=false` afterwards, with `L7 on=true` unchanged
      beside them. The relays moved; an HTTP 202 alone would not have said so.
      Also worth recording because it is the shape of a real failure: the audit rows for this
      morning's testing show **12 of 14 `via=local` and 2 `via=cloud`**, each cloud row carrying
      *"local failed (the bridge reports this device offline, so a local SET cannot reach it);
      recovered via cloud"*. That is `local-first` doing exactly what it is for, on a fleet that
      was flapping — and it is the reason the site is not on `local-only` yet.
- [x] **EX-166** The ingestion path has an opinion about what it is storing. `shapeRows.mjs`'s
      `splitLatestPayload` was seven `?? null` assignments — no type check, no finiteness check,
      no range check, no timestamp check, nothing at all between the bridge and `readings`. That
      is how 3,625 kWh for one day on a circuit averaging 36 W landed in Supabase on 2026-09-03
      and had to be repaired by hand. The bridge grew a backstop for that one field afterwards
      (`SITE.max_branch_kwh_per_day`, applied in `buildLatest`), but the bridge deploys separately
      from this daemon and can be older than it, so the write path still checked nothing.
      **Three rules, each the way round it is for a reason.** *Omit, never zero* — a refused field
      becomes `null`, matching `buildLatest`'s `num()`; "no data" and "zero watts" render
      differently and only one of them averages into an hourly rollup. *Never drop a row for a bad
      value* — `online` carries the truth about the device and this series has no holes at all, so
      one bad field must not cost the other six. *A row with no usable timestamp is not a row* —
      `ts` is half the upsert key so it cannot be nulled, and substituting the receipt time would
      fabricate **when**, which is the same class of harm as fabricating a value and much harder
      to notice later.
      **The timestamp rule is availability protection, not tidiness.** `iso8(NaN)` returns the
      literal string `"NaN-NaN-NaNTNaN:NaN:NaN+08:00"`. Postgres rejects it with a 400,
      `writeOrBuffer` appends the whole batch to the outage buffer, and `flushBuffer` replays that
      buffer at the head of every subsequent cycle and re-persists the remainder on the first
      error — so one permanently-invalid row sits at the head of the queue for ever and every
      reading behind it stops reaching Supabase. A single malformed timestamp wedges ingestion
      permanently, and it would read as a database outage.
      **The bounds are sized against the building, measured, not guessed.** `SITE.telemetry_bounds`
      and `max_building_kwh_per_day` are new; the vendor catalogue cannot serve here because it
      declares ranges for settings and enums and **none** for `cur_power`, `cur_voltage` or
      `cur_current`. Over 610,989 readings across 22 days the fleet's extremes are 241.8 V,
      15.974 A, 3,091 W per device and 4,551 W for the building; every bound clears its measured
      extreme with room, because the two errors are not symmetrical — a stored odd value is
      visible and arguable, a discarded real one is gone.
      **Verified on real data, not only on fixtures.** A full live day replayed through the real
      module — 28,775 `readings` plus 1,440 `building_totals` — gives **0 rejections and 0 rows
      dropped**; the current live payload gives 0 of 21. The 2026-09-03 value replayed through the
      same path is omitted rather than zeroed, every other field on its row survives, and the
      reason recorded is `lo_yel2.energy_kwh_today=3625.108 outside [0, 100]`. Six neuters of the
      scrub and three of the wiring each fail the right tests.
      **What it does NOT catch, stated in the module itself.** co5 reported 72.427 kWh for the
      local day of 2026-09-06 against 2.268 kWh integrated from its own power — 32-fold, and
      comfortably inside a 100 kWh bound. A bound wide enough to be safe cannot catch a value that
      is merely wrong; narrowing it until it could would discard real readings. See RM-047, which
      is the actual cause and is still live.
      Also fixed here because the new code runs inside it: `splitLatestPayload` sat outside every
      try/catch in `ingestCycle`, so a malformed bridge body threw straight past `updateHealth` —
      the same fault that file's header describes for the fetch path, left standing one line below
      the fix for it. It now has its own `payload` stage, told apart from `bridge` in the journal.
      `server/scrubTelemetry.mjs` (+28 tests), `server/healthRow.mjs` (+13),
      `server/shapeRows.mjs`, `server/ingestCycle.mjs` (+9), `server/ingest.mjs`,
      `shared/sites/mmsu-nberic-care/site.mjs`, `supabase/phase30_ingestion_scrub.sql`

- [x] **EX-165** Outlet parity: a socket reports what the RELAY is doing, and an unattended
      device-level command reaches both sockets. **Three defects, one cause — outlets were
      second-class on every path switches had already been fixed on**, and the operator found it
      by testing the building by hand on 2026-09-07 rather than by reading anything.
      **What was reported:** Light Switch 7 passed all six of its tests including its schedule and
      the wall switch syncing to the app. Outlet 5 passed manual and remote control, **its
      schedule never fired**, and **pressing its button did not update the app**.
      **1. Measured socket state (FI-023 for the class it left out).** The two branches sat
      adjacent in `buildLatest`: the switch one prefers `lightStatus[n].on` over the commanded
      value; the outlet one four lines below read `bems_outlets_state` alone — written by the
      `Outlet Logic Hub` from an incoming COMMAND, never corrected by hardware. The measured value
      was already arriving and being ignored: every outlet reports real `switch_1`/`switch_2`
      booleans on `capabilities` every poll, verified across all seven the same day. Now preferred
      per socket, falling back to commanded, `typeof === 'boolean'` rather than truthiness because
      flow context survives restarts on disk. Four neuters each fail the right tests.
      **2 and 3. `socket: null` on both unattended callers.** `resolveTarget` refuses a
      dual-socket outlet without a socket — measured: `l7` at `socket:null` gives `ok:true`
      target `L7`, `co5` gives `ok:false socket_required`. The Automation page cannot express a
      socket at all (`supabaseConfig.ts:122` reads and writes `.is('socket', null)` exclusively),
      and `shedPlan.mjs:62` hard-coded `socket: null` on every target. So **no outlet could be
      scheduled and no outlet could be shed** — all seven, not just Outlet 5.
      **The shed half was never reported because nobody had armed it, and it is the worse one.**
      All 14 devices are tiered: `group_1` is the seven switches (~16 W of a 919 W demand),
      `group_2` and `group_3` are all seven outlets — **561 W, 61% of metered demand**. RM-006c
      calls arming auto-shed "one save from the Automation page"; doing that would have shed the
      lighting, escalated through both outlet tiers, failed silently on every one, and stayed over
      the 2.21 kW ceiling. The escalation ladder below the lighting tier was refusals.
      `fanOutCommand` expands a device-level intent into per-target commands, honouring the rule
      `shared/commands.mjs` has always stated — *"A UI wanting 'turn off Outlet 3' fans out to two
      commands itself"* — which the Control page obeyed and the two unattended callers never did.
      An already-targeted command passes through, checked with `!= null` rather than truthiness
      because socket 0 is invalid but falsy. Each socket gets its own `fire()` and its own audit
      row, so a partial failure reads as one dispatched and one failed. No migration:
      `UNIQUE(device_id)` stays and `phase6_schedules_unique_fix.sql`'s reasoning holds.
      **A GREEN TEST WAS ASSERTING A SCENARIO THE APP CANNOT PRODUCE, and that is why this
      survived.** `scheduler.test.mjs`'s "an outlet schedule now fires too" passes
      `dueNowRow({ device_id: 'co1', socket: 1 })` — it *supplies* a socket. `dueNowRow`'s own
      default is `socket: null`, which is what the UI writes for every schedule. The test proved
      outlet scheduling works given a socket, and nothing in the system could give it one. The new
      test uses the shape the application actually emits; removing the fan-out fails it and leaves
      the old one green.
      `shared/buildLatest.mjs`, `shared/commands.mjs`, `server/scheduler.mjs`,
      `test/outlet-measured-state.test.mjs` (9), `test/socket-fanout.test.mjs` (11),
      `server/scheduler.test.mjs` (+2)

- [x] **FI-023** A switch's `state` is what the RELAY is doing, not what was last asked of it.
      `buildLatest` derived it from `bems_lights_state`, which the flow's `Lighting Logic Hub`
      writes from an incoming COMMAND before forwarding it to the device — a record of intent,
      never corrected by the hardware. So the app could not notice a light switched at the wall,
      by its own schedule, or by a command that silently failed.
      It did not notice: on 2026-09-03 the dashboard showed all seven office lights off while the
      devices reported all seven on, confirmed independently by the vendor cloud, which reaches
      them over the internet rather than the local subnet. The primary display of a building
      energy management system was reporting seven circuits as off while they were on.
      The measured value was already present — `Collect status` has always maintained
      `lightStatus[<n>].on` from `dps['1']`, and this function read only `.conn` from that same
      entry. It is now preferred, with the commanded value kept as the fallback so a flow or mock
      carrying no lightStatus is unaffected, and the check is `typeof === 'boolean'` rather than a
      truthiness test because flow context survives restarts on disk and a half-written entry must
      read as absent rather than as ON. An offline switch reports its last MEASURED value:
      stale-but-real beats fresh-but-imagined, and `online: false` is what says how much to trust
      it. Both halves confirmed to fail the right tests when neutered —
      `shared/buildLatest.mjs`, `test/switch-measured-state.test.mjs` (7 tests).
      **NOT YET DEPLOYED.** `buildLatest` is inlined into the generated flow, so this needs
      `build:flow` + `deploy:pi --force --apply`, and it changes what command confirmation MEANS:
      `commandStore.reconcile` previously compared against the value the command itself had just
      written, so a light command confirmed instantly and "confirmed" meant nothing. It now waits
      for the device, which is correct — and means a light that does not report inside the 6 s
      `COMMAND_CONFIRM_MS` window would show as failed when it worked. Lights push on change and
      are now polled every 60 s (EX-157), so that should be comfortable, but it is unproven: at
      the time of writing 0 of 7 lights are reachable (RM-013), so the first light command after
      this deploys is the one to watch
      **APPLIED LIVE 2026-09-03 20:47**, flows.json backed up first. It had been sitting
      committed-but-undeployed for six hours — the flow was last rebuilt at 12:24, before this
      commit landed, so the running bridge carried EX-158's day baseline and NOT this. Caught by
      grepping the DEPLOYED `Build latest readings` for `switchHealth` rather than trusting the
      repo, which is the same lesson `1f9bed3` already carries under the title "A commit is not a
      deploy". Anything that edits `shared/buildLatest.mjs` needs `build:flow` +
      `deploy:pi --force --apply`, and nothing warns you.
      293 → 293 nodes, `findTimeout` 19/19 intact, and EX-160's and EX-161's controllers (8 + 8)
      survived the `--force` because they live on the SOURCE tabs, not the bridge tab.
      All seven lights now report a `state` matching `global.lightStatus[n].on`.
      **That check is weaker than it looks and the discriminating test is still owed:** commanded
      and measured currently AGREE on all seven, so agreement proves the field is populated, not
      that it follows the hardware when the two diverge. **Flip a light at the wall and confirm
      the app follows it** — that is the observation this entry was written for, and it needs a
      person in the room.
### Data & Supabase

- [x] **EX-080** Base schema: devices, readings, building_totals, ingestion_health — `supabase/schema.sql`
- [x] **EX-081** RLS lockdown; no anon policies anywhere — `supabase/phase5_lockdown_rls.sql`
- [x] **EX-082** Schedules and DSM thresholds, including the partial-unique-index upsert fix — `supabase/phase6_schedules_config.sql`, `supabase/phase6_schedules_unique_fix.sql`
- [x] **EX-083** Device config as a sibling table, so ingestion's periodic re-upsert cannot null out human edits — `supabase/phase7_device_config.sql`
- [x] **EX-084** Anomalies table, service-role write, authenticated-select-only — `supabase/phase8_anomalies.sql`
- [x] **EX-085** `readings_buckets` RPC: server-side time-bucketed history, averaging only online samples, `security invoker` so RLS still applies, and raising rather than truncating — `supabase/phase9_history_buckets.sql`
- [x] **EX-086** `readings_hourly` rollup table plus an atomic roll-up-and-prune function — `supabase/phase9_readings_hourly.sql`
- [x] **EX-087** A narrow update policy letting a command's own outcome be attached to its audit row: own row, only while in flight, only to a terminal status — `supabase/phase9_command_outcome.sql`
- [x] **EX-088** `readings_archive` RPC merging `readings_hourly` and `readings` into one series, deduplicating the seam, weighting coarser buckets by each hour's own sample count, and raising rather than fabricating a sub-hour grain — `supabase/phase10_history_archive.sql`
- [x] **EX-089** `building_totals_hourly` plus atomic rollup-and-prune, an outright `anomalies` prune, and the `ts` indexes the prune predicates always needed — `supabase/phase11_totals_retention.sql`
- [x] **EX-090** `monthly_reports` / `monthly_building_reports` and an idempotent generator: energy as a sum of daily maxima, days grouped in the site timezone, coverage recorded on every row — `supabase/phase12_monthly_reports.sql`

### Auth & security

- [x] **EX-108** Supabase Auth with a login screen; the proxy verifies the caller's own token — `src/components/auth/LoginPage.tsx`, `server/proxy.mjs`
- [x] **EX-109** Command audit rows attributed to the real signed-in user, inserted with the caller's token so RLS grants it — `server/proxy.mjs`
- [x] **EX-110** Remote access over the tailnet, verified working from off-site
- [x] **EX-111** Anon key only in the browser bundle; the service-role key is read solely by the ingestion daemon — `src/config/supabase.ts`, `server/.env.example`

### Testing & tooling

- [x] **EX-120** 607 frontend tests (vitest) — `src/**/*.test.ts(x)`
- [x] **EX-121** 348 bridge/contract tests, including assertions that the generated flow contains no write nodes and no MQTT — `test/`
- [x] **EX-122** 356 server tests against real spawned processes and hand-rolled fake HTTP servers, no mocking library — `server/*.test.mjs`
- [x] **EX-105** Environment hygiene is checked, not trusted. A module that is *imported* must
      not reconfigure the process: `server/envHygiene.test.mjs` imports each route module in a
      clean child process and asserts it added no keys to `process.env`, and separately greps
      for a module-scope `loadDotEnv`. **Both halves are needed.** The behavioural one is asleep
      on any checkout without a `server/.env` — `loadDotEnv` is a silent no-op there, so it
      passes vacuously on precisely the machines where the bug does no harm, and would have
      caught RM-022 nowhere. The source-level half fails anywhere.
      This is the same shape as EX-091: the mistake is invisible to types, survives a green
      suite, and the only reliable guard reads the source — `server/envHygiene.test.mjs`
- [x] **EX-131** The MQTT broker no longer accepts anonymous connections from the device network.
      It listened on **every interface** with `allow_anonymous true`, on 1883 and on a
      websockets listener at 9001, sharing the 2.4 GHz segment with the field devices. Anything
      associated to that SSID could read every topic and publish to any of them. That was
      already wrong and was about to get worse: RM-026's chosen bridge can **write** to the
      inverter.
      **Bound to loopback rather than password-protected, and the evidence chose that.** Across
      the retained logs the broker has seen **70 connections, every one on 1883 and every one
      from loopback** — zero off-host, ever. Node-RED, its only real client, connects to
      `localhost`. Credentials would have secured a door nobody uses, and would have required a
      live flow write to carry them into the broker config node.
      **Both loopback families.** `localhost` resolves to `::1` on this host as well as
      `127.0.0.1` and the logs show both in use, so a single `listener 1883 127.0.0.1` would
      have silently locked out whichever the resolver happened to prefer. Validated on a spare
      port before going near the live service, precisely because that failure would have looked
      like a broker fault rather than a config one.
      **The websockets listener is retired, not merely closed.** It was added for a
      "browser-based digital twin" that was never built and had **never carried a connection** —
      an open, anonymous listener on the device network with no consumer is pure attack surface.
      **This configuration exists only on the Pi, and nothing in this repository declares it** —
      the same shape as `findTimeout`/`tuyaVersion`, where a rebuild or a package upgrade
      restores the permissive default with no diff and no alarm. Recorded in `CLAUDE.md`'s site
      facts for that reason, and in `docs/pi-session-brief.md` — which is what a session
      actually reads before touching the Pi — with timestamped `.bak` files beside both config
      files.
      *Verified after the change:* Node-RED reconnected within fifteen seconds under its
      existing client id, the Pi's own LAN address refuses 1883, loopback still accepts, 9001 is
      closed, and all six services stayed active with the fleet unchanged.
      *Deliberately left anonymous on loopback:* only processes on the Pi can reach it now, and
      anything with local execution there has far better options than the broker. Adding
      credentials would have bought little and cost a flow write.
      `/etc/mosquitto/mosquitto.conf`, `/etc/mosquitto/conf.d/bems.conf` (both on the Pi only)
- [x] **EX-130** An internet outage no longer removes control of the building.
      **THE GAP, WHICH WAS NOT WHERE ANYONE WOULD LOOK FOR IT.** The Tuya fleet is local: the
      devices sit on the Pi's own L2 segment, answer local keys, and dispatch has always
      preferred the local path with the vendor cloud as fallback. Commanding them needs no
      internet at all. Two things needed it anyway — `handleCommand` verified every session by
      calling `/auth/v1/user`, and `auditedDispatch` wrote the audit row to Supabase *before*
      dispatching — and between them the effective offline command window was **zero**. A WAN
      outage removed every control in the building while the device layer sat there working
      perfectly. Break-glass sessions authenticate locally and last 12 h, but are view-only by
      design, so they did not cover it either.
      **NEITHER SAFETY PROPERTY WAS RELAXED.** Sessions are still verified, and a relay still
      cannot move without the command being recorded first. What changed is that "recorded"
      stopped meaning "recorded in Supabase" and started meaning "recorded durably somewhere we
      control". `auditedDispatch`'s contract is untouched — the durability is supplied by
      wrapping the injected `insertAudit`/`updateAudit`, not by editing the rule.
      **The distinction the whole design turns on: a 4xx is an ANSWER, a throw is an outage.**
      Supabase replying "this caller may not write that row" is an authorization decision and
      still refuses; only a transport failure may be buffered. Laundering a refusal into a local
      queue entry and then moving a relay on the strength of it is the one genuinely dangerous
      mistake available here, and it is the first thing the tests pin.
      **No new secret and no new dependency.** Access tokens are ES256 and the public key is
      published at `/auth/v1/.well-known/jwks.json` — *measured, not assumed*; `node:crypto`
      verifies ES256 natively. A shared JWT secret would have meant adding the most powerful
      credential in the auth system to `server/.env`; a cached public key is not a secret at
      all. The cache persists to disk, because a proxy restarted **during** an outage would
      otherwise silently lose offline capability at the worst possible moment.
      **Network-first, deliberately.** The remote check is authoritative and is the only one
      that notices a session the user has since signed out of; local verification cannot see a
      revocation. So it stays primary and its answers are never second-guessed — the offline
      path applies only when the question could not be *asked*. That is strictly weaker, and it
      is used only when the alternative is losing the building.
      **`alg` is not negotiable.** The oldest JWT break is a verifier that reads the algorithm
      out of the header and obeys: `none` accepts anything, and `HS256` lets an attacker HMAC
      a token using the public key as the shared secret — public, by definition. This verifies
      ES256 and nothing else, and a test forges both.
      **Rotate, never truncate.** Two processes touch the buffer: the proxy appends, ingest
      drains. Read-then-truncate would silently drop a row appended in between — a lost audit
      row for a relay that really did move, which is precisely what the trail exists to prevent.
      `rename(2)` is atomic, so a concurrent append lands in a fresh file. *Stated honestly:
      that atomicity is not covered by a test.* An interleaving hook can only be placed where a
      window exists, and the correct implementation has none — an attempt to add one passed
      against a deliberately broken copy-then-truncate version, so the hook was removed rather
      than left implying a guarantee it never gave.
      **Replay needed no new mechanism.** The buffer entry shape matches the one `ingest.mjs`
      already drains, `requested_by` travels *in the row* so attribution survives an upload
      under service-role credentials, and the outcome is amended into the buffered entry before
      it is ever sent — so one correct row replays, with no migration, despite `command_id`
      carrying no unique constraint.
      **The operator is told.** `/api/capabilities` reports the backlog and the Control page
      says so when it is non-zero, silent otherwise. A command accepted into a local buffer is
      not the same fact as one recorded in the audit table, and this project does not let the
      UI claim the stronger one.
      *Break-glass remains view-only* — the operator's decision, and a test pins it, because an
      outage is exactly the circumstance that could quietly promote it.
      **BOTH CALLERS, NOT ONE.** The first version of this covered only the proxy, which left
      `scheduler.mjs` — schedules and auto-shed — still unable to record and therefore skipping
      every command during an outage. It failed *closed*, so nothing unsafe happened, but a
      scheduled lights-off silently not running is a real cost in a building, and it recreated
      exactly the asymmetry `auditedDispatch`'s own docblock exists to prevent: one safety
      contract, two callers, different behaviour. The scheduler is worth covering precisely
      because it keeps working through an outage — its schedules and thresholds are held in
      memory and only *refreshed* from Supabase, so it goes on evaluating with nothing to
      record against.
      **One buffer file per writing process.** Both processes amend their own entry after
      dispatch, which is a read-modify-write; `writeBuffer` rewrites the whole file, so two
      processes sharing one would let a concurrent reader see a partial file and let the loser
      of the interleaving discard the other's rows. Separate files remove the race outright
      rather than narrowing it, and cost nothing — `ingest.mjs` drains a list. The backlog
      reported to the UI sums both, because "the audit trail is behind" is one fact about the
      system.
      **A test leaked a fabricated command into the production queue, and that is now guarded.**
      While these tests were being written, a full-suite run left a fake `l1` command in
      `server/data/command-audit-buffer-scheduler.ndjson` — a row `ingest.mjs` would have
      uploaded into the **real** audit trail on its next tick, attributed to a test user. The
      cause is instructive rather than careless: the harness closes its fake Supabase while a
      command is in flight, and a socket dying mid-request is indistinguishable from a real
      outage, so it buffered exactly as designed. Every spawn in both harnesses now redirects
      its state under `os.tmpdir()`, and `server/testStatePaths.test.mjs` reads the source to
      keep it that way. *Source-level because the behavioural version cannot be written:* the
      leak depends on a teardown race that does not reproduce on demand — deleting the fix and
      re-running the file produced nothing. The guard found a third unredirected spawn site on
      its first run.
      `server/jwtVerify.mjs`, `server/jwksCache.mjs`, `server/auditQueue.mjs`,
      `server/proxy.mjs`, `server/ingest.mjs`, `server/scheduler.mjs`,
      `server/testStatePaths.test.mjs`,
      `src/components/control/AuditBacklogNote.tsx`, `src/stores/capabilitiesStore.ts`
- [x] **EX-132** A stylesheet token that never existed, in five shipped declarations — and a
      guard so it cannot happen a sixth time. `91f94d5`, `test/design-tokens.test.mjs`.
      `var(--text)` was used in RM-028's and RM-030's CSS. **There is no `--text` in this
      project**; the text colour is `--txt`. An undefined custom property is not an error — CSS
      drops the declaration and the element inherits whatever colour is in scope.
      **Measured, not inferred:** `.space-tree-panel__name` rendered at **1.14:1** in dark mode,
      `rgb(30,41,59)` on `rgba(30,30,30,.75)`. The space tree's node names — the labels of the
      feature itself — were very nearly invisible. The same applied to the tree's form inputs,
      the by-space `<select>`, and `.space-totals-card__value`: the average-power figure. They
      now measure **13.61:1**.
      **Nothing in the pipeline could have caught it.** `tsc` does not read stylesheets; vitest
      renders in jsdom, which computes no cascade worth checking; the contrast guard FI-008
      proposed was never built. It took reading computed colours out of a real browser in both
      themes — which is what CLAUDE.md's "check contrast in BOTH themes" is asking for.
      The guard is narrower than FI-008 and complements it rather than closing it: it fails any
      `var(--token)` without a fallback naming a token `src/index.css` does not define, across
      every `.ts`/`.tsx`/`.css` file. **It is not a contrast checker** — a token that exists can
      still be unreadable on a given background, and only a browser can measure that.
      **Neuter-checked:** reintroduce `var(--text)` anywhere and the test fails naming it.
      *Method note worth keeping:* a contrast reading taken straight after a theme toggle is
      unreliable — the card surface cross-fades, and a stale glass value produced two false
      alarms before I noticed. Measure on a clean load in each theme.
- [x] **EX-133** **Staleness is a per-device budget, not one constant** — the fault behind
      "the outlet keeps flipping between stale and live while Node-RED says it is connected".
      `TIMING.STALE_AFTER_MS` was 30 s for every device, while the classes report on cadences an
      order of magnitude apart. **Measured on the Pi 2026-09-01, 119 samples over 240 s:** every
      live outlet and the near-idle branch meter peaked at **59.9 s** of reading age, because
      `outletPollPlan` asks an outlet for its state once a minute and nothing else asks it
      anything. So every one of them was flagged stale for **half of every minute**, forever, on
      hardware working perfectly. Switches never flagged at all — `buildLatest` stamps
      `ts = now` for them, so their freshness is unmeasurable rather than good.
      `isReadingStale` has **fifteen call sites**, so one constant drove all of: the Devices
      table flipping LIVE↔STALE, the alerts bell raising and clearing a COMM FAULT once a minute
      per outlet, the 3D scene desaturating, and — the expensive one — `commandStore.reconcile`
      reporting a relay that had genuinely moved as "the device did not report the new state".
      The budget now travels on the reading (`Reading.stale_after_ms`), resolved by the bridge in
      `shared/registry.mjs`'s `STALE_AFTER_MS_BY_CLASS`. **The bridge is the right author
      because it owns the poller** — it is the only party that knows an outlet cannot report
      faster than 60 s — and a copy of that table in `src/` would be free to disagree with the
      thing it describes, which is exactly what the single 30 s was. A site may override per
      device in its own directory (Track B). `online: false` still wins over any budget: that is
      the bridge saying it has no connection at all, and no budget may launder it into "fresh".
      **Two of this repo's own guards shaped the result** — the device-naming guard caught a
      device id in a new comment, and the site-composition guard caught a first version
      decorating `DEVICE_REGISTRY`, so the table is threaded into `buildLatest` as a parameter
      like `offsetMinutes` instead. *Requires a flow rebuild* (`build:flow` + `deploy:pi
      --force --apply`), because `build-flow.mjs` inlines the registry —
      `shared/registry.mjs`, `shared/buildLatest.mjs`, `src/lib/staleness.ts`,
      `test/reading-freshness.test.mjs`
      **Guarded against reintroduction:** a test asserts the outlet budget strictly exceeds
      `outletPollPlan.POLL_INTERVAL_S`. A budget shorter than the poll that feeds it *is* this
      bug, and nothing previously forbade it.
- [x] **EX-134** **The mock can now reproduce the fault it could not see.** `mock-bridge` stamped
      `m.t = Date.now()` on every tick, so its devices were the only ones in the system that
      reported continuously — and no amount of local testing could produce the sawtooth above.
      `--poll-cadence=<s>` quantises metered arrivals to a cadence and emits the `arrivals` key
      the real bridge's energy tab produces. `npm run mock -- --poll-cadence=60` is the live Pi's
      actual behaviour. **A fault the mock cannot produce is a fault that gets diagnosed on
      production hardware** — `mock-bridge/server.mjs`
- [x] **EX-135** **A command that moved a relay stopped reporting failure.**
      `commandStore.reconcile` only accepts its success path when the reading is not stale. The
      Outlet Logic Hub echoes a commanded socket within one WS push, but the row's `ts` comes
      from `<ctx>_last_time`, which advances only on the 60 s poll — so under the old budget
      about half of all successful outlet commands missed the success path, waited out
      `COMMAND_CONFIRM_MS`, and were reported as failures. The staleness conjunct stays (it is
      what stops a frozen echo from an offline device confirming a command that never landed);
      what was wrong was the number it consulted. **Verified in a browser:** an outlet commanded
      at a meter age of **59 s** — the worst point in the cycle — switched and produced no FAULT
      row nine seconds later. The failure message is also split: "did not report the new state"
      claims the device answered and contradicted the command, which is only available when the
      reading postdates it — `src/stores/commandStore.ts`
      **Confirmed in production 2026-09-01**, on the real fleet through the real authenticated
      path: the operator toggled `co1` socket 1 off and on, and `l1` on and off, from the browser
      and reported no errors. All four audit rows read `dispatched` / `via=local`, attributed to
      a real user, with an empty outage buffer and no Node-RED error for either device.
      *That run corroborates the fix; it does not by itself prove it.* Two outlet commands nine
      seconds apart could both have landed in the fresh half of the poll cycle, where the old
      budget would also have worked. The proof is the deterministic reproduction above — the
      regression test fails with a 30 s budget on the row and passes with 150 s, and
      `npm run mock -- --poll-cadence=60` reproduces the sawtooth on demand. Worth saying plainly,
      because "we tried it and it was fine" is the same class of evidence that let this fault
      survive a fortnight in the first place.
- [x] **EX-136** **Two light controls had dead click handlers.** EX-017 removed `stale` from
      `disabled=` but left it in the `toggle()` of `SwitchesListCard` and `LightingMatrixCard`,
      so the button rendered enabled and the click did nothing at all. A control that looks
      operable and silently is not is worse than a disabled one, which at least says so.
      `isCommandable` (`online: false`) is the real refusal and still gates the button, where it
      is visible — the four control cards
- [x] **EX-137** **"Bridge not reachable" was one socket being offline.** Every dispatch failure
      answered one 502 `hardware_dispatch_failed`, which `describeFailure` rendered as "The
      bridge did not accept the command (502)" — so a refusal meaning *the bridge has no
      connection to this device*, a fact about one socket with a remedy at that socket, arrived
      looking like a building-wide outage. That is what the 2026-08-31 physical test reported,
      while the bridge was serving readings throughout, and it aimed the diagnosis at the wrong
      subsystem for a fortnight. `dispatchCommand` now returns a `reason`
      (`device_offline` | `bridge_unreachable` | `bridge_rejected` | `no_route`) — a code, not a
      prose string for the proxy to parse — the proxy maps each to its own response code and
      carries `via`, and the UI names the actual cause. Where no code arrives, the message now
      claims nothing about which subsystem failed: guessing is what caused the misdiagnosis —
      `server/dispatchLight.mjs`, `server/proxy.mjs`, `src/stores/commandStore.ts`
- [x] **EX-138** **Local-first is declared, observable and provable.** It was already the
      behaviour — the fleet is on the Pi's own 2.4 GHz segment, `dispatchCommand` tries it first
      on every command, and the cloud is only reached after a local failure — but it was a
      property of the code rather than a decision on record, enabled only because credentials
      happened to exist, and nothing on screen said so.
      **Proven on hardware 2026-09-01:** `l1` commanded through `dispatchCommand` with no cloud
      option configured at all — `ok=true via=local` in **85 ms**, state read back as changed,
      then restored. Device id and local key over the building's own LAN, no vendor in the path.
      **And `local-only` proven to REFUSE a working fallback, which is the stronger claim.** With
      a real vendor client built from this deployment's own credentials: under `local-first` a
      forced local failure reached the cloud (`via=cloud`, 1 vendor call) — *that check exists so
      the next line cannot pass vacuously* — while under `local-only` the identical failure gave
      `via=local` with **0 vendor calls** and a detail naming the policy. Then a real command over
      the live bridge: `ok=true via=local` in **29 ms**, 0 vendor calls, relay observed
      `off → on → off`. A configured fallback sitting unused is a different fact from an absent
      one, and this is the difference measured.
      `SITE.policy.dispatch` is `local-first` (unchanged behaviour) or `local-only`, which
      **refuses** the fallback — a different guarantee from never having configured one, and the
      failure detail says which. The Control page states the policy and names any device that
      answered only through the cloud, which is a success the operator reads as unremarkable
      while meaning that device stopped answering locally. `npm run local-probe:pi` reports it on
      demand, **read-only**, and deliberately does *not* open its own `tuyapi` session: a
      device's inbound socket table is small, and exhausting it is the exact fault ADR-002 was
      written about — `shared/sites/<id>/site.mjs`, `node-red-bridge/localProbePlan.mjs`,
      `src/components/control/DispatchPathNote.tsx`
- [x] **EX-139** **Three metered channels had a health flag that could not go false.** A tuya
      node reports data on output 1 and connection status on output 2; the parser sets
      `<ctx>_health` false only on a `DISCONNECTED`/`ERROR` message, which arrives on output 2.
      Read off the live flow 2026-09-01: of the three meter nodes, **one was wired and two were
      not**, and those two feed three of the four metered channels — roughly **98% of measured
      demand**. `buildLatest` drops an offline meter from the building totals and the
      accumulator gates on the same flag, so a meter that cannot go offline keeps contributing
      its last frozen reading to the kWh figures. Only the ten-minute arrival rule was catching
      it: the backstop doing the primary signal's job.
      `fix-tuya-health-signals.mjs` was written for exactly this and its other two fixes did
      land, but its rewire list names a meter node the flow no longer has, so it now aborts
      before it can help. Expressed as an **invariant** instead — a data output that goes
      somewhere and a status output that goes nowhere is wrong — it needs no list of ids and
      survives the flow being edited. **Dry-run against the Pi finds the two meters plus the two
      quiesced IR devices, and says which are which.** *Not yet applied; needs a flow write* —
      `node-red-bridge/healthWiringPlan.mjs`, `npm run fix-health:pi`
- [x] **EX-140** **The outlet poller skips outlets that are known to be down.** `co4`–`co6` have
      been off the network for weeks (RM-020) and were producing **180** `Device not connected`
      plus a share of **490** `find() timed out` lines every thirty minutes, forever — nothing
      else in the journal was. A log whose steady state is six errors a minute is a log nobody
      reads, and this project has already had a real fault sit unnoticed inside that kind of
      noise. One output per outlet, skipping any the parser has flagged disconnected.
      **Self-healing, which is why it is preferred over quiescing them:** the reconnect loop is
      untouched, so polling resumes by itself when a device returns; `quiescePlan` would need a
      manual `--undo` after the site visit and would not stop the poller sending to a stopped
      node anyway. Unknown health still polls — refusing would keep a device that has never
      reported silent forever. The plan now **upgrades** an existing poller rather than reporting
      "already present, nothing to do", which would have silently declined to fix the thing it
      was run for. *Not yet applied; needs a flow write* — `node-red-bridge/outletPollPlan.mjs`
- [x] **EX-141** **A meter's freshness could be faked by its own frozen wattage** — and the first
      diagnosis of this was wrong, which is worth recording alongside the fix.
      `TRACK_ARRIVALS` stamps an arrival when a signature of the meter's collector fields
      differs from last poll. **The first write-up claimed that signature had no arrival signal
      at all and keyed purely on value change.** That was wrong: the energy collector exposes
      `n`, the tab's sample-buffer depth, which grows on every message, and it was in the
      signature all along — the collector's own comment says exactly that. Measuring the buffer
      instead of reasoning about it settled it: over 43 s, `lo_red` went 2→3 and `arec` 4→5, so
      the meters were reporting roughly once a minute and the tracker was following them.
      **The real defect was narrower and worse.** The signature also contained `e`, the energy
      accumulator — which is integrated **on a timer**, not on arrival. Measured on the Pi
      2026-09-01: across fourteen seconds in which `co_yel_arr_v` stayed at length 1, no message
      at all, `co_yel_energy` moved `0.14347 → 0.14351 → 0.14355`. So a meter drawing power
      registered an "arrival" every couple of seconds while really reporting about once a minute
      — and a meter that **died while loaded** would keep registering arrivals from its own
      frozen wattage, indefinitely.
      That matters because `STALE_READING_MS` exists as the BACKSTOP for a health flag that
      lies, and until the same day **three metered channels could not report a disconnect at
      all** (EX-139). Both the primary signal and its backstop were compromised at once, and the
      backstop was compromised *by* the primary signal: the accumulator is gated on the health
      flag, so `e` only freezes when health is already correct. A backstop must not depend on the
      thing it is backing up.
      `e` is dropped from the signature; `n`, `v`, `c`, `p`, `h` stay, all of which move only
      when a message arrives. Extracted to `node-red-bridge/arrivalTracker.mjs` so the source
      string that ships into the Node-RED function node is **executed** by its tests rather than
      pattern-matched — a correction this subtle is exactly what a regex test waves through —
      `node-red-bridge/arrivalTracker.mjs`, `test/arrival-tracker.test.mjs`
      *Requires a flow deploy to take effect.*
- [x] **EX-142** **A frozen reading could still reach a chart, three ways** — the Analytics
      "Metered vs total" card was plotting **513.9 W that did not exist**. `co5` has been off the
      network for weeks and its history holds 60 consecutive points, every one `online: false`,
      every one carrying that frozen value from before it dropped; the whole building draws about
      35 W. So the outlet line sat roughly fifteen times the building's real demand — far *above*
      the panel total it is meant to sit under — and `Math.max(0, total - metered)` clamped the
      resulting negative to "0.00 kW untracked now", the most reassuring possible rendering of a
      figure that was not computable at all.
      FI-010/EX-102 had added an `online` flag per point and made `pointValue` return `undefined`
      for an offline one; `pointValue`'s own comment calls itself "the one place a point becomes
      a plotted number". **Three callers never went through it.** `sumHistories` added `power_w`
      straight, so every summed line — the Overview energy flow chart too — included each offline
      contributor's frozen value. `downsampleTrend` rebuilt each bucket as `{ts, power_w}` and
      dropped the flag, which defeated EX-102 downstream **only for series longer than
      `maxPoints`** — so 1h and 6h behaved while 24h and the archive ranges, the ones an energy
      claim is read off, quietly plotted memories as measurements. `trendStats` summed every
      point while promising its numbers "stay accurate to the actual readings".
      Neither alternative to a gap was available: summing the frozen value fabricates a reading,
      substituting zero fabricates a different one — it asserts the circuit drew nothing when the
      truth is nobody knows. A dip in a summed line is indistinguishable from the building using
      less, which is the misreading that costs something: an energy saving that was a
      disconnection. A bucket is offline only when NO sample in it was online, and a pair's two
      sides are suppressed independently — an offline outlet must not blank a panel total that is
      perfectly well known — `src/components/overview/totalPowerSeries.ts`,
      `src/components/trends/chartSummary.ts`, `src/components/analytics/analyticsMath.ts`
- [x] **EX-143** **Every popover opened off the edge of the screen.** Measured before any change,
      on the Overview page alone: at 1265 px the weather hint ran **81 px past the right edge**;
      at 375 px **four of five hints** ran 26–61 px off; the alerts bell rendered at
      **`left: -17px`**, so the first 17 px of every alert row was unreachable — and off the LEFT
      edge is the worse direction, because nothing can scroll to it.
      Three controls had three independently written copies of the same `mousedown`-outside +
      `Escape` dismissal and the same CSS-only positioning, and the same bug in all three.
      **The causes differed in a way that matters:** the ⓘ was 260 px anchored `left: 0` to a
      24 px button — too wide for where it started; the alerts panel was 320 px anchored
      `right: 0`, which *fits* a 375 px screen and overflowed anyway because `right: 0` is
      measured from the bell's own 44 px wrapper, whose right edge sits at x=303. Capping the
      width fixed the first and did nothing for the second. Only clamping against the real
      viewport fixes both.
      **`position: fixed` alone is not enough here, and the reason is easy to miss:** `.card` and
      `.top-nav` both carry `backdrop-filter`, which makes them containing blocks for
      fixed-position descendants — so a fixed popover inside either is measured against the card
      or the nav, which is the bug rather than the fix. Portaling to `<body>` is what makes the
      viewport the frame of reference, and it also escapes the cards' overflow clipping.
      `placePopover` is pure and tested at 23 cases because jsdom reports every rect as 0×0, so a
      component test of the arithmetic would assert nothing. It slides rather than flips
      alignment, caps height so long content scrolls inside, and prefers overflowing right over
      left when a viewport cannot fit both margins.
      *Verified in a browser, not only in jsdom:* 30 popovers across six pages at 320×568, 18 at
      375×812 and 1440×900, and 16 at 380×360 with anchors pinned to the top and bottom of the
      viewport to force the flip and the height cap. **None outside the viewport** —
      `src/components/ui/popoverPlacement.ts`, `src/components/ui/useAnchoredPopover.ts`
- [x] **EX-144** **The bridge answered to the whole device Wi-Fi, with no credential.** Node-RED
      serves the admin API **and every http-in node** on one port, and `uiHost` was unset — so it
      bound every interface, including the Pi's `wlan0`, which *is* the dedicated 2.4 GHz SSID
      the Tuya field devices sit on. **Measured rather than reasoned about:** fetching
      `/api/devices` and `/api/readings/latest` from another host with no token returned **200
      and the full device catalogue and live readings**. After the fix, connection refused.
      Bound to loopback rather than firewalled, matching what this deployment already decided for
      the MQTT broker (EX-131). No firewall tooling is installed here, so a rule would have added
      an undeclared host dependency to solve what one line of config solves.
      **Every consumer was inventoried first**, because this is a remote change to the one host
      nobody is standing next to: `ibems-proxy`, `ibems-ingest` and `ibems-scheduler` all default
      to the *literal* `127.0.0.1`; the kiosk talks to `:5183`; `tailscale serve` proxies to
      `:5183` and `:8080` and never to 1880. The literal matters — binding one address of
      `localhost` silently locks out the other, the trap already paid for on the broker.
      **What it costs, stated rather than discovered later:** the Node-RED editor is no longer
      reachable across the network. `ssh -L 1880:127.0.0.1:1880 <host>` reaches it without
      widening anything, and the repo's scripts are already documented to run on the Pi with
      `--host=127.0.0.1`.
      **The check is the durable half.** `settings.js` is not in this repository, so a rebuild or
      a package upgrade restores the permissive default with no diff and no alarm — the same
      shape as `findTimeout` and the broker listener, both of which have already bitten this
      project. `npm run preflight` now dials this machine's own non-loopback addresses and
      reports what answers; verified live, it prints *"The bridge is not reachable off this
      machine — bound to loopback"*. **WARN, not ERROR**: the deployment works either way, and
      overstating it is how a real error further down the list gets skipped —
      `scripts/preflight.mjs`, `test/preflight.test.mjs`, CLAUDE.md's site facts
- [x] **EX-129** `npm run set-device-ip:pi` — the RM-021 remedy, as a reversible script.
      Gives a `tuya-smart-device` node a static `deviceIp` so the bridge stops depending on a
      discovery broadcast the device has stopped sending. Dry run by default, `--apply` to
      write, `--undo` to clear, like every other script that touches the live flow.
      **The address is resolved at run time** — vendor cloud MAC joined against this host's ARP
      table — and never typed in or committed. That keeps the site's addressing out of a public
      repository, and it is also the only correct version: a written-down address is wrong the
      moment DHCP moves it, and a *stale* one is worse than none, because `find()` short-
      circuits past discovery whenever id and ip are both set. The default target set is
      computed, not hard-coded, because the membership moved twice inside one hour on 2026-08-26
      and a list baked into a script would be wrong by the time it ran.
      `validateDeviceIpPlan` holds the same invariants as `quiescePlan`: node count unchanged,
      nothing added or removed, and the only permitted difference anywhere is `deviceIp` on an
      explicitly named node. These live on the hand-built source tabs where `findTimeout` and
      `tuyaVersion` are the only copy that exists.
      **Its first real use returned a negative result — see RM-021.** The script is kept anyway:
      it is free to try, it is the right first move on a dark-but-on-segment device, and having
      run it is what turned "the remedy we have not tried yet" into a measurement.
      `node-red-bridge/set-device-ip.mjs`, `node-red-bridge/deviceIpPlan.mjs`,
      `test/device-ip-plan.test.mjs`
- [x] **EX-128** (FI-015) The on-segment/absent split is served over HTTP, not only over SSH.
      `GET /api/tuya/presence` joins the vendor cloud's per-device MAC against the host's own
      ARP table — the join that separates **"off the network"** from **"on the network but no
      longer discoverable"**, which is worth a free config change before anybody drives to the
      office. *Worth stating carefully, because this entry originally did not:* on-segment is
      **not** a promise that no visit is needed. It says the cheap remedy is worth trying. See
      RM-021, where trying it on `co5` proved the point by failing.
      It existed only as `npm run tuya:macs`. That was correct and completely unreachable
      without a terminal, and the answer is perishable: the split moved **twice inside one hour**
      on 2026-08-26, with one outlet going `stale` → `absent` between two runs twenty minutes
      apart. A fact that decides whether somebody makes a journey should not cost an SSH session.
      **`arp_readable` is the load-bearing part of the payload.** Unlike `/api/tuya/devices`,
      this route reads the *host's* neighbour table, so it means nothing anywhere but the Pi —
      and `joinMacPresence` fed an empty table marks **every device absent**, which is the
      strongest claim this system makes, from no evidence, rendering on screen as the whole
      fleet having left the network. So an unreadable table is reported as unreadable, and a
      command that exits 0 with nothing to say counts as unreadable too: a host that is not on
      the device segment answers exactly that way, and "I cannot see" must not render as "there
      is nothing there". The frontend re-checks the flag rather than trusting the server to have
      withheld `presence`, and reads a *missing* flag as false.
      **MAC and address never reach the browser.** The join needs both; the page needs neither,
      and together they are a map of the building's network — `tuya-devices.mjs` already
      refuses to print them, and a screenshot of a dashboard travels further than a terminal
      does. `toPublicPresence` copies fields in by allowlist, and a test asserts the real
      payload contains no MAC-shaped and no address-shaped string.
      **Shipped as a conditional note, NOT the per-device column FI-015 asked for, and that is
      the honest limit.** The reply is keyed by vendor device; the registry carries no vendor id
      — `shared/registry.mjs` says so outright, because `mtr_co_yellow` and `mtr_lo_yellow`
      are two logical meters on one physical box. Joining on display name would look right and
      be wrong for precisely the devices hardest to reason about, and EX-028b records this
      project making that exact mistake once already and getting a confident, empty verdict for
      it. So the vendor's names are reported as the vendor's, unjoined and labelled as such.
      **CORRECTION, 2026-08-26 evening: "not soundly possible" was too strong.**
      `server/cloudDispatchConfig.mjs` already carries the join — `vendorIdMapFrom` reads the
      vendor id off each `tuya-smart-device` node in the live flow, and
      `registryIdForNodeName` maps it to a registry id. Crucially it **fails closed**: strict
      regexes for `Light Switch N` and `CON`, and `null` for everything else, so the meters
      and the ACU — the ambiguous cases the paragraph above is really about — are refused
      rather than guessed. That is not the display-name matching EX-028b warns against; it is
      the opposite. A per-device column is therefore available **for the 14 commandable
      devices**, with no claim made for the rest. Left as a follow-up rather than built here.
      The note renders **only when it has something to say**, following the same rule as the
      unstable count in the page header — and EX-028b removed a card from this very page for
      restating what the table already showed. This only ever says what the table cannot.
      *Two tests in this change passed while guarding nothing, and were caught by neutering the
      code rather than by review.* One drove `presenceSplit` with `presence: null`, so its
      groups came out empty whether or not the guard existed. Two more asserted a component
      renders nothing using `waitFor`, which is satisfied by the first render — before the
      request returns, when it renders nothing anyway. **Every "expect nothing" assertion needs
      the subject settled first**, or it answers before the question is asked.
      `server/proxy.mjs`, `server/macPresence.mjs`, `server/tuyaCloud.mjs`,
      `src/lib/devicePresence.ts`, `src/hooks/useDevicePresence.ts`,
      `src/components/devices/SegmentPresenceNote.tsx`
- [x] **EX-127** `npm run test:server` runs on Windows, not only on Linux.
      Both EX-105 tests above spawned a child and handed it a bare absolute path as an ESM
      specifier. On Linux that happens to work; on Windows `C:...` is read as a URL with
      scheme `c:` and the import throws `ERR_UNSUPPORTED_ESM_URL_SCHEME`, so the suite ended
      **309/311 on a workstation and 311/311 on the Pi**.
      *Why that is worth fixing rather than tolerating:* it is RM-022's lesson pointing the
      other way. RM-022 was two tests that passed on a workstation and failed on the Pi; this
      was two that passed on the Pi and failed on a workstation. Either way the suite's answer
      depends on where it ran, which teaches you to discount it — and these two in particular
      guard `TUYA_ACCESS_SECRET`, the credential CLAUDE.md names as the most sensitive here.
      A developer on Windows had two red tests they were expected to know were "just Windows".
      The fix is `pathToFileURL(...).href`, which is the correct ESM specifier on **every**
      platform rather than a Windows special-case — verified 311/311 on both — `server/envHygiene.test.mjs`
- [x] **EX-172** *(2026-09-17)* The intermittent `fetch failed` / `read ECONNRESET` in
      `server/proxy.test.mjs` on the Windows workstation was Node crashing, not the tests.
      About one run of the file in thirty failed, in a different test each time, and a rerun passed;
      Linux CI never failed. Instrumenting both ends showed the **spawned proxy process dying with
      status 0xC0000409** partway through its outbound `fetch` — nothing on stderr, no `exit` event —
      and Windows resetting the test's open socket. The cause is libuv#5107: on every outbound TCP
      connect, libuv's Windows code calls `RtlGetVersion()` with an `OSVERSIONINFOW` whose size field
      was never set, and when leftover stack data holds the larger struct's size the call overruns the
      stack cookie. Node 24.15.0 (libuv 1.51.0) has it; the fix is in 24.16.0 and 26.1.0, and was never
      backported to 22.x. Idle, listen-only and single-fetch children did not crash in 1000 spawns
      each, nor did the proxy with no request: the odds depend on the call path, and this file, where
      every test spawns a proxy that fetches while serving a request, is where they were high enough
      to notice.
      **Measured on the workstation:** `proxy.test.mjs` 30 times per runtime, 1/30
      failed on 24.15.0 and 0/30 on 24.21.0; the proxy spawned and sent one authenticated
      request died with 0xC0000409 3 times in about 2,200 spawns on 24.15.0 (where one of the four
      probe processes also stopped silently after 100) and 0 times in 2,800 on 24.21.0.
      Nothing in the tests can prevent a runtime crash, and retrying would have hidden one, so
      `server/nodeRuntime.test.mjs` fails the server suite on an affected Windows runtime, naming
      the bug and the version to install — every run, rather than one in thirty. **`npm run
      test:server` stays red on the workstation until its Node is 24.16.0 or later.** —
      `server/nodeRuntime.mjs`, `server/nodeRuntime.test.mjs`
- [x] **EX-126** Migration rehearsal kept rather than discarded: every phase file applied in order against a real PostgreSQL 16 in a throwaway container, with the Supabase-provided symbols stubbed, then all six functions driven against seeded data. The guard tests below check intent; this checks that Postgres will actually run the file — `supabase/rehearse.sh`
- [x] **EX-123** Schema guard tests asserting RLS shape per migration — `test/device-config-schema.test.mjs`, `test/phase8-anomalies-schema.test.mjs`, `test/phase9-history-schema.test.mjs`, `test/phase10-archive-schema.test.mjs`, `test/phase11-totals-retention-schema.test.mjs`, `test/phase12-monthly-reports-schema.test.mjs`
- [x] **EX-125** First tests against the proxy's WebSocket relay and against a bridge that hangs rather than refuses — `server/proxy.test.mjs`
- [x] **EX-124** Operational scripts encoding the real workflow — `package.json` (`mock`, `verify:pi`, `deploy:pi`, `ingest`, `build:flow`, `rotate-light-token:pi`, `backup`)
- [x] **EX-170** The deploy note names every service a change reaches, and a test derives the list.
      **Done 2026-09-13.** `CLAUDE.md` and `docs/pi-session-brief.md` said a `server/` or `shared/`
      change needs `sudo systemctl restart ibems-proxy ibems-scheduler`. `server/ingest.mjs` imports
      `server/reports.mjs`, `server/retention.mjs` and `shared/registry.mjs`, and runs as
      `ibems-ingest` — so following the note left the ingest daemon on old code, and nothing says so:
      a daemon on old code is `active`, and writes rows.
      **Measured on the Pi, read-only, 2026-09-13.** Ingest had been up since 2026-09-08 15:52. The
      pull at 2026-09-09 21:44 (merge `76d19ca`) replaced `shared/sites/mmsu-nberic-care/site.mjs`
      and `devices.mjs` beneath it; proxy and scheduler were restarted 26 minutes later, and ingest
      was not. Every other module each of the three daemons loads was compared the same way, and
      those two were the only files newer than their daemon. What changed in them — a `measures`
      field on two devices and the `acu_min_room_target_c` policy key — is read by nothing ingest
      loads (`shapeRows.mjs` takes only `SITE.id` and capability promotion from the registry), so no
      row it wrote came out different. The next change there need not be so harmless.
      **Restarted 2026-09-13 12:40:19 by the operator, and read back.** It stopped on SIGTERM and
      started cleanly; the fleet alarm re-seeded from the database (18 of 20 devices seen online in
      the last seven days); the three retention checks and the report check all found nothing due,
      as expected before 2026-09-15; and it wrote 20 readings + totals at 12:40:25, 22 seconds after
      the old process's last write, so no minute of readings was lost. `NRestarts=0`. The
      stale-module check, re-run over all 81 module-to-daemon pairs, now finds none.
      **The map is derived, not kept.** Each `server/*.service` `ExecStart` names an entry module, and
      the imports beneath it, followed to the end, are what that process holds. Three units keep a
      Node process running. `ibems-wifi-prefer` runs node as a oneshot, a fresh process on every
      timer tick, so it always has the code on disk; `ibems-dashboard` runs `serve` and
      `ibems-kiosk` runs `chromium`, and load nothing from here. The brief carries the map as a
      table. The test fails when a module a daemon loads is missing from it, is listed under the
      wrong daemons, or is listed and loaded by none, and when the restart command beside either
      deploy note does not name all three. Tracing it turned up two more things the old note missed:
      the proxy also loads `node-red-bridge/nodeRedAdmin.mjs` and `enrollPlan.mjs`, outside both
      directories the note named, and `src/` imports `shared/` through `@shared`, so those modules
      need `npm run build` as well as a restart. The second is stated in `CLAUDE.md` and is not
      guarded.
      **The scanner has to read multi-line imports, and the first attempt did not.** A line-based
      grep for `import … from`, used while tracing this by hand, found `reports.mjs` and missed
      `retention.mjs` — whose import spans seven lines, and which is the module the note forgot. A
      self-test pins that form, and the forms that must not count: a JSDoc `import()` type, and an
      import quoted in a comment. A second test pins the unit parse to what was read by hand, so a
      parser that finds nothing cannot pass the agreement checks. The deploy-note anchor was wrong
      on its first run too: the brief wraps "Node loads a / module once" across a line break, so a
      literal-space pattern reported the note as missing.
      **Every rule was neutered on a copy of the tree, and each failed on the rule it targets:**
      either deploy command losing `ibems-ingest`; `CONTRIBUTING.md` gaining a two-daemon command;
      the map losing `server/retention.mjs`, the `server/notify.mjs` row losing the scheduler, and
      the map listing `server/backup.mjs`, which no daemon loads; the scheduler starting to import
      `reports.mjs`; `ibems-wifi-prefer` stopping being a oneshot; and the scanner made line-based.
      The unmutated copy passed. — `test/service-restart-map.test.mjs`, `docs/pi-session-brief.md`,
      `CLAUDE.md`

---

## 2. Current roadmap (active execution)



### The Reports page, from the operator's brief — RM-137 onward (2026-09-22)

- [x] **RM-137** A statement timeout is asked again by itself. "readings_archive failed for mtr_arec_acu:
      canceling statement due to statement timeout" surfaced on the first attempt and Retry drew the chart:
      every Reports loader rethrew `new Error(\`${fn} failed: ${message}\`)`, dropping the SQLSTATE, and
      `isTransient` classified by English. `ReportQueryError` keeps `code/details/hint/status` (message
      byte-identical) at all nine wraps — `circuitSeries`, `reportSeries`, `supabaseReports`; `isTransient`
      retries 57014, 53300, 55P03, 08000/08003/08006, PGRST000–002 and HTTP 502–504, by code only.
      **Measured from the Pi (service role), not assumed:** a week's first `readings_archive` read took
      0.9–5.4 s a meter, the second 0.42–0.56 s, at any concurrency; two-at-a-time was the slowest first
      read (5.4 s) and a warm week took 0.52 s at once vs 0.95 s two at a time — a cold cache, not
      contention, so `getCircuitTrend` keeps `Promise.all`. **Open:** the operator's signed-in
      `EXPLAIN (ANALYZE, BUFFERS)` of the slow call, to confirm `shared read` on the first attempt; no SQL
      change without it. Tests: `reportLoader.test.ts` (+15), `reportQueryErrors.test.ts` (9, new),
      `useReportData.test.ts` (+1, one updated); a neuter dropping 57014 fails 12.
- [x] **RM-138** A report not made yet is said, not silent. The operator (22 Sept, 20:30) could not tell the
      missing week of 14 Sept from a broken pipeline. **It was not late:** week key Monday 00:00Z, ends
      21 Sept 00:00Z, settles +2 days = **08:00 Manila, Wed 23 Sept**, made at the daemon's next 6-hourly pass
      (passes run six-hourly from the last `ibems-ingest` restart; the week of 7 Sept was made 39 min after it settled). Generator
      logic unchanged. `shared/reportSchedule.mjs` now holds `REPORT_GRACE_DAYS`, `DAY_GRACE_HOURS`,
      `REPORT_CHECK_MS` (re-exported by `server/reports.mjs`) and `periodSettlesAt`; a minute-by-minute
      sweep in `server/reports.test.mjs` fails if it and the daemon's loops disagree (a +1 h neuter fails 2).
      `src/lib/pendingPeriods.ts` names the period just ended and the one running with their due moment;
      the calendar cell is dashed and says when, the popover and the page say it in words, a disabled Next
      says what it waits for. **The list was never re-read** (a kiosk on Weekly kept a settled week missing
      until reload, whatever the TTL comment said): `useReportData` now re-reads it quietly at each due
      moment — never blanking it, never moving the reader (a newer report is offered: "Open it") — and says
      "overdue" only when a read after due + 6 h + 15 min still lacks it. Months settle 08:00 on the **3rd**.
      **Read back pending:** Wed 23 Sept after 11:30 — the journal's `generated weeks 2026-09-14`, the row,
      and the page. Needs `npm run build` and an `ibems-ingest` restart (restart map updated). Tests:
      `pendingPeriods.test.ts` (9), `useReportData.test.ts` (+4), `PeriodPicker.test.tsx` (+3),
      `ReportsPage.reliability.test.tsx` (+1), `server/reports.test.mjs` (+3).
- [x] **RM-139** No circuit told apart by colour alone. Audited against the brief: chart forms fit (bars
      for daily totals, lines for trends, a 100% bar for shares, no donut); every chart already has one
      tab stop, arrow keys, a live region and a "Show the numbers" table; icons are lucide only, no emoji.
      **Missing:** "Power through the week" (up to four crossing lines) and "Energy per day by circuit"
      (stacks) differed by hue alone. Each line now wears its circuit's pattern (`SERIES_DASH`: solid, long
      dash, dotted, dash-dot; legend swatches match; the PDF draws them) and is named where it ends; each
      stack is named beside its last recorded column, top first, where a segment can carry a name
      (`charts/directLabels.ts`, names never overlap). **In-bar names failed contrast unguarded:** white on
      the light theme's amber was 2.15:1 — `--on-series-0..3` per theme, ≥4.5:1 asserted in both themes
      and print. **The status hues stay, measured:** re-mapping series 0 (= `warn`) and 2 (= `good`) was
      searched against every `palette.test.ts` guard; with blue and purple kept no pair passes print, light
      and dark together, and with all four free every passing palette needs a rose-red (the fault family) —
      recorded in `palette.ts`; the operator chose cues over a weaker guard. The same four tokens start
      Analytics' cycle, whose red, sky and pink tail is **FI-038**. Tests: `circuitCharts.test.ts` (+4, one
      helper narrowed to the legend row), `palette.test.ts` (+3), `circuitBreakdownChart.test.ts` (+1).
- [ ] **FI-038** Analytics' series cycle continues past the report's four with `--red-bright` (the fault
      colour, decoratively) then sky and a literal pink; audit it against RM-139's reasoning.
- [x] **RM-140** Loading and transitions: what was missing, not a redo. **A PDF bug first:** the export gate
      waited for the hour profile, heatmap and curve but not the Circuits series, which only start loading
      when the drawer opens — a document made at once printed the circuit charts as "could not be loaded"
      while they were still loading. They are waited for, and named beside their sections when they fail.
      **Continuity, keeping "derived by key"** (the operator's choice — no old figures under a new heading):
      the period picker stays in the bar, `aria-busy`, "Loading reports…", instead of vanishing while a new
      kind's list loads; the skeleton draws the tab's own charts (Overview 2, Usage patterns 3, Circuits 2)
      instead of five, so nothing jumps. **View Transitions** (`src/lib/viewTransition.ts`, native,
      feature-detected, `flushSync`): period kind, period, scope, tab and "Open …" crossfade in 180 ms while
      the bar (`view-transition-name`) holds still; skipped under reduced motion, and the global
      reduced-motion block now names `::view-transition-*`, which `*` never matched. **Checked, unchanged:**
      only the Circuits sections are deferred and everything else feeds the PDF, so nothing more is lazy;
      the skeleton's status line already names the period being fetched. Tests: `viewTransition.test.ts`
      (4), `reports-css.test.mjs` (+2), `ReportSkeleton.test.tsx` (+1), `PeriodPicker.test.tsx` (+1),
      `ReportsPage.reliability.test.tsx` (+1), `ReportsPage.apportioned.test.tsx` (+2).
- [x] **RM-141** Pop-ups that fit, **measured on live data signed in** (2026-09-22, the local preview; a
      harness swept the pointer over every chart at both scroll ends, stepped Home/End by keyboard, and opened
      each calendar, the scope, the hint and the drawer). Worst overflow past the viewport, before → after:

      | | 360×640 (touch) | 768×1024 | 800×480 |
      |---|---|---|---|
      | chart tooltip | **94 px left** (Energy by use), **66–127 px right** (keyboard End, 8 charts) → 0 | 0 → 0 | 0 → 0 |
      | day calendar | cells 5 px past the grid → 0 | 1 px → 0 | **3 px sideways scroll**, cells 11 px past → 0 |
      | export drawer | Generate **510 px** below view → in view | in view | Generate **475 px** below → in view |
      | scope, hint, week/month calendars | 0 | 0 | 0 |

      The tooltip was the one surface off the primitives: side chosen from the value's centre, anchored at its
      edge, no clamp, and keyboard stepping never scrolled a phone's plot. `placeBeside` (beside
      `placePopover`, same margin) keeps "beside the value, never over it", falls back to the reading point
      for a value too wide to sit beside, and clamps into the figure's visible span; `ChartFigure` measures
      before paint and scrolls the stepped-to value into view. The day grid: `preferredWidth` 352 for a day,
      and on a finger 44 px columns with no gap (7 × 44 fits a phone). The drawer: `OverlayPanel` caps at
      `100dvh` (vh fallback); Generate is a sticky row sunk into the body's padding. The explorer's computed
      35–105 px at 800×480 did not occur on real geometry. Tests: `popoverPlacement.test.ts` (+7, incl. a
      sweep at all three sizes), `ChartFigure.hover.test.tsx` (+1), `reports-css.test.mjs` (+3).
- [x] **FI-039** `sceneToJsx` passed hyphenated SVG attributes to React, which logged "Invalid DOM property" for
      each in development — 51 on one visit. It now hands React the camelCase names (same DOM attributes; the
      page-versus-PDF parity test holds); zero warnings across all four tabs, checked in a browser 2026-09-22.
      `charts/sceneToJsx.test.tsx` (2, in a file of its own because React warns once per name).
- [ ] **FI-040** Reports cannot be deep-linked to a tab or period; `useHashSubRoute` already exists.
- [x] **FI-041** `Tabs` set `aria-controls` to panels the Reports page never rendered. The selected tab's body is
      now its `TabPanel` (as on Automation), labelled by its tab — checked on all four in a browser — and a
      `:focus-visible` ring shows a keyboard reader the panel they tabbed into (a click still leaves none).
      `ReportsPage.tabs.test.tsx` (+4), `reports-css.test.mjs` (+1). **And RM-140's transitions no longer wait on a
      frame:** shown but not painting, the app's browser pane held a tab click for seconds; past 300 ms the
      change is made directly, once (`viewTransition.test.ts` +2).
- [x] **RM-142** The Reports page, polished from the operator's screenshots (2026-09-23): charts drawn at the
      page's width, one legend, the estimate as a card, a control bar that hides what scrolls beneath it.
      - **Charts drawn at the column's width.** Every chart was a 640-unit drawing stretched to its column:
        2.36× at 1920 px, where its 9-unit labels stood 21 px tall beside 11 px captions and a circuit chart
        was ~590 px high. `chartWidth.ts` measures the tab panel and draws on-screen charts at
        `(panel − 34) / (11/9)` units (floor 460, ceiling 1440, 20-unit steps): measured signed in, labels
        11.1 px at 1920 and 11.2 px at 800×480, circuit charts 310 px high, the phone's 460 px scrolling plot
        unchanged. Placeholders take the same width. The PDF still draws at 640.
      - **One legend.** RM-139's names beside the plot repeated the legend and stacked into a second one
        wherever the lines ended together; removed (`directLabels.ts` deleted). Each circuit is named once,
        in the legend, with its line pattern, and the plot has its width back.
      - **"Estimated, not metered" as a card.** It borrowed the table card, whose padding is vertical only —
        heading flush to the edge, three figures on one run-on line, the chart a card inside a card. Now its
        own 16 px padding, a header, the figures as a grid of tiles (name, value, basis), and the chart
        without its own border.
      - **The stuck control bar** meets the nav (the 8 px gap showed the report scrolling through) and sits
        on `--pop-bg` rather than 75% glass, through which legends and table figures read.
      - Not changed: the app-wide nav's own glass, through which content also reads — a decision for every
        page, not this one. Tests: `chartWidth.test.ts` (5), `circuitCharts.test.ts` (direct-label tests
        replaced by one-legend tests), `ReportsPage.apportioned.test.tsx` (+1), `ReportSkeleton.test.tsx`
        (+1), `ReportsPage.reliability.test.tsx` (+1), `reports-css.test.mjs` (+1).
- [ ] **FI-042** `Skeleton.tsx` calls itself static; `.skeleton` shimmers (stopped only by reduced motion).

### Onboarding without IoT Core, and the aircon's own IR protocol — RM-126 to RM-129 (2026-09-22)

**The operator's decision (2026-09-17):** Tuya IoT Core is used only to extract device ids and local
keys when devices are first paired, one developer-account trial at a time, all linked to the one Smart
Life account. It is not a runtime dependency. Their own observation, recorded with its limit: a device's
id and local key do not change while it stays paired — a restart or a new IP does not change them; only
removing it from Smart Life and pairing it again does.

- [x] **RM-126** Device facts without the vendor cloud. **Deployed and read back 2026-09-22** (§0).
  - **Three sources, merged** (`server/deviceSources.mjs`):
    - imported keys (`server/credentialImport.mjs` parses a key tool's JSON/CSV or `tinytuya wizard`'s
      `devices.json`; `server/credentialStore.mjs` keeps them in `server/data/device-credentials.json`,
      0600, written atomically). A row with no id or no 16-character key is reported by name and
      skipped; a Bluetooth-only device's "-" key is named as such;
    - the device network (`server/lanPresence.mjs`): a standing passive listener on the Tuya discovery
      ports inside the proxy, beside Node-RED's own (`reuseAddr`). A device paired a minute ago appears
      with its id, product key and announced version; no addresses are kept. `LAN_PRESENCE=off`
      disables it;
    - the vendor OpenAPI, only while it answers. Its state is reported with the vendor code alone
      (`code 28841002: IoT Core subscription expired`) — never the message text, which can name the
      data-centre host.
  - **Routes.** `/api/tuya/devices` always answers 200, with `sources` and per-device
    `credential_source`, `on_lan`, `lan_version`. `POST /api/credentials/import` (authenticated, 1 MiB
    cap, `complete` flag) and `GET /api/credentials` (lengths only). `npm run keys:import` on the Pi,
    dry run by default. No reply carries a key; `tuyaFleet.assertNoSecrets` checks every response.
  - **Enrolment and rebind** take keys from an import first, then the cloud; the version from what the
    device announces. Their messages no longer assume the cloud is the only source.
  - **Orphans are concluded cautiously**, because a rebind repoints a node: not quiesced, unheard by a
    listener that has run 3 min, and absent from a COMPLETE list (a working cloud listing, or an import
    marked complete). Without a warm listener, rebind listens once for the one device. `tuyaFleet`'s
    `orphanNodesFrom` ("not in the cloud project" alone) is deleted.
  - `server/deviceSources.test.mjs`, `server/credentialImport.test.mjs`, `server/lanPresence.test.mjs`,
    `server/import-keys.test.mjs`, `server/proxy.test.mjs` (the import and listing routes).

- [x] **RM-127** Add Device: Import keys, and which sources answered. **Built on the Pi and served, 2026-09-22.**
  - One line per source; each detected device shows its network presence and version, and where its key
    comes from (key imported / key from cloud / no key). A device heard with no key is `needs_key`
    ("Needs its key"), and the import panel opens for it.
  - The paste is cleared once the proxy has it; the list refreshes at once; the panel stays open over
    its own result — found in the browser preview, where a successful import had closed it.
  - Mock: `/api/tuya/devices` and `/api/credentials/import` at contract parity; `npm run mock --
    --onboarding` seeds a lapsed cloud, imported keys and one keyless new device.
  - Checked at 375 px (no overflow, 44 px targets) and in both themes (lowest contrast 4.89:1, dark).
  - `src/components/devices/ImportKeysPanel.tsx`, `src/components/devices/EnrollWizard.tsx`,
    `src/lib/credentials.ts`, `src/lib/tuyaFleet.ts`, `src/hooks/useCloudFleet.ts`.

- [x] **RM-128** The aircon's IR frames are TCL112AC, and the flow now generates any state. **Applied
  2026-09-22 06:49 and read back** (§0); no generated frame has been sent to the unit yet (RM-120).
  - **Measured.** All sixteen codes in `AC Master Logic` (live-flow fixture of 2026-09-17) decode as
    TCL112AC: header 23 CB 26 01 00, 112 bits LSB-first, byte 13 the sum of bytes 0–12 — every checksum
    verifies. The fifteen ON codes are **cool, fan auto, swing off** at 16–30 °C; OFF is the one
    power-off frame. `LOCAL_LIBRARY_STATE` is now read out of the codes rather than assumed.
  - **Field layout** from IRremoteESP8266's `Tcl112Protocol` (`src/ir_Tcl.h`): byte 5 bit 2 power;
    byte 6 bits 0–3 mode (heat 1, dry 2, cool 3, fan 7, auto 8); byte 7 bits 0–3 = 31 − setpoint;
    byte 8 bits 0–2 fan (auto 0, low 2, medium 3, high 5), bits 3–5 vertical swing (7 on).
  - **Why generate rather than learn.** Learning captures one full state per button press; every
    combination is 5 × 4 × 2 × 15 = 600. Generating needs one captured frame, and is trusted because
    it rebuilds all fifteen captured ON codes byte for byte, from any of them (`test/ir-tcl112.test.mjs`).
    Learning (dp 201 study / dp 202) stays in the backlog for a unit whose protocol is unknown (FI-037).
  - **How.** `shared/irTcl112.mjs` (self-contained, inlined into the function node);
    `SITE.aircon.ir_protocol: 'tcl112'`. AC Master Logic sends a captured frame when one exists (and
    OFF always), otherwise a generated one, and says which (`source`). `aircon:pi` refuses to install
    the generator unless it reproduces every captured code on the flow it is writing. The dispatcher
    notes a generated frame in the audit detail; `/api/capabilities` serves `acu_local_ir_protocol`;
    the Control page offers mode, fan and swing over the LAN.
  - **Unchanged rule.** `local_ir_verified` covers generated frames too: until the on-site test, ON
    states go cloud-first when a cloud is ready — with IoT Core lapsed, that means straight to the LAN.
  - `shared/irTcl112.mjs`, `node-red-bridge/airconSources.mjs`, `node-red-bridge/airconFlowPlan.mjs`,
    `shared/acState.mjs` (`localIrSource`), `test/aircon-sources.test.mjs`, `test/aircon-flow-plan.test.mjs`.

- [x] **RM-129** The cloud connection: Home Assistant assessed, not adopted. **Decision record.**
  - **Why not HA as the device layer.** Its built-in Tuya integration cannot drive `infrared_ac` (the
    aircon's remote), and the local-key integrations (tuya-local, LocalTuya) duplicate what the flow
    already does, with a second copy of every key and a second process holding the same device
    sessions. HA was already rejected as the device layer; this re-check found nothing to reverse it.
  - **Why not a built-in QR login.** The device-sharing SDK's QR login registers as Home Assistant's
    own client. Building it into iBEMS would sign in to the vendor under another application's
    identity. Instead the operator runs a key tool on their own machine and imports its export.
  - **IoT Core policy.** Tuya offers an official extension of the trial (1, 3 or 6 months, on request)
    for the occasional extraction. Rotating new developer accounts against one Smart Life account works
    today but is the kind of use a vendor may close without notice; a key tool through the Smart Life
    account does not depend on it.
  - **Still cloud-only:** the relay fallback (ADR-002), `/api/tuya/presence`'s MAC join,
    `set-device-ip:pi`, `tuya:devices`, `tuya:spec`.

- [ ] **FI-036** A key tool built into iBEMS — **not chosen** (RM-129: it would borrow another
  application's vendor identity). Revisit only if Tuya publishes a login for third parties.
- [ ] **FI-037** IR learning for an aircon whose protocol is not known: dp 201 `{"control":"study"}`,
  the code arrives base64 on dp 202, sent back as `key1: "1" + code`. Not needed for this unit (RM-128);
  the parser already forwards dp 202 to the state manager.

### The dual-channel meter's channels, and a Daily period — RM-122 to RM-125 (2026-09-22)

Why this exists is the 2026-09-22 entry in §0. The operator's report, 2026-09-21: L.O Yellow (lighting
L5–L7, under 100 W) had been logging the outlets' daytime load since Saturday the 19th. Two premises were
confirmed by the operator the same day and are declared in `SITE.channel_demux`: the lighting branch
cannot draw more than 150 W, and the outlet branch is never at 0 A.

- [x] **RM-122** The shared dual-channel meter trades its own channels; the flow now corrects it at the
      source. **Built; not applied — `npm run demux:pi` (§0).**
      **What was measured, read-only, from the stored rows and the live flow.** One `tuya-smart-device`
      session (`C.O yellow`, v3.5) feeds two generated parsers, each a pure map of dp number to context
      key (105–107 to `co_yel_*`, 115–117 to `lo_yel2_*`); no stage can route dp 115 into `co_yel_last_p`.
      Yet from 06:21 to 17:20 on the 19th and 05:08 to 09:44 on the 21st (and four flips of 3–15 minutes
      that afternoon and evening) channel 2 carried the outlet clamp: the device's own `device_state<n>`
      went to `monitor` on the channel reading exactly 0 W / 0.000 A, its own `today_acc_energy<n>` froze
      on that side, and at each flip its registers jumped by thousands of kWh (`add_ele2` = 3497.79,
      `all_energy` +3625.9 at 17:22 on the 19th — the same ~3,625 that poisoned `weekBase`/`monthBase` on
      09-03, EX-158). Those are dps, not computed values. The two ~40 W loads are distinguishable and
      travel with the clamp: lighting is 41 W / 0.43 A / PF 0.41 (LED; `monitor` when off), outlet standby
      is 40 W / 0.23 A / PF 0.75 and never 0 A. The Pi's reboot at 09:17 did not end the episode; the
      device did, at 09:44. RM-019's session collapse (EX-037b) removed a possible cause and not this one.
      **The fix.** `shared/channelDemux.mjs` decides the assignment from the two premises only: a channel
      above the ceiling is the outlet branch (`ceiling`); a channel at `monitor` / 0 A is the lighting
      branch (`idle`); otherwise the last certain assignment is carried, and a flip needs two agreeing
      samples. `node-red-bridge/channelDemuxPlan.mjs` puts one function node between the session's data
      output and both parsers — the parsers stay byte-identical, the status output stays direct — that
      renumbers dps 103–112 ↔ 113–122 while the assignment is `swapped`, so the legacy integrator, the day
      baseline, the accumulator and the bridge all read each circuit under its own name. Its decision
      rides to `/api/readings/latest` as `channel_map` (`docs/bridge-contract.md`) and into
      `readings.capabilities.channel_map`, so every stored row says how it was attributed.
      **What stays undetected, by design:** a flip that begins and ends while both channels are ~40 W and
      neither idle — bounded by the difference between the two loads, a few watts. Measured the first
      night: four such flips between 23:37 and 03:48 on 09-21/22, visible only by power factor, about
      14 Wh in all; the demux was seeded `direct` at 04:26 and decides at the first idle or ceiling
      event of the morning. A third, PF-based rule would close that and rest on an empirical
      fingerprint rather than a physical fact, so it is not written.
      **`npm run check:meters` was blind to this.** It looked for a clean trade; the 19th was a hand-off
      (one channel to 0 as the other took its load). It reports both shapes now, in site time.
      `shared/channelDemux.mjs`, `test/channel-demux.test.mjs` (22), `node-red-bridge/channelDemuxPlan.mjs`,
      `node-red-bridge/demux-channels.mjs`, `test/channel-demux-plan.test.mjs` (12, executing the node's
      code), `test/site-channel-demux.test.mjs`, `test/channel-map-carried.test.mjs`,
      `shared/sites/mmsu-nberic-care/site.mjs`, `shared/buildLatest.mjs`, `server/shapeRows.mjs`,
      `shared/channelSwap.mjs`, `server/check-meter-swap.mjs`.
- [x] **RM-123** The stored rows the swap corrupted, corrected — `npm run scrub:meters`. **Built; dry run
      read against the live rows; not applied.**
      The same classifier, replayed over both devices' rows in time order; every swapped minute's two rows
      trade volts, amps, watts, the per-channel register columns and their capability codes, renamed to
      the channel each device declares. **Energy is re-integrated, not traded:** the reports credit each
      hour's rise of `energy_kwh_today` (phase42), and a swapped day's counter mixes correct minutes with
      traded ones, so on every affected local day both devices' counters are restated as the running
      integral of the corrected online power from local midnight — the second opinion EX-158 named — and
      every such row says so in `capabilities.scrub`. Days with no swapped minute are untouched. The apply
      is a bulk upsert on the primary key, then every affected row is read back against the plan.
      **The dry run, 2026-09-22 00:04, and the apply at 04:33:** 4,290 paired minutes, five windows,
      15.0 h swapped; 5,748 rows rewritten (1,800 traded). The first attempt failed with `23502` on
      `online` — PostgREST's upsert evaluates the INSERT tuple's NOT NULL constraints before the conflict
      path, so every row's own `online` must travel with it; nothing was written by that attempt, which
      is what a bulk request inside one transaction guarantees. The read-back compares `capabilities` by
      content, because jsonb reorders keys. 09-19: C.O 0.706 → 5.258 kWh, L.O 5.214 → 0.588; 09-21: C.O 6.798 →
      9.503, L.O 3.235 → 0.758 — each day's two figures sum to within 1 % before and after, as a swap
      must. The bridge's bases banked the wrong figures: C.O weekBase +2.705 / monthBase +7.257,
      L.O −2.477 / −7.103 — printed by the dry run for the hand correction in §0.
      `server/scrubMeterSwap.mjs`, `server/scrubMeterSwap.test.mjs` (9), `server/scrub-meter-swap.mjs`.
- [x] **RM-124** A Daily period, hour by hour, beside Weekly and Monthly. **Built and rehearsed; `phase46`
      not applied.**
      **Data.** `phase46_daily_reports.sql`: `report_window` accepts `'day'` (p_start itself, 1440 minutes),
      so every series function answers for a day unchanged; both stored-report tables admit it;
      `generate_period_report` is phase44's text byte for byte plus the day branches — a day's building
      energy is its own daily counter's high-water mark, not the week's month-counter increment, which
      falls back to the whole month-to-date when the previous day has no rows; and `report_hour_energy`
      returns each device's hourly credit by phase42's rule, with its average and highest power and its
      minutes, every hour a row, raising above 900 rows. The rehearsal proves the 24 credits sum exactly
      to the stored day, that a counter jump is clipped in its hour, and that a month of every device is
      refused rather than truncated. `server/reports.mjs` generates settled local days (an hour after
      midnight, fourteen per pass) — the one period reckoned at the site's offset, because a day settled
      in UTC would keep yesterday off the page until nine in the morning.
      **Page.** `Daily · Weekly · Monthly`; a day is named with its weekday; the picker turns month pages
      of days; the Overview's chart is `hourlyEnergyChart` — twenty-four columns 00 to 23, the daily
      chart's rules one day wide, summing the building's branch meters; the Circuits tab draws each
      circuit hour by hour through the stacked chart it already had; the PDF gains `Energy per hour` and
      `Energy per hour, by circuit` and drops the per-day and typical-day sections for a day.
      `supabase/phase46_daily_reports.sql`, `test/phase46-daily-reports-schema.test.mjs`,
      `supabase/rehearse.sh`, `server/reports.mjs`, `src/lib/{supabaseReports,reportPeriods,reportFiles,
      periodCalendar,reportSeries,circuitCharts,reportSections,reportChartSizes}.ts`,
      `src/components/reports/charts/hourlyEnergyChart.ts`, `src/components/reports/{ReportControlBar,
      PeriodPicker,useReportData,ReportCharts,CircuitDeepDive,ReportsPage,ExportDrawer,ReportSkeleton}.tsx`,
      `src/lib/reportPdf/buildReport.ts`, `src/components/reports/ReportsPage.day.test.tsx` (7).
- [x] **RM-125** The journal is persistent, and bounded. It was volatile: `/var/log/journal` was empty, and
      the Pi was rebooted at 09:17 and 17:02 on 2026-09-21, so nothing Node-RED logged on the 19th survived
      — the database was the only witness to RM-122. **Done 2026-09-22 05:16, operator's "proceed":**
      `/etc/systemd/journald.conf.d/50-ibems-persistent.conf` — `Storage=persistent`, `SystemMaxUse=200M`,
      `SystemMaxFileSize=32M`, `MaxRetentionSec=90day`. A drop-in, because Raspberry Pi OS itself forces
      `Storage=volatile` from `raspberrypi-sys-mods`' `40-rpi-volatile-storage.conf` (SD-card wear) and the
      main `journald.conf` is overridden by it whatever it says; `50-` sorts after `40-`. Flushed: this boot's
      runtime journal (79 MB, everything since 17:02) is now on disk. **This lives only in `/etc` on the Pi**
      — the same exposure shape as the broker and `uiHost`: a rebuild loses it silently. `npm run preflight`
      does not check it yet.
- [ ] **FI-034** `readings_buckets` over the full 30-day raw window hits the statement timeout; the RM-122
      scan had to be chunked by six days. A `p_until` parameter, or an index note.
- [x] **FI-035** ~~The operator described C.O Yellow as "outlets and aircon"; RM-088 records the aircon on
      CARE ACU alone.~~ **Answered 2026-09-22:** both are true. C.O Yellow carries the CARE office's
      outlets AND, in another room, the director's office aircon, at about two thirds of the branch;
      CARE ACU is the CARE office's own unit. There is no meter on the director's aircon. RM-130.
- [x] **RM-131** What an outage does to the field network, read back; the recovery that needs no cloud.
      **Built and deployed 2026-09-22 (evening), operator's "proceed".**
      **The evidence — the operator's outage test of 2026-09-21, from the journal RM-125 kept.**
      17:02:43 the Pi boots; 17:02:55 it joins the office 5 GHz SSID because `BEMS` is not up yet
      (the AP boots in ~2 min); 17:08:19 the Wi-Fi watchdog returns it. 17:08–18:11 every switch and
      outlet connects and drops — `ECONNRESET` from the device, a minute or two of `connection timed
      out`, reconnect — 12 to 20 times each (CO4: 20), while the four meters, nearest the AP, never
      drop. From ~18:11 every one of them and the IR hub is silent to `find()`. **Measured the next
      morning:** six of them answer ARP; three probed accept TCP on 6668 (one meter as control); a 30 s
      passive listen hears exactly three broadcasters, the meters; the air is quiet (−38 dBm, one tx
      failure in 14 h, channel 1 shared with one neighbour). So the devices are associated and their
      Tuya service is alive; they have stopped sending the UDP discovery broadcast, and `find()` is
      the only thing that needs it. A Node-RED restart cannot help. RM-020/RM-021's "needs a
      power-cycle" and the 09-03 recovery are this same state — the power cycle restarts the
      announcements, which is the whole of why it works.
      **The fix removes the dependence on discovery.** `server/lanMap.mjs` + `lan-map-learn.mjs` +
      `ibems-lan-map.timer` (every 10 min, 30 s passive listen, `reuseAddr` beside Node-RED's own)
      remember every announcement with its address and MAC in `server/data/lan-map.json` (live state,
      gitignored). `set-device-ip:pi --from-lan-map` addresses every node the map knows — no cloud —
      and `--reservations` prints the DHCP table for the AP. `server/fleetRecover.mjs` +
      `fleet-recover.mjs` + `ibems-fleet-recover.timer` (every 5 min) restart Node-RED only for a
      device that is offline to the bridge yet reachable (one TCP probe of its static address, or an
      announcement within 15 min whose address answers now — the IR hub announced at 07:47 on the 22nd
      and was `EHOSTUNREACH` by 07:54, a device fault a restart cannot touch), only on two consecutive
      checks, at most hourly, never within 10 min of boot — the l6 case, automated, with the RM-020 case
      explicitly excluded. A pinned node whose device announces from elsewhere is logged as
      `ADDRESS DRIFT`, never re-addressed from a timer: flow writes stay a person's call. `ibems-wifi-prefer`
      now fires 90 s after boot and every 5 min. `docs/outage-recovery.md` is the runbook, including
      the AP items RM-046 left open and the UPS that would make the AP's cold boot not happen.
      **What it cannot do:** make a silent device announce. **Read back the same morning:** the operator
      power-cycled the office at 07:42; the map filled at 07:47 (18 announced in one 30 s listen); the
      addresses were applied at 08:02 and every node reconnected by address inside a minute, 19/20
      online. The AP reservations remain (§0).
      `server/lanMap.mjs` (+ test, 7), `server/lan-map-learn.mjs`, `server/fleetRecover.mjs` (+ test,
      6), `server/fleet-recover.mjs`, `server/ibems-{lan-map,fleet-recover}.{service,timer}`,
      `server/ibems-wifi-prefer.timer`, `node-red-bridge/set-device-ip.mjs`, `docs/outage-recovery.md`.
- [x] **RM-132** The preflight checks what lives only on the host, and the optional cloud is a warning.
      **Built and read back 2026-09-22, 08:20.** RM-125 and RM-131 added three settings with the
      `uiHost` shape — correct today, kept nowhere in the repository, lost by a rebuild or a package
      upgrade with no diff and no alarm — and each was a real loss before it was a check. `npm run
      preflight` now reports **`host_journal`** (the merged `journald` config's last `Storage=` via
      `systemd-analyze cat-config`, AND `system.journal` seen under `/var/log/journal/<machine-id>` —
      configured but not yet written is not persistent), **`host_timers`** (every `server/ibems-*.timer`
      is `active`; the list is read from the directory, so a new timer is checked without being
      listed), and **`host_addresses`** (every enabled `tuya-smart-device` node has a `deviceIp`, with
      the LAN map's size and freshness beside it; needs the admin login, and an unreadable flow is
      `unchecked`, never "none pinned"). Each fix names the drop-in, the `enable --now` line, or
      `set-device-ip:pi --from-lan-map`, and the runbook.
      **The vendor cloud is a warning now, not an error.** Until today a refused console made the
      verdict `Not ready` every day the trial stayed lapsed, contradicting the operator's decision of
      2026-09-17 (RM-129). `env_tuya` missing and `vendor_auth` refused are `warn`, and the fix
      lists what stays cloud-only. On this deployment the verdict is **`Ready` with two warnings**
      (the trial, 19 of 20 devices); the three host checks all pass. `scripts/preflight.mjs`,
      `test/preflight.test.mjs` (24), `CLAUDE.md`, `docs/replication.md`.
- [x] **RM-133** L.O Yellow's clamp stopped measuring at 07:47:44, and the freeze flag could not say so.
      **Verified 2026-09-22 11:00–11:11; deployed 11:27 on the operator's "deploy now"; read back
      11:57 — the flag stood on schedule. The meter itself is the operator's.**
      **What the rows show.** From 07:47:44 `mtr_lo_yellow` repeated exactly 39.8 W / 0.446 A / 226.7 V
      with `today_acc_energy2` held at 25523.556 and `add_ele2` at 0.01 — 188 identical minute rows to
      10:57 — while `mtr_co_yellow` on the same session moved every minute and its register rose 3.18
      kWh. The 39.8 W is the moment's true reading: `l7` was on at 07:47 and was switched off at 07:48
      (`l5`, `l6` off all day), so the circuit has drawn about nothing since, and the channel never
      said so. At 10:58:59 the channel's voltage dp began following channel 1's exactly (214.5 / 214.5,
      213.3 / 213.3 …) while power, current and register stayed held; the voltage is one measurement
      shared by both clamps. The demux is not involved: `channel_map` read `direct` / `ceiling`
      throughout, and channel 1 carried the 850 W load it should. `device_state2` read `working`, not
      `monitor`, all along. The freeze began five minutes after the operator's power cycle of the
      office (07:42); it is the meter, in the state it booted into.
      **What was tried.** `sudo systemctl restart nodered` at 11:08 (the project's first remedy): 19
      devices back inside a minute; channel 2 still 39.8 W / 0.446 A / 25523.556 after the reconnect's
      full dp read. A session does not thaw a clamp.
      **Corrected by RM-134 (same afternoon): there was no "full dp read".** The tuya node hard-codes
      `issueGetOnConnect: false`, so a reconnect reads nothing, and the 39.8 W survived the restart in
      persisted flow context. Nor did the hold begin at 07:47:44: the stored rows hold 39.8 W / 0.446 A /
      25523.556 from **07:43:49**, and `l5`–`l7` were offline 06:30–07:47. `l7`'s "on" before 07:47 was a
      cached value, and its "off" at 07:48 was its first report after the power cycle. The lights went
      off while the Pi was rebooting (07:44–07:47); the meter's push reached nobody; nothing polled the
      meters. The rule below was right to flag the disagreement; the "frozen clamp" reading of it was not.
      **Why the flag never stood.** RM-079's rule needs v/c/p held three hours — due 10:47:44 — and
      from 10:58 the shared voltage restarted that clock every minute (`value_freeze.lo_yel2.since`
      read 11:03:52 at 11:05). The ingest also never stored the flag (FI-027), so the rows could not
      have said it either way.
      **Built.** A second clock in `node-red-bridge/valueFreezeTracker.mjs`: the last change of the
      channel's OWN registers (`today_acc_energy<n>`, `total_energy<n>`; never the shared
      `all_energy`), carried across value changes. `shared/measurementFreeze.mjs` `REGISTER_STALL`
      (30 min, owing ≥ 0.005 kWh — five ticks, so 10 W needs the half hour and 3 W two) and
      `registerStalled`; `shared/buildLatest.mjs` flags on either rule, `frozen_since` the earlier
      clock, threaded through `build-flow.mjs` and the mock as `FROZEN_AFTER_MS` is. `server/shapeRows.mjs`
      stores `measurement_frozen` and `frozen_since` in the row's `capabilities` (FI-027's storage
      half). `docs/bridge-contract.md`. Tests: `test/value-freeze-tracker.test.mjs` (+3),
      `test/measurement-frozen.test.mjs` (+5), `server/ingest.test.mjs` (+1).
      **Deployed 11:27:16** after a byte-identical `flows.json` backup: `deploy:pi --force --apply` (two
      node bodies changed, "Track value freezes" and "Build latest readings"; source tabs matched, 301 →
      301 nodes, verification 5/5), then `ibems-ingest`, `ibems-proxy`, `ibems-scheduler` restarted.
      All four meters' register clocks read back live at 11:27:31 (`value_freeze.<ctx>.regSince`);
      C.O Yellow's moved with every report, L.O Yellow's stood.
      **Read back 11:57, on the rule's schedule.** At 11:56:42, thirty minutes after the clock started,
      `mtr_lo_yellow` carried `measurement_frozen: true`, `frozen_since: 11:27:16`, and no
      `energy_kwh_today_integrated`, while the three other meters carried neither; the stored row at
      11:57:42 is the first with `capabilities.measurement_frozen` and `frozen_since` (the one before
      it, ingested at 11:56:42, has none — the tick came first). The clamp is still held at 39.8 W /
      0.446 A / 25523.556. Commit `9b941a4`, CI green.
      **The meter:** by this project's own rule (RM-077's "three freezes in four days"), a channel
      that a Node-RED restart does not thaw needs a power cycle at the panel — the operator's, outside
      office hours, and RM-020's caution applies. Until then L.O Yellow's stored power is a held
      figure; its energy is not being counted (the register is still, so the reports credit nothing —
      which is nearly right, the lights being off).
- [x] **RM-136** Two notices the operator reported on the Overview's Energy Breakdown and Analytics' By
      branch after RM-135, and the wording of both. **Built 2026-09-22 afternoon; run by the operator at
      16:31 and read back.**
      **Read back 16:36, read-only.**
      - The deploy passed 5/5, and the tracker carries the idle-restart clock; the meter poll and the
        demux survived the redeploy.
      - The repair wrote and read back 398 ring samples and four integrators, and the values survived the
        restart (`lo_yel2_energy` 0.2915).
      - The history endpoint holds no 39.8 W sample in 07:43–14:21. Its only flags are the two at 15:38,
        which the page's half-hour guard ignores.
      - 19/20 online, nothing frozen, and no new journal error beyond RM-026's logger.
      - In a browser against the live bridge, the Overview's Energy Breakdown and Analytics' By branch show
        no held notice and no shortfall.
      **1. "L.O Yellow's meter repeated exactly 41.9 W from 15:38 to 15:39 (1 min) … so it was not
      measuring" — a false flag, and a bug in RM-133's rule.** The lights came on at 15:38. In the ring,
      the very first loaded sample carried the bridge's `frozen` flag, which cleared at 15:40 when the
      register ticked. The register clock (`valueFreezeTracker.mjs`) measured "since the register last
      moved". A circuit at 0 W rightly moves nothing, so after hours idle the first 41.9 W sample "owed" hours
      of energy and was flagged at once. It would have happened at every lights-on after an idle stretch.
      - **Fixed at the source:** the clock restarts while the channel draws nothing, so owed energy counts
        only from when the load begins. `test/value-freeze-tracker.test.mjs` (+1, failed first).
      - **And on the page:** a flagged run shorter than the bridge's own shortest rule (half an hour of a
        still register, `REGISTER_STALL.afterMs`) is not trusted, since a true flag cannot sit on one.
        This clears the two flagged samples already in today's ring. `src/lib/timeseries.test.ts` (+1,
        failed first). RM-135's "a flagged run counts whatever its length" was the amplifier.
      **2. "L.O Yellow's meter repeated exactly 39.8 W from 07:43 to 14:21 … so it was not measuring" — a
      true hold, already fixed in the stored rows (RM-134's scrub), so the operator asked for it to go.**
      Two of Node-RED's own copies still carry it:
      - the 24 h ring the page reads;
      - the legacy integrators (`lo_yel2_energy` and the building's `bems_energy_today/week/month`), which
        counted the held watts.

      Cleaning the ring alone would bring back "47% missing"; so both are corrected together by
      `npm run repair:held-context:pi` (`node-red-bridge/heldContextRepair.mjs` +
      `repair-held-context.mjs`, `test/held-context-repair.test.mjs` 6; the phantom rule was neutered and
      its test failed). It is dry run by default, refuses `--apply` while Node-RED runs, backs both files
      up, and reads them back. **Dry run against the live files:** 398 ring samples go to 0 W; the phantom
      is 0.2597 kWh (held power over the time the integrator ran); `lo_yel2_energy` 0.5512 → 0.2915
      against the register's 0.2947; the building's three integrators each drop by 0.2597.
      **3. The wording, revised by the operator.** "The meter stopped updating … was not measuring … energy
      used in that window was not measured" was false on 09-22 on all three counts. It now reads, for
      example: "**L.O Red's reading was held.** It repeated exactly 19.1 W at 228.2 V from 06:00 to 20:59
      (14 h 59 min) while reporting online, so that figure was not a live measurement. The energy shown is
      the meter's own register, not the held power." An ongoing hold adds "if the meter itself has
      stopped, energy used since then is not counted yet". The headline (`frozenHeadline`) and the detail
      live in `src/lib/branchEnergy.ts` for both cards, and the name appears once.
      `node-red-bridge/valueFreezeTracker.mjs`, `node-red-bridge/bridge-flow.json` (regenerated),
      `src/lib/{timeseries,branchEnergy}.ts`, `src/components/{analytics/EnergySection,overview/EnergyBreakdownCard}.tsx`,
      `src/components/analytics/branchEnergyCards.test.tsx`, `src/lib/branchEnergy.test.ts`, `package.json`.
- [x] **RM-135** "L.O Yellow is reporting less than it measured — 0.29 kWh against 0.55 kWh … 47%
      missing … energy going missing between the meter and this page." A false accusation, shown after
      RM-134 had fixed the reading. **Built 2026-09-22 afternoon; verified in a browser against the live
      bridge; deploys with `npm run build` on the Pi.**
      **Why it showed.** The 0.55 is the legacy integrator, which multiplied the held 39.8 W by 6.6 hours.
      The bridge withholds that second opinion only while its freeze flag stands; the flag cleared at
      14:21, so it came back carrying the morning. The page subtracts what a freeze made the integrator
      count, but only for a freeze it finds in the 24 h ring (RM-077), and it found **none**. Run against
      the real ring, `detectFrozenRuns`' longest identical run was 164 samples (it needs 180). Three
      things cut the hold, and none of them was the meter measuring:
      - offline samples at the morning's reconnects (07:45, 07:59, 08:13);
      - channel 2's voltage dp, which is channel 1's mains reading;
      - the bridge's own flag switching on.
      **The fix.** `src/lib/timeseries.ts` `detectFrozenRuns`:
      - It skips offline samples instead of breaking on them: a value that survives a reconnect is a
        value nobody re-read.
      - On a channel whose voltage is shared (`src/lib/measurementScope.ts` `voltageIsShared`: the
        product has more than one channel), it keys on power and current alone. That is RM-133's
        principle, applied on the page.
      - A run holding any sample the bridge flagged `frozen` counts whatever its length.

      Single-channel devices keep the voltage in the key, and the thresholds are unchanged. Measured
      over seven days of stored rows for all eleven metered devices: without the voltage, the outlets'
      longest healthy run would double (60 → 119 min against the 175-minute bar), while the meters'
      stays at 13 min. So the voltage is dropped only where it is not the device's own reading.
      Carrying runs across offline gaps produced nothing longer than two samples. The notice now names
      the whole hold without claiming a held voltage. The charts (`buildChartRows`, `prepareSeries` from
      Analytics and `SourceCard`) use the same rule, so the 24 h chart marks the same span.
      **Measured:**
      - On the real ring, one run, 07:43–14:21, 392 samples. 0.263 kWh comes out of the integrator,
        leaving 0.286 against the register's 0.293: nothing missing.
      - In a browser against the live bridge (a dev server tunnelled to it, GETs only), the Energy
        Breakdown shows "L.O Yellow's meter stopped updating … 39.8 W from 07:43 to 14:21 (6 h 38 min)"
        and no shortfall.
      - Tests: `src/lib/timeseries.test.ts` (+3), `src/lib/branchEnergy.test.ts` (+2, the day's shape),
        `src/components/analytics/analyticsMath.test.ts` (+2). Each of the three rules was neutered and
        its test failed.
      **Not changed:** the notice's wording, "so it was not measuring … energy used in that window was
      not measured" (RM-077, the operator's decision of 2026-09-14). It is right for a clamp that
      freezes. On 09-22 the meter was measuring and its register counted the 2 Wh correctly; the bridge
      was not listening. Rewording it is the operator's call.
      `src/lib/timeseries.ts`, `src/lib/measurementScope.ts`, `src/lib/branchEnergy.ts`,
      `src/components/analytics/{analyticsMath.ts,AnalyticsPage.tsx,SourceCard.tsx}`.
- [x] **RM-134** The meters were never re-read. L.O Yellow's "frozen clamp" was a value nobody asked
      for again. **Applied by the operator 2026-09-22 ~14:20 (`flows.json` backed up beside it; demux
      upgraded, then the meter poll added, 301 → 303 nodes). Read back 14:21–14:24, read-only, and the
      diagnosis held.**
      - The demux's raw record gained dp 103 `working`, 110, 111, **113 `monitor`**, 120 and 121 for the
        first time; dp 115/116 read **0 / 0**.
      - `mtr_lo_yellow` reads 0 W / 0 A / `monitor`; its register is 25523.558, +0.002 kWh since
        07:43:49. **No device is flagged frozen.**
      - L.O Red's label went from a stale `monitor` at 26.6 W to `working` at 27.5 W. So the `monitor`
        label at load was a stale push, and grounding the idle rule in current stays the conservative
        choice.
      - There is no meter-node error in the journal since the apply. CI is green on `c225c52`.

      **The timeline, confirmed:**
      - No command was issued 07:30–08:30.
      - `l7`'s `relay_status` is `off` (off at power-on), so its "on" at 07:47 was a cached value.
      - The previous boot's last journal entry is 07:44:02: the power cut took the lights and the Pi
        together.
      - At 07:47 the reconnected meter pushed only channel 2's voltage. Its power and current had nothing
        left to change.

      **The held rows:** `npm run scrub:held` (`server/scrubHeldReading.mjs` + `scrub-held-reading.mjs`,
      8 tests, both refusals neuter-checked). Dry run against the live rows: 396 rows between 07:43:49 and
      14:21:47, the register +0.002 kWh across 6.6 h, so **at most 0.302 W on average** where the held
      39.8 W would have added 0.264 kWh. 389 rows take C.O Yellow's same-instant voltage and 7 have none
      (null, stamped). `energy_kwh_today` is untouched: it came from the register and was right.
      **Applied by the operator 2026-09-22 ~14:50:** "OK: all 396 rows read back as planned". Checked
      again independently, read-only:
      - Of the 396 rows in the window, 396 are 0 W / 0 A and stamped `held_reading`. None still holds
        39.8 W, none is flagged frozen, and 7 have a null voltage.
      - The genuine edge rows (07:43:49, and 14:21:47 on) are untouched.
      - `npm run check:meters -- --hours=24` lists four events, all before this work: three one-minute
        trades at 17:28–17:37 on 09-21 (before the demux, and under its two-sample debounce) and the
        demux's own 06:53 transition minute. None falls after 07:43, so zeroing the held rows made no
        false hand-off.
      - `npm run preflight -- --listen=6` reads **`Ready`** (the two known warnings), with `flow_polls`:
        "all 18 node(s) are fed a GET poll".
      **Left as it is, deliberately.** The legacy integrator (`energy_kwh_today_integrated`, 0.549
      against the register's 0.293) and the 24 h history ring still carry today's held 39.8 W. Both are
      flow context, so they can only be edited with Node-RED stopped. The integrator resets at midnight
      and the ring rolls off within a day. The stored rows and the reports, which read the register, are
      unaffected.
      **What was measured, read-only.**
      - Every outlet, every light switch and the IR hub is fed `{ operation: 'GET' }` on a timer. The
        three meter sessions (C.O yellow, L.O red, AREC ACU) were fed nothing.
      - The live `node-red-contrib-tuya-smart-device` 5.4.0 hard-codes `issueGetOnConnect: false` and
        `issueRefreshOnConnect: false`. The devices report a dp only when it changes.
      - The demux's raw record (`co_yel_raw_dp`, persisted since 04:26) had **never** received dp 103/113
        (`device_state1/2`) or 110/111/120/121.
      - Channel 2 measured normally 06:54–07:43:49 (lights on, ~40 W, register rising 25523.522 → .556).
        The office power came back with the L5–L7 relays off while the Pi was rebooting (07:44–07:47). The
        meter's push of "0 W" reached nobody, and a channel at 0 W had nothing new to push. The register
        has stood at 25523.556 since, which is ≤ 0.001 kWh in six hours, i.e. under 0.2 W.

      So the bridge showed the last pushed value indefinitely, and RM-133's register rule flagged the
      disagreement. The same signature is on L.O Red's freezes (RM-077, re-read there).
      **Built.**
      - **The meter poll.** `node-red-bridge/meterPollPlan.mjs` + `poll-meters.mjs` (`npm run
        poll-meters:pi`). It adds an inject every 60 s (first fire 10 s after the deploy) and a function
        with one output per session, sending GET and skipping a session whose parser says it is down.
        Targets come from the registry: each `class: 'meter'` device's parser, found by its health key, then
        the tuya node that feeds it directly or through the channel demux. So the dual meter gets one GET,
        and the Aircon tab's legacy "AREC ACU Daily Parser", which also writes `arec_health` but is fed by a
        timer, is not mistaken for a parser. The install is add-only and validated; the deployment type is
        `nodes`, so no session restarts. **Live dry run: 3 sessions, 301 → 303 nodes, no invariant problem.**
      - **The demux's idle rule is grounded in current** (`shared/channelDemux.mjs` `isIdle`). A channel is
        idle only at exactly 0 W / 0 A, and the `monitor` label is no longer sufficient. The poll makes the
        label arrive every minute for the first time; live L.O Red shows `monitor` at 26.6 W, and two polls
        agreeing on a word would have traded a day's attribution. Every observed flip (all at 0 W / 0 A) is
        classified exactly as before. The regression test failed before the change.
      - **`npm run preflight` `flow_polls`** is an error when an enabled tuya node is fed no GET
        (`pollCoverage`). A restored `flows.json` would drop a poller with no diff.
      - `CLAUDE.md` gets the site fact "the tuya node never reads state on connect"; the Pi brief gets the
        trap "a Node-RED restart is not a re-read".
      **Decisive test on apply** (read-only): `co_yel_raw_dp` gains dp 103/113, and `mtr_lo_yellow` reads
      ~0 W with `today_acc_energy2` still 25523.556 and no `measurement_frozen`. If it re-reports 39.8 W
      instead, the clamp really is stuck and RM-133's panel power cycle stands.
      **Then (operator's choice): scrub the held rows** 07:45 → the first polled row, with the register as
      evidence (power/current 0, a `capabilities.scrub` stamp, dry run first).
      **Channel interchange:** the demux now judges a complete snapshot of both channels each minute
      rather than one fresh channel beside one possibly hours old. Prevention outright is hardware: check
      for a firmware OTA on the dual meter; the definitive fix is two `cz_ct_single` meters, which cannot
      trade channels.
      `node-red-bridge/meterPollPlan.mjs`, `node-red-bridge/poll-meters.mjs`, `test/meter-poll.test.mjs`
      (16), `shared/channelDemux.mjs`, `test/channel-demux.test.mjs` (+1), `scripts/preflight.mjs`,
      `test/preflight.test.mjs` (+4), `CLAUDE.md`, `docs/pi-session-brief.md`, `shared/measurementFreeze.mjs`,
      `node-red-bridge/valueFreezeTracker.mjs` (comments), `server/scrubHeldReading.mjs` (+ test, 8),
      `server/scrub-held-reading.mjs`, `package.json`.
- [x] **RM-130** The director's office aircon, on C.O Yellow with the outlets, reported as the estimate it is.
      **Built 2026-09-22; deployed with the Daily period.**
      **What the operator said (2026-09-22, closing FI-035):** the outlets on C.O Yellow are in the CARE
      office; the aircon in the director's office is on the same branch and draws about two thirds of it.
      Nothing meters that aircon on its own, so its figure can only be an APPORTIONMENT — the branch's
      measured energy times a declared share — which is a different kind of number from everything else
      on the page, and is treated as one: the share and its basis are declared in the site file
      (`circuits.mjs`, `apportionment` on C.O Yellow, `share: 2 / 3`, `basis: "operator's estimate,
      2026-09-22"`), never in code; every place the figure appears says "≈", the share in words, the
      basis, what it leaves for the outlets, and the branch's own caveats (a partly recorded branch gives a
      partly recorded estimate; a branch figure RM-090 refuses refuses its share too).
      **The measured charts are not touched.** `load: 'other'` still groups the whole of C.O Yellow as
      Others in "Energy by use"; the section says how much the estimate would move to Aircon, and that it is
      not moved, because a chart of measurements should not carry an estimate. A reader who wants the
      reallocated split has the two figures side by side.
      **Where it appears:** the Circuits tab, as "Estimated, not metered" below the branch table, for the
      branches in the reader's scope; the PDF, as the `Estimated loads` section in both Simple and Detailed,
      for the branches in the document's scope. Not on the Overview, which is the whole building measured.
      **Charted (operator's request, the same evening):** the estimate gets its own bar chart in the same
      shape as the circuits' — per day for a week or month (the branch's bounded daily energy times the
      share), per hour for a day (its hourly credits times the share) — drawn through the same builders
      with an `estimate` option: every bar hatched in the series colour and outlined, never solid; every
      value "≈"; the basis in the caption. In the section on the Circuits tab and inside the PDF's
      `Estimated loads` section. `charts/{daily,hourly}EnergyChart.ts` (`EnergyChartOptions`),
      `apportionment.ts` (`estimateDayPoints`, `estimateHourPoints`).
      `src/lib/apportionment.ts` (+ test), `src/components/reports/ApportionedLoads.tsx`,
      `src/components/reports/ReportsPage.apportioned.test.tsx`, `src/lib/reportPdf/{buildReport,docDefinition}.ts`
      (+ tests), `src/lib/reportSections.ts`, `test/site-branch-wiring.test.mjs` (the declaration's shape:
      a share strictly between 0 and 1 of a metered branch, a load the reports know, a basis; the
      apportionments of a branch never reach 1).

### The re-paired IR blaster — RM-114 to RM-121 (2026-09-17)

**What the operator did.** They re-paired the aircon's IR blaster into Smart Life and the vendor
project, then pasted its new device id and local key into the `NBRIC IR Blaster` node in the Node-RED
editor (deployed 14:36 local). The node stayed quiesced (`disableAutoStart: true`, since EX-098).

**What was measured, read-only, the same day:**
- **"Smart IR"** is category `wnykq`, product "Lasco Wifi IR Pro Max", online in the cloud. The flow
  node now points at it, and its local key matches the cloud's (compared, never printed).
- A passive listen on the Pi decoded its discovery broadcast announcing **v3.3**, the value the node
  declares. All 18 installed devices announced; every version matched its declaration.
- Its thing model has four dps:
  - 101 `temp_current` (value, scale 1, ℃; 286 = 28.6 °C; standard code `va_temperature`);
  - 102 `humidity_value` (%; standard code `va_humidity`);
  - 201 `ir_send`;
  - 202 `ir_study_code`.

  It has no standard instruction set.
- **"Air"** is category `infrared_ac`, `sub: true`: a virtual remote with no network presence. Its model
  carries dps 101–105 (`switch_power`, `mode` "0".."4", `temperature`, `fan` "0".."3", `swing`) and the
  hub's IR plumbing (dps 1–13, 201, 202). Tuya's IR AC reference names the enums: mode 0 cool, 1 heat,
  2 auto, 3 fan, 4 dry; fan 0 auto, 1 low, 2 medium, 3 high.
- Its standard set (PowerOn/PowerOff/T/M/F) has no swing. Its shadow held
  `switch_power:true, mode:"0", temperature:16, fan:"0", swing:false` from the pairing test.
- Tuya's IR hub API (`/v2.0/infrareds/*`) is **not subscribed** on this project (`28841101`). The
  thing-model route is how the cloud reaches the remote.

- [x] **RM-114** The Outside Temp would have shown indoor data the moment the hub reported.
  - **The defect.** `buildLatest` derived `online` for both `ac_dash_state` devices from the same four
    fields, and gave the outside sensor `ac.humidity`. The uninstalled sensor would have read ONLINE,
    and the Overview's "Outside" tile would have shown the office's humidity.
  - **The aircon had its own version of it.** It counted `setTemp`, a value this system commands, as
    evidence of reporting, and its `ts` was always now.
  - **The fix.**
    - Each device now answers from its own fields.
    - The aircon's `online` needs a real sensor value and a session not reported down, and its `ts` is
      the hub's sense time (expiring past `STALE_READING_MS`).
    - The sensor reads only its `state_field`.
    - `STALE_AFTER_MS_BY_CLASS.acu_ir` is 150 s against a 60 s hub poll.
    - The reading also serves the last commanded `ac_mode`, `ac_fan`, `ac_swing`, `commanded_at` and
      `command_via`.
  - `shared/buildLatest.mjs`, `test/aircon-reading.test.mjs`, `test/reading-freshness.test.mjs`.

- [x] **RM-115** An aircon command is one absolute state, sent local-first.
  - **Why a whole state.** An IR frame carries power, mode, setpoint, fan and swing together, so
    `shared/acState.mjs` resolves every command into all five. The mode, fan or swing a command leaves
    out comes from the last COMMANDED state, so the closed loop's setpoint steps keep the operator's
    mode. Both paths are handed that one state, so a cloud send can never restore what the cloud
    remembered.
  - **How it travels.**
    - `shared/commands.mjs` accepts `mode`, `fan` and `swing` for `acu_ir` only.
    - The local route posts `{state}` to `/acu`; the flow answers `422 no_local_code` or
      `409 device_offline`, and both go to the cloud.
    - The cloud route issues the state as DP properties on the Air remote. OFF sends power alone.
    - The remote's id is resolved from the cloud listing as the project's one `infrared_ac` device
      (`server/acRemote.mjs`); zero or several is a stated reason. It is not in the flow, and it cannot
      be in this repository.
    - A cloud send is posted back to the flow as `record_only`.
  - **The unverified-library rule.** While `SITE.aircon.local_ir_verified` is false, ON states go
    cloud-first: a wrong IR code does not fail, it succeeds at doing the wrong thing. `local-only`
    still means no vendor.
  - **Knock-on changes.**
    - The scheduler builds the cloud route for aircon commands only.
    - `cloudDispatchConfig` maps a node through the registry's `flow_node`, and re-reads the flow on a
      lookup miss.
    - The audit outcome records the resolved state in columns and in the note.
    - `/api/capabilities` serves `acu_cloud_route` and `acu_local_ir_verified`.
  - `shared/acState.mjs`, `server/dispatchLight.mjs`, `server/dispatchCloud.mjs`, `server/acRemote.mjs`,
    `server/auditedDispatch.mjs`, `server/dispatchAircon.test.mjs`.
  - **Not yet deployed** — see §0.

- [x] **RM-116** `npm run aircon:pi` — the Aircon tab, refactored for the hub. **Applied by the operator
  2026-09-17 and read back the same evening:** a re-plan found nothing to do, the hub connected at
  19:50, and `ac_dash_state` carried the hub's temperature and humidity. RM-128 regenerates AC Master
  Logic on top of it (not yet applied).
  - **Changes.**
    - Un-quiesces the blaster and nothing else about it.
    - The blaster's parser becomes a generated IR hub parser: catalogue-driven, plausibility-bounded,
      stamping the sense time and the session's health, with learned codes on output 2.
    - The state manager writes the hub readings and the full commanded state, keeping the Outside
      Temp branch as it was.
    - AC Master Logic is regenerated around the live node's own head and IR library, extracted and
      checked code for code, with a third output that replies.
    - `ACU auth + validate` takes the full state, and the parallel "ACU 200 response" is removed. That
      node answered 200 before anything was known, so a dead hub looked like success and the cloud
      fallback could never fire.
    - A 60 s hub poll is added.
    - The Node-RED aircon cron path and the silent ESP32 sniffer are disabled (`d: true`).
  - **Invariants.**
    - Every tuya node's id, key, version and find timeout is unchanged.
    - Outside Temp stays quiesced, and its parser is byte-identical.
    - The IR library is identical, and no other tab changes.
    - There are no dangling wires, and a re-run is a no-op.
  - **Tests.** The generated sources are executed in a Node-RED-shaped sandbox against a redacted
    fixture of the live tab.
  - **Dry run.** Planned against the full live flow read-only: clean, invariants pass, 299 → 300 nodes.
  - `node-red-bridge/airconSources.mjs`, `node-red-bridge/airconFlowPlan.mjs`,
    `node-red-bridge/aircon-flow.mjs`, `test/aircon-flow-plan.test.mjs`, `test/aircon-sources.test.mjs`,
    `test/fixtures/aircon-tab-live-2026-09-17.json`.

- [x] **RM-117** `supabase/phase45_command_ac_state.sql` — `commands.ac_mode`, `ac_fan`, `ac_swing`.
  **Applied by the operator 2026-09-17; read back 2026-09-22 07:55** — a GET of
  `commands?select=id,ac_mode,ac_fan,ac_swing` through the Pi's credentials answers 200.
  - **Constraints.** The `shared/acState.mjs` vocabularies; all three or none; only on an ON command.
    No backfill, no grant.
  - **Rehearsal.** Run on the Pi in a throwaway container (image already cached): every migration, the
    privilege invariant, phase45 twice, and a stage that has four malformed rows refused. PASSED.
  - `supabase/rehearse.sh`, `test/phase45-command-ac-state-schema.test.mjs`.

- [x] **RM-118** Add Device: versions from the device itself, IR hubs and remotes recognised, Rebind.
  - **Enrolment could never succeed.**
    - **Cause.** It required `detail.version` from the cloud, and `/v1.0/devices/{id}` has no version
      field (checked on every device). The `enroll:pi` CLI had its own copy of the same requirement.
    - **Fix.** `server/lanDiscovery.mjs` listens passively (`reuseAddr`, as tuyapi does) and decodes
      v3.1 plaintext, v3.3/3.4 AES-ECB and v3.5 AES-GCM, with no dependencies.
    - **Measured.** Run on the live segment, it decoded all 18 installed devices with every version
      matching tuyapi's, and no undecoded datagram.
  - **The wizard offered "Air" as an outlet.**
    - `classifyVendorDevice` knows the project's five vendor categories.
    - The remote is "linked" to the site's aircon and never enrollable.
    - An IR hub or a meter is not enrolled from the form, each with its reason.
    - A claimed device names its node.
  - **Rebind.**
    - **Why.** A re-pair gives a device a new id and key, and the fix was hand-pasting them into the
      editor, which is what happened here.
    - **Plan.** `rebindPlan` changes exactly `deviceId`, `deviceKey`, the announced `tuyaVersion` and
      optionally `disableAutoStart`, on one named node.
    - **Refusals.** `rebindService` refuses a node whose device is still in the project, a target
      another node polls, a different kind, a virtual sub-device, a node with no registry device, or a
      missing version. It reports a version that differs from `TUYA_NODE_VERSIONS`, and never returns
      the key.
    - **Entry points.** `POST /api/rebind` and `npm run rebind:pi` share it.
  - **Checked against the fleet measured today.**
    - Air → linked to CARE ACU IR.
    - Smart IR → already in the flow as `NBRIC IR Blaster`.
    - Outside Temp is an orphan with no bound class, so it is never offered a rebind.
  - `server/lanDiscovery.mjs`, `shared/enrollment.mjs`, `server/tuyaFleet.mjs`,
    `node-red-bridge/rebindPlan.mjs`, `server/rebindService.mjs`, `server/rebindRoute.mjs`,
    `src/components/devices/EnrollWizard.tsx`.

- [x] **RM-119** The Control page's aircon panel sends and shows the full state.
  - **Controls.** Mode and Fan pill groups, the setpoint and a Swing switch compose one state. The
    confirmation names all of it.
  - **Readouts.** The hub's room temperature and humidity sit apart from LAST SENT, which is what was
    commanded, with when and via which path.
  - **Where it goes.** The panel says where a state will go before Send (over the LAN, through the
    cloud, or nowhere with the reason and Send ON disabled). OFF always stays available.
  - **Checked** in the browser against the mock at 800×600 and 375 px in both themes.
  - `src/components/control/IrCommandCenterCard.tsx`, `src/components/control/acControl.ts`,
    `src/components/ui/PillGroup.tsx`.
  - **Not yet built on the Pi.**

- [ ] **RM-120** The on-site acceptance test. **Operator, with someone watching the unit.** Each step
  moves the real aircon, so each is the operator's to run.
  1. Send OFF. Expect `via=local`.
  2. Send ON 24 °C in the library's state, and **record what the unit's display shows for mode, fan and
     swing**. The codes decode as cool / auto / off (RM-128); a unit showing anything else means it
     does not read TCL112 the way the reference does — stop and record it.
  3. Send Dry, fan High, swing on — a GENERATED frame (RM-128). Expect `via=local` with the audit detail
     "generated" while IoT Core is lapsed (`via=cloud` if it is renewed), and the unit to follow. Repeat
     for Fan and Heat, fan Low: each field of the generated frame is then seen working once.
  4. Send 26 °C with the same mode, fan and swing. The unit keeps them.
  5. Only after 2–4 pass: set `SITE.aircon.local_ir_verified: true`, with the evidence here.
  6. Take the hub off the network. A local send answers 409 (and goes via the cloud if one answers).
  7. Arm one ACU rule for 15 minutes. Its steps keep the mode.

  Until step 5 is done, ON states are cloud-first by design when a cloud is ready.
  The network no longer blocks it: after the Pi's 07:44 reboot on 2026-09-22 the IR hub is back and
  connected (§0). It waits only on someone at the unit.

- [ ] **RM-121** **The Tuya IoT Core subscription expired on 2026-09-17.**
  - **Measured.** Every business call answers `code 28841002: IoT Core service subscription has
    expired`. The token still issues. The proxy has logged it since about 18:58 local.
  - **Blocked until renewal.** The vendor-cloud fallback for every device, the aircon's
    mode/fan/swing route, the Add Device list, `/api/tuya/presence`, `npm run tuya:devices` and
    `npm run tuya:spec`.
  - **Unaffected.** Local control, ingest and reports.
  - **The fix is an account action:** Tuya developer console → Cloud → Cloud Services → IoT Core →
    extend.
  - **Superseded in part, 2026-09-22 (RM-126 – RM-129).** The operator's policy is that IoT Core is for
    extracting keys only. Add Device, rebind and the aircon's mode/fan/swing no longer need it; what
    still does is listed under RM-129. Renewal is now optional, not the first action. Since RM-132
    the preflight reports the lapsed trial as a warning rather than `Not ready`.
  - **Related, optional.** Subscribing "IR Control Hub Open Service" would add Tuya's own AC status
    endpoint. Nothing here needs it.

### Reports, corrected and made plain — RM-090 to RM-099 (2026-09-16)

Why this exists is the 2026-09-16 entry in §0. Operator decisions, 2026-09-16:
1. Correct the stored report and show a "Corrected" note.
2. Load categories are fixed in the site setup: L.O Red and L.O Yellow are Lighting, CARE ACU is Aircon,
   and C.O Yellow with its outlets is Others.
3. The every-reading CSV exports minute readings while they are retained, and hourly rows for older
   periods. Retention is not changed.
4. Four simpler tabs: Overview, Circuits, Usage patterns, Compare.

- [x] **RM-090 (S) — the page refuses a stored figure its circuit could not have drawn. 2026-09-16.**
  - **`src/lib/boundedEnergy.ts`** holds the rule twice over:
    - `boundDay`, the per-day rule phase42 will compute in SQL. Its six fixture days are the ones the
      rehearsal will seed, with the same answers: a jump, a healthy day, a nine-hour gap, a restart, a
      jump in an hour with no power reading, and a day with no power at all.
    - `periodEnergyCheck`, which calls a stored figure impossible when it exceeds its peak power held for
      the whole period (+10 %, +5 Wh). It is loose on purpose — energy counted across an outage still
      passes — and it still refuses 81.406, whose limit is 46.4.
  - **What a flagged figure does.**
    - `ReportFigure` prints an impossible figure as an em dash with a "Not possible" badge, and a
      corrected one (`energy_removed_kwh` above 1 Wh, from phase42) with a "Corrected" badge saying how
      much was taken out.
    - The breakdown leaves the circuit out and says why, rather than calling it unmetered. The Circuits
      tab's total and shares skip it. The per-device CSV leaves the cell empty and gains a Note column.
    - The PDF follows each device table with a line per flag.
  - **Neuters.** Four each fail tests: dropping the cap, crediting the cap instead of the measured power,
    never letting a falling counter reset the rise, and never calling a period impossible.
  - Files: `src/lib/boundedEnergy.ts`, `src/lib/supabaseReports.ts`, `src/components/reports/ReportFigure.tsx`,
    `src/lib/circuitBreakdown.ts`, `src/components/reports/charts/circuitBreakdownChart.ts`,
    `src/components/reports/CircuitDeepDive.tsx`, `src/components/reports/ReportsPage.tsx`,
    `src/lib/reportCsv.ts`, `src/lib/reportPdf/buildReport.ts`, `src/lib/reportPdf/docDefinition.ts`, and
    their tests.
- [x] **RM-091 (M) — `phase42_bounded_device_energy.sql`: the generators use the rule, and the one row is
  corrected. Written and rehearsed 2026-09-17; applied by the operator and read back the same day.**
  - **Read back live** (service role, GET only, 2026-09-17):
    - `report_device_daily_energy` for the week of 7 September gives L.O Yellow **0.713 kWh on 8
      September, with 77.502 on the counter, 76.789 removed and one clipped hour**. The other six days
      equal their counters exactly.
    - The stored `period_reports` row reads **4.617 kWh with 76.789 removed**, `energy_restated_at`
      2026-09-16 21:22 UTC. Its `generated_at` (2026-09-16 00:39 UTC), sample count and peak are unchanged.
    - **Exactly one row** anywhere has `energy_restated_at` or `energy_removed_kwh`. The other three meters
      that week are untouched.
    - The building row is unchanged at 61.733 kWh, and **the four branches now sum to 61.513** — 0.36 %
      apart, where they were 138.3.
    - The function run over every stored period (August, and every week from 10 August) finds **no other
      removal**.
    - The legacy `monthly_reports` row is unchanged, and an anonymous call is refused with 42501.
  - **Timing, as the service role** (which skips RLS): 0.4–2.9 s per period; the August month took 2.9 s.
    A signed-in reader also pays the readings policies' role check — RM-091a.
  - **What it adds.**
    - `period_reports.energy_removed_kwh` and `energy_restated_at`.
    - `report_device_daily_energy(period, start, tz, device_ids)`: one row per device per local day of
      the period, gap days included, with the bounded energy, the counter, what was removed, clipped
      hours, peak, average, minutes recorded, minutes in the day and resolution. `security invoker`;
      signed-in readers and the service role may run it, anonymous readers may not.
  - **What it changes.** `generate_period_report` and `generate_monthly_report` sum that function for
    per-device energy, and the period generator keeps what was removed beside the figure.
    `test/phase42-bounded-device-energy-schema.test.mjs` holds three things:
    - both generators' building halves, declarations and hours are phase27's and phase12's text byte
      for byte;
    - the correction updates three columns of one table and deletes nothing;
    - the cap's constants are `src/lib/boundedEnergy.ts`'s.
  - **The one-time correction** subtracts what was removed only from a stored row that provably contains
    it: its figure must still equal the sum of the counters it was built from, within 0.01 kWh. It never
    touches coverage, `generated_at`, the building rows or the legacy tables, and a second paste changes
    nothing.
  - **Rehearsed on the Pi's Docker, `== REHEARSAL PASSED ==`.**
    - Every earlier assertion still holds, June's figures and the monthly-equals-period check included.
    - A new stage seeds the six fixture days `boundedEnergy.test.ts` uses, with the same answers, plus a
      minute-resolution jump (51.19 -> 1.19 kWh). It also seeds stored rows as the old generators wrote
      them, then applies phase42 twice: two rows corrected, then none.
    - Stale rows and a figure not built from these counters are left alone. The generators reproduce the
      corrections, and July agrees between the period table and the legacy table.
  - **Neuters.**
    - Rehearsal: without the bound, it fails at fixture A (67.50 where 0.30 is right); without the proof
      that the stored figure contains the jump, it corrects the unprovable row to 2.95.
    - Text test: an edited building half fails its byte-for-byte check.
  - **To apply:** paste the file into the Supabase SQL editor. The NOTICE should say it corrected
    **1** row. I read the rest back over the API. The operator can time a signed-in month read, which
    decides RM-091a:
    ```sql
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    explain analyze select * from report_device_daily_energy('month', date '2026-09-01', 'Asia/Manila',
      array['mtr_lo_red','mtr_arec_acu','mtr_co_yellow','mtr_lo_yellow']);
    rollback;
    ```
  - **Expected read-back:**
    - 2026-09-08 L.O Yellow: counter 77.502, energy about 0.713, removed about 76.789, and no other
      removal anywhere.
    - The week of 2026-09-07 `mtr_lo_yellow` row: about 4.617 kWh, with `generated_at` unchanged.
    - The four branches: about 61.51 kWh against the building's 61.73.
  - Files: `supabase/phase42_bounded_device_energy.sql`, `supabase/rehearse.sh`,
    `test/phase42-bounded-device-energy-schema.test.mjs`, `docs/storage-contract.md`.
- [x] **RM-091a (S) — `phase43_readings_policy_speed.sql`: the readings policies check the role once per
  statement. Written and rehearsed 2026-09-17; applied by the operator and read back the same day.**
  - **Read back by the operator.** `pg_policies` shows both `readings_select_authenticated` and
    `readings_hourly_select_authenticated` as `(( SELECT auth.role() AS role) = 'authenticated'::text)`.
  - **The signed-in timing probe** below (all eleven measuring devices, September to date, 17 days)
    measured **5,232 ms before and 3,269 ms after** — one run each.
  - **The same read as the service role**, which skips RLS: 1.2–1.5 s warm and 3.8 s cold. A full month has
    nearly twice these readings, so one statement for every device stays too close to the signed-in
    statement timeout — RM-091b.
  - **Why.** `readings` and `readings_hourly` let signed-in readers in with `auth.role() = 'authenticated'`,
    called bare, so Postgres evaluates it for every row a query touches. phase40 (RM-086) measured the same
    shape on the totals tables: 3.5 s as the service role, cancelled by the signed-in statement timeout on
    every attempt.
  - **Why it matters now.** RM-094's Circuits tab and RM-098's every-reading CSV read whole weeks and months
    of `readings` signed in, and phase42's month read already takes 2.9 s before any policy check.
  - **The change.** Both policies are dropped and recreated with `(select auth.role())`: the same rows, the
    same role, evaluated once. Nothing else is touched.
  - **Guards.**
    - `test/phase43-readings-policy-speed-schema.test.mjs` checks the shape and that nothing else is in the
      file.
    - `supabase/rehearse.sh` applies it twice, checks both quals, and confirms a signed-in reader still sees
      every reading and hourly row and still finds the jump. A neuter restoring the bare call fails it.
  - **Timing probe** — run it in the SQL editor before and after pasting phase43 (it is rolled back, and
    reads the eleven devices the Circuits tab asks for):
    ```sql
    begin;
    set local role authenticated;
    select set_config('request.jwt.claim.role', 'authenticated', true),
           set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    explain analyze select * from report_device_daily_energy('month', date '2026-09-01', 'Asia/Manila',
      array['mtr_lo_red','mtr_arec_acu','mtr_co_yellow','mtr_lo_yellow','co1','co2','co3','co4','co5','co6','co7']);
    rollback;
    ```
  - **Read back:** the probe's Execution Time before and after, and the Circuits tab on a month signed in.
- [x] **RM-091b (S) — the Circuits tab reads daily energy four devices at a time. 2026-09-17.**
  - **The change.** `getDeviceDailyEnergy` (`src/lib/circuitSeries.ts`) sends `DAILY_ENERGY_GROUP` = 4
    devices per statement, all groups concurrently, and merges the rows in device-then-day order.
    "Not installed" from any group is an answer for the whole read; any other failure throws.
  - **Measured live as the service role,** September to date:
    - one statement for all eleven devices: 1.3–3.8 s;
    - three concurrent groups: 0.7–1.4 s each, **1.4 s wall** — the same wait, with each statement doing
      about a third of the work.
  - **Observed and not explained.** For about two minutes during that measurement, every month read timed
    out at about 9 s (57014) — even one device, as the service role — while a simple read answered in
    0.6 s. The next 16 calls, in the same shapes, took 0.7–3.8 s. My own concurrent measurement calls may
    have loaded the database at that moment, but nothing established that. If the Circuits tab reports a
    statement timeout again, this is where to start.
  - **Tests.** `circuitSeries.test.ts` +2: grouping and merged order; a missing function or a failure in
    any group. A neuter setting the group size to 400 fails the grouping test.
- [x] **RM-092 (S) — a `load` category on each branch circuit. 2026-09-17.**
  - `shared/circuits.mjs` gains `LOADS` (`lighting`, `aircon`, `other`), `LOAD_LABELS` (Lighting,
    Aircon, Others), `loadOf(circuits, id)` and `buildingMetersByLoad(circuits)`.
    - `loadOf` returns a circuit's own category, else the nearest above it. It is cycle-safe, and an
      undeclared or unknown value is `null`, never a guess.
    - `buildingMetersByLoad` groups building meters only, so an outlet can never be added to its own
      branch's figure.
  - The site's `circuits.mjs` carries the operator's categories: L.O Red and L.O Yellow are lighting,
    CARE ACU is aircon, C.O Yellow is other. The demo site carries them too, and `site:new` documents
    the field.
  - `site:check` reports `circuit_load_invalid` (error) and `circuit_load_missing` (warning, for a
    building meter whose circuit says nothing). This site reads coherent.
  - Tests: `test/circuit-tree.test.mjs` (+4), `test/site-branch-wiring.test.mjs` (the four categories,
    and Others is C.O Yellow's meter alone), `test/site-check.test.mjs` (+2, and the live site has no
    missing category).
  - No daemon reads `load`, so running services behave identically until they restart onto it. The
    frontend needs `npm run build` (RM-093 is the first reader).
- [x] **RM-093 (M) — narrow a report to a category of load or to one circuit. 2026-09-17.**
  - **The scope.** `src/lib/circuitBreakdown.ts` gains
    `ReportScope = all | load | circuit`, with:
    - `encodeScope` and `decodeScope` (anything the tree does not offer is the whole building, never
      an empty report);
    - `scopeOptions` (the whole building, then each category the branches carry — only when they
      carry two or more — then each branch);
    - `scopeLabel`, `scopeMeterIds` (building meters only), and `loadOfDevice`.
    - `scopeRows` takes a scope, and still takes a bare circuit id.
  - **The select.** The control bar's "Circuit" select groups its options: All circuits, *By use*
    (Lighting, Aircon, Others), then *One circuit*. The page's scope note, the device table, the
    Circuits tab and the per-device CSV name follow whichever is chosen.
  - **Tests.** `circuitScope.test.ts` +9: round-trips, option order, a category's branches, meters and
    devices, every building meter in exactly one category, a deeper panel with inherited categories,
    and no categories offered when the branches carry fewer than two. `ReportsPage.scope.test.tsx`
    narrows to each category the site carries.
- [x] **RM-094 (M) — per-circuit daily energy and hourly power for any stored period. 2026-09-17.**
  - **`src/lib/circuitSeries.ts`**
    - `getDeviceDailyEnergy` calls phase42's `report_device_daily_energy` for every device that
      measures power, once per period, and the scope is applied in the browser. `PGRST202` or `42883`
      (phase42 not applied) resolves to `{ available: false }`: an answer the page explains, not an error
      to retry. A refusal or a timeout still throws.
    - `getCircuitTrend` reads the window from `report_window`, then each branch meter's hours from
      `readings_archive`. `densifyHours` gives every hour a slot, and an hour nothing was recorded in
      stays empty, never 0 W.
  - **`useReportData`** gains `deviceDaily` and `trend` sections. They load only when a caller asks
    (`want.circuits`), so the page still fetches nothing for a panel nobody opened. A failed power read
    stays confined to the power chart.
  - **Tests.** `circuitSeries.test.ts` (11): missing function against refusal and timeout, the row cap,
    empty hours, rows outside the window. `useReportData.test.ts` (+4): idle until asked, both read when
    asked, "not available" not retried, a failure confined.
- [x] **RM-095 (M) — Energy per day by circuit, and Power through the week or month. 2026-09-17.**
  Report scenes, so the page and the PDF draw one picture.
  - **`charts/circuitDailyEnergyChart.ts`**
    - Stacked bars per day, in circuit order.
    - A day no circuit recorded is one hatched block per outage, never a zero bar.
    - A partly recorded day is lighter with a broken top edge.
    - Legend in panel order. Hover on the whole day column gives the total, each circuit, and any
      counter jump not counted.
  - **`charts/circuitPowerTrendChart.ts`**
    - One line per circuit in watts on one axis, broken at every hour without a reading.
    - Day boundaries at the building's midnight, and a legend.
    - Hover a day at a time: each circuit's average and highest.
  - **`src/lib/circuitCharts.ts`**
    - `circuitRefs(scope)` gives each branch its colour by its place on the panel, kept when narrowed.
    - `circuitDayPoints` shapes the daily rows; a day is partial when any circuit was.
    - `trendChartInput` places days at local midnight from the site's own offset.
    - `loadShareSegments` sums building meters by category and leaves a category out, with the reason,
      when one of its meters is impossible.
  - **`circuitBreakdownChart`** segments carry a fixed `colourIndex`, so a missing neighbour no longer
    repaints the rest.
  - **Tests:** `circuitCharts.test.ts` (11), `circuitCharts.test.ts` in lib (9), breakdown +1.
  - **Palette, measured with the dataviz validator.**
    - The print palette passes every check.
    - The light screen palette passes, with a contrast warning on amber and green lines (2.09:1 and
      2.47:1), relieved by legends, number tables and hover values.
    - **The dark screen palette fails the lightness band** (`--green-bright` 0.71, `--purple-bright`
      0.81), and so do the base tokens. It is the app-wide chart palette, Analytics' too, so it is
      recorded as FI-028 rather than changed inside this work. *(FI-028 landed 2026-09-17.)*
- [x] **RM-096 (L) — four tabs, each one question. 2026-09-17.** Landed with RM-097 in one change,
  because both rewrite the same pinned strings.
  - **Overview** (how much)
    - The heading with its "Recorded" badge and the key figure tiles.
    - One line of small figures (commands, unusual readings, voltage, current R / Y / B) in place of the
      "Also recorded" card.
    - **Energy per day** and **Energy by use** (Lighting / Aircon / Others).
    - "How much was recorded" in a disclosure.
  - **Circuits** (`CircuitDeepDive.tsx`, rewritten)
    - Lighting / Aircon / Others chips setting the same scope as the control bar.
    - The chosen part's energy, share of the building, circuit count and highest circuit demand.
    - An "Adds up" / "Check the meters" badge comparing the circuits' sum with the building's own figure
      (RM-054's thresholds).
    - The share bar, **Energy per day by circuit** and **Power through the week or month** (RM-095). The
      daily chart reads "appears once the database update (phase42) is applied" until it is.
    - The branch circuits table, then the devices on them in a disclosure.
  - **Usage patterns** (`UsagePatterns.tsx`, replacing `BaselineReport.tsx`)
    - The gate, and usual, high and highest demand tiles in kW.
    - The findings as tiles, and the typical day, busy hours and time-at-each-level charts.
    - Three short limits.
  - **Compare:** its figures unchanged, the wording plain.
  - **Loading.** The circuit series load only while the Circuits tab or the export drawer is open.
    `ReportCharts` draws a chosen subset (`only`).
  - **New CSS** (`.report-glance`, `.report-chips`, `.report-recorded__summary`, `.report-scope-note`)
    passes the 8-point grid guard. The disclosure summary joins the one coarse-pointer block.
- [x] **RM-097 (M) — plain words on the page. 2026-09-17.**
  - **Wording changes**
    - Median, p95 and peak become usual, high and highest; p99 is gone from the page.
    - "Load factor" becomes "How steady"; "Overnight base load" becomes "Left on overnight".
    - "Load duration" becomes "Time at each demand level"; "DSM ceiling" becomes "Max total draw", the
      Automation page's own label.
    - "Coverage" becomes "Recorded" and "How much was recorded"; "Sparse" becomes "Mostly missing".
    - "Demand by hour" becomes "A typical day, hour by hour"; the heatmap becomes "Busy hours".
    - Baseline / reporting become earlier / this; "Anomalies" becomes "Unusual readings".
  - **Shared text.** `shared/reportProse.mjs` gains `PLAIN_NOT_SAID`, `PLAIN_COMPARISON_LIMITS` and
    `tooLittleRecorded`: the same claims, shorter, beside the full sentences. The CLI deliverable keeps the
    full sentences.
  - **Tests.** A page test walks all four tabs and fails on p50, p95, p99, median, baseline, DSM, load
    factor, load duration or percentile. Every pinned string moved with its wording.
  - **The PDF's wording changes with RM-099**, which rebuilds the document as Simple or Detailed.
- [x] **RM-098 (M) — two new CSVs, both following the category or circuit chosen. 2026-09-17.**
  - **Devices by day** (`deviceDailyCsv`)
    - One row per device per local day, from phase42's bounded daily energy, so the days sum to the
      report's figure.
    - A "Counter jump not counted (kWh)" column; highest and average power; minutes recorded and minutes
      in the day.
    - Day status, and whether the day was made from minute readings or hourly averages.
    - A day nothing was recorded on is empty, never 0 kWh.
    - Until phase42 is applied the drawer says the format needs the database update.
  - **Every reading** (`src/lib/readingsExport.ts`)
    - Each power-measuring device in the scope, reading by reading: building-local time, voltage,
      current, power and energy counter.
    - An hourly row, marked "hourly average", for an hour whose minute readings retention has pruned —
      decided by the data, not by a date.
    - An offline row prints no figures ("offline — not a reading").
    - The reading that carried a counter jump is noted "counter jumped +67.28 kWh while drawing 49 W — not
      counted", by the same rule the reports use.
    - **How it fetches:**
      - pages keyed on the timestamp string, stopping only on an empty page;
      - the export stops if the cursor does not advance;
      - an exact count must match the rows fetched, or it stops and says to try again;
      - two devices at a time, with progress ("12,400 readings so far") and a Cancel button;
      - the file is assembled as a Blob from parts, never one giant string.
  - **The drawer** offers five formats: PDF, Building by day, Devices whole period, Devices by day, Every
    reading. Each says whether it follows the scope. Filenames gain `-devices-daily` and `-readings`.
  - **Tests.**
    - `readingsExport.test.ts` (12), against a fake query builder with a 500-row cap: every row returned,
      a count mismatch refused, a stuck cursor refused, hourly rows only where minutes are gone, cancel,
      offline rows, the jump note, formula neutralisation, local time.
    - `reportCsv.test.ts` (+4).
    - `useExportAction.test.ts` (+2): progress, and cancel saying nothing was saved.
    - `reportFiles.test.ts` (+1).
- [x] **RM-099 (M) — a Simple or Detailed PDF that follows the category or circuit chosen. 2026-09-17.**
  - **The drawer's choice.** It opens on **Simple** (the key figures and the charts), and **Detailed** adds
    the "when" charts, every table and the comparison. `reportSections.ts` marks each section as `both`
    or `detailed`, and `normaliseSections(chosen, detail)` keeps the locked two in both. A choice
    remembered from before this change opens as Detailed, which is what it made.
  - **The document.**
    - The cover says which part of the building it is about ("Lighting — the circuit sections are narrowed
      to it", or "The whole building") and which depth. "Built from index-….js" is now "Software build …".
    - "How much was recorded" comes first: one line in Simple, the full table in Detailed.
    - "Corrected figures" lists every figure RM-090 corrected or refused, before any figure.
    - Simple charts carry no number tables, and one line points to the Detailed PDF and the CSVs.
    - The limits close both.
  - **The charts.** **Energy by use**, **Energy per day by circuit** and **Power through the period by
    circuit** are new. The circuit charts follow the scope; the building's own charts are titled
    "(whole building)" when the document is narrowed. The circuit and device tables follow the scope.
  - **The words.** The PDF's own words are plain now: usual / high / highest demand in kW, busy hours,
    time at each demand level, "compared with", and the short limits.
  - **Filenames** carry the scope and `-simple`.
  - **Tests.**
    - `docDefinition.test.ts` +6: no tables in Simple; the one-line recording figure still first; every
      Simple choice keeps recording first and limits last; Detailed-only sections left out of Simple;
      the scope on the cover; corrections before figures.
    - `buildReport.test.ts` +3: scoped circuit charts and "(whole building)"; Simple's own sections and
      corrections; no statistician's words in anything a reader sees, and a neuter putting "p99" back
      fails it.
    - `ExportDrawer.test.tsx` +1.

### Reports, on the kiosk it has — RM-100 to RM-108 (2026-09-17)

The operator asked for a four-pillar UI/UX overhaul of the Reports page — data-ink, filtering, data viz,
export ergonomics. The audit that preceded it found most of the four already shipped and held by tests
(RM-072 to RM-099: the 8-point grid, hairline tables, the value-first tooltip, shape-matched skeletons,
the 44px block), and four of the brief's asks already decided against in this file. Those four went to
the operator with the reasons and stayed decided: **token CSS, not Tailwind** (RM-071); **an inline
outcome, not a toast** (RM-071); **a calendar of stored reports, not arbitrary ranges** (RM-085 stays
deferred); **a token-only lift on the hero, not a gradient** (FI-008 cannot measure one). What was left
was measured rather than assumed, and one measurement changed the shape of the work: **the kiosk is
800×480.** RM-082d had tuned the control bar against 1024×600.

- [x] **RM-100 (S) — the kiosk's size, read from the display. 2026-09-17.** `/sys/class/drm/card1-DSI-1/modes`
  holds one mode, `800x480`. This file said both; §4 records which was wrong. Every 1024 in `src/`
  corrected (`ReportControlBar.tsx`, `index.css`, `ReportCharts.tsx`, `reportChartSizes.ts`).
- [x] **RM-101 (M) — one bar, one line. 2026-09-17.** At 800px the RM-082b bar — period type, stepper, two
  presets, a labelled select, four tabs, Export — wrapped to three lines, which is why RM-082d could not
  let it stick on the kiosk. The tabs decide the *reading* of a report, not the report: they are a strip
  of their own beneath the bar (`.report-tabs-strip`). The presets moved into the calendar (RM-103), the
  select became one button (RM-102), and the stepper's and scope's minimum widths were cut to what their
  longest label needs. **Measured in Firefox at 800×480: 58px, one line** (~62px on the touchscreen's
  44px floor). With the 73px nav that is 27–28% of 480 — barely under the third RM-082d rejected — so
  **the sticky threshold stays at 720px tall** and the kiosk scrolls to the bar; the number is in the
  CSS comment for whoever revisits it. `ReportsPage.tabs.test.tsx` +1: the bar holds no tablist and no
  combobox, and the tabs are still a tablist named "Report type".
- [x] **RM-102 (M) — `ScopePicker`: one button narrows the report. 2026-09-17.** RM-082c's `<select>` in
  the bar and RM-096's chips on the Circuits tab were two controls for one state. One button now,
  named "Circuit" plus the choice (the visible text inside the accessible name, so a voice user can
  say what they see), and behind it the two questions in the order the operator asks them: **By use**
  as pills — All, Lighting, Aircon, Others, `aria-pressed` — and **One circuit** as a list with
  `aria-current`. Choosing closes it and hands focus back, in an effect rather than during render
  (`react-hooks/refs` refused the first draft, rightly). The Circuits-tab chips are gone; the popover is
  `useAnchoredPopover` like the period picker's, 380px so the four pills sit on one row, clamped to a
  phone. Both button and items are in the one coarse-pointer block. `src/components/reports/ScopePicker.tsx`,
  `ScopePicker.test.tsx` (5), `ReportsPage.scope.test.tsx` rewritten to drive the button.
- [x] **RM-103 (M) — a calendar of stored reports. 2026-09-17.** The period list was a column of names
  grouped by year — three the day it shipped, a scroll of 240 in twenty years. `src/lib/periodCalendar.ts`
  (pure; 6 tests) lays the stored starts out as twelve month cells a year, or a row of week-starts under
  each month on the weekday the stored weeks use, Monday when none is stored. **Still the stored reports,
  never the calendar's idea of what exists**: a cell with no report is disabled and titled "No report
  for March 2026", in the stepper's own words; every cell carries its full name for a screen reader
  ("June 2026", "Week of …") and its short one on screen. A year stepper walks only years that have a
  report; Latest and Same-period-last-year sit under the grid, unchanged in behaviour. Opens scrolled to
  the period being read, before paint, once the hook has sized the panel — a passive effect ran before
  the panel had a height to scroll within, which the screenshot caught. Five columns for the fifth week
  of a month, which wrapped; a themed thin scrollbar, because Firefox drew a white one in the dark theme.
  `PeriodPicker.test.tsx` rewritten (12).
- [x] **RM-104 (S) — the hero KPI is the one lifted surface. 2026-09-17.** `--shadow-card` and the
  `--card-lip` highlight the app's cards carry, a 3px rule of `--accent-text` along the top, and
  `--border-strong`; every other tile stays flat, so the lift means something. All tokens, so the
  contrast guard measures it. Held by `test/reports-css.test.mjs`.
- [x] **RM-106 (S) — the breakdown colours a circuit by its place in the panel. 2026-09-17.** `buildBreakdown`
  set no `colourIndex`, so `circuitBreakdownChart` fell back to array position — and RM-090 refusing one
  meter's figure moved every later circuit one colour along. The same circuit wore one colour this week
  and another the next, on the chart whose whole job is telling circuits apart across periods. Now the
  index is the branch's position in `branchOptions()`, the rule `circuitRefs` already used for the
  Circuits tab. `circuitBreakdown.test.ts` +1: refusing the second meter leaves the third's colour.
- [x] **RM-107 (S) — a month's table keeps its column headers. 2026-09-17.** Thirty-one 40px rows scrolled
  the captions off an 800×480 screen by the fourth day. `.report-table-scroll` is a box no taller than
  `min(70vh, 640px)` that scrolls both ways; `thead th` is sticky and painted, with the hairline as an
  inset shadow because a collapsed-border table leaves the border behind when the cell moves; the corner
  cell sticks both ways above the row headers. A row hover paints `--bg-surface-2` — a scan aid that
  follows the pointer and leaves nothing behind, not a stripe. Read back in Firefox at 800×1100 with the
  box scrolled to the 6th. Held by `test/reports-css.test.mjs`.
- [x] **RM-108 (S) — Export is the page's one primary action. 2026-09-17.** Export in the bar and
  Generate/Download in the drawer wore `.devices-add-btn`, the least prominent control on the bar.
  `.report-primary-btn` is the inverted chip the active pills already wear (`--txt` on `--bg-page`,
  measured in both themes), 40px, lifts a pixel on hover and settles on press inside the global
  reduced-motion rule, 44px on the touchscreen. The done line under the button carries a tick beside the
  words; the working line carries a moving 2px bar, so a month of every reading is visibly alive between
  progress messages. **Not done: a byte count in the done line.** The PDF path uses pdfmake's own
  `.download()`, which `download.ts` deliberately keeps rather than hand-rolling a blob and anchor, and the
  line already names the file and counts what it wrote. Held by `test/reports-css.test.mjs` and
  `ExportDrawer.test.tsx`.
- **RM-105 — not this session.** The plan had a re-stepped series token set for both themes, measured with
  the dataviz validator (light: the print tier `--accent-text/--blue/--green/--purple`, which passes with
  no contrast warning and makes page and paper agree; dark: a set inside the 0.48–0.67 band). Between
  planning and coding, **FI-028 landed from the workstation** with the dark half and a both-themes test,
  and opened **FI-029** — blue and purple are one colour to a deuteranope in the light theme and in
  print — with the fix described. Left to that line of work rather than collide in `index.css` and
  `palette.test.ts` on the same day. The light-theme measurement above stands for whoever takes FI-029:
  `#ae4d03 #1e5ce4 #037756 #7c3aed` passes every check but that one, and it is the pair FI-029 names.

**How it was read back.** A throwaway harness (deleted, not committed) mounted the real bar, tabs strip,
a hero tile and a 31-row `ReportTable` against the real stylesheet on a spare port, and headless Firefox
took it at 800×480, 375×812 and 800×1100 in both themes, with each popover open and the table box
scrolled. The signed-in page was not re-read this session: the Reports page needs a session, and the
kiosk has none (RM-007). The next signed-in look should confirm the KPI grid at 800px — the harness
showed the fourth tile wrapping alone under the hero, which is RM-082a's `auto-fit` grid and predates
this work.

### Read back signed in — RM-109 to RM-112 (2026-09-17)

The Reports page was checked in the workstation's browser, signed in by the operator, against the live
project and the Pi's build of RM-100 to RM-108. Exports were captured inside the page, so no file was
saved.

**What holds:**
- **Week of 7 September.** L.O Yellow shows **4.62 kWh, Corrected**, titled "a 76.79 kWh jump in the meter's
  counter is not counted". Lighting is 9.1% of the building.
- **Circuits tab.** "The circuits add up to 61.51 of the building's 61.73 kWh". Every circuit's day stack
  sums to its table figure within rounding. Both circuit charts drew, with no statement timeout.
- **Lighting scope.** 5.58 kWh, 9.1%, 2 circuits, both charts and both tables narrowed.
- **Plain words.** A text sweep of Usage patterns and Compare found none of p50/p95/p99, percentile,
  median, coverage, baseline, samples, load factor or DSM.
- **Devices by day CSV (Lighting).** 14 device-days. 2026-09-08 L.O Yellow is 0.713 kWh with 76.789 in
  "Counter jump not counted".
- **Every reading CSV (Lighting).** 20,122 minute rows from 2 devices in 7.6 s (1.87 MB). The 02:36 row
  says "counter jumped +67.28 kWh while drawing 49 W — not counted", and 27 rows are offline.
- **PDFs (Lighting, week).** Simple is 8 sections, 3 pages and 33 KB; Detailed is 16 sections, 8 pages and
  57 KB. The console timed the first at 6,418 ms (mostly loading pdfmake and its fonts) and the second at
  103 ms. RM-083c still wants the kiosk's own figure.
- **Layout.** At 800×480 and 375 px, light and dark, on all four tabs: no page-level horizontal overflow,
  and no text under 4.5:1 against its composited background.

- [x] **RM-109 (S) — a report chart fits a phone. 2026-09-17.**
  - **The defect.** `.report-charts` is a grid, and its implicit column was as wide as its widest content,
    the drawings' 460px minimum. At 375px every figure was 493px wide in a 319px column, and
    `.app-content` clips horizontal overflow, so the right third of every chart was cut off with nothing to
    scroll. The page reported no overflow at all, which is why the earlier sweeps passed.
  - **The fix.** The column is `minmax(0, 1fr)` and the figure has `min-width: 0`, so the horizontal scroll
    `.report-chart__plot` already had takes over.
  - **Held by** `test/reports-css.test.mjs`, with positive controls.
- [x] **RM-110 (S) — "Energy by use" counts uses. 2026-09-17.** The bar read "61.5 kWh across 3 circuits"
  for Lighting, Aircon and Others, which are four circuits.
  - `circuitBreakdownChart` takes `of: 'uses'`: "across 3 uses", and "1 circuit" in the singular.
  - The Overview, the Circuits tab (unless it is narrowed to circuits) and the PDF pass it.
  - **Held by** `circuitBreakdownChart.test.ts` and `ReportsPage.scope.test.tsx` (Overview and Circuits tab).
- [x] **RM-111 (S) — never more minutes recorded than the period has. 2026-09-17.**
  - **What the page said.** The week of 7 September read "10,082 of 10,080 minutes".
  - **Measured live, read-only.** `building_totals` holds 10,082 rows in **10,074** distinct minutes. All 8
    doubled minutes (07:15, 07:33, 08:43 and 12:56 UTC on the 7th; 00:36, 07:31 and 07:52 on the 8th; 04:40
    on the 13th) are minutes in which `ibems-ingest` was restarted. A scheduled tick had already written
    the minute on its boundary, and the new daemon's first cycle ran at once, seconds later, under a
    different `ts`. So `onConflict: 'ts'` could not merge them.
  - **The page's guard.** `toDemandSummary` (`src/lib/reportSeries.ts`) holds observed and usable minutes to
    the period's length.
  - **The real count** is phase44's (RM-073), which counts distinct minutes rather than rows. The true
    figure for that week is 10,074, with 6 minutes genuinely missing.
  - **Read back live** on the rebuilt kiosk bundle: the week reads "10,080 of 10,080 minutes".
    - At 375px no chart on Overview, Circuits or Usage patterns reaches past the screen (widest right edge
      347px of 375), and every plot scrolls inside its own box (RM-109).
    - The Overview and the Circuits tab both say "across 3 uses" (RM-110).
    - Nothing on the page says "observed" (RM-112).
    - At 800px the key-figure tiles sit in two rows of four columns, with no tile alone — the harness
      concern RM-100–108 left for a signed-in look.
  - **Not changed.** Ingest's first cycle after a restart still writes. A restart is rare, and the report
    side must count minutes whatever writes them.
  - **Held by** `reportSeries.test.ts`.
- [x] **RM-112 (S) — one word for it: recorded. 2026-09-17.**
  - The daily energy, busy hours, duration and typical-day charts and the load-factor reason said
    "observed", where every newer surface says "recorded". The reason is what shows as a finding's
    refusal.
  - The busy-hours range and legend printed "1832 W". They now use the reader's grouping, as the other
    charts do.
  - The "not observed" figure label for a stored zero is RM-081's and is kept.
  - **Held by** the four chart tests and `reportFindings.test.ts`.
- [x] **RM-113 (S) — the PDF export registers its own fonts. 2026-09-17.**
  - **The failure.** After phase44 was applied, the operator's first export on the kiosk (a month, all
    circuits, Detailed) failed with "The export could not be completed: File 'Roboto-Medium.ttf' not found
    in virtual file system". It reproduced in the workstation's browser on the same build for Simple and
    Detailed alike. The same export had worked that morning on the build before.
  - **The cause, read in the built chunk.** `pdfmake/build/fonts/Roboto.js` ends with `if (_global.pdfMake
    ...) _global.pdfMake.addFontContainer(fontContainer)`, and pdfmake assigns the global only when its own
    entry module evaluates. `download.ts` imported both at once and trusted that side effect, so the
    bundler's evaluation order decided whether any font was registered. The rebuild for RM-109–112 flipped
    it, and the first bold text asked for a file nobody had written. The failure is not in the data and
    not in phase44.
  - **The fix.** `download.ts` takes the container's default export and calls
    `pdfMake.addFontContainer(roboto)` itself, on every export, before `createPdf`. Registering twice only
    rewrites the same four files.
  - **Held by** `src/lib/reportPdf/download.test.ts`, whose mocked container registers nothing on import
    (the order that broke the kiosk). It checks that the fonts are registered before the document is
    created, and again on the next export.

### Analytics data quality — RM-076 to RM-079 (2026-09-14)

Why this exists is the 2026-09-14 entry in §0. The principle it follows: **energy comes from registers,
charts come from instantaneous signals, and neither feeds the other.** Every drawn value carries a
quality, and nothing is coerced to 0.

- [x] **RM-076 — one time grid, and what each minute of it is.** `src/lib/timeseries.ts`.
  - **Slots, not array positions.** Slot widths are 60 s / 15 min / 1 h / 1 day for 24h / 7d / 30d /
    1y. The stored widths equal `readings_buckets`' and `readings_archive`'s own buckets, which floor on
    the epoch; `supabaseHistory.test.ts` pins the agreement. One bridge sample gets one slot, pushed
    forward at most two slots when its arrival stamp is late. Measured over a full day on every meter,
    floor-binning invents 318–476 holes per meter; this invents none.
  - **A quality per slot:** `measured | interpolated | live | frozen | offline | outlier | missing`. A
    gap of two minutes or less between two real readings is bridged linearly and drawn dashed; anything
    longer is a labelled band (`Offline` / `No data`). The limit is time, so nothing is bridged on a
    15-minute grid. Power is never held forward. A reading outside `SITE.telemetry_bounds` is rejected,
    never clamped.
  - **Charts** (`analyticsMath.ts`, `HistoryAreaChart.tsx`, `AnalyticsPage.tsx`, `UntrackedLoadCard.tsx`,
    `overview/EnergyFlowCard.tsx`): devices joined by slot; measured solid, bridged dashed, frozen dotted
    and muted, long gaps as bands; each chart states its own quality in its accessible name. A sum with a
    frozen contributor is drawn frozen, carrying the held figure, not left blank. The 24h charts end at
    each device's live reading (`liveSampleOf`, withheld once expired).
  - **Tooltip** (`ChartTooltip.tsx`, `lib/dataQuality.ts`): the time (`Sep 14 · 22:40`, or the span a
    longer point stands for), each device's value, and a tag of a word or two only where a point is not
    a plain reading — Estimated, Frozen, Offline, No data, Bad reading, Live. A `Cached · N min old` note
    appears only once the data has stopped arriving. **Simplified on the operator's request from the live
    page, 2026-09-15:** the first version explained every point in a sentence ("Average of 11 of 11
    samples", "Reading at 22:50:02", "Bridge buffer · fetched 08:32:01") on every line, which buried the
    value a reader came for.
  - **Sync** (`useAnalyticsHistory.ts`): `sync` says whether the range has answered, when its history
    last arrived (`deviceStore.historyFetchedAt`), and how many fetches in a row have failed. A failure
    is retried after 10 s, doubling, capped at the range's own cadence. `DataQualityBadge.tsx` reads
    Live / Syncing… / Cached · N min old / History unavailable, then — in the tooltip's own words —
    `Estimated · N min`, `Gaps · N` and `Frozen · <meter>`.
  - **Stored coverage:** `mapReadingsRows` keeps `online_count/sample_count` as `HistoryPoint.coverage`,
    reversing a test that dropped them, so a tooltip can say "Stored average of 12 of 15 samples online".
  - **Error boundaries:** `ErrorBoundary` gains `variant="inline"` and `resetKey`. Every Analytics card
    has its own, outside the card's button, and redraws by itself when the data changes.
  - **Store:** `deviceStore.history` is keyed by device and range, so a 24h write no longer evicts a 7d
    series. A reader still only ever gets the range it asked for.
  - **Mock:** `npm run mock -- --faults=flicker,offline,frozen,spike` shapes the seeded history after the
    measured faults, and the mock's samples now carry `online` as the real ring does.
- [x] **RM-077 — a frozen meter is named, not blamed on the bridge.** `lib/timeseries.detectFrozenRuns`:
  identical power/voltage/current, power above zero, online, for at least 180 samples and 175 minutes.
  Healthy maximum over seven days across all eleven metered devices: 61 minutes (outlets refresh about
  hourly; meters alone: 33). The faults: 540, 657 and 942 minutes. It shipped at one hour, sized on the
  meters alone, and flagged two healthy outlets on live data the same day — see §0. `lib/branchEnergy.ts` names
  each freeze today with its window and held reading, takes what the integrator counted from it out of
  that branch's second opinion and out of the building's, then runs `branchShortfalls` unchanged — its
  thresholds were sized on healthy data. Nothing is estimated. Fixtures: 09-12 and 09-13 from
  `readings`; RM-056's 2026-09-08 figures still produce the true shortfall.
  **Re-read 2026-09-22 (RM-134):** L.O Red's freezes have the signature RM-134 found on L.O Yellow: a
  nonzero reading held while the device's own registers stood still, which is what a circuit at 0 W
  looks like to a bridge that never re-reads the meter. The meters were never polled, so a missed
  "→ 0 W" push was never corrected. That is the likelier cause than a stuck clamp. It is not proven for
  those days; the evidence is gone with the volatile journal.
- [x] **RM-078 — one branch-energy derivation.** `lib/branchEnergy.branchEnergySplit`, through
  `lib/useBranchEnergy.ts`, used by `EnergySection.tsx` and `overview/EnergyBreakdownCard.tsx`:
  membership `BUILDING_METER_IDS`, the total rounded exactly as `buildLatest`'s `branchSum`, rows to two
  decimals, an expired reading kept (a register is a count) but dimmed. `EnergySection` no longer takes a
  `branchDevices` prop. `components/analytics/branchEnergyCards.test.tsx` renders both cards against one
  store and pins that they agree.
- [x] **RM-079 — the bridge side: the tick, and a freeze flag on the reading.** Built 2026-09-14 on the
  operator's go-ahead for the flow write.
  - **`sample_ts`.** The ring moved to `node-red-bridge/historyRing.mjs` (`test/history-ring.test.mjs`
    executes it) and writes the tick beside the reading's own `ts`, identical for every device in a
    pass. `lib/timeseries.ts` places a point by `sample_ts` when present and by `ts` otherwise, so a
    buffer that switches partway keeps every sample (pinned).
  - **`measurement_frozen`.** `node-red-bridge/valueFreezeTracker.mjs` stamps the last change of each
    metered device's v/c/p — not `n`, not `e`, and on change rather than on read, so reader cadence
    cannot move it (the RM-056 lesson). `shared/buildLatest.mjs` flags a reading held for
    `FROZEN_AFTER_MS` (`shared/measurementFreeze.mjs`, three hours; a vitest pins the frontend's
    `FROZEN_MIN_SAMPLES` against it) while drawing power and online, adds `frozen_since`, and omits
    `energy_kwh_today_integrated` while the flag stands. The ring writes `frozen: true`. The frontend
    draws a flagged sample and a flagged live tail as frozen; `branchEnergy` names a flagged freeze
    with no history loaded, without naming one twice; `SourceCard` says "Frozen since HH:MM".
    Documented in `docs/bridge-contract.md`.
  - **The flow diff is one node and three edits:** "Track value freezes" added — created last, so every
    existing generated id is unchanged — "Track meter arrivals" rewired to it, and the bodies of "Build
    latest readings" and "Append to history ring". The mock runs the same tracker string and threshold.
  - **One test caught itself.** The "older flow" case first passed the threshold anyway, because
    `build(s, undefined)` takes a defaulted parameter's default. It now calls `buildLatest` with nine
    arguments, as an old flow does.
  - **Restart map:** `shared/buildLatest.mjs` reaches `ibems-proxy` and `ibems-scheduler`.
  - **Deployed 2026-09-15 08:09:38** (`7d9b599`, after CI went green on it). `flows.json` was backed up
    byte-identical first, then `deploy:pi --force --apply`: 298 → 299 nodes, all four source tabs
    matched, no id collisions, and its own verification passed 5/5.
    **Read back, not assumed:**
    - `sample_ts` reached the context file about 25 s later, and the newest sample in all eleven history
      buffers carries the same tick. Every buffer kept its 1,440 points.
    - `value_freeze` tracks all eleven metered devices.
    - The latest readings still show 21 rows and 18 of 20 online. There are no freeze flags (the
      three-hour clock had just started), and all four meters still carry
      `energy_kwh_today_integrated`.
    - Node-RED logged no errors from the bridge.
    - The dashboard's `lib/timeseries.ts`, run over the served history (1,436 arrival-stamped points
      followed by four tick-stamped ones), gave 1,440 slots for 1,440 samples on every device: nothing
      lost or doubled at the switch, no gap windows, and the flickers bridged.

    **Daemons restarted 08:18:32–34 by the operator.** The remote restart had been refused by the
    session's permission mode. Read back:
    - `ibems-ingest`, `ibems-proxy` and `ibems-scheduler` are active, with no restarts since.
    - `shared/buildLatest.mjs` and `shared/measurementFreeze.mjs` were modified the day before, so no
      daemon holds a stale module.
    - The proxy is listening and forwarding authorized requests.
    - The scheduler loaded its 22 schedule rows with auto-shed on.
    - Ingest is writing 20 readings plus totals each cycle.
    - No error or warning line has been logged since the restart.
    **Not yet seen live:** a `measurement_frozen` flag, which needs a meter to hold still for three
    hours.

### The Reports page, made reliable, readable and exportable — RM-081 to RM-085 (2026-09-15)

The operator asked for a report page that can be trusted to load, reads at a glance, exports a PDF
and a simple CSV, and lets the reader choose which parts of a report to include. RM-072 built a good
pipeline under a page that fetched everything in one `Promise.all`, kept one error string nothing
ever cleared, and put its controls in three rows. This section is that page's overhaul, in order.

- [x] **RM-081 (M)** **DONE 2026-09-15. Every part of a report loads, fails and recovers on its
      own.** Audit of the page as RM-072 left it, each item confirmed in the code before it was
      changed:
      the error was one string set by any of three effects and never cleared, so a failure followed
      the reader to every other period until a reload; the charts' series, the tariffs, the emission
      factors and the DSM ceiling were one `Promise.all`, so a failed tariff read hid five charts
      that had loaded; nothing had a timeout, and nothing but the period list said it was loading;
      no panel had an error boundary, so one malformed row replaced the whole page; and stepping
      back to a period refetched all ten queries.

      *`src/lib/reportLoader.ts`* holds three primitives that know nothing about reports.
      `withTimeout` **aborts** the request it gives up on, not just the wait — the signal is threaded
      through `getReportPeriods`, `getDevicePeriodReports`, the five phase37 calls, both tariff
      readers and `fetchScheduleContext`, all optional so no other caller changed. `isTransient`
      admits only a timeout or a browser network failure (Chrome, Firefox and Safari word it three
      ways); a permission refusal, a truncated result or a caller cancelling is never retried,
      because asking again cannot change the answer. `createReportCache` de-duplicates requests in
      flight, never keeps a failure — a remembered failure is a Retry that cannot work — and expires
      after ten minutes, because the list of periods grows every Monday-plus-grace and a kiosk left
      on the page would otherwise never see the new week. 23 tests.

      *`src/components/reports/useReportData.ts`* reads the report as six sections — periods,
      devices, core (daily series + demand summary), detail (hour profile, matrix, curve), pricing
      and ceiling — each `idle | loading | ready | error` with its own `retry`. Still **derived by
      key and never cleared in an effect**, the rule this page has held since c5d4e18: an outcome is
      tagged with the request it answers, so a month's rows cannot render under a week that shares
      its first day. The cache is **per mount**, not module scope: a module-level cache would carry
      one test's fixtures into the next and one session's answers into another's. 17 tests.

      *On the page*, every panel sits in an inline `ErrorBoundary`, and `ReportCharts` now builds
      each scene **inside** its own boundary rather than all five in one `useMemo` above them — so a
      chart that cannot be drawn costs one card. `ReportSectionNote` says loading as a `status` and
      failure as an `alert` naming what failed, why, and a Retry. A failed tariff read renders "the
      rates could not be loaded", **never "no rate has been entered"**, which is a claim about the
      database a failed read has not established — and the PDF button is disabled with that reason
      rather than producing a document that says it.

      **Measured on live data before it was written:** `period_building_reports` holds the week of
      2026-08-10 as `energy_kwh = 0` from **10 of 10,080** samples, and the page printed "0.00 kWh".
      A period whose summary shows no minute with a real reading now reads **"— not observed"** for
      energy and peak demand; before the summary arrives, a stored zero from a period that was not
      fully observed is held back the same way. The stored row is unchanged — restating it is RM-073.
      Weekly reports also stop calling themselves months: "(partial week)", "the whole week was
      observed", "No week has completed".

      **Two things the tests found about themselves, recorded because both look like page bugs.**
      `vi.resetAllMocks()` wipes the implementation a `vi.mock` factory set, so a ceiling read mocked
      there returned `undefined`, failed, and raised a second alert the test was not about — the
      third time an unmocked read on this page has read as a broken panel. And the existing
      CSV-filename test was **racing the device rows**: it waited for the week's label, which
      arrives before the rows, then clicked an export button that is correctly disabled until they
      do. The loader's extra async steps made it fail two runs in three; it now waits for the button
      to be enabled. That is one of **three assertions changed in `ReportsPage.test.tsx`**; the other
      two widened exact-argument checks to allow the new signal. None of its honesty properties
      changed.

      `ReportsPage.reliability.test.tsx` (7): a throwing heatmap is contained and the table, the
      figures and four charts remain; a tariff failure keeps all five charts and never claims no
      rate; Retry recovers a failed section; loading is announced; "not observed"; "partial week";
      the weekly empty state. **Not verified signed-in in a browser** — the workstation's dev build
      has no Supabase keys, so the Reports page renders "not configured" there.

- [x] **RM-082a (M)** **DONE 2026-09-15. The headline comes first and largest, and the tables are
      built for reading.** The report's figures were eight equal cells of a `<dl>`, the period's
      energy at the same 14px as its command count.

      *`ReportKpis`* leads with energy at `--fs-3xl`, then peak demand in kW, cost and emissions
      (through `CostCarbonLine`, so a failed rate read still never claims "no rate entered"),
      readings coverage as the share of minutes that carried a **real reading** — 27% for August
      2026, not the 48% the rows say — and a comparison with the previous stored period **only when
      `ipmvp.compare` says both were fully observed**; otherwise it says "not comparable" and names
      which period was watched how much. Above it, the period is named once with its coverage
      badge and when it was generated, in the building's own time. Voltage, phase currents,
      commands and anomalies move to an "Also recorded" list rather than disappearing.

      **The order is a decision, and it keeps the rule it looks like it breaks.** Coverage precedes
      the figures it qualifies: the badge sits in the heading directly above the headline row, every
      headline carries its own "(partial …)" on the same line, and the detailed coverage card follows
      immediately. What moved is the *detail*, not the qualifier.

      *`ReportTable`* replaces `.devices-table` in the device table, both circuit tables and every
      chart's numbers. That class brought a `min-width: 860px` sized for the eight-column fleet grid,
      which made a five-column report scroll on the kiosk; and the `is-numeric` class the chart tables
      set **had no CSS rule at all**, so every number in every chart table was left-aligned. Units now
      live in the header once, numeric columns right-align in tabular figures, rows are separated by a
      hairline with no zebra striping or vertical rules, and the row header stays pinned when a table
      does have to scroll. A missing value is an em dash and a **zero is a zero** — both directions
      asserted. `ReportFigure` and `CoverageTag` moved out of the page so three callers share one copy
      of "never without the qualifier".

      *The 8-point grid is a test, not a convention:* `test/reports-spacing-grid.test.mjs` fails on any
      margin, padding or gap in a `.report-`/`.reports-` rule that is not 0, a multiple of 8,
      `--sp-2`, `--sp-4` or `calc(var(--sp-2) * N)` (`--sp-1` allowed in a gap only). Its first run
      found **five** off-grid values — 6px, three uses of `--sp-3` (12px) and 2px. It proves itself
      against a synthetic sheet with five known violations before it is believed, and refuses to pass
      if it matched fewer than fifteen rules.

      **Three things the tests caught about themselves.** `null / 1000` is `0` in JavaScript, which is
      exactly how a missing peak would have printed "0.00 kW" — pinned. The first version of that
      assertion searched the whole tile row for `/0\.00 kW/`, which matches inside "100.00 kWh".
      And a `<dt>` (role `term`) takes its accessible name from author attributes only, never from its
      text, so `getByRole('term', { name })` **can never match** — the first version of "no
      comparison without an earlier period" was vacuous. All three now query text, and the comparison
      test is the absence test's positive control.

      Tests: `ReportTable.test.tsx` (6), `ReportKpis.test.tsx` (8), the grid guard (3). The peak
      guard was **neutered to prove it**: with the null check removed, exactly that test fails; with
      the file restored byte-for-byte, all eight pass. **Not verified signed-in in a browser.**

- [x] **RM-082b (M)** **DONE 2026-09-15. One control bar, and loading that looks like what it
      loads.** The controls were in three places — the report tabs and both exports in the page
      header, Monthly/Weekly on a row of its own, the period pills on another — so a reader met three
      rows of chrome before a figure, and the exports sat a screen away from what they exported.

      *`ReportControlBar`* holds them in one row, in the order a reader decides: what kind of period,
      which one, which reading of it, what to take away. **Sticky** under the nav, measured through
      `--nav-h-live` rather than assumed, and below the nav's z-index so the nav's own popovers still
      cover it — because the report is five charts and a table long, and changing the period from the
      bottom of it should not mean scrolling back to the top. **Not sticky below 640px**, where it wraps
      onto several lines and would cover a third of a phone screen for the whole report.

      *`PeriodPicker` is a stepper now*: the report before, the one being read (which opens a list of
      every stored report grouped by year, the current one marked), the report after, **Latest**, and
      **Same month/week last year**. It steps through **stored reports, not the calendar** — the list
      can have holes, and "previous" landing on a period with no report would render an empty page
      that reads as a period with no consumption. A week last year is **52 weeks back, 364 days**:
      stored weeks start on a Monday, and 365 days lands on a Tuesday that matches no week, so a
      calendar year would have reported last year's week missing every time (`src/lib/reportPeriods.ts`,
      pinned across a leap day). An unavailable jump is disabled **and says why** — "No report for
      August 2025" — through a description a screen reader reads, not only a tooltip. It kept the
      "Report month"/"Report week" group and the current period's button name, so the existing page
      and tabs tests held **without a change**.

      *`ReportSkeleton`* replaces the loading sentences for the charts and the device table. Each chart
      placeholder takes the **same aspect ratio** as its chart — `src/lib/reportChartSizes.ts`, which
      `ReportCharts` now draws from too, so the two cannot drift — because the charts scale to their
      column and a fixed-height placeholder would still jump when the chart arrived. One status line
      is spoken; a second skeleton on the page stays silent. Placeholders show only while nothing has
      failed — beside an error a skeleton would claim the part is still coming. The plan's "hold the
      previous frame on a same-period retry" turned out to be moot: a Retry only ever follows a
      failure, which has nothing drawn to hold, and a period already read answers from RM-081's cache
      with no loading state at all.

      Removed: `.reports-months` and the `MAX_PILLS` export, which nothing imports now.
      Tests: `PeriodPicker.test.tsx` (10, nine of them red against the pill row), `ReportSkeleton.test.tsx`
      (4), `reportPeriods.test.ts` (4). **Not verified signed-in in a browser.**

- [x] **RM-082c (S)** — **Scope the device table and the circuit report to one branch.** Landed
      2026-09-15. A **Circuit** select in the control bar — *All circuits* or one branch — narrows the
      Summary device table, the Circuits tab and the per-device CSV, and nothing else.
      - **From the circuit tree, never from device ids.** The branches are the meters the building total
        is the sum of, named by their circuits (`branchOptions` in `src/lib/circuitBreakdown.ts`). A device
        is on a branch when that branch is anywhere on its path from the service entrance, so a deeper
        panel than this building's narrows correctly. A device the tree does not place is kept out and
        counted rather than guessed into a branch (`circuitScope.test.ts`, with an invented two-level panel
        and a wiring cycle).
      - **A share stays a share of the whole building**, in the Circuits tab and in the CSV. Narrowed to one
        branch, a share of the rows left on screen would read 100%; the test that guards it was checked to
        fail with the building total taken from the narrowed rows.
      - **The narrowed CSV is named for its branch** (`ibems-month-report-2026-08-<branch>.csv`), spelled in
        letters, digits and hyphens because a circuit name is operator-edited.
      - **What cannot be narrowed says so.** The headline figures, findings and charts are building series,
        and per-device series are not stored. A note under the bar names the branch and how many of the
        period's devices are shown; the export drawer says the PDF and the simple CSV stay the whole
        building's (`ReportsPage.scope.test.tsx`).
      - **Read back live the same day**, on the Pi at `ec8fece`, signed in, with CI green. Narrowed to
        C.O Yellow, August 2026's Summary table holds that branch's meter and its seven outlets (8 of 20
        devices), and the Circuits tab keeps the branch's share at 56.2% — the same as unnarrowed, not
        100%. The note and the drawer's sentences for the PDF and the per-device CSV read as written, and
        All circuits restores all 20. The CSV was not downloaded from the pane; its rows, shares and name
        are held by the tests.
- [x] **RM-083a (M)** **DONE 2026-09-15. The parts of an export, each pure and each held to the
      page's rules.** Nothing here touches the DOM; the drawer that offers them is RM-083b.

      *`src/lib/reportSections.ts`* — thirteen sections in the order the document reads, from coverage
      to the closing refusals. **Two are locked**, by operator decision: coverage and "what this report
      does not say", each carrying the reason the drawer will show. `normaliseSections` puts them back
      whatever a reader asks for, returns every choice once and in document order, and drops an id
      this build does not know — a choice remembered from an older one.

      *`docDefinition.ts` builds only the chosen sections*, and the test that matters asserts it **for
      every choice** rather than for one: the empty selection, all of them, each alone, and each left
      out — coverage precedes every figure and the refusals close the document in all of them. The PDF
      also gains what it omitted: peak demand, voltage, commands and anomalies beside the energy, and
      Baseline, Circuits and Comparison sections — the comparison **never without** the list of what it
      was not adjusted for. An unchosen chart takes its table with it. A cost section left out prints
      nothing about cost, rather than "no rate has been entered", which would be a claim about a
      section the reader did not ask for. And RM-081's rule reaches the document: a period with no
      real reading reads **"Not observed"**, not its stored 0.00 kWh. `ExportPdfButton` tags each chart
      with its section and supplies the key figures, so today's button still produces the whole
      document.

      *`src/lib/reportCsv.ts`* — the **simple CSV is one tidy row per day**: date, energy, peak demand
      in kW, readings coverage, and `complete | partial | no data`. No preamble, and **no totals row**,
      because a total inside a column is counted twice the moment anyone sums it. A day with no real
      reading has an **empty** energy cell — a zero in a spreadsheet is summed into the month like a real
      one. Cost and emissions columns exist only when a rate or factor exists, in the rate's own currency,
      and **not at all** when the rates are in two currencies. The per-device CSV keeps its columns and
      adds **Branch** (`circuitBreakdown.branchOf`, read off the circuit tree) and **Share of building**,
      given only when every branch meter reported — a share of a total missing a branch is too large.

      *`pricePerDay` / `emissionsPerDay`* apply the same refusals as `costOf` per day, and the priced
      days **add up to `costOf`'s total** — asserted, because a spreadsheet that disagrees with the report
      about the same month is the failure. *`src/lib/reportFiles.ts`* names every export from the
      period's own date: `ibems-month-report-2026-08.pdf`, `…-daily.csv`; the per-device CSV keeps the
      name it has always had.

      Tests: `reportSections` (5), `docDefinition` (+9), `reportCsv` (10), `energyCostPerDay` (6),
      `reportFiles` (5), `circuitBranch` (3).

- [x] **RM-083b (M)** **DONE 2026-09-15. One Export, a drawer that asks what to take away, and
      exports that say what they did.** The control bar's PDF and CSV buttons could each only ever
      export everything; they are one **Export** button now, opening `ExportDrawer` — the shared
      focus-trapped panel pinned to the right edge — with a format (PDF · simple CSV · per-device CSV)
      and, for the PDF, the section checklist, **coverage and the refusals shown ticked, disabled, and
      with the reason read to a screen reader**. A CSV holds one table and has no sections to choose;
      the drawer says what the file holds instead.

      **An export that cannot run says why, and cannot start.** Each format is unavailable for a
      reason in words: still loading; could not be loaded (retry it on the page first); no per-device
      rows were stored. And **a failed rate read blocks the PDF and the simple CSV**, because the PDF
      would print "no rate has been entered" and the CSV would silently omit its cost column — both
      claims about the database that a failed read has not established.

      *`src/lib/useExportAction.ts`* fixes the two defects of the button it replaces. The busy flag was
      React state, which two clicks in one tick both read as idle — it is a **ref**, set synchronously.
      And the PDF's scenes were built synchronously before its first `await`, so "Building PDF…" could
      not paint until the work it announced was done — the work now **waits for the next paint**, racing
      a short timeout because a hidden tab may never deliver one. The result ("Saved
      ibems-month-report-2026-08.pdf · 9 sections") or the failure appears **beside the button**, not in
      the page header where the old PDF error landed inside the flex row of controls.

      *`src/lib/reportPdf/buildReport.ts`* is the document's assembly, moved out of the button into a
      pure function: only the **chosen** charts are drawn (each scene costs time on the Pi), the peak is
      qualified or missing by the same rules as the page, the baseline gate precedes its numbers, the
      circuits split branch meters from the devices inside them, and a comparison with the previous
      stored period appears **only when both were fully observed** — otherwise it states why.
      `ExportPdfButton` is deleted. The last choice is remembered per viewer under try/catch, and a
      remembered section this build does not know is dropped.

      Two existing page tests went through the old buttons and now go through the drawer, asserting
      the same properties: no per-device CSV without rows, and a week's export named by its Monday.
      Tests: `useExportAction` (4), `buildReport` (9), `ExportDrawer` (11). **Not verified signed-in in a
      browser, and no PDF has been generated from this build on real data yet.**

- [x] **RM-081b (S)** **DONE 2026-09-15, found by verifying RM-081 signed in on live data. A section
      must be no bigger than one thing that can fail.** The operator signed in and the Reports page was
      read back in a browser against August 2026. The headline figures, coverage (27%), the table and
      both themes' contrast all checked out — and "The hourly charts could not be loaded.
      report_demand_curve failed: canceling statement due to statement timeout" came back on every
      Retry, about nine seconds each. Measured from the Pi, the other four series answered in
      0.6–1.4 s and the curve in 3.5 s as the service role; signed in, RLS pushes it past the statement
      timeout. That is RM-086's to fix in the database.

      **What it exposed here is a grouping mistake of RM-081's own.** The hour profile, the heatmap
      and the duration curve were one "detail" section, fetched together. Both of the first two loaded;
      the curve did not; **all three charts disappeared**, and because the PDF waited on all of them,
      **no PDF could be made for August**. RM-081's rule was that each part fails on its own, and a
      section is exactly the unit that fails together — so it has to be no bigger than one query.

      `useReportData` now reads `hours`, `matrix` and `curve` as three sections, each with its own
      timeout, label and Retry. `ReportCharts` draws each chart from its own data: one still loading
      holds its place at its own aspect ratio (`ChartPlaceholder`), one that failed is absent and named
      above the charts with its Retry. The PDF waits only for the headline data and the device rows;
      a chosen chart whose data failed is **left out and named in the document** ("Not included,
      because their data could not be loaded when this document was made: Load duration"), and the
      export drawer says so under that section before anyone generates it.

      Tests: the hook's "a slow duration curve costs only the curve", `buildReport` names a left-out
      chart, `docDefinition` prints the note before the charts, the drawer shows it, and the page's
      reliability test now asserts four charts are drawn while the heatmap's series has failed.

- [x] **RM-082d (S)** **DONE 2026-09-15, measured on the live page. The control bar is sticky only
      where there is room for it.** At the kiosk's 1024×600 the sticky bar was **117px** under a 73px
      nav — 190px of a 600px screen covered for the length of the report. It is sticky now only on
      screens wider than 640px **and at least 720px tall**; below that it scrolls away with the page.
      The same read-back confirmed the rest of RM-082 on real data: no sideways overflow at 1024×600 or
      375px, the headline tiles on one row at kiosk width and one column on a phone, the device table
      scrolling inside its own card, and every report text element measured at WCAG AA or better in
      both themes (lowest 4.77:1 light, 5.03:1 dark, 194 elements each).

- [x] **RM-086 (S)** — **phase40: the duration curve in one pass, and the totals policies' auth check
      evaluated once. APPLIED 2026-09-15 and read back.**
      `supabase/phase40_report_curve_speed.sql`, `test/phase40-report-curve-schema.test.mjs`.

      **Read back, both ways it failed.** As the service role, `report_demand_curve` for August 2026
      answers in **448 ms, from 3.5 s** — 101 points, starting at 4,551.3 W (the month's stored peak)
      and ending at 5.3 W, not one point rising, resolution still `minute`. **Signed in**, on the page
      where it had been cancelled by the statement timeout after nine seconds on every attempt, Retry
      drew all five charts in about half a second: energy per day, demand by hour, the breakdown, the
      heatmap and load duration, with no error left on the page.

      **Measured first.** Signed in on the live project, `report_demand_curve` for August 2026 was
      cancelled by the statement timeout on every attempt, about nine seconds each. As the service role,
      which bypasses RLS, it took **3.5 s**, against 0.6–1.4 s for its four sibling series over the same
      window.

      **Two causes.** phase37 computed each of the curve's 101 points as a **correlated** scalar
      subquery — `percentile_cont(f)` over `samples` — so the whole window of `building_totals` was
      scanned and sorted **101 times**. `percentile_cont` accepts an array of fractions and answers all
      of them from **one sort**, which is the form phase40 writes. And the two policies that let
      `authenticated` read the totals compared `auth.role()` bare, which Postgres evaluates **per row**;
      wrapped as `(select auth.role())` it is evaluated once per statement. Same rows visible, same
      roles allowed.

      **Unchanged:** the curve's shape, its 101 points, its NULLs for a period nobody observed, its
      resolution column and its signature. Dropped by exact signature, never `cascade`, and re-granted
      to `authenticated` only.

      **The rehearsal nearly proved nothing, and that is worth recording.** `rehearse.sh` re-applies
      phase37 after the ordered run to test re-application — which put the *slow* curve back, so every
      assertion after it would have rehearsed phase37's function and passed. It now re-applies phase40
      twice after that step. Its new block recomputes the curve in phase37's own correlated form over
      the fixture month and requires the two to agree **point for point**, and asserts 101 empty points
      for an unobserved month, an honoured `p_points`, and both policies wrapping `auth.role()`.
      **Rehearsed green on PostgreSQL 16** (in a throwaway container on the Pi), phase39's privilege
      invariant included. The schema test's first per-row check matched the new CTE's opening
      parenthesis; it tests the percentile's argument now.

      **To close:** the operator pastes it into the Supabase SQL editor; read back by opening Reports
      signed in and seeing the duration curve draw.

- [x] **RM-088 (S)** — **Every device on the branch circuit it is actually wired to.** Written,
      deployed and read back live 2026-09-15 — the read-back is in §0.
      - **What the operator said.** L.O Red carries light switches L1–L4; L.O Yellow carries L5–L7; C.O
        Yellow carries every outlet and whatever plugs into them; CARE ACU carries the aircon only.
        *Amended 2026-09-22 (FI-035, RM-130):* C.O Yellow's outlets are in the CARE office, and the same
        branch feeds the director's office aircon in another room, at about two thirds of it, unmetered.
        CARE ACU is the CARE office's own unit.
      - **What was wrong.** `shared/sites/mmsu-nberic-care/devices.mjs` filed all seven lights under L.O
        Red, and its circuit map — transcribed from a 2019 dashboard comment — described L.O Yellow as
        "the outdoor aircon unit", as did `circuits.mjs`, both meters' descriptions, the 3D pack's
        comments and `docs/physical-install.md`. L.O Yellow's meter reads about 120 W, which is
        lighting. The aircon's IR endpoint, `acu_main`, was on no branch. So a report narrowed to L.O
        Yellow (RM-082c) showed a branch with no devices, and one narrowed to L.O Red showed three lights
        that are not on it. Earlier entries here that say "outdoor ACU" for L.O Yellow — the branch table
        in §0 and RM-072's first read of August — carry that same error.
      - **What changed.** L1–L4 on L.O Red, L5–L7 on L.O Yellow, `acu_main` on CARE ACU; the descriptions
        and the install guide's map now say what each branch carries. The outside temperature sensor
        stays on no branch, because nobody has said what feeds it. The regenerated
        `node-red-bridge/bridge-flow.json` carries the new branches. Energy figures do not move: every
        light is unmetered, and each branch's energy is its own meter's.
      - **Held by** `test/site-branch-wiring.test.mjs` — each branch's exact devices, both meters'
        descriptions, and no site file or install guide still calling L.O Yellow an aircon.
      - **Live.** The services restarted at 12:39 UTC, and the flow was deployed from the Pi with
        `--host=127.0.0.1` (dry run, then `--force --apply`, after backing up `flows.json`). The bridge and
        the `devices` table both read back the corrected branches. The order matters for the table:
        ingest copies the bridge's device list at start and every five minutes, so a restart before the
        flow deploy leaves the old branches in `devices` until the next sync.
- [x] **RM-089 (S)** — **A lost packet no longer fails a Supabase request.** Written and verified
      2026-09-15; **live since the restart at 12:39 UTC; closed 2026-09-17 on 36.9 hours of logs** —
      two lines against 40 to 150 at the old rate, and neither of them a failed connection.
      - **The symptom.** Ingest logged "Supabase unreachable, buffered (1 pending): TypeError: fetch
        failed" 26–100 times a day all week, in bursts, and a read from the Pi during one burst failed as
        `AggregateError [ETIMEDOUT]` listing both IPv4 addresses and both IPv6 ones.
      - **The mechanism.** Node 20 and later give each resolved address one connection attempt of 250 ms.
        The Pi's IPv6 addresses fail at once (`ENETUNREACH` — it has no IPv6 route), so a request rests on
        its IPv4 attempts, and a TCP SYN lost on the Wi-Fi is retried only after about a second. One lost
        packet failed the request. Measured the same day, a quiet link connects in 41–76 ms (p90 62 ms,
        30 of 30 under 250 ms), which is why the failures come in bursts rather than steadily.
      - **The fix.** `server/netDefaults.mjs` sets `net.setDefaultAutoSelectFamilyAttemptTimeout(3500)`,
        enough for two SYN retries and still inside fetch's 10 s connect timeout. It is the first import
        of `ingest.mjs`, `proxy.mjs` and `scheduler.mjs`, so no socket opens before it; the Pi brief's
        restart map lists it. `server/netDefaults.test.mjs` pins the value, that importing it sets the
        default, and that each daemon imports it first.
      - **To close.** Compare a day of "Supabase unreachable" lines after the restart with the week
        before it: 29, 35, 26, 68, 100 and 50 a day from 2026-09-09 to 2026-09-14, and 45 in the 24 hours
        before the fix. If they do not fall, the cause is elsewhere and this entry should say so.
        **At 2026-09-16 06:18 UTC, 17.6 hours after the restart: zero, and zero failed device syncs.** The
        old rate would have given about 33 in that time.
      - **Closed.** Counted from the ingest journal at 2026-09-17 01:32 UTC, **36.9 hours** after the
        restart:
        - **0** "fetch failed" — the connection failure this entry is about.
        - **1** "device sync failed" (07:45:06 UTC on 2026-09-16) and **1** "Supabase unreachable,
          buffered (1 pending)" (07:45:17), both `AbortError: This operation was aborted`: the request's
          own timeout firing, not a connection that could not be made. Two requests in one 11-second
          episode; the buffered write was retried and drained as before.
        - The week before logged 26–100 a day, which is 40 to 150 in the same 36.9 hours.
        An abort is a slow answer rather than a lost packet, so it is outside what this change can fix. If
        aborts start to cluster, that is a new entry, starting from the Supabase side's latency at the time.
- [x] **RM-087 (S)** — **phase41: the hourly totals rollup keeps phase32's integrated cross-check.**
      Written and rehearsed 2026-09-15; **applied by the operator and read back 2026-09-16**, three weeks
      before the first pass that would have lost a value.
      - **The defect.** phase32 (RM-057) stores the legacy power integration beside the summed building
        total as `building_totals.energy_kwh_*_integrated` — the only independent measurement of those
        circuits — and added `building_totals_hourly.energy_kwh_*_integrated_max`. It never redefined
        `roll_up_and_prune_building_totals`, which is still phase11's and names neither column, so a
        retention pass stores NULL in the hourly bucket and deletes the raw row. The series starts at
        2026-09-08 07:31 UTC, so the first pass to reach it falls on 2026-10-08. Found while checking the
        first real retention pass; nothing has been lost.
      - **The fix.** `supabase/phase41_totals_rollup_integrated.sql` redefines the one function under the
        same signature, OUT columns and grants, plus three within-hour maxima. No backfill: no hour rolled
        so far held a value. Site scoping stays RM-030's.
      - **Held by** `test/phase41-totals-rollup-integrated-schema.test.mjs` — every rule phase11 proved, and
        each integrated counter checked position by position into its own column, because all of them are
        `numeric` and a swapped pair would run cleanly — and by `supabase/rehearse.sh`, which seeds the
        series at values unlike the summed counters, asserts the three maxima, and applies phase41 twice.
        Before the file existed, the rehearsal failed on exactly that assertion, with NULL.
      - **To close.** Paste the file into the Supabase SQL editor, then read the deployed function back
        without touching a real row — phase31's method, inside a transaction that is rolled back:

        ```sql
        begin;
        insert into building_totals (ts, site_id, energy_kwh_today_integrated, energy_kwh_week_integrated, energy_kwh_month_integrated)
        select v.ts, (select id from sites order by id limit 1), v.d, v.w, v.m
          from (values (timestamptz '2020-01-01 00:10:00+00', 1.5, 2.5, 3.5),
                       (timestamptz '2020-01-01 00:40:00+00', 1.6, 2.6, 3.6)) as v(ts, d, w, m);
        select * from roll_up_and_prune_building_totals(timestamptz '2020-01-01 01:00:00+00');
        select energy_kwh_today_integrated_max, energy_kwh_week_integrated_max, energy_kwh_month_integrated_max
          from building_totals_hourly where hour = timestamptz '2020-01-01 00:00:00+00';
        rollback;
        ```

        It should roll 1 hour, delete 2 rows, and read 1.6, 2.6 and 3.6; NULLs mean the old function is
        still live. The cutoff can select only the two rows the script inserts — the oldest real reading
        is 2026-08-16 — and the rollback removes them and their bucket. This exact script was run in the
        rehearsal's database after phase41 on 2026-09-15 and returned 1, 2, and 1.6, 2.6, 3.6.
      - **Closed 2026-09-16.** The operator applied the file and ran that script against the live
        database: **1.6, 2.6 and 3.6**, so the deployed function carries the series. Read back afterwards,
        the rollback had left nothing — no row before 2026 in `building_totals`, no bucket before 2026 in
        `building_totals_hourly`, and the oldest real rows unchanged (`building_totals` from
        2026-08-17 00:00, the earliest hourly bucket 2026-08-16 15:00). The retention passes since are
        still exact against the raw export, and none has failed.
- [ ] **RM-083c (S)** — **Time the PDF on the kiosk's Pi, and move it to a worker only if it is slow.**
      Each export now logs `[ibems] pdf: assembled in N ms, rendered in N ms` to the console. Generate one
      month's PDF on the kiosk, read the line, and record it here. Above one second, move
      `buildDocDefinition` + `createPdf().getBlob()` into a module worker and download the Blob on the
      main thread; below it, record the figure and close this.
      **Tried remotely on 2026-09-15; not possible from here.** A standalone page running the export's exact
      steps on a synthetic full month — 31 days, a 744-cell heatmap, every section — built cleanly against
      the Pi's checkout, to be opened in a headless Chromium with its own profile. Headless Chromium on the
      Pi hangs before it navigates while the kiosk's own Chromium is running: a local server answered
      `curl`, and Chromium never requested the page, in 240 s with the page and 60 s with `--dump-dom`.
      A Node run was ruled out earlier, because `download.ts` records that pdfmake resolves chart fonts
      through the real filesystem there. Nothing on the Pi was changed, and the scratch directory was
      removed. One export on the kiosk is still the way to close this.
- [x] **RM-084 (S)** — **Hover on the charts, and three findings the series already hold.** Landed
      2026-09-15. Every generator now emits `Scene.hits` — a day's whole column, an hour, a heatmap
      cell, a circuit's segment, a point on the duration curve — each carrying its value, what it
      belongs to and any qualifier as plain text (`Hit` in `charts/types.ts`). Neither serializer reads
      them, so the SVG the PDF embeds is byte-identical with or without (`charts/hits.test.ts`).
      `ChartFigure` reads a value under the pointer or from the arrow keys at one tab stop — a month's
      heatmap is 744 cells, not 744 tab stops; up and down move a day at a time
      (`charts/hitNavigation.ts`) — shows a value-first tooltip beside the value rather than over it,
      keeps a tapped value on the kiosk until the next tap, and says each keyboard step in a live region
      (`ChartFigure.hover.test.tsx`). `src/lib/reportFindings.ts` adds three findings to the Summary tab,
      after the coverage that qualifies them: weekday against weekend energy from complete days only
      (Saturday and Sunday assumed — the site has no working week — and the page says so); a load factor
      whose average is weighted by the share of each day observed, qualified on a partial period; and the
      overnight base load, the median of 00:00–06:00's hourly medians, needing four of those six hours.
      Each is an em dash with its reason when the data cannot carry it (`reportFindings.test.ts`,
      `ReportFindings.test.tsx`). Page only: the PDF's sections are unchanged.
      **Read back live the same day**, on the Pi at `f864de6`, signed in, with CI green.
      - **August 2026:** 13.0 kWh a weekday against 1.4 kWh a weekend day, a 10% load factor qualified
        at 27% of minutes observed, and a 91 W overnight base load. Recomputed independently from the
        daily chart's own table: 13.05 kWh over 25–28 and 31 August, 1.40 kWh over 29–30 August.
      - **Week of 10 August** (no usable reading): all three findings are an em dash with their reasons,
        and none of its charts offers anything to explore.
      - **Hover:** 28 August reads 8.10 kWh, matching its table row.
      - **Keyboard:** walks the heatmap a day at a time; the live region says each step.
      - **Contrast:** tooltip and findings text measure at least 5.9:1 in the light theme and 7.9:1 in
        the dark.
- [ ] **RM-085 (L)** — **Arbitrary windows: last 24 hours, month to date, billing cycle, custom.**
      **Deferred by operator decision, 2026-09-15.** `report_window` accepts only a whole week or
      month (`phase37_report_series.sql:66`) and counts the unfinished part of a period as missing,
      so these cannot be served honestly from today's functions. Needs `phase45_report_ranges.sql`
      (renumbered 2026-09-16: phase42 is RM-091's and phase43 RM-091a's; and 2026-09-17: phase44 is
      RM-073's)
      (range variants clamped to `now()`, per-device energy from each device's own counters, a
      weekday-by-hour heatmap past 37 days to stay under the 900-cell cap), a billing-cycle day
      setting, a provisional "in progress" banner, and a rehearsal asserting the bars sum to the
      range total.

### Reports gain charts, a document, and a price — RM-072 (2026-09-10)

`ReportsPage.tsx` is 337 lines that render one `<dl>` of six figures and one five-column table.
It has **no charts at all**, there is no PDF anywhere in this repo, and there is not one
`@media print` rule in 8,453 lines of `src/index.css`. Export is CSV only.

The data underneath it is real and good, which is what makes the page the weak part rather than
the pipeline: `period_building_reports` holds four weekly rows and one monthly row from
production right now — August 2026 at 90.95 kWh from 21,421 of 44,640 expected samples, peak
4,551 W, 127 commands. **That also settles §5 Q9**, which still asks whether the Reports page has
been seen with real data. It has.

Planned: four report types (period summary, baseline, circuit deep-dive, and a comparison in the
IPMVP Option C shape), five chart families, a paginated PDF, and an operator-entered tariff and
emission factor carrying provenance. What has landed:

- [x] **RM-072a — the pdfmake spike, and it is the part worth reading.** Run against 0.3.11 in
      Node and in a real browser with the hardest SVG the design calls for: a hatch `<pattern>`,
      a `<linearGradient>`, `stroke-dasharray`, and text carrying `&` and `<CO5>`. It works —
      a 2-page, 24,580-byte PDF in **102 ms**, carrying `/Pattern` and `/Shading` (so the hatch
      and the gradient really are vector) with Roboto embedded and subsetted (so the text is
      real and selectable). Visually confirmed: the unobserved day draws as a hatched block
      labelled "no data", the zero day as a hairline bar, and the two are not each other.
      Three findings that would each have cost an afternoon, none of them in the documentation
      an LLM or a tutorial will hand you:
      **(1) pdfmake 0.3 is Promise-based.** `createPdf(def).getBlob()` returns a Promise. The
      `getBlob(cb)` callback form that every example shows is the 0.2 API, and on 0.3 it hangs
      forever — no error, no warning, no timeout. This cost the most time.
      **(2) Fonts must come from the font CONTAINER, not `vfs_fonts.js`.**
      `build/fonts/Roboto.js` self-registers through `addFontContainer` and works;
      `build/vfs_fonts.js` registers the font *files* but no font *definitions*, so
      `font: 'Roboto'` is unknown and rendering hangs in exactly the same silent way as (1) —
      which is how one bug looks like the other.
      **(3) SVG `<text>` resolves fonts through a different path than pdfmake's own text**, via
      a `fontCallback` in `js/Renderer.js` that hands PDFKit a filename. In the browser that
      resolves against the virtual filesystem; in Node it hits the real one and fails. Only
      bites a server-side render, which is one more reason not to do one.
      Measured cost: `pdfmake.min.js` 1.05 MB + `fonts/Roboto.js` 855 KB, to be a lazy chunk
      with its own `manualChunks` entry so the figure stays visible in build output. Still
      unmeasured: the same generation on the Pi, which gates the button's busy state.

- [x] **RM-072b — the chart primitives: one scene, two serializers.** Charts here are neither
      Recharts nor scraped from it. A generator is a pure function returning a **scene** — a flat
      list of resolved drawing primitives — and two thin serializers turn it into React elements
      for the page and an SVG string for the PDF.
      **Why not simply return an SVG string**, which would be one renderer and no possible
      disagreement: putting a string into the DOM means `dangerouslySetInnerHTML`, which appears
      **nowhere in this codebase**, and the first use of it would be for chart labels built partly
      from operator-editable device names — the same names `src/lib/csv.ts` already treats as
      untrusted where the payload is a spreadsheet formula. Going through real React elements
      means React escapes them, by construction, in the one consumer that has a scripting engine
      attached. `sceneToSvg` escapes by hand because pdfmake's parser does not.
      The drift that buys is closed twice over. `sceneNodes.ts` makes every decision — every tag,
      attribute name and formatted number — exactly once, so the two serializers are fifteen lines
      each with nothing left to disagree about; and `serializers.test.tsx` renders one scene
      through both and compares node for node, attribute for attribute. Deliberately not a
      snapshot: a snapshot goes green under `-u` on precisely the change it exists to catch.
      `src/components/reports/charts/{types,palette,escapeXml,sceneNodes,sceneToSvg,sceneToJsx,chartFrame}.ts`,
      67 tests.

- [x] **RM-072c — a print palette, and the guard the existing contrast test cannot provide.**
      `test/contrast.test.mjs` measures every text token against every palette SURFACE, and its
      own header says what it does not do: *"It measures the palette, not the page."* **Paper is
      not a palette surface.** So the PDF gets a fixed light palette regardless of the kiosk's
      theme — which is also the right document — mirrored from the light `:root` the way
      `scene3d/tokens.ts` mirrors it for Three.js, and drift-guarded the same way.
      The new assertion is contrast against `#ffffff`, and **it rejected `--accent` on the first
      run at 2.15:1** — a figure `index.css` already documents, and the reason it ships
      `--accent-text`. The print series therefore takes the AA-strength tier
      (`--accent-text`/`--blue`/`--green`/`--purple`), never the `-bright` tier the screen uses
      for lines on a tinted card.
      **Two of that file's first assertions were wrong, and both were wrong in the same
      direction — measuring the wrong thing and reporting success:**
      *Gridlines were held to 3:1.* WCAG 2.2 SC 1.4.11 is about graphical objects **required to
      understand** the content, and a gridline is a reading aid, not a datum. One at 3:1 would be
      as loud as the series drawn over it, so the test would have forced a measurably worse chart
      while passing. It now asserts what a gridline actually has to do: recede behind the ink and
      behind every series, while staying visible on the page.
      *Series separation was measured as a luminance difference*, and failed on `--blue` against
      `--purple` at 0.0078 — two colours nobody would confuse. Luminance is the wrong instrument
      for a categorical palette; it is exactly the axis on which two distinguishable hues may
      coincide. Tightening the threshold until it passed would have been fitting the guard to the
      palette. It measures **CIE76 ΔE in Lab** now, at ≥25, with its own Lab anchors asserted so a
      copy that has drifted cannot report success.
      Also added: `--heat-1..5`, the palette's only *ordered* scale, for the day-by-hour demand
      heatmap — five lightness steps of one hue rather than a rainbow, because a heat cell is
      ranked and a multi-hue ramp is only rankable by someone who already knows the legend. The
      dark theme **inverts** it rather than darkening it: "more" must read as more ink on paper
      and more light on a dark screen, and carrying the light ramp across would have made an
      unobserved hour the loudest cell on the page — an error invisible in a swatch strip. Both
      directions are asserted monotonic.

- [x] **RM-072d — two dataviz rules enforced in `chartFrame.ts` rather than left to whoever
      writes the next generator.** A bar axis is anchored at zero (`zeroBased` is a required
      option, not a default): a bar's length *is* its value, so an axis starting at 1.2 makes a
      1.26 kWh day look like nothing beside a 1.38 kWh day, which is the commonest way a truthful
      dataset produces a dishonest picture. And `niceScale` returns **`null`** for an empty or
      all-null domain rather than a plausible 0–1 grid — the same rule as `coverageOf` returning
      null instead of zero, so a caller has to draw "nobody was watching" instead of a confident
      empty chart over a month nobody observed.



- [x] **RM-072e — `supabase/phase37_report_series.sql`, the series behind the charts.**
      **APPLIED 2026-09-10 — and then corrected; see RM-072f, which must be re-applied.** phase27's tables hold one row
      per period — a total, a peak, a coverage pair. A chart needs the SHAPE, and none of it is
      stored: energy day by day, demand hour by hour, the load sorted high to low.
      Seven `stable`, `security invoker` functions: `report_window`, `report_resolution`,
      `report_daily_series`, `report_hour_profile`, `report_hour_matrix`, `report_demand_curve`,
      `report_demand_summary`. Invoker is load-bearing — a definer function here would run as its
      owner and hand every reading to anyone who could execute it, undoing `phase5` without
      touching a policy. `anon` is named explicitly in every revoke, because revoking from PUBLIC
      does not remove a grant Supabase gave `anon` directly.
      **Why SQL and not a loop in the browser.** A month of `building_totals` is 44,640 rows
      against PostgREST's silent 1000-row cap — the trap `phase9_history_buckets.sql` was written
      for, whose symptom was a "7 day" chart holding 17h39m that "rendered with axes and a
      plausible curve, and wrong". And gap days: every bucket is a `generate_series` LEFT JOIN, so
      a day cannot be forgotten because it is never separately constructed. `baselineReport.mjs`
      found the alternative the hard way and patches it up afterwards with a fill loop.
      **`resolution` is the new honesty column, and it names a decay nothing was tracking.**
      `building_totals` is pruned at 30 days. A p95 for August read in September is part minute
      samples and part hourly means; read in October it is entirely hourly means, which is a
      *different statistic* — an average of averages cannot reach the peaks the samples had, so it
      reads systematically low. There is no error, no gap and no event; the same query simply
      returns a quieter answer every month. Every function returns `'minute' | 'mixed' | 'hour'`
      and every consumer renders it beside the figure, exactly as coverage already is.
      **The rehearsal earned its keep, and both bugs it found erred in the reassuring direction.**
      `supabase/rehearse.sh` gained a phase37 block of 30 assertions against the existing
      fixtures — which is what caught them, because a file-text test cannot:
      *`observed_minutes` counted an hourly bucket as ONE minute.* A fully observed month that had
      been rolled up would have reported ~744 observed against 43,200 expected: **1.7% coverage
      for a month with no gaps at all**, and since the Reports page renders coverage beside every
      figure, it would have qualified every true number in the document as untrustworthy.
      *`longest_gap_minutes` was measured across raw rows alone*, so once part of a window had been
      pruned the gap was measured only over the surviving part. A fixture dark for eight days
      reported a **one-minute gap**, because the dark stretch lay entirely in the rolled-up half.
      Both are the same mistake — treating an observation as an instant rather than an interval.
      A raw row covers its minute; an hourly bucket covers its hour and carries the minutes it
      actually saw. The gap is now a stated floor, and `resolution` says at what granularity.
      **The assertion the whole file rests on**: the daily series' bars must sum to the figure the
      month report prints above them. They are computed by different expressions in different
      functions — the month takes `max(energy_kwh_month_max)`, the series sums per-day increments
      of the same counter — and nothing but this checks that they agree. Also asserted: a frozen
      day adds 0 (the live failure phase27 measured), an unobserved day is a row with NULL energy
      and `sample_count` 0, the duration curve never rises and its first point equals the report's
      peak, and a mid-month date truncates to the 1st.
      Two defects the rehearsal surfaced before that, both invisible to a text test: `sample_count`
      as both an OUT parameter and a CTE column is ambiguous in PL/pgSQL, and `percentile_cont`
      has no numeric overload — it returns double precision whatever it sorted, so an uncast
      result fails at `RETURN QUERY` with a message naming a column position rather than a line.
      `test/phase37-report-series-schema.test.mjs`, 21 assertions; rehearsal green on real
      PostgreSQL 16.


- [x] **RM-072f — phase37 applied, read back against the live project, and three defects found
      that the rehearsal could not.** Applied 2026-09-10. **The corrected file must be re-applied**
      — the version currently in the database is the one this entry describes fixing.
      The read-back is not a formality. FI-018 established why: the first real baseline report
      turned up a dark day rendered as an absent row and a blank row rendered as `—–—`, neither of
      which any test caught. This found three more, and **all three erred in the reassuring
      direction** — which is the direction that does not get reported.

      **What was right.** The assertion the file rests on held on production data: the daily
      series' 31 bars sum to **90.9468 kWh**, exactly the figure the stored month report prints
      above them, computed by a different expression in a different function. 16 days observed,
      15 dark, and all 15 dark days render as NULL rather than 0. The peak agrees at 4551.3 W and
      the hour profile returns 24 rows with no unobserved hour carrying a statistic.

      **1. `longest_gap_minutes` said NINE MINUTES for a month that was dark for sixteen days.**
      August 2026's first observation is the 16th, and the gap series was differenced only
      *between* observations — so the darkness before the first one, and after the last, was
      never measured at all. Nine minutes is the longest stretch between two samples once the
      data starts. No fixture would produce this: a fixture is never half a real month. The
      window's own start and end are zero-length observations now, `least(win_end, now())` at the
      far end because hours that have not happened are not a gap.

      **2. `resolution` conflated "made of what" with "how much".** It compared the count of raw
      hours against the window's ELAPSED hours, so August — which is *entirely* raw minute
      samples and also half dark — reported `'mixed'`. That is a resolution downgrade describing
      a coverage gap, and coverage already answers that question beside every figure. It compares
      raw hours against rolled-up hours now, and returns **NULL** when nothing was observed:
      with no data, resolution is not a claim anyone can make, the same rule that makes an
      unobserved hour NULL rather than 0 W.

      **3. `report_hour_matrix` timed out on a month and returned a week in milliseconds.** That
      reads as a row-count problem and is not one — 744 cells is well under the 900 cap the
      function guards. `report_resolution` was being called **inline in the select list**, so it
      ran once per OUTPUT ROW: 744 scans of `building_totals` counting distinct hours. Hoisted
      into a local computed once per call. The seam guard in `report_hour_profile` was also
      rewritten from `date_trunc('hour', t2.ts) = b.hour` to a range, because an index on `ts`
      can serve a range and cannot serve a function of the column.

      Guards added for all three, in both places: `test/phase37-report-series-schema.test.mjs`
      (now 23) asserts the boundary sentinels exist, that resolution never measures the window
      length, and that `report_resolution` appears exactly once per function; `supabase/rehearse.sh`
      asserts all three resolution states plus NULL, and that the longest gap exceeds 20,000
      minutes — the trailing dark stretch, which the old expression could not see.


- [x] **RM-072g — a row is not an observation, and the Reports page has been overstating its own
      coverage.** The fourth thing the live read-back turned up, and the only one that is a defect
      in a SHIPPED feature rather than in new code.

      **What it looks like.** `report_daily_series` reported 2026-08-18 as **1,414 samples,
      0 kWh, no peak** — a day that is 98% covered and used no electricity. `building_totals`
      does hold 1,414 rows for that day, and **every one of them has `total_power_w` NULL,
      `avg_voltage` NULL, and `energy_kwh_month` frozen** at the previous day's value. The meters
      wrote rows on schedule; they observed nothing. `server/baselineReport.mjs` already draws
      this distinction and reports that day as *"nothing observed — no usable total was
      recorded"*. Nothing else in the system does.

      **Measured on the live project, August 2026:**

      | | rows | usable | coverage |
      |---|---|---|---|
      | August 2026 | 21,421 | **12,006** | 48.0% → **26.9%** |
      | week of 2026-08-31 | 10,080 | 10,029 | 100.0% → 99.5% |

      9,415 of August's 21,421 "observed" samples — **44% of them** — carry no reading. The
      Reports page renders coverage beside every figure precisely so that a barely-observed month
      can never quote a bare total, and that coverage figure is itself overstated by 21 points.
      A healthy week is barely affected, which is why this has never looked wrong.

      **What changed here.** phase37's bucketed functions return BOTH counts —
      `sample_count` (rows, which reconciles with phase27 so the page never shows two coverage
      figures without saying why) and `usable_sample_count` (rows carrying a real reading, which
      is what a chart must use to decide observed-versus-gap). `report_demand_summary` gains
      `usable_minutes`, and **only a usable observation closes a gap**: 600 rows of frozen
      counter dropped into the middle of a dark stretch must not shorten it. The daily average is
      weighted by usable samples too — an hour holding 40 real readings and 20 frozen ones is 40
      minutes of evidence about demand, not 60.

      **What has NOT changed, and is a decision rather than a task.** `generate_period_report`
      (phase27) still counts rows as `online_sample_count`, so the stored reports and the figure
      on the page are unchanged. Correcting it would rewrite every stored coverage figure in the
      database, including months already reported upward, and would move some months across the
      50% band boundary between "partial" and "sparse" — which is the boundary `isQuotable`
      uses to decide whether a total may be shown without a caveat. That is worth doing and it is
      **RM-073**, not a side effect of this one.

      Guarded in both places: `test/phase37-report-series-schema.test.mjs` asserts both counts
      exist and that only a usable observation closes a gap; `supabase/rehearse.sh` seeds 600 rows
      of the exact frozen signature into a dark day and asserts the day reports 600 rows, 0
      usable, no peak, no average, and a gap that does not shorten.

- [x] **RM-072h — `create or replace` is not enough, and the rehearsal had been proving the one
      case that never happens twice.** Re-applying phase37 after RM-072g added a column failed in
      the SQL editor with `42P13: cannot change return type of existing function`. A function's
      OUT parameters are part of its identity, so `create or replace` can change a body and never
      a shape.

      **The gap this exposed is in the rehearsal, not just the file.** `rehearse.sh` applies every
      migration to an EMPTY database, which proves each file works on a fresh install — and a
      hand-applied migration gets pasted a second time precisely *because* it changed, so applying
      to an empty database is the one situation that never occurs twice. Three rounds of read-back
      fixes were re-applied by hand and none of them was ever rehearsed as a re-application.

      Every function is now dropped by explicit signature before it is created, so the file is
      idempotent across a SHAPE change and not merely across a body change. Deliberately not
      `cascade`: nothing depends on these today, and if something ever does, an error naming it
      beats its silent removal.

      The rehearsal now puts a deliberately wrong-shaped `report_daily_series` in the way — same
      name, same argument types, different OUT columns, exactly what an earlier version of the
      file left behind — and re-applies over it, then applies again unchanged. That is the case
      that broke, reproduced. `test/phase37-report-series-schema.test.mjs` asserts a drop exists
      for every function and that none of them uses `cascade`, so a function added later without
      one fails before it reaches a database.


- [x] **RM-072i — applied and verified, 2026-09-10.** Every check green against the live project:
      the daily series' bars sum to **90.9468 kWh**, exactly the stored month report; the peak
      agrees at 4551.3 W; the hour profile returns 24 rows with no unobserved hour carrying a
      statistic; the matrix returns all 744 cells in 453 ms; the duration curve never rises and
      starts at the period peak; and `anon` is refused with 401 on every function, so the revoke
      survived the drop-and-recreate.

      **What the corrected counts show about August 2026**, now that rows and readings are told
      apart:

      | | rows | real readings |
      |---|---|---|
      | month coverage | 48.0% | **26.9%** |
      | days with rows but no readings | — | **5** (16th, 18th, 21st, 22nd, 23rd) |
      | hour-cells that look observed | 361 | **208** |
      | 2026-08-17 | 1,371 rows | **668** readings |
      | 2026-08-19 | 1,411 rows | **166** readings |

      The 19th is the one to look at: **0.89 kWh from 166 usable minutes of 1,440** — under 12% of
      the day — which the page today reports as a 98%-covered day. 153 of the month's hour-cells
      would draw as observed in a heatmap while holding no reading at all. The longest gap reads
      23,549 minutes (16.4 days), against the nine minutes the first version reported.

      A healthy week is untouched: the week of 2026-08-31 is 10,080 rows and 10,029 readings,
      100% against 99.5%. Which is exactly why none of this has ever looked wrong.

      One thing noticed and deliberately not chased: 2026-09-01 reports 1,442 samples against an
      expected 1,440. `expected_samples` is a nominal figure derived from the window, and a minute
      that carries two rows is a pre-existing ingest artefact — `server/baselineReport.mjs` shows
      the same 1,442 for that day. Recorded, not fixed.


- [x] **RM-072j — the first chart, and August is the argument for how it draws.** The daily
      energy bar chart, rendered from the live series and looked at rather than only asserted on.
      Three states, three treatments, and no two of them look alike:

      *observed and complete* — a solid bar, on an axis anchored at zero because a bar's length
      is its value. *Observed but partial* — the same bar at reduced weight with a **dashed open
      cap**: 2026-08-19 recorded 0.89 kWh from 166 usable minutes, which is a floor, and an
      unmarked floor on a shared axis reads as a comparison. *Not observed* — a hatched block the
      full height of the plot, and never a bar of any height, because a zero-height bar and a
      genuine zero are the same picture and only one of them is a fact.

      **Two things only looking at it could have caught.**

      August has twenty unobserved days. One block and one label each gave twenty 8px labels in
      nine-pixel bands — an unreadable smear that made the chart look broken rather than the
      month. Consecutive dark days are merged into one run *before* anything is drawn, so
      "one block per outage" is a property of the geometry rather than a rendering trick, and the
      big leading gap now reads **"16 days, no data"** once, in the middle. A run too narrow for
      its label gets none: a clipped label is worse than the hatch alone.

      The partial-day marker was a `≥` above the bar. At 9px in a font the PDF may not embed it
      renders as an ambiguous smudge — and drawn perfectly it still asks the reader to know what
      a mathematical operator floating above a bar means. It is a dashed top edge now: an
      unfinished bar with an unfinished cap, which needs no legend and survives a monochrome
      print. Opacity alone was never enough; that is decoration, not a channel.

      `dailyEnergyChart.ts`, 18 tests. Coverage policy stays in `coverageOf` — the generator is
      handed `observed` and `complete` already resolved and knows nothing about bands.


- [x] **RM-072k — the remaining four chart generators, and what rendering them against live data
      said.** `loadProfileChart`, `circuitBreakdownChart`, `demandHeatmapChart` and
      `durationCurveChart`. 133 tests across the five generators. The honesty rule each one keeps:

      *Load profile* — median, the p50–p95 spread and the peak, as three series because a median
      alone cannot tell an hour that sat steadily at 800 W from one that idled at 100 W and spiked
      to 4 kW twice. **The line breaks at an unobserved hour rather than interpolating across it**
      — EX-102's rule for the live 24h chart, carried into the report. `runsOf` in `chartFrame.ts`
      is that rule written once, and every line chart here uses it.

      *Circuit breakdown* — a 100% stacked bar, which is the honest form and not a stylistic one:
      since RM-057 the building total IS the sum of these four branch meters, so the parts really
      make the whole. An unmetered circuit is excluded and named, never drawn as a zero-width
      sliver — the seven light switches have no metering at all, and a sliver of nothing says the
      lights used no electricity.

      *Heatmap* — the only chart here where a coverage gap is a SHAPE rather than a footnote. An
      unobserved cell is hatched, **never the lightest step of the ramp**: the ramp runs least to
      most, so its palest step means "this hour drew almost nothing", and 153 of August's 744
      cells hold rows carrying no reading at all.

      *Duration curve* — with the DSM ceiling drawn across it and the share of the period spent
      above it. A ceiling that is never reached is still drawn, above the curve, because "the
      building never came near it" is the finding rather than the absence of one, and a ceiling
      set far above anything the building does is how auto-shedding ends up armed and inert.

      **Three things only rendering them could have found.**

      The load profile drew three series and named none of them. The description says "median,
      the p50–p95 spread, and the peak" in prose, and prose cannot say which one is the blue line.
      It has a key now.

      `--heat-1` was `#eff6ff`, near enough to white that a genuinely quiet hour read as an empty
      cell — which is the one distinction the ramp shares a chart with the hatch to make. Two
      steps darker at the light end, dark end unchanged, ramp still spans 8:1.

      `test/site-naming.test.mjs` — a guard that predates this work — caught `toLocaleString('en-US')`
      in the duration curve's watt formatter. It is right to: RM-033 already had to go back and
      unpick thirteen such call sites for the replication framework. The reader owns formatting.

      **And one finding about the building rather than the code.** The breakdown of August reads:
      convenience outlets 51.1 kWh, indoor ACU 30.9, outdoor ACU 6.5, lighting 2.4 — and
      **49.3 of the 51.1 kWh on the convenience-outlet branch is not attributable to any of the
      seven metered outlets beneath it.** That is not a chart defect; it is RM-020 and RM-021 seen
      from the energy side. Six of those seven outlets have been off the network for weeks, so the
      branch meter sees the load and no sub-meter accounts for it. The chart says so in words
      rather than quietly splitting the difference.


- [x] **RM-072m — the client layer and the charts on the page.** `src/lib/reportSeries.ts` reads
      phase37's five functions, every call through `assertNotTruncated` against that function's own
      bounded row count — these cannot legitimately hit a cap, so hitting one means the answer was
      cut, and a cut series draws a complete-looking chart. `p_tz` is passed explicitly from
      `SITE.timezone` rather than left to the SQL default: the client and the query have to agree
      about what a day is.

      **The mappers are where the distinction either survives or is quietly lost.** Every bucketed
      row carries `sample_count` (rows) and `usable_sample_count` (rows holding a real reading);
      2026-08-18 has 1,414 of the first and zero of the second. `toDailyPoints` takes `observed`
      from the second and defers to `coverageOf` for where "complete" begins, so the chart and the
      figures printed beside it are qualified by one threshold rather than two. `toHeatCells`
      blanks a cell whose samples carried nothing **and** one whose average is null — belt and
      braces, and where the two disagree the absent number wins.

      **`ChartFigure` makes a chart a document element rather than a picture.** `Sparkline` is
      `aria-hidden` and that is right for what it is; a heatmap has no numeric stat beside it, so
      hiding it removes the finding instead of de-duplicating it. The scene names itself
      (`role="img"` + `<title>`/`<desc>`), and every chart carries its own numbers in a collapsed
      table — the only form in which an exact figure can be read off, and the only one where a
      missing value is visibly an em dash rather than an absence in a drawing.
      One defect found while testing it: the visible caption repeated the scene's `<desc>` word
      for word, so a screen reader read the same sentence twice. It is `aria-hidden` when it
      duplicates, exposed when a caller supplies something the chart cannot know.

      **`PeriodPicker`** replaces the pill row. RM-041's buttons were right for the two months
      that existed then and do not survive their own query — `getReportPeriods` fetches up to 240
      months or **520 weeks**. The buttons stay to fourteen and a year-grouped select takes over
      past it.

      **And the CSV defect is fixed**: `exportCsv` computed `period` and then dropped it, because
      it was absent from `DEVICE_CSV_COLUMNS` — so a weekly export's rows were headed "Month" and
      held a Monday. The filename disambiguated them; the file's contents did not.

      **Two pre-existing guards caught real faults in this work, both about replication.**
      `test/device-ids-in-frontend.test.mjs` refused the untracked-energy calculation, which named
      `mtr_co_yellow` and `/^co\d$/` inline — every one of those literals is a promise the next
      building has the same wiring, the promise FI-017 and RM-033 exist to stop the frontend
      making. It is `src/lib/circuitBreakdown.ts` now, deriving the shape from the circuit tree:
      segments come from `BUILDING_METER_IDS`, which is the same derived constant
      `shared/buildLatest.mjs` sums to produce the building total, so the chart and the figure
      above it cannot disagree about which meters make the whole; sub-meters come from each
      device's own `branch_circuit`. A branch with no metered children is never flagged as
      unattributed — nothing was claiming to account for it, and flagging it would flag correct
      wiring.
      `test/css-touch-targets.test.mjs` refused a second `@media (pointer: coarse)` block: it
      reads *the* block, so a second one silently takes the place of the one that covers every
      other control. The two new controls joined the canonical list instead — which is the single-
      block invariant RM-071a's stray comma broke app-wide.

      **DEPLOYED to the Pi 2026-09-10**, `npm run build` on the device — the kiosk is served from
      `./dist`, and a commit is not a deploy. Serving `index-BXlsdybd.js`; boots clean with no
      console errors. No restart was needed and none was performed: RM-043's `useBuildWatch`
      notices the entry bundle's hash within five minutes and the kiosk reloads itself once it
      has been idle a minute, which is the durable fix that incident bought.
      **The five charts cost 21 kB.** 689,487 bytes before, 710,842 after — which is the
      hand-rolled-SVG decision paying for itself, against a Recharts instance per chart. `pdfmake`
      is installed but imported by nothing yet, and `grep` confirms zero bytes of it in the
      bundle; it stays that way until the export button dynamically imports it.

      Still to come before this is a document: the report-type tabs and the other three reports,
      then the PDF. **Not yet seen signed-in** — the charts have been rendered from live data and
      read back, and the page boots, but nobody has opened Reports with a session.


- [x] **RM-072n — four readings of one period, and the one that refuses to answer.** The
      report-type tabs, plus the baseline, circuit and comparison reports. Tabs rather than
      routes because the period is the page's SUBJECT — a tab that reset it would be a different
      page pretending. Reuses `ui/Tabs`, whose header states the requirement this had to meet:
      selection follows focus, so a panel that fetched on mount would fire four loads as a
      keyboard user arrowed across the strip. Everything is fetched once at page level and handed
      down; no panel does I/O.

      **`shared/reportProse.mjs`** now holds every sentence a report says about its own limits —
      the coverage lede, the "not a baseline yet" gate and its thresholds, the demand caveat, and
      the closing "what this report does not say". `server/baselineReport.mjs` reads them from
      there, and **its 13 tests pass with the file untouched**, which is the proof the move was
      faithful. Three renderings of one set of caveats: the CLI's Markdown, the page, and the PDF
      to come. The failure if they diverge is not a typo — it is a document qualifying a figure
      the screen quotes bare, which is RM-062's defect in a different place.

      **The baseline report** is Milestone 1's "benchmarking summary" on the page rather than in
      a gitignored Markdown file nobody opens. FI-018 has produced this content since 2026-08-31;
      the figures were never the problem, the reader was. Coverage first, then the thinness gate,
      then the numbers — and the gate counts **real readings and days that held one**, not rows,
      because counting rows would let a fortnight of frozen counters promote a sample to a
      benchmark. That is the exact shape 2026-08-18 has.

      **`CoverageBanner` shows two coverage figures, named.** August 2026 is 48% as rows and 27%
      as real readings; showing only the first overstates by twenty-one points, showing only the
      second disagrees with the stored report. Both, with the gap explained. `resolution` is
      qualified here too — an old period's percentiles come from hourly means, a different
      statistic with no event to mark the transition.

      **`ComparisonReport` is IPMVP Option C, and the refusal is the feature.** Option C is
      whole-facility and requires adjustment for the independent variables; this system records
      none of them. So `src/lib/ipmvp.ts` computes a difference **only when both periods are
      `complete`**, and otherwise says which period was thin and by how much. Live, that is a
      100%-covered week beside a 48%-covered month: ungated it prints something like **−52%** as
      the most quotable number on the page, entirely an artefact of the meters being off. It also
      refuses a week against a month, returns `null` rather than a percentage of zero, and says
      the direction in words — a minus sign in front of a number a reader hopes is good gets read
      as whichever they were hoping for. `COMPARISON_NOT_ADJUSTED` is permanent and not
      collapsible; the last of its four bullets is *"It is a difference, not a saving."*

      **`CircuitDeepDive`** separates the branch meters from the devices inside them. A flat table
      puts a branch and one of its own outlets on adjacent rows reading as peers, and adding them
      double-counts. It leads with the unattributed figure when there is one.

      One defect found while testing: mocking the whole of `@/lib/reportSeries` left the pure
      mappers undefined, `ReportCharts` called one, and the page threw on first render — so four
      assertions failed with "unable to find", reading as four layout bugs and being one bad
      mock. Only the I/O is faked now, which is the rule the sibling test file already states.


- [x] **RM-072p — the PDF, and the report becomes a document.** `Download PDF` on the Reports
      page. Rendered from live August data and read back: **7 pages, 492 kB, 311 ms**, five vector
      charts, fonts embedded and subsetted so the text is real and selectable, and `/Pattern` in
      the output confirming the gap hatch is vector rather than a picture of one.

      **`docDefinition.ts` does not import pdfmake, and that is the whole point.** The definition
      is a plain object, so everything worth asserting is checkable as a value without rendering
      a byte or pulling two megabytes into a test run: that coverage precedes the figures it
      qualifies (asserted as an ordering property, not by eyeballing), that all seven tables set
      `headerRows: 1`, that the closing refusals are the last node and `unbreakable`, that a
      missing device figure is an em dash and never a zero, and — a whole-tree string walk —
      **that no currency symbol appears anywhere**, which is RM-073's territory and stays absent
      until a tariff can be entered with provenance. `download.ts` is the only file that knows
      pdfmake exists.

      **Why a PDF is held to a higher bar than the page.** The page can be re-read with a
      different period selected and its charts can be hovered. A PDF leaves the building: it is
      attached to an email, printed, and quoted months later. It is the one rendering nobody can
      ask a follow-up question of, so every figure carries its qualification with it rather than
      nearby — which is why the cover states the timezone frame in its second sentence and the
      footer names the building and period on every page.

      **The charts are generated twice, deliberately.** The page's copies use `SCREEN_PALETTE`
      (`var(--…)`, following the theme toggle); the document's use `PRINT_PALETTE` — concrete hex
      mirroring the light theme — because paper is white whatever the kiosk is set to, and a
      reader in dark mode should not get a document they cannot print. Same scenes, same numbers,
      different ink.

      **Dynamically imported**, with its own `pdf` chunk: 1,826 kB minified / 815 kB gzipped, and
      the main bundle **did not grow at all**. A reader who never exports a report never pays for
      the ability to, which matters most on the machine the kiosk runs on.

      `src/types/pdfmake.d.ts` is hand-written rather than `@types/pdfmake`: that package describes
      the **0.2** API, the callback one, which on 0.3 hangs forever with no error — typing against
      it would have TypeScript vouching for the exact call that does not work.

      The document reads back correct on the live month: 12,006 of 44,640 minutes with a real
      reading (27%) against 21,421 rows (48%), a 23,549-minute longest gap, **11 days observed of
      which 7 complete** — eleven and not sixteen, because five of August's days hold rows the
      meters wrote while observing nothing.

      **DEPLOYED to the Pi 2026-09-10**, serving `index-BV4kgcIO.js`. `npm ci` first — pdfmake is
      a new dependency and the device did not have it; a `npm run build` alone would have
      succeeded and shipped a button that throws on click, because nothing imports pdfmake
      statically. Verified after: the `pdf` chunk is reachable at 1,826 kB **and appears nowhere
      in the served HTML**, so it is fetched on the first click and never on a page load.


- [x] **RM-072q — what a kilowatt-hour costs, and what it emits.** The last piece of the reporting
      scope. `supabase/phase38_tariff_emissions.sql` — **applied 2026-09-12.** Both tables answer on
      the live project (an `anon` probe is refused on a privilege error, not `42P01`), so the schema
      is there. **No tariff and no emission factor has been entered yet**, which is an operator
      action and not a code one: until one is, every ₱ and every kg CO₂ in the page and the PDF
      reads "no rate has been entered" — which is the designed behaviour, not a fault.

      **Two tables, not two keys in `sites.policy`.** `set_acu_min_room_target` (phase35) is a
      `security definer` function because the `sites` row *also* decides whether commands may
      leave the building for a vendor cloud, and RLS is row-level — a policy narrow enough to
      permit the setpoint and refuse the dispatch mode cannot be written, so the function is the
      narrow door. A dedicated table has no such collision: plain `authenticated` RLS, and no
      function to maintain. phase38 adds none, which the schema test asserts.

      **Dated, not a scalar.** A single "current rate" would price August 2026 at whatever the
      rate is on the afternoon somebody opens the report — an error that is invisible and grows.
      `report_daily_series` gives a figure per day precisely so cost can be computed per day at
      the rate in force *that* day, and the report names every rate it used.

      **`source` is `not null check (btrim(source) <> '')`, and that constraint is the reason
      this is a table at all.** A rate typed in without saying where it came from becomes an
      unattributable figure in a document going to a university — the most quotable number in it
      and the least checkable. Save is disabled until it is filled and the hint says why.

      **No UPDATE, deliberately** — no policy, no grant, asserted by the schema test. A tariff row
      is a historical claim: "from this date the rate was this, and here is where that came from."
      Editing it in place rewrites what a past report was priced at with nothing to show it
      happened. Correcting a mistake is a delete and a re-insert, so both acts stay attributed.
      `set_by` comes from `auth.uid()` and cannot be forged; `set_by_email` is a snapshot beside
      it, because provenance is who it was *at the time* rather than a live join that would
      rewrite an old report's footnote when somebody's address changes.

      **`src/lib/energyCost.ts` refuses four ways**, and every one is a `null` rather than a zero:
      no rate configured at all; a day earlier than the earliest rate (back-applying it would be
      inventing history — the kilowatt-hours are real, what they cost is not known); a day whose
      rows carried no reading (unobserved, not free); and two rates in different currencies, which
      do not sum — better no total than a number that is four hundred of nothing. The cost also
      **inherits the energy's coverage qualifier verbatim**: if the kWh is a floor, so is the cost.

      **Three pre-existing guards caught real faults**, all of them about replication or about
      growth by accident:
      `test/site-naming.test.mjs` refused the tariff form's *placeholder*, which named this
      institution — a placeholder is shipped text, and it would have named the wrong university at
      every other deployment. It comes from `SITE.display_name` now. The same reasoning then
      applied to the form's `currency: 'PHP'` default, which no guard would have caught: the
      migration refuses to default the currency and says why, and pre-filling it in the form makes
      exactly that assumption one layer further out where no constraint can see it. It starts
      empty.
      `SettingsPage.test.tsx` pins the section list, so the sixth section had to be a deliberate
      addition rather than an accident — which is how the Devices toolbar reached 1123px.
      And the tabs test failed on an unmocked `getTariffs`: the Promise.all never resolved and
      every tab needing the series rendered nothing, which reads as four broken panels and was
      one missing mock. Second time that exact shape has appeared; the rule is in both files now.

      `docDefinition` gains the cost, the emissions and a provenance line per rate — under the
      figure rather than as a footnote at the back. The document test's "no currency anywhere"
      assertion is stronger than before rather than weaker: there is now a cost path to *not*
      take, and the default fixture has no tariff because that is the live state.

      **DEPLOYED to the Pi 2026-09-12**, serving `index-Tuu7wc6z.js`, boots clean. Deployed
      **ahead of the migration on purpose**, which is only safe because of the paragraph below.
      **`phase38` still needs applying**, and until it is, the Settings section and the report's
      cost line both say no rate has been entered rather than failing.

      A database that has not reached phase38 reads as "no rate entered". The frontend reads two
      tables the migration creates, and migrations here are pasted by hand — so between deploying
      a bundle and pasting the SQL, every read would reject, the page-level `Promise.all` would
      never resolve, and the Reports page would fail to load, reporting the wrong problem
      entirely. Postgres **42P01** (`undefined_table`) is treated as "not configured"; **only**
      that code, because a permission or network failure means something different and a page
      that swallowed one would be lying about why it has no figure. Not just for the deploy gap:
      RM-033 stands this up for another institution and `docs/replication.md` lists the migrations
      as a step somebody performs, so a site that has not reached phase38 should have a Reports
      page that works.

      **CI was red from this commit for six pushes, and it was not read back after any of them.**
      `CostCarbonLine.tsx` exported `provenanceLines`, a plain function, and re-exported `siteDate`
      beside its component; `react-refresh/only-export-components` rejects both. Lint is CI's
      first step, so from `33e3d9c` to `67ad4ba` **CI ran no build and no test suite at all** on
      either node version — every check behind lint was being run only on a workstation. Fixed
      2026-09-13: `provenanceLines` moved to `src/lib/energyCost.ts` beside the `Costed` and
      `Carboned` types it formats, with the three tests it never had — it is the PDF's only copy of
      the provenance footnote, the sentence a funder uses to trace a peso figure to its source. The
      `siteDate` re-export had no consumer anywhere and is deleted. Verified on every step CI runs:
      lint and build clean, 1,547 vitest, 1,030 bridge, 653 server, `server/data` left clean.


- [x] **RM-072r — phase38 read back, and the grant it never took away.** Applied 2026-09-12.
      Every constraint holds against the live project: a rate with a blank source is refused, a
      negative rate is refused, a rate above the sanity ceiling is refused, a currency that is not
      three letters is refused, an emission factor above 2.0 is refused, a second rate for the
      same start date is refused, and `anon` is refused on both tables. **phase38 must be
      re-applied** — see below.

      **The read-back found the hole, and my first two measurements of it were both unsound.**
      A service-role probe reported that an UPDATE succeeded, which proves nothing: the service
      role bypasses RLS by design. A second probe set `role authenticated` inside a `DO` block,
      where it does not change the role the statements run as — and the owner bypasses RLS that
      is not `FORCE`d, so three "successes" were the owner's. Only the third probe, with a real
      `set role` outside a function body, measured anything. Recording all three because the
      wrong two were each individually plausible.

      **What is actually true: a grant is additive, and nothing had ever taken Supabase's default
      away.** A real project runs `alter default privileges ... grant all on tables to anon,
      authenticated, service_role`, so `authenticated` held
      `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE` on the new tables. phase38 granted
      `select, insert, delete` and revoked only from `public, anon` — adding nothing that was not
      already there, and leaving the file's own "no UPDATE path" header as the only thing
      enforcing it. It revokes from `authenticated` too now.

      **`supabase/rehearse.sh` now reproduces Supabase's default privileges**, which is what makes
      any privilege assertion in it mean anything: a bare `create role` grants nothing, so until
      this line a migration that only granted looked correct in the container and left a privilege
      it never took away in production. The phase38 block asserts the exact privilege set against
      `information_schema`, and **the guard was verified by neutering it** — with the revoke
      removed the rehearsal fails and names the full privilege list.

- [x] **RM-074 — `authenticated` holds exactly what its policies permit.**
      `supabase/phase39_privilege_lockdown.sql` — **applied 2026-09-12, and read back.**

      **What the read-back measured**, rather than assumed. A signed-out probe of all 23 tables:
      every one now refuses `anon` with a privilege error. That is the measurement worth having,
      because it distinguishes the two states that look alike from the outside — a table with
      `grant all` and no `anon` policy returns an empty array, and a revoked one returns
      `permission denied`. Before phase39 all 23 answered `200 []`; after it, `42501`. Nothing in
      the app can reach that changed shape: `src/App.tsx:38` returns `<LoginPage />` unless the
      session is authenticated, so no Supabase read happens as `anon` at all.
      Service-role paths are unaffected, also measured: five services active, ingest writing with
      zero lag, `ingestion_health.last_error` null, no buffered rows, `commands` readable, and
      phase37's full read-back green including its three `anon` refusal probes.

      **What it does not prove.** Every check above runs as `service_role` or `anon`. The
      `authenticated` write paths — Devices config, Automation schedules, Settings — are the ones
      this migration narrows, and confirming them needs a signed-in click-through that no probe
      here can perform. The equality invariant is the argument that they are safe; a page load is
      the evidence.

      **What it fixes.** Every table in the schema granted `authenticated`
      `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` — not because anyone granted
      them, but because `alter default privileges … grant all on tables to anon, authenticated,
      service_role` is what a Supabase project does to every new table in `public`, and a grant is
      additive. Twenty-three tables, since phase4.

      **Why it has been invisible, and exactly where it was not.** Postgres needs both the table
      privilege *and* a matching row policy, so an UPDATE or DELETE no policy permits already
      affects nothing. **TRUNCATE is not filtered by row security at all.** Measured as a
      genuinely switched `authenticated` role: `truncate commands` emptied the audit trail — the
      table deliberately exempt from every retention pass so it cannot be lost. `REFERENCES` and
      `TRIGGER` are likewise outside RLS's reach.

      **The rule, and why it cannot break a working page.** `authenticated` gets exactly the
      commands its table has a POLICY for, transcribed from a live survey of `pg_policies` against
      `information_schema.role_table_grants` rather than from reading the migrations — the
      policies are what is actually in force. Every table has RLS enabled, verified rather than
      assumed, so a command without a policy was already refused and removing its grant changes no
      behaviour that works. The invariant is an *equality*, which is itself the safety proof:
      grants ⊇ policy commands means nothing a policy permits can be blocked by a missing grant.

      **Two grants are a judgement rather than a transcription**, and the schema test pins both.
      `commands` gets `select, insert, update` and **no DELETE** — the value of an audit trail is
      that the thing being audited cannot remove it. `acu_rules` gets `select, delete` and no
      INSERT or UPDATE, because phase36's `upsert_acu_rule` and `set_acu_rule_enabled` are
      `security definer` precisely so a rule cannot be written around their validation.
      `service_role` is untouched: it bypasses RLS by design, the daemons run as it, and narrowing
      it is a different question with a different blast radius.

      **The guard is a rule, not a list.** `supabase/rehearse.sh` asserts, for every RLS-enabled
      table in `public`, that `authenticated`'s privileges equal its policy commands — so a table
      added next year is covered without anyone remembering to add it. Verified by removing
      phase39 and re-running: it fails and names every drifted table with both sets. It is only
      meaningful because that script now reproduces Supabase's own default privileges; against a
      bare `create role` it would pass vacuously, which is how this survived three years of
      migrations and a schema test per phase.
- [x] **RM-075 — the backup exports what the schema holds, in an order it can page and restore.**
      **Done 2026-09-13.** `server/backup.mjs`, `server/backupCoverage.test.mjs`,
      `docs/backup-policy.md`. No migration and no daemon: `npm run backup` is run by hand.

      **Coverage had drifted, and the drift was real data.** The export was a hand-kept list of
      ten tables. It still named phase12's monthly tables a fortnight after the Reports page moved
      to phase27's period tables, and had never named `energy_tariffs` or `emission_factors` — the
      only copy of an operator-entered rate and the source it cites — nor `sites`,
      `socket_config`, `site_ui_prefs`, `space_nodes` or `acu_rules`. Measured live: the space
      tree's 4 nodes, the 14 socket configurations and the site's own row had never been in any
      backup. It now exports 19 tables, and `NOT_BACKED_UP` names the other four with a reason
      each.

      **Three rules, asked of the migrations rather than of the list.** Every table the migrations
      leave standing is backed up or excluded with a written reason, and nothing is listed that no
      migration still creates — so RM-042's drop will force the monthly tables off the list. Every
      table is paged by a key covering its whole primary key. Every table comes after every table it
      references, because the restore loads the files in list order. Written first and confirmed
      failing, each for its own reason; the ordering rule caught a foreign key the plan had missed,
      added to `device_config` by a later `alter table`. A parser self-check pins the rules to
      primary keys read off the SQL by hand, so a parser that found nothing cannot pass them.

      **The paging rule, stated exactly.** Pages are fetched by `Range` over `order=`, and several
      keys were not unique — `readings_hourly` by `hour` ties every device at every hour. Postgres
      documents that tied rows come back in no promised order across LIMIT/OFFSET queries. **It
      did not bite on a live export:** `anomalies`, 6,584 rows over seven pages ordered by `ts`
      alone, came out with no duplicate and no missing row. So this removes a reliance on ordering
      Postgres does not promise; it does not fix an observed loss.

      **Verified against the live project**, old export and new: each file checked against the
      database's own count at the export's high-water mark — all 19 tables, 0 duplicates,
      0 missing. PostgREST was confirmed to honour a URL-encoded multi-column `order` exactly as the
      export builds it, second key included.

      **Watch the first real retention pass, on or shortly after 2026-09-15 15:52 UTC** (retention
      asks every six hours). The building's oldest reading is 2026-08-16 15:52 UTC, so nothing has
      aged past the 30-day window yet: `readings_hourly` and `building_totals_hourly` are **empty**,
      and `roll_up_and_prune_readings` has only ever run on fixtures. That pass deletes raw rows for
      the first time, so a backup taken before it and copied off the Pi is worth more than one
      taken after.

- [x] **RM-073 (M)** — Correct `generate_period_report`'s `online_sample_count` to count usable
      observations rather than rows, and regenerate. **Decided by the operator 2026-09-17: restate, with
      a note in the report. `supabase/phase44_recorded_minutes.sql` was applied by the operator the same
      day and read back.** RM-085's planned ranges file becomes phase45.
      - **Read back live** (service role, GET only):
        - The six building rows match the preview below exactly: August 12,055 (was 21,421), weeks of 08-10
          0 (10), 08-17 1,640 (9,900), 08-24 8,975 (10,071), 08-31 10,025 (10,080), 09-07 10,074 (10,082).
          All share one `coverage_restated_at`.
        - 65 device rows restated. Most moved by a restart's few minutes; the branch meters moved more, e.g.
          August `mtr_co_yellow` 11,071 → 10,483.
        - Energy and `generated_at` unchanged on every building row. L.O Yellow's week of 09-07 is still
          4.617 kWh with 76.789 removed.
        - Legacy `monthly_building_reports` for August reads 12,055, so RM-042's comparison still holds.
        - Without a key, the building helper answers 401.
        - Signed in, August's heading reads "Mostly missing · 27%" with "Recorded share corrected on Sep 17,
          2026: this report said 48%, counting rows the meters sent with no reading in them."
      - **What it does.**
        - `report_recorded_minutes_building` and `report_recorded_minutes_devices` count a window's
          distinct minutes that hold a reading. A rolled-up hour counts at most 60.
        - Both generators store those counts, and `report_demand_summary` counts the same way. Undo the
          substitutions and each is phase42's or phase37's text, byte for byte.
        - Every stored report is recounted. A changed row keeps `online_sample_count_before` and
          `coverage_restated_at`.
        - The legacy monthly tables get the same counts, with no note, so RM-042's comparison still
          holds.
      - **Previewed read-only on the live project** (building rows):

        | Period | Stored | Recounted | Share |
        |---|---|---|---|
        | August 2026 | 21,421 | 12,055 of 44,640 | 48.0% → 27.0% |
        | week of 2026-08-10 | 10 | 0 of 10,080 | 0.1% → 0.0% |
        | week of 2026-08-17 | 9,900 | 1,640 of 10,080 | 98.2% → 16.3% |
        | week of 2026-08-24 | 10,071 | 8,975 of 10,080 | 99.9% → 89.0% |
        | week of 2026-08-31 | 10,080 | 10,025 of 10,080 | 100.0% → 99.5% |
        | week of 2026-09-07 | 10,082 | 10,074 of 10,080 | 100.0% → 99.9% |

        The page's Recorded tile already prints the recounted figures, 1,640 for the week of 2026-08-17,
        beside a heading badge of "Complete · 98%". After phase44 the two agree.
      - **The note.** `coverageRestatement` (`src/lib/supabaseReports.ts`) returns the note only when the
        whole percent a reader sees changed, so 100% → 99.9% says nothing. The Overview heading and the
        PDF's "Corrected figures" list print, for example: "Recorded share corrected on Sep 17, 2026: this
        report said 98%, counting rows the meters sent with no reading in them."
      - **Guards.**
        - `test/phase44-recorded-minutes-schema.test.mjs`: 10 tests. Neuter checks: a changed peak
          expression and a restatement that writes `generated_at` each fail.
        - `supabase/rehearse.sh`: a phase44 stage with a restart's duplicate minute, frozen rows, a
          61-sample hour and a raw hour overlapping its rollup. phase42's generators store 142 and 106; after
          phase44, 70 and 70, with the notes, energy untouched, a second paste changing nothing, and the
          summary giving the same 70. `== REHEARSAL PASSED ==` on the Pi's Docker.
        - `supabaseReports.test.ts`, `buildReport.test.ts` and `ReportsPage.test.tsx`.
      - **To apply and read back.** Paste the file into the SQL editor; its notice reports how many rows it
        restated. Then, read-only: `period_building_reports` for the week of 2026-08-17 reads 1,640 with
        9,900 before, and August 12,055 with 21,421 before. No energy or `generated_at` moves. The page
        heading shows the note for those two, not for 2026-09-07.
      *(The decision it was blocked on, as recorded before:)*
      RM-072g measured what it would change: August 2026's stored coverage moves 48.0% → 26.9%.
      Regenerating rewrites every stored coverage figure, including for months that have already
      been reported to the university, and some months will cross the 50% boundary that
      `isQuotable` uses to decide whether a total may be quoted without a caveat — so figures that
      are currently shown bare would acquire a "(partial month)" qualifier. That is the correct
      direction and it is still a change to published history. What it needs first: a decision on
      whether to restate, and if so a note in the report itself saying that coverage before a
      given date was computed differently. Do NOT do this quietly.


### How the Automation page READS — RM-071 (2026-09-10)

RM-066..069 fixed what the page could express. This fixed how it reads. Every rule was a flat run
of controls — `AcuRuleCard` alone had a text input, two selects, two number inputs, two time
inputs, a textarea, seven day chips and a switch in one row — and nothing said which of them was
the *condition* and which the *consequence*, which is the entire content of a rule.

- [x] **RM-071a** A stray double comma at `src/index.css:7913` (`.automation-write-btn,,`) had been
      disabling the whole 44px touch-target rule **app-wide**. A CSS selector list is
      all-or-nothing: one empty member and the browser discards the entire rule, silently.
      Verified in a real parser, and measured on a coarse pointer — "Save changes" was 36px.
      Eleven of the twelve listed controls had no other floor, including
      `.confirm-modal__cancel`/`__confirm`, the dialog that gates arming unattended load shedding
      from the kiosk's own touchscreen. `.nav-icon-btn` is the exception and is recorded as such:
      its `::after` expander kept a real 44px tap target throughout, so a
      `getBoundingClientRect()` sweep reports it as a failure and is wrong to.
      Evidence: `test/css-touch-targets.test.mjs` (4, proven by neutering — its first draft had a
      hole in exactly the place the bug lived and passed on the reintroduced defect).
- [x] **RM-071b** `src/components/automation/RuleBlock.tsx` — the IF/THEN frame. Two zones in a
      common region, separated by proximity, background and a rail coloured by trigger type
      (clock / sensor / demand). **Colour is the fourth cue, not the first**: each zone carries
      the word WHEN or THEN, the trigger carries an icon, and the trigger type is announced to
      screen readers, so nothing depends on telling amber from blue on a page that switches
      relays. Now used by schedules, aircon rules and DSM thresholds.
- [x] **RM-071c** Progressive disclosure where it was actually warranted, and NOT where it was
      not. The Overview's 24-hour audit log is collapsed — height is the scarcest thing on the
      800×480 kiosk. But collapsing it would have hidden a *failed* command, so the card reports
      `{count, failed}` up and a closed disclosure reads "12 commands, 1 failed". **No disclosure
      on `AcuRuleCard`** despite the plan expecting one: only the step interval is an advanced
      field, and a `<details>` around a single input is more chrome than the thing it hides.
      **None on `DsmThresholdsCard`**: the brief assumed raw JSON and calibration coefficients
      there; it has two number inputs and a toggle, verified by reading all 234 lines.
- [x] **RM-071d** `acuWindowConflicts()` in `src/lib/scheduleStack.ts` — the one cross-domain
      check on this page that is actually computable. A schedule switching the aircon **off**
      inside an armed ACU rule's window leaves the loop holding on `acu_off`, doing nothing, while
      still reading as armed. Both sides share the 7-char Mon..Sun encoding, so the overlap is a
      bitwise question. **A DSM cross-check was asked for and deliberately not built**: a
      threshold is a power limit and a schedule is a time, and whether a rule trips one depends on
      what else is drawing — a warning there would cry wolf on correct configurations.
      *Dormant today*: `acu_main` has no schedule rows, because the operator deleted its one rule.
      Evidence: `ScheduleStackCard.test.tsx` (16, four of them negative cases).
- [x] **RM-071e** Responsive pass. The `@media (max-width: 720px)` block at `index.css:5739` was
      **empty**, under a comment describing a table layout that no longer existed and quoting a
      341px overflow measured against it. Measured overflow at 375px today: **0px**. The comment
      outlived its markup, which is worse than no comment. Replaced with what is actually needed:
      zones go full width, the coming-soon column moves below the rules, the identity row wraps.
      Verified 0px overflow at 375, 800×480 and 1440.
- [x] **RM-071f** `.automation-dsm-field__head` used `justify-content: space-between` with no gap
      and no wrap. Latent for as long as that card was full-width — the caption and status pill
      only *looked* separated because there was spare room. Inside a zone they ran together as
      "MAX PHASE CURRENT (A)NO LIMIT SET". space-between is a distribution, not a minimum.
- [x] **RM-071g** `ScheduleStackCard` had **no component test at all** — part of how this page
      once shipped claiming it was not dispatchable while the daemon fired its rows at real
      relays. It has 16 now.
- [x] **RM-071h** Spacing, headings and the rest of the touch floor, from a heuristic pass the
      operator asked for after spotting the first one by eye.
      **"Unsaved changes" had no CSS rule at all** — `.automation-pending-card` was a modifier
      that styled nothing — so it sat flush against the tab panel with a measured **0px** gap and
      two card borders touching, which reads as an overlap. It is the only block on the page that
      lost its spacing, because `AutomationPage` returns a fragment: every sibling carries its own
      trailing margin (header 20px, tab strip 16px) and `.tabs__panel` carries none, a tab panel
      normally being the last thing on a page. Now 20px, matching the page's own major-boundary
      value rather than the tighter 16px that binds the tabs to their panel.
      **The heading outline skipped a level and had an outlier.** `Card`'s contract is page h1 →
      section h2 → card h3, and this page had no h2 at all; meanwhile `LoadShedPanel` hand-wrote
      an `h2` that read to a screen reader as the PARENT of the cards either side of it, which is
      false — they are siblings. Each tab panel now carries an `sr-only` h2 (the tab strip already
      says it visually; the heading is for the outline, which is how many screen-reader users
      navigate). Zero skips on all four tabs.
      **Four more controls were under the 44px floor**, found by measuring rather than assuming:
      `.schedule-rule__delete` at **30×30** — a destructive control on a touchscreen — plus the
      "Add schedule" CTA at 37px, the ACU number inputs (only `select` had been covered), and the
      shed panel's 18px `<summary>`. That last one takes padding rather than `min-height`, because
      a `<summary>` is `display: list-item` and a min-height would strand the disclosure triangle
      at the top of a 44px box. All four tabs now measure clear; desktop chrome is unchanged.
      **Two pieces of drift cleaned:** a comment in the touch block describing the per-row "clear
      schedule" control, deleted with `ScheduleRow.tsx` in the RM-066 merge; and a redundant
      `:focus-visible` override RM-071 itself had added, duplicating the global rule that the Tabs
      section a few hundred lines up explicitly warns against overriding locally.
      *Not a finding, recorded so it is not re-raised:* a sweep using `el.focus()` reports ~30
      controls with no focus ring. That is a measurement artifact — programmatic focus does not
      match `:focus-visible`. The global rule at `index.css:470` covers everything.
- [x] **RM-071i** Page shape and click affordance, from the operator's own review.
      **The "This page switches real hardware" card is gone.** It restated what the page header
      already says in `dispatchConsequence`, and the detail it added — the audited path, the
      dry-run distinction — is in the header's InfoHint a few pixels away. Nothing was lost; the
      claim still appears, colour-coded by state, in the one place it cannot be scrolled past.
      Its CSS went with it rather than being left to rot.
      **The "Overview" tab is "Summary".** "Overview" is the name of a different PAGE in the top
      nav, so the tab named the wrong thing twice while saying nothing about what set it apart
      from three tabs named by their trigger. The route id moved too, which is safe:
      `useHashSubRoute` falls back to the default for a sub it does not recognise, and this IS
      the default — an old `#automation/overview` link lands on exactly the same tab.
      **The tab strip moved into the page header, beside Save changes**, which is where every
      other page keeps its controls — Devices its filters and Add, Analytics its scope toggles,
      Control its master buttons. Automation was the one page with its primary controls in a
      different place. Two overrides carry it: `margin-bottom: 0` (that 16px belonged to its old
      life as a full-width strip) and `min-width: 0`, without which four tabs set a floor on the
      header width and `.page-header__actions` gets CLIPPED rather than scrolled — the exact
      failure that rule documents at length. Below 720px the strip scrolls its own tabs behind
      the same edge-fade mask the top nav already uses, so a cut-off tab reads as trailing off
      rather than as clipped.
      **Every clickable thing now looks clickable.** Measured, not eyeballed: all 21 shed-tier
      `<select>`s and the aircon selects rendered `cursor: default`, so the most-repeated control
      on the State-Driven tab gave no pointer signal at all. The page's primary CTA
      (`.schedule-stack__add`) had **no hover state**, and neither did `.quick-toggle` — the
      switch that arms a rule against real relays, a 44×24 track with no border and no label,
      where the cursor was the only thing saying it was live.
      *A first draft of that hover shipped nothing:* `--accent-hi` measured **1.38:1** against the
      button's own fill in light theme — it is the bright decorative amber and it vanishes on a
      light accent surface. `--accent-text` is the variant meant for these surfaces: 4.49 light,
      7.31 dark.
- [x] **RM-071j** The tab strip sat **8px above** the save button's centre in a row that is
      `align-items: center`. The override RM-071i wrote — `.automation-tabs { margin-bottom: 0 }` —
      **never applied**: it ties `.tabs` on specificity and loses on source order (4413 vs 4739),
      so the 16px survived, inflated the strip's flex box to 61px, and that box set the row height
      while the write group centred inside it. A rule that reads as correct and computes as absent.
      `.page-header__actions .tabs` is (0,2,0), order-independent, and states the real condition.
      *Heights are not a defect and were checked, not assumed:* Devices 33, Analytics 35, Control
      39, Automation's tab buttons 35 and save 36. The strip's 44px outer box is `.tabs`'s own 4px
      padding — the same shape Analytics' scope group has (42 box, 35 buttons).
- [x] **RM-071k** Adding a schedule while a blank one was still in the list surfaced
      `duplicate key value violates unique constraint "schedules_dedupe_uidx"` and left it on
      screen until the next *successful* add. Three separate faults in one flow.
      **Prevented, not explained.** `phase33`'s dedupe index keys on
      `(device_id, coalesce(socket,0), on, off, days)`, so a second blank rule is an exact
      duplicate of the first and the insert is refused *every time*. The Add button now waits with
      a reason instead of firing a write that cannot succeed.
      **Translated at the boundary.** `explainWriteError()` in `src/lib/supabaseSchedules.ts` turns
      the constraint violation into a sentence naming what to do, with different wording for an
      add (go and finish the blank rule) than for an edit (there is no blank rule — change a
      time). Anything unrecognised passes through verbatim rather than being flattened into
      "something went wrong": an unfamiliar message the reader can search beats a friendly one
      that hides the only useful string.
      **Dismissable.** The message has a ✕, so a reader who has understood it can clear it instead
      of living with a stale failure. Its 22px hit area joins the pseudo-element expander group —
      it is a symbol inline in a text run, which is exactly what that group exists for.
      Evidence: `supabaseSchedules.test.ts` (5), `ScheduleStackCard.test.tsx` (22, six new).
- [x] **RM-071l** The Automation sub-line matches every other page now. It was a bold amber
      `<strong>`; `.page-sub` is 12.5px/400/`--muted-2` on Overview, Devices and the rest, and
      Automation was the only page that differed. RM-062's actual requirement is unchanged — the
      sentence is still ON THE PAGE and not behind the ⓘ — and the colour was redundant with the
      words: the three states have three different sentences ("switch real hardware", "do not
      reach any hardware", "has not been confirmed yet"), so nothing was ever carried by colour
      alone and `color-not-only` is satisfied by the text. Measured identical to Overview's
      sub-line: 12.5px, weight 400, `rgb(139,147,160)`.

**Tailwind was asked for and deliberately not used.** It is imported at `index.css:1` and has
**zero** utility classes across all 86 styled components; `test/design-tokens.test.mjs` and
`test/contrast.test.mjs` enforce the token palette. Matching the other pages *requires* the
existing system, and new colours outside it would bypass the contrast guard.

**Toasts were asked for and deliberately not built.** This codebase rejects them twice in writing
(`index.css:7464`, `:7767` — "a failed write says why, next to the control that failed"), there is
no toast system, and this is an unattended 24/7 kiosk where an auto-dismissing message is seen by
nobody.

Contrast measured in a browser on a **reloaded** page, composited over alpha, in both themes:
light — zone label 4.93, log summary 12.92, count 5.40; dark — zone label 5.79, shed title 11.95,
shed sub 4.72; rails 8.16 and 5.56 against the 3:1 non-text floor.

### What the Automation page can express — RM-066 to RM-069 (migrations applied 2026-09-09)

Organised by WHAT MAKES A RULE FIRE, which is the distinction an operator reasons about and the
one the trade already names: Time-Driven (the clock), State-Driven (a measured quantity),
Event-Driven (a sensor reading). Grouping by device was the alternative and it is worse — "why
did the lights go off?" is answered by the trigger, not by the thing that was switched. A
strategy with no field devices gets a card inside its own category naming what it is blocked on,
because several are blocked on a purchase order rather than on code and the person reading the
page is the one who can raise it.

- [x] **RM-066** Schedules become a stackable, per-socket list. `supabase/phase33_schedules_stackable.sql`
      drops `unique (device_id)` — `id` is the only identity now, so `upsert()` leaves the table
      entirely and writes are insert / update-by-id / delete-by-id. A DELETE policy is added
      (`schedules` had none, because clearing one row used to be a write of nulls). The migration
      splits every whole-outlet row into one row per socket inside a single atomic `DO` block:
      a half-applied split would leave a parent AND its two children, which at the next matching
      minute is four dispatches to two relays.
      **The fan-out moved into `server/schedulePlan.mjs`'s new `resolveDue`**, because the ORDER
      matters and a caller must not be able to get it wrong: match → fan out → collapse per
      `(device_id, socket)`, with `off` winning any collision across rows as it already did within
      one. Collapsing first cannot merge a legacy `socket: null` row with its two siblings — they
      are three genuinely different keys — and the daemon's old `flatMap(fanOutCommand)` then
      expanded one of them into four commands. Two regression tests pin that, at plan and daemon
      level. `unfireableRows` counts armed rules that can never fire and the daemon logs it: with
      one row per device an unattributed schedule was a whole device going quiet and somebody
      noticed; in a stack of five it is one rule, and nobody does.
      Evidence: `server/resolveDue.test.mjs` (30), `server/scheduler.test.mjs`,
      `src/lib/scheduleStack.test.ts` (34), `src/components/automation/AutomationPage.test.tsx`.
      **Deleted with it:** `src/components/automation/ScheduleRow.tsx` and the schedule half of
      `src/lib/supabaseConfig.ts` (`scheduleRowsToContext`, `scheduleRowsFor`, `scheduleKey`).
      They were orphaned the moment the stack editor replaced the flat table — no production
      caller, only their own tests — and leaving them beside a roadmap entry claiming the page
      was rebuilt would have been the kind of drift §4 exists to catch. `supabaseConfig.ts` now
      carries only the DSM singleton, which is genuinely one row of settings and for which the
      flat context map is still the right shape.

- [x] **RM-067** Load-shed tiers become per socket. `supabase/phase34_socket_config.sql` adds
      `socket_config`, PK `(device_id, socket)` — a sibling table rather than a `sockets jsonb`
      column on `device_config`, because `supabaseDeviceConfig.ts` builds WHOLE-ROW upserts and a
      jsonb column there would be erased by an unrelated notes edit, invisibly, surfacing only the
      next time the building went over its limit. `device_config.load_shed_group` stays as the
      fallback, so a site without the migration behaves exactly as before; `resolveShedTier` in
      `src/lib/deviceConfig.ts` is the single place that precedence is decided.
      `planShed` now enumerates targets per socket and reads `socket_states` rather than the
      derived device `state` — an outlet with one socket on and one off sheds ONE relay, not two —
      so `scheduler.mjs`'s `fanOutCommand` on the shed path is gone rather than merely redundant.
      The panel's tallies changed in the same commit and now count SHED POINTS: a panel saying
      "3 devices" while the shedder sheds 5 sockets is exactly the believed-but-wrong UI
      `shedTiers.ts` refuses to ship.

- [x] **RM-068** `acu_min_setpoint_c` becomes `acu_min_room_target_c`, and its meaning changes with
      its name. It was a bound on the setpoint COMMANDED to the aircon; `validateCommand` refused
      anything below it. That is untenable once the setpoint is the LEVER a closed loop moves — a
      loop that may never ask for 22 cannot hold a room at 24 on a hot afternoon, and a person who
      needs 18 for an hour had no way to ask. It now means the coldest ROOM temperature an
      automatic rule may aim for. `ACU_MIN_C`/`ACU_MAX_C` (16..30) remain the only hard bound on a
      command, because below them there is no IR code to send at all.
      A manual setpoint below the policy is **warned about and recorded**, not refused: the warning
      rides on the command and `server/proxy.mjs` folds it into the audit note, so the fact
      survives instead of the command being prevented. `supabase/phase35_policy_room_target.sql`
      does the rename as expand-and-contract — copy the key, redefine the old writer to delegate
      (its return type is reproduced exactly, because `create or replace` cannot change one), and
      leave the contraction to a later file. `shared/sitePolicy.mjs` reads new-then-old, so at no
      point is neither key readable.

- [x] **RM-069** Closed-loop aircon control. An operator sets a ROOM target and names a sensor; the
      controller steps the aircon's setpoint 1 °C at a time toward it, rate-limited, inside an
      active window. `supabase/phase36_acu_rules.sql` adds `acu_rules`, `acu_loop_state` and
      `commands.target_c` — without that last column a row recording a setpoint change did not say
      which setpoint, since `target` resolves to the literal `AC_POWER`.
      **The safety posture, which is the aircon equivalent of "auto-shed sheds, it never restores":
      the loop may change how cold a running aircon is asked to be; it may never change whether the
      building is being cooled.** No branch emits an `off`, none acts unless the unit reports on,
      and losing the loop leaves the unit running at its last setpoint.
      `acu_loop_state` is a TABLE and not a variable for one specific reason: the unit restarts on
      failure every 10 s, and an in-memory last-step time would let a crash loop walk the setpoint
      from 30 to 16 in under three minutes.
      **Not verified against hardware and cannot be** — see §0. `holds` is output rather than
      diagnostics: every idle rule renders a sentence saying why, because on this site the only
      branch reached is `acu_offline` and "configured and nothing is happening" must not be
      indistinguishable from a bug.
      Evidence: `server/acuLoopPlan.test.mjs` (41, including two closed-loop simulations),
      `server/scheduler.test.mjs`, `test/acu-vocabulary.test.mjs`,
      `src/components/automation/EventDrivenPanel.test.tsx`.

- [x] **The Automation page had zero component coverage** before this, which is part of how the
      false dispatch claim survived so long. It now has `AutomationPage.test.tsx` and
      `EventDrivenPanel.test.tsx`, and the reach assertions are the ones that matter: a
      not-yet-loaded capabilities response counts as CLOSED, never as open.

- [x] **A reusable `Tabs`** (`src/components/ui/Tabs.tsx`) — the app's first real tablist. The two
      that predate it make `role="tab"`'s promise about the keyboard and keep none of it: no arrow
      keys, and every tab its own Tab stop. `DeviceCard`'s channel switcher is a candidate to
      replace with it. Tabs are deep-linkable (`#automation/time`) through `useHashSubRoute`, which
      writes with `replaceState` — four arrow presses must not cost four back presses.

- [x] **One implementation of the week, not two.** `parseDays`/`appDayIndex` lived in
      `automationMath.ts` AND `server/schedulePlan.mjs`, each with a comment claiming it mirrored
      the other. They are now `shared/scheduleDays.mjs`. Likewise `shared/scheduleRules.mjs` (why a
      rule can never fire) and `shared/acuLoopVocabulary.mjs` (why the loop is idle) are shared
      rather than mirrored — `shedTiers.ts`/`shedPlan.mjs` remains the older mirror-and-test
      pattern, and this is the cheaper one where `shared/` can hold the rule.

### Customisable floor plans — RM-035 to RM-037

Design agreed 2026-09-01 and written up in **`docs/floor-plan-design.md`**, which carries the
reasoning; these entries carry the state.

**Why now.** The tree finally has rows — `NBERIC → First → Left → CARE Office` — and **nothing is
in it**: 0 of 20 devices assigned to a space, none with plan coordinates. RM-030's by-space totals
and RM-031's data-drawn plan both have their schema and no data. The placement step has not been
taken because the result is not yet worth having: the frame is a fixed square, and the lighting
layout comes from `carePlan.ts`, a pack surveyed in one room that would draw a second site's
devices at this site's positions and look entirely correct doing it (the reason RM-032 refused to
fall back to it).

- [x] **RM-035 (S)** **DONE 2026-09-01, migration applied and verified live.** The plan and 3D
      cards are removable, per site. A new
      `site_ui_prefs` table — the operator-writable sibling of read-only `sites`, exactly as
      `device_config` is to `devices`. **Not a column on `sites`:** that row is deliberately
      read-only from the browser (`phase19_sites.sql` says so outright) and also carries
      `policy.acu_min_setpoint_c`, the university's energy floor that `validateCommand` enforces
      server-side. RLS is row-level, so granting UPDATE for a display preference would grant it
      for the aircon policy too.
      Defaults are `true`, so the migration changes nothing on screen until somebody asks it to.
      **The property to hold:** hiding a card never hides a control — the lighting and outlet
      lists keep dispatching. Losing a diagram is cosmetic; losing a relay is not. Pinned by test
      and **neutered to prove it fires**: moving the switches list inside the hidden block — the
      exact refactor that would break it — failed the guard.
      *Verified live:* the migration was rehearsed against PostgreSQL 16 alongside every other
      file, then applied **twice** in a throwaway container because it claims re-run safety and
      phase21 is this project's scar from claiming that falsely — second apply clean, three
      policies (SELECT/INSERT/UPDATE, no DELETE), zero rows seeded. On the live project the table
      reads `200 []` to the service role and **42501 to anon for both read and write** — a
      privilege error rather than an empty RLS result, so `anon` cannot reach the table at all and
      RLS sits behind that. *Not yet exercised:* an operator actually flipping a toggle, which
      needs a signed-in session — `src/lib/siteUi.ts`, `src/components/devices/PageCardsPanel.tsx`,
      `supabase/phase24_site_ui_prefs.sql`
- [x] **RM-036 (M)** **DONE 2026-09-01.** A room gets its real outline. `space_nodes.attrs.plan` holds a shape
      *descriptor* (rect / L / T / U / triangle / circle / cells), not a baked path — a path is
      un-editable and reopening the editor could only offer "start again". One pure
      `shapeToPath` renders every kind; "eject to grid" rasterises any preset into a nudgeable
      cols×rows bitmap. No migration: `attrs` exists for exactly this.
- [x] **RM-037 (M)** **DONE 2026-09-01, migration applied and verified live, deployed.**
      **Lighting layout becomes data, and the last hard-coded geometry can go.**
      `device_config.plan_fixtures` holds a switch's lamps as normalised points — **not grid cell
      indices**, because an index is meaningless without the grid that made it, so a 4×3 → 5×3
      resize would silently relocate every luminaire in the building when nothing had moved. The
      grid is an input method, not a storage format. The test that proves it (`SpacePlanView.test.tsx`,
      "resizes the grid without moving a single lamp") was neutered to confirm it bites: rendering
      a lamp from its array index as a cell index fails it.

      *Shipped:* `src/lib/lightingGrid.ts` (pure — `gridCells`, `cellOf`, `toggleFixture`,
      `parseFixtures`, `circuitColors`; `MAX_FIXTURES = 200` as a stop on a stuck pointer, not a
      design limit), `src/lib/controlPlanData.ts` (pure — `drawnRooms`, `dataPlanFor`),
      `src/components/spatial/LightingGridEditor.tsx`, the ceiling grid and lamp layer in
      `SpacePlanView.tsx`, `deviceConfigStore.toggleFixtureAt` (saves immediately, same reasoning
      as `placeOnPlan`), `src/components/control/PlanRoomPicker.tsx` and
      `plans/DataPlanShell.tsx`. Colour is an aid and never the label — every circuit is named as
      well as coloured, and `circuitColors` sorts so a circuit keeps its colour whatever order a
      fetch returns.

      *`useControlPlan` now prefers data*, keeps the pack as a fallback, then the existing honest
      "no plan is drawn for this site". A plan built from data is drawn in NORMALISED space
      (`.control-outlet-plan--data`, `aspect-ratio: 1`), never in the CARE office's surveyed
      320:550 — inheriting that would assert a measurement nobody took for the room being drawn.
      The preference test was vacuous when first written (the pack's dynamic import had not
      resolved, so reversing the preference broke nothing); it now waits for the pack to load
      first, and the control test that makes it non-vacuous is kept beside it and says so.

      *A device outside the drawn outline warns and is never blocked* — the outline is the
      operator's sketch, so refusing a placement would make a hand-drawn wall authoritative over
      the building.

      *Migration verified live before deploying, in that order and for a reason.*
      `readDeviceConfigs` names every column in one `select`, so against a database without
      `plan_fixtures` PostgREST fails the WHOLE query (42703) rather than omitting the column —
      and that query carries rooms, categories, shed groups and plan positions. Deploying first
      would not have degraded the plan; it would have taken the device-config layer down.
      Verified from the Pi against the live project: the column is selectable, and so is the
      frontend's exact select list — 14 rows, HTTP 200, `plan_fixtures` present on every row and
      null on all of them. Then `git pull` + `npm run build` on the Pi, 979 tests green there,
      and the served bundle confirmed to carry the new strings.

      *Two things this was NOT able to check.* `supabase/rehearse.sh` needs Docker, which is not
      installed on the workstation, so the file was never rehearsed against a throwaway database.
      And `device_config_plan_fixtures_is_array` is unconfirmed: a check constraint is not
      evaluated when a statement matches zero rows, so the read-only probe (a PATCH filtered to a
      non-existent id) returned 204 either way. Confirming it needs one query in the SQL editor:
      `select conname from pg_constraint where conrelid = 'device_config'::regclass;`. The column,
      not the constraint, is what gated the deploy, and `parseFixtures` already tolerates junk.

      **NOTHING IS DRAWN YET.** Measured on the live database the same day: 0 of 14 rows have a
      `space_node_id`, 0 have a position, 0 have lamps. So the Control page still renders the
      hand-surveyed pack — correctly, that is the documented fallback — and the floor plan lists
      every device under "Not placed". RM-035/036/037 built the machinery; drawing this office is
      an operator action and is what unblocks the `carePlan.ts` deletion below.

      Deleting `carePlan.ts` remains a **follow-up**, once this office's room is actually drawn —
      doing it in the same change would leave the CARE office with no plan between the deploy and
      the moment somebody draws one. That deletion closes the last half of FI-016.

### Settings, policy and layout — RM-038 to RM-040

- [x] **RM-038 (M)** **DONE 2026-09-01, migration applied and verified live, deployed.**
      **The aircon floor stops being a build constant.** `policy.acu_min_setpoint_c` is the coldest
      setpoint the building permits and it comes from the university's energy-efficiency policy —
      a rule that changes. It was compiled into both the browser bundle and the proxy from
      `shared/sites/<id>/site.mjs`, so revising an administrative decision meant editing source,
      rebuilding and redeploying: a code change standing in for a signature.

      *Corrected to 24 °C*, which the operator states is the actual university policy; the site
      file had 25.

      *Why a `security definer` function and not an UPDATE policy.* phase19 grants `sites` SELECT
      and deliberately no UPDATE, because the same `policy` jsonb also carries `dispatch` — which
      decides whether commands may leave the building for a vendor cloud. Postgres RLS is
      row-level, not key-level, so a policy narrow enough to permit the setpoint and refuse the
      dispatch mode cannot be written. `set_acu_min_setpoint` touches one key; the rehearsal
      asserts `dispatch` survives, and that assertion was checked by making the function clobber
      the whole object, which fails it.

      *The fallback runs build-ward, and that direction is the point.* `server/livePolicy.mjs`
      caches the row and, on any read failure, keeps the last good value or the build value —
      never none. A floor that vanished during an outage would let through exactly the commands
      it exists to refuse, silently. Twelve tests cover it; neutering the merge fails six.
      `/api/capabilities` now reports both the floor in force and whether it came from the
      database or the build, so `PolicySection` can say when it is showing a rule that is not
      currently being enforced.

      *The setpoint selector is reactive.* `IrCommandCenterCard` built its options once at module
      scope from `SITE.policy`; it now derives them from the live floor, and a chosen degree that
      the floor has since excluded resolves to the nearest permitted one during render rather
      than in an effect.

      `validateCommand` is still the enforcement, and the hardware bound (`ACU_MIN_C` = 16,
      `ACU_MAX_C` = 30) is still applied after the policy floor, so nothing written here can widen
      the range beyond what the IR library has codes for.

      *Verified live 2026-09-01.* The migration is applied; the function refuses 12 and 31, raises
      on an unknown site id, and the floor is set to 24. `livePolicy` was proven against the real
      project **non-vacuously**: the site file also says 24, so reading back 24 would have proved
      nothing — the database was set to 26, the module read 26 rather than the build's 24 and
      reported `source: 'database'`, and it was set back. Deployed and the proxy restarted.
      One check that could NOT be made non-vacuous here: "every other policy key is untouched"
      passed against a live policy that has only the one key. The rehearsal proves it properly,
      with `dispatch` seeded first.

      *Rehearsed:* `supabase/rehearse.sh` on the Pi, PostgreSQL 16, all migrations in order plus
      seven new assertions for the function — valid write, key isolation, NULL removing the key,
      both out-of-range refusals, and an unknown site raising rather than updating nothing.

- [x] **RM-039 (S)** **DONE 2026-09-01.** The account menu hard-coded `FileText` for every entry,
      so Reports and Settings drew the same glyph and the icon column carried no information. The
      icon moved onto the nav item, so a new entry cannot inherit somebody else's. The test
      compares rendered SVGs and was checked by putting the bug back.

- [x] **RM-040 (S)** **DONE 2026-09-01.** The Automation page was 494px ragged at 1920px —
      measured, not eyeballed: left column 1064px against right 1558px. One card caused it, the
      load-shed table at 1104px, which landed in that column when it moved off the Devices
      toolbar. The per-device rows are a lookup, so they sit behind a capped scroll with a pinned
      header; the tier counts stay whole. Imbalance is now 119px. The tier tally also laid out
      four-then-one, and the orphan was "Not classified" — not a fifth tier but the absence of
      one, now stated as such on its own line.

      **The Deployment settings section was deleted** in the same change, as asked. What it
      uniquely showed: site id and timezone (both in the header chip) and the aircon floor (which
      RM-038 gave a better home). *No longer displayed anywhere:* "commands reach hardware" and
      "classes that dispatch". Worth knowing before somebody goes looking for them.

- [x] **RM-041 (M)** **CODE DONE 2026-09-01 — `supabase/phase27_period_reports.sql` NOT YET APPLIED.**
      **Reports gain a week.** The operator asked for weekly alongside monthly: a month is what
      gets reported upward, a week is how somebody notices that something changed.

      *Not a second copy of phase12.* The obvious move — `weekly_reports` plus a twin generator —
      is 140 lines of duplicated seam handling, and the seam is the subtle part (the aggregation
      reads the hourly rollup UNION the not-yet-rolled-up raw rows, excluding raw hours the rollup
      already covers). Two copies drift, and the drift is silent because the numbers stay
      plausible. Reading phase12's function, the only month-specific things in it are the
      truncation, the interval and the target tables — so `generate_period_report(period, start,
      tz)` keeps the shape and parameterises the window, writing period-agnostic tables keyed
      `(period, period_start, …)`.

      **phase12 is left entirely alone.** Its tables, function and grants all stay: they are what
      the deployment runs today, and rewriting a working aggregation nobody asked to change, on a
      live building, to gain a feature that does not need it, is not a trade worth making. The
      migration backfills every existing month through the new function, and the rehearsal
      asserts the two agree **row for row and column for column** — checked by perturbing the new
      function's peak, which fails it. The daemon keeps calling phase12's function alongside the
      new one so the comparison stays possible.

      *The one place a week is genuinely different, not just differently windowed:* building
      energy. A month uses the bridge's own month counter, exactly as phase12 does. A week cannot
      — over a week that counter reads as the month-to-date total, which presented as "energy this
      week" would be wrong by however much the month had already accumulated and would look
      entirely plausible. A week sums DAILY maxima instead, the same technique phase12 uses per
      device, which is also independent of whatever day the meter's own week counter rolls over
      on. The rehearsal asserts the two figures differ, checked by making the week use the month
      counter, which fails it.

      *Frontend:* a Monthly/Weekly switch on Reports; the period list, summary, per-device table
      and CSV all follow it. Both the list and the per-device rows are tagged with the period they
      were fetched for, because **2026-06-01 is both a month start and a Monday** — untagged, one
      renders under the other's heading. That guard was vacuous when first written (the fixture
      resolved instantly, so there was no stale window) and now holds the list fetch open to
      create one.

      *Daemon:* `weeksNeedingReport` mirrors `monthsNeedingReport`, grace period and
      rebuild-once rule included, capped at 12 a pass because weeks accrue ~4.3x faster than
      months. It asks `period_building_reports`, not phase12's table, because that is what the
      page reads — a month "done" in the old table and absent from the new one is a month the
      page shows nothing for.

      *Applied 2026-09-01, and verifying it against production found a real defect before it was
      ever seen on a screen.* The tables answer the page's exact queries and the constraint
      refuses an unknown period. Two checks could NOT be exercised: this deployment's data starts
      2026-08-16, so **no month has settled and phase12's tables are empty** — the backfill had
      nothing to do and the equivalence check is proven only on the rehearsal's fixtures. The
      anti-vacuity assertions beside it are what said so rather than letting it read as a pass.

      **THE DEFECT.** A real week generated fine — 34.219 kWh for the week of 2026-08-17 — and the
      number was wrong. Summing the daily counter's maxima double-counts a frozen meter:
      `building_totals` has no `online` column, so unlike the per-device path there is nothing to
      filter stale samples out with, and 18 August's counters were byte-identical to 17 August's.
      The month counter had advanced ~19.5 over that week; a week cannot exceed the month-to-date
      containing it. A week now sums INCREMENTS of the monotonic month counter, which a frozen day
      advances by nothing. The rehearsal seeds a genuinely frozen day and asserts 14 rather than
      24; reverting to daily maxima yields 34 and fails it.

      One approximation stated rather than hidden: when the day before a period has no data at
      all, that period's first observed day contributes its whole counter, because the baseline is
      unknown. It over-counts only across a gap, and the coverage band already marks such a period
      as incomplete.

      **STILL TO DO:** **re-apply `supabase/phase27_period_reports.sql`** — it is
      `create or replace`, so re-running is safe, and the copy in production still has the wrong
      week expression. Then the week of 2026-08-17 needs regenerating: it already has a report
      dated after it settled, so `weeksNeedingReport` will never rebuild it on its own. Deploy the
      frontend after that, not before.

      *Rehearsed:* `supabase/rehearse.sh` on the Pi against PostgreSQL 16, with fourteen new
      assertions — phase12 equivalence both ways, the backfill actually running, week truncation
      to Monday, a week and a month coexisting on one start date, upsert on regeneration, the
      derived 10080-minute expectation, an unknown period refused by both the function and the
      check constraint, and the building-energy distinction above.

- [x] **RM-047 (M) — FIXED 2026-09-07, option 1.** **Outlet daily energy was fabricated on every
      poll, on all seven.** The evidence is in §0. The parser now integrates power over elapsed
      time and does not accumulate `add_ele` at all.

      **The assumption was measured before it was relied on.** For the four CT meters both
      figures exist for the same day, so integrating their stored `power_w` can be checked
      against their own `today_acc_energy`: **0.0–1.1% across 2026-08-30 to 09-02** on every
      meter, and 3.1–3.7% on 09-03, the fleet-outage day where gaps are expected. About 1%
      against a real counter, replacing +3,200%.

      **Two refinements the old code did not have.** The interval is now a trapezoid over both
      endpoints rather than the arriving wattage applied backwards over the whole preceding
      minute — free, and it halves the error on any load that changed during the interval. And a
      gap longer than `MAX_INTEGRATION_GAP_MS` (5 min) is **skipped rather than clamped**: that is
      integration's one documented weakness — *"a disconnected meter's last wattage compounds into
      the total for as long as it stays down"* — and we do not know what the socket did while it
      was gone, so inventing it would be the same class of harm as inventing a reading. Five
      minutes is 3.3× the slowest measured sample spacing (30/60/90 s) and cost exactly one
      skipped interval across five days and four meters. A non-positive span is refused too, so a
      clock stepping backwards cannot subtract energy.

      `add_ele` is still decoded and still reaches `capabilities` — it is the only device-side
      energy figure an outlet reports and any future cross-check needs it. It is simply not added
      to anything.

      **A GREEN TEST WAS ASSERTING THE FABRICATION.** `dp-parser-plan.test.mjs`'s *"add_ele
      ACCUMULATES"* ran five identical packets and asserted the total was 0.04 kWh — *"five 0.008
      kWh increments"*. Five identical packets **are** five polls of one retained value, so the
      test described the bug and called it the fix. It was green for the whole period co5 was
      reporting 72.427 kWh for a 2.268 kWh day. That is the **third** time in two sessions a test
      has encoded an assumption instead of an outcome; the other two were `scheduler.test.mjs`
      supplying a socket the UI cannot produce, and the EX-160 harness building the same wrong
      `msg` shape the code read.
      Four neuters — restoring the `add_ele` accumulation, removing the staleness cap, removing
      the non-positive guard, and reverting to right-endpoint — each fail exactly the right tests
      and nothing else.
      `node-red-bridge/dpParserPlan.mjs`, `test/outlet-energy-integration.test.mjs` (16),
      `test/dp-parser-plan.test.mjs` (3 rewritten)

      **DEPLOYED AND VERIFIED LIVE, 2026-09-07.** `fix-dp-parsers:pi --apply` rewrote exactly the
      seven outlet parsers (5,037 -> 6,721 bytes each, 8 context keys preserved apiece, invariants
      held, no meter touched), after a timestamped `flows.json` backup. The deployed `co5` parser
      was read back: its only executable energy statement is
      `energy += ((prevP + lastP) / 2 / 1000) * hours` and `energy += fresh.add_ele` appears
      nowhere outside the comment that quotes it. The same watch that found the fault, re-run
      against the fixed parser:

      | device | power | `add_ele` | per-minute delta, before -> after |
      |---|---|---|---|
      | co1 | **0 W** | 0.051, stuck | 0.0510 -> **0.0000** across four minutes |
      | co5 | 55.7 W | 0.052, stuck | 0.0520 -> **0.0009** (≈54 W, matching the meter) |
      | co6 | 19–27 W | 0.024, stuck | 0.0260 -> **0.0003–0.0005** (≈24 W) |
      | mtr_co_yellow | ~690 W | — | unchanged, still its own counter |

      co1 is the clean proof: zero watts now yields zero energy, where it had been accruing
      0.051 kWh every minute — 73 kWh a day from a socket drawing nothing.

      **CONFIRMED OVER 4+ HOURS OF REAL OPERATION, not just the three-minute watch.** Reported
      daily energy against what each outlet's own power integrates to, from the counter repair to
      four hours later:

      | device | reported | integrated | ratio |
      |---|---|---|---|
      | co1, co3 | **0.0000** | 0.0000 | zero watts all window, gained nothing |
      | co2 | 0.0131 | 0.0131 | 1.00x |
      | co4 | 0.0230 | 0.0236 | 0.98x |
      | co5 | 0.1130 | 0.1218 | 0.93x (peak 588 W) |
      | co6 | 0.0708 | 0.0723 | 0.98x |
      | co7 | 0.0040 | 0.0036 | 1.12x — 0.4 Wh apart, so the ratio is noise |

      Over the same window the old code would have given co1 0.24 kWh at zero watts and co5
      **6.7 kWh**. The few percent that remain are the expected drift between the parser's
      `Date.now()` deltas and this check's integration over the stored arrival time.
      **AND IT SURVIVED ITS FIRST MIDNIGHT.** A new accumulator's first rollover is a real risk
      point — EX-158 needed four before it was believed. Measured across local midnight into
      2026-09-08: all seven outlets reset to exactly 0.0000 and are accruing in step with their
      wattage. **co5's full day on 09-07 came to 1.15 kWh; 09-06, the last full day before the
      fix, was 72.43.**
      Fleet back to 18/20
      after the Node-RED restart (the two out are `acu_main` and `sens_outside_temp`, both known),
      and ingestion ticking clean with zero scrub rejections.

      **A FLAKY TEST WAS CAUGHT BY RUNNING THE SUITE ON THE PI FIRST, not by CI.** Three
      integration assertions used a 1e-9 tolerance on a figure derived from the wall clock, and
      the Pi is slow enough that the millisecond between staging the interval and the parser
      reading its own `Date.now()` broke them. Green on the workstation, intermittently red on the
      hardware. Loosened to 1e-4, which still separates the trapezoid result from the
      right-endpoint one by fifty times the tolerance, and confirmed stable over 20 consecutive
      runs.

- [x] **RM-047b (M) — the history is corrected too, 2026-09-07.** The choice was correct-it
      rather than mark-the-window: marking only helps if something reads the mark, and nothing in
      `src/` does, so a mark would have left the wrong numbers on screen while feeling like a fix.

      **The objection had to be answered first, because this rewrites a production table.**
      Recomputing is not fabrication here: `pc_outlet` has no energy register at all, so this
      column has NEVER held a device measurement for an outlet — it has always been a value the
      bridge derived from power. This recomputes the same derived quantity with the corrected
      formula from `power_w`, which is measured and is not touched. `outletIdsFrom` selects by
      class, so a CT meter — which does have its own counter — is unreachable from here by
      construction, and a test asserts it.

      **AND THE FIRST RULE I WROTE WAS WRONG, which the measurement caught before it ran.**
      Integrating the stored history naively gave co5 **12.33 kWh a day for eight consecutive
      days** in late August. Checked: 2026-08-28 has 1,440 rows with `online: false` on every one
      and `power_w` frozen at exactly 513.9 W — the device was gone and the bridge was serving its
      last wattage. That is integration's documented compounding fault, and a blanket backfill
      would have invented more energy than the bug it was fixing. So an interval counts only when
      the device was online at BOTH endpoints; the live parser needs no such guard because no
      packet means no integration, but history has no such protection. With the guard, co5's
      phantom 12.33 kWh/day collapses to 0.00.

      **Result, converged and idempotent:** 149,432 of 209,539 outlet rows rewritten; the seven
      outlets' summed daily peaks go from **344.8 kWh to 11.7 kWh**, and a re-run now reports
      11.7 against 11.7. Exact undo data was snapshotted first
      (`~/backups/rm047-*/outlet-energy-before.ndjson`, 209,518 rows).

      **The flow's counters had to be repaired as well, or the backfill was pointless.** Today's
      rows kept being rewritten from the still-inflated `<ctx>_energy` in flow context — co1 at
      15.41, co5 at 33.78. Repaired with Node-RED stopped (backup beside the file), each set to
      the corrected value-so-far-today; verified live afterwards, co1 flat at 0.495 on 0 W while
      co4 and co6 advance in step with their wattage.

      **A small residual difference is expected and is not a bug.** The parser accumulates on
      `Date.now()` deltas at packet arrival, while the backfill integrates over the stored `ts`,
      which is the bridge's build time. The two drift slightly, so a dry run will always report a
      handful of differing rows.

      **Reports need no action.** `period_reports` holds 2026-08 and the weeks of 08-10, 08-17 and
      08-24 — all of them before the fault window, which began 09-03. September is not settled, so
      the first September report will be generated from the corrected rows. The August reports are
      left as generated: the outlets drew fractions of a kWh in that period and regenerating a
      settled report to move a number by 0.1 kWh is not worth changing published history for.
      `readings_hourly` is still empty, so no rollup carries the fault.
      `server/backfillOutletEnergy.mjs`, `server/backfillOutletEnergy.test.mjs` (16)

- [x] **RM-051 (S) — the functionality test log carried the same blind spot as the code.
      Revised 2026-09-07.** The Lighting sheet asks whether a switch follows the wall plate and
      whether the screen matches it. **The Outlets sheet asked neither** — which is precisely the
      fault the operator found by hand the same day, *despite* the log not asking them to look.
      Both documents were written from the same assumption, which is why the gap survived in both.

      Outlets went **6 → 10 functions** per device, Lighting **6 → 7**:

      | added | to | why it earns a row |
      |---|---|---|
      | Button still works | Outlets | the app did not follow the physical button; state came from the last command |
      | Reports its state | Outlets | same fix, and the half a person can only check by watching |
      | Auto-shed switches it off | both | never tested on any device, and refused on all seven outlets until RM-047's session |
      | Daily energy is believable | Outlets | **every other row passed while today's kWh was 32× too high** |

      That last one is the point. A pass/fail switching test cannot see a wrong number: the socket
      switched correctly all day and reported 32 times the energy it used. Its pass condition is
      checkable by eye — *"today's kWh keeps step with the watts; a socket sitting at zero gains
      no energy"* — because a socket drawing nothing that still gains kWh is exactly what the
      live watch showed.

      Wording and block position mirror the Lighting sheet rather than inventing new phrasing, per
      the plan. `Schedule fires` also gained a note: it is the row that was failing on Outlet 5,
      it was fixed the same day, and any earlier result on it is stale.

      Mechanically: blocks rebuilt to rows 18–87 and 18–117, formulas carried across with
      openpyxl's `Translator` so relative refs follow the row, and the conditional formatting, the
      P/F validation and the Summary's fixed ranges and per-device counts (`*6` → `*7` / `*10`)
      all extended to match. Verified afterwards: zero stale references, every formula naming only
      its own row and its slot's header row, all 10 slots resolving correctly, 7×10 and 10×10
      blocks. **Nothing was lost** — every TRIES cell in the workbook was empty, checked before
      touching it — and the original is backed up beside the file.
      Device IDs stay in that workbook and are not reproduced here.

- [x] **FI-022 — capability writes reach the meters over the LAN. 2026-09-08.**
      `hasLocalCapabilityRoute()` returned `false` for everything, so a power-alarm threshold went
      to the vendor cloud even though the device sits on the Pi's own 2.4 GHz segment. The site
      declares `dispatch: 'local-first'`; that was true of relays and untrue of settings.

      **It could not reuse the relay route**, which is why this needed a plan module rather than a
      flag. Traced on the live flow: `Auth + validate` coerces the payload with `Boolean(s)`, the
      router keys on `topic: L1..L7`, and each `Format CMD` is literally
      `{dps: 1, set: msg.payload}`. Every stage assumes a relay.

      **SCOPED TO THE METERS, deliberately.** The three tuya nodes on the Energy tab are fed today
      by nothing but `Discovery back-off` and `Stale address recovery` — no command path to
      disturb — and **a CT meter has no relay**, so the worst a bug can do is set a wrong alarm
      threshold. Outlets and switches would mean ~20 nodes wired beside live relay control, which
      is a different risk; their settings still fall through to the cloud, and a test says so.

      **The device is resolved from the flow's WIRING, never from names.** The live flow calls one
      meter's node `AREC ACU` while the registry calls that device `CARE ACU` — name matching
      would have mis-targeted it and nothing would have said so. Two logical meters correctly
      resolve to the *same* instrument and differ only by dp: **111 for channel 1, 121 for
      channel 2**, which is what keeps a write off the neighbouring branch circuit.

      **The validator asserts the invariant that makes the write safe:** every pre-existing node
      is byte-identical afterwards, and every routing target is a tuya node that already existed.
      A router naming three devices in its `wires` does not modify them — a node's inputs are not
      part of it — so "nothing the building depends on changed" is checkable exactly.

      **TWO REAL BUGS, BOTH FOUND BY RUNNING IT RATHER THAN READING IT.**
      1. `server/proxy.mjs` resolves a write to the channel code `warn_power1` before dispatching,
         while the catalogue and the frontend talk in bases. A table keyed by one of them made
         every real write fail as *"not writable"* — caught by the proxy integration test, which
         had to be rewritten anyway because its premise (*"capability writes have no LAN endpoint
         yet"*) was the thing being removed.
      2. **The endpoint answered HTTP 200 and the register never moved.** The tuya node logged
         `Converting circular structure to JSON`: an http-in message holds `req` and `res`, which
         are circular, and the node serialises what it is given. This is precisely the failure the
         project's deploy notes warn about twice, and it was found by reading the value back off
         the device. The auth node now emits a fresh `{topic, payload}` for the device and keeps
         the HTTP objects on the reply branch only; two tests pin it.

      **VERIFIED ON THE HARDWARE.** `warn_power1` on `mtr_lo_red` read `None` before and **1500
      after**, reported back by the meter itself with no error in the node log. That circuit draws
      14–54 W, so a 1,500 W alarm threshold is inert — it was chosen to be observable without
      changing any behaviour.
      `node-red-bridge/capabilityRoutePlan.mjs`, `node-red-bridge/add-capability-route.mjs`,
      `server/dispatchLight.mjs`, `test/capability-route-plan.test.mjs` (25),
      `server/proxy.test.mjs` (2 rewritten), `npm run capability-route:pi`

- [x] **RM-052 (M) — a daily counter that jumps FORWARD now re-anchors too. 2026-09-08.**
      The evidence is in §0. `energyDayBase` had two re-anchor events — the local day rolling
      over, and the counter going backwards — and a register that acquires an offset in the
      middle of a day trips neither.

      **The new rule is a rate, not a bound, and that distinction is the fix.** No branch here can
      draw more than `SITE.telemetry_bounds.power_w.max`, so none can add more kW-hours than that
      in an hour. A counter that advances faster has not measured electricity, whatever the
      figure. The ceiling is threaded in from the site at build time, like the UTC offset and the
      daily bound before it — a site that declares no bounds keeps the tracker's default.

      **The jump is ABSORBED into the baseline, not rejected**, so today's published figure
      carries straight on from where it was rather than restarting at zero on a dashboard
      somebody is watching. That is the same courtesy the first-sight seeding already pays, and
      **the neuter round is what proved the test knew the difference**: setting the base to the
      counter also makes the figure "small", and the first version of the assertion accepted it.
      Tightened to require the morning's 0.111 kWh to survive intact, after which that neuter
      fails like the other two.

      Three neuters each fail the right tests: removing the check, making the ceiling absolute
      rather than per-hour, and clobbering the base instead of absorbing the delta.
      `node-red-bridge/energyDayBase.mjs`, `node-red-bridge/build-flow.mjs`,
      `test/energy-day-base.test.mjs` (+7)

      **DEPLOYED AND THE LIVE STATE REPAIRED, 2026-09-08.** `deploy:pi --force --apply` after a
      backup, 293 -> 293 nodes, 5/5 bridge checks. The fix guards FUTURE jumps; the offset already
      banked in context needed repairing separately, so each meter's baseline was reset to
      `counter - integrated` — the tracker's own seeding rule — with Node-RED stopped and a backup
      beside the file. Measured immediately after:

      | meter | before | after | integrates to |
      |---|---|---|---|
      | **mtr_lo_yellow** | **77.502** | **0.301** | 0.302 |
      | mtr_co_yellow | 0.7856 (via the backstop) | 0.7916 | 0.697 |
      | mtr_arec_acu | 1.300 | 1.3032 | — |
      | mtr_lo_red | 0.087 | 0.086 | — |

      The hardware registers still read 77.502 and 3,676 — the offsets are the device's and are
      not ours to clear. The baseline now excludes them rather than pretending the register is
      clean. Building total 2.48 kWh, fleet 18/20.

- [x] **RM-053 (M) — the week/month accumulator no longer banks a counter's offset. 2026-09-08.**
      The evidence is in §0. Two faults, both in a string constant that nothing could execute,
      so the first act was to extract it to `node-red-bridge/energyAccumulator.mjs` and make the
      **shipped source** the thing the tests run — the same move `energyDayBase.mjs` and
      `arrivalTracker.mjs` already carry, and this is the third time it has paid.

      **1. It accrues from bounded increments now, never from an unbounded absolute.** The rate
      ceiling is the site's own `telemetry_bounds.power_w.max`, identical to RM-052's, because it
      is the same physical fact one layer along: no branch can add more kW-hours in an hour than
      it can draw. **Increments arriving on TOP of a bogus offset are still kept** — the register
      kept counting real watt-hours either side of its jump, and refusing those would trade an
      over-count for an under-count. A test pins that specifically.

      **2. A completed day folds BEFORE the period keys roll.** It belongs to the week and month
      it ended in. The old order zeroed it out of its own period and added it to the next.

      **The backwards rule now banks the EXCESS, `max(0, banked - reported)`, and that single
      expression separates the two things that look identical.** A device reboot leaves the
      register near zero, so nearly all of the run is banked — the case the old rule existed for,
      and it still works. A corrected baseline reports a figure that *supersedes* what we had, so
      nothing is banked and nothing is double-counted. One neuter fails both of those tests at
      once, which is how the suite proves it knows the difference.

      Deliberately given up: at a day rollover the new day starts from zero rather than adopting
      whatever the counter reads, because at that one moment a lagging counter still carries the
      old day and adopting it would fold the day twice. The cost is the energy drawn between
      local midnight and the first poll after it — tens of seconds. Under-counting a sliver is
      the safe direction; §0 is what over-counting looks like.

      11 tests; **six neuters each fail the right ones** — removing the rate check, restoring the
      old key order, banking the whole run backwards, dropping the ceiling, dropping the
      stored-shape upgrade, and accepting non-numeric figures.
      `node-red-bridge/energyAccumulator.mjs`, `node-red-bridge/build-flow.mjs`,
      `test/energy-accumulator.test.mjs`

      **DEPLOYED AND THE LIVE STATE REPAIRED, 2026-09-08.** A diff against the running flow first
      confirmed the change touched **exactly one node of 24** and no source tab, then
      `deploy:pi --force --apply` after a backup, 298 nodes, 5/5 bridge checks. The bases already
      banked needed repairing separately, and were **re-derived from the corrected `readings`
      history** — the sum of each completed local day's peak — rather than back-computed from the
      contaminated value, so the repair could not inherit the fault's arithmetic. Node-RED
      stopped, backup beside the context file, 11 accumulators written:

      | device | week before | after | month before | after |
      |---|---|---|---|---|
      | **mtr_lo_yellow** | **78.977** | **1.236** | **83.390** | **5.611** |
      | mtr_co_yellow | 9.720 | 8.165 | 39.166 | 34.281 |
      | mtr_arec_acu | 7.628 | 5.932 | 23.946 | 16.336 |
      | mtr_lo_red | 0.279 | 0.191 | 1.437 | 0.933 |
      | co5 | 180.916 | 1.150 | 413.430 | 6.382 |
      | co1 / co3 / co6 | 19.3 / 3.9 / 44.5 | 0.5 / 0.0 / 0.7 | 47.4 / 43.1 / 102.2 | 0.7 / 0.4 / 1.9 |

      The outlet rows are **RM-047's fabricated energy**, banked before that fix landed and never
      recomputed — RM-047b corrected the stored history and could not reach flow context. They
      are not what the operator reported, and they were 181 kWh of a week that was really 1.15.

      Served immediately after: **L.O Yellow 80 % -> 8.2 % of the week, 56 % -> 9.8 % of the
      month**; branch sum 18.646 against the building's independent 18.588. `period_reports` was
      checked and is **clean** — no row above 100 kWh, and every one generated before the jump —
      so nothing there needed regenerating. Nothing reads `readings.energy_kwh_week`, so the
      contaminated column in stored history feeds no surface; it is left as the record of what
      was served. Fleet 18/20, five services active.

- [x] **RM-054 (S) — the Analytics energy breakdown compares its two figures now. 2026-09-08.**
      The evidence, the measured threshold and what it deliberately does not do are in §0. The
      two quantities on that card were rendered side by side and never compared, which is how
      RM-053 showed a 5.4x contradiction for a day; the check is one-sided (a branch sum below
      the building total is normal and is never flagged), silent when the building counter is
      null, and sized from measurement rather than a round number.

      **The pure logic is its own module** — `energyDisagreement.ts`, not a helper inside the
      component — because `eslint`'s `react-refresh/only-export-components` refuses a component
      file that exports anything else. It caught that after `tsc`, `vite build` and 1,134 vitest
      tests had all passed, which is the third time this project has recorded that ordering.

      **The neuter pass changed the implementation, which is the part worth keeping.** Written
      first as `branchSum > total * (1 + MARGIN)`, replacing the subtraction with `Math.abs`
      failed **nothing** — no shortfall can clear a comparison against `branchSum` itself, so the
      one-sidedness the whole design rests on was untested. Both bars now read off one signed
      `excessKwh`, and that neuter fails a test.

      11 new tests; **six neuters each fail the right ones** — dropping the absolute floor, the
      proportional margin, the direction, the missing-total guard, the per-period total (the
      split read against the wrong period's counter), and the zero-total ratio guard.

      Contrast measured in a real browser on the composited fill rather than only on the tokens:
      **4.90:1 light, 6.62:1 dark** for `--warn` on `--warn-soft` inside a card, both clearing AA.
      `src/components/analytics/energyDisagreement.ts`,
      `src/components/analytics/EnergySection.tsx`,
      `src/components/analytics/EnergySection.test.tsx`, `src/index.css`

      **NOT YET SEEN FIRING ON THE REAL PAGE.** The mock bridge seeds the building's week/month
      baselines as the sum of its four branch meters on purpose — `mock-bridge/server.mjs` says a
      discrepancy on screen should mean a real bug, not a fixture artefact — so the app can only
      be observed staying quiet, which it does (19.92 against 19.92, no notice). The notice's
      appearance is covered by the component tests and by a browser check of the real stylesheet.

- [x] **RM-055 (S) — Overview's two "today" figures stop wearing the same label. 2026-09-08.**
      The operator's report. `LiveDemandCard`'s "Today" is `_totals.energy_kwh_today`, the
      building's own counter; `EnergyBreakdownCard`'s headline is the SUM OF THE BRANCH METERS'
      registers. Two different quantities, one card apart, both saying only "today" — 4.75
      against 5.09 when this was written.

      **Relabelling was the fix, not changing either number.** The sum of the rows shown is the
      only figure that card can honestly headline (its shares are computed against it), and the
      building's own counter is the only figure Live Demand can. What was wrong was the naming.
      The headline now reads `kWh today · branches`, and the InfoHint says in as many words why
      it differs from Live Demand's.

      RM-054's one-sided check now runs on this card too, so the Overview is not silent either.
      The check moved to `src/lib/energyDisagreement.ts` — two feature areas use it — and its CSS
      lost its page prefix with it (`.energy-disagreement`).

      7 new tests, and the card had none before: the split, the label, the quiet direction, the
      fault shape, a null `totals`, a null day counter, and the empty state.
      `src/components/overview/EnergyBreakdownCard.tsx`,
      `src/components/overview/EnergyBreakdownCard.test.tsx`, `src/lib/energyDisagreement.ts`,
      `src/components/analytics/EnergySection.tsx`, `src/index.css`

- [x] **RM-056 (M) — the rate ceiling is measured against the counter's clock, not the reader's.
      2026-09-08.** The evidence is in §0, and it is the root cause of what RM-055 relabelled.
      `Energy day baseline` runs on the read path, so its idea of "elapsed time" was the gap
      between WS pushes and HTTP GETs — 2 s — while the meter it guards reports in ~30 s lumps.
      Every lump above 25 kW × 2 s = 0.0139 kWh was absorbed into the baseline as an impossible
      jump. `mtr_arec_acu` was publishing 62 % of its own register; the other three, whose lumps
      fit under the ceiling, lost nothing.

      **`seen[code]` is now written only when the value CHANGES**, so the span is the one the
      increment accrued over. That is the whole fix.

      3 new tests, **three neuters each fail the right ones** — restoring the per-read timestamp
      (both new lump tests fail), removing the rate check (all three jump tests fail), and making
      the ceiling ignore elapsed time (the ten-minutes-later jump fails). 24 tests in that file,
      933 across the bridge suite.
      `node-red-bridge/energyDayBase.mjs`, `node-red-bridge/bridge-flow.json`,
      `test/energy-day-base.test.mjs`

      **DEPLOYED 2026-09-08 14:29.** A diff against the previous generated flow first confirmed
      the change touched **exactly one node of 41** — `Energy day baseline` — and no source tab.
      Backup beside `flows.json`, dry run (4/4 source tabs matched, no id collisions,
      298 -> 298 nodes), then `deploy:pi --force --apply`. 5/5 bridge checks. **Flow context
      survived the write**: all four baselines came back intact, including RM-052's banked
      3675.479 and 77.201 offsets. Fleet 18 online, four services active, no errors in the log.

      **Verified live, not just in tests.** 60 back-to-back reads of `/api/readings/latest` were
      fired at the bridge — precisely the stress that used to shrink the ceiling — spanning a
      0.012 kWh counter advance. The published figure took **all 0.012 and the baseline did not
      move**. Before the fix that read cadence put the ceiling near 0.007 kWh and the lump would
      have been absorbed.

      **And the gap stopped growing.** Branch sum against the building's own counter:
      0.340 kWh at 13:33, 0.462 at 14:09 (+0.122 in 36 min), 0.468 at 14:31 post-deploy, 0.468
      at 14:33. The two now track in parallel.

      **THE ABSORBED ENERGY WAS REPAIRED TOO — RM-056b, 2026-09-08 14:44, before the rollover
      could bank it.** The fix stops further absorption; it gives nothing back, and
      `ACCUMULATE_ENERGY` banks the *published* daily figure into `weekBase`/`monthBase` at local
      midnight, so an understated day would have become a permanently understated week and month.

      **The value written was 0, and 0 was derived from physics, not from the contaminated
      number.** Integrating each meter's own reported power since local midnight — the one
      measure that owes this tracker nothing — settled which baselines were real:

      | meter | counter | base held | counter − integrated | served − integrated |
      |---|---|---|---|---|
      | mtr_co_yellow | 3677.417 | 3675.479 | 3675.487 | **+0.007** |
      | mtr_lo_red | 0.154 | 0.001 | 0.002 | **+0.001** |
      | **mtr_arec_acu** | 3.506 | **0.448** | **+0.032** | **−0.415** |
      | mtr_lo_yellow | 77.503 | 77.201 | 77.203 | **+0.002** |

      Three of the four are already correct to within 0.007 kWh, and their baselines carry
      genuine register offsets that had to be left alone. `mtr_arec_acu` is the opposite: its RAW
      counter matches the independent integration to 0.032 kWh (0.9 %), so the counter did reset
      at local midnight and its whole 0.448 baseline was absorbed consumption. Same rule as
      RM-053's repair — derive the value from what the hardware physically did, never by
      subtracting an estimate of the fault's own arithmetic.

      **Method, and every check it refused to skip.** Node-RED stopped first so its shutdown
      flushed context, backup taken *after* the flush, a script that aborts on any surprise (wrong
      `dayKey`, a baseline that had moved since it was measured, another meter's baseline
      changing, a value that did not survive the JSON round trip), written to a temp file that had
      to parse from disk before it replaced anything. The file halved in size — Node-RED writes it
      indented, the rewrite is compact — so a deep walk of both trees confirmed the claim rather
      than assuming it: **24 context keys to 24, no shape changes, exactly ONE differing path in
      2.85 MB.** The history ring buffers and every accumulator came through untouched.

      **Verified after the restart:** `mtr_arec_acu` base 0.00000, served 3.577 = its counter, and
      the other three baselines byte-identical including RM-052's 3675.479 and 77.201. Branch sum
      **6.014 against the building's own 5.997 — +0.28 %**, which is RM-053's post-repair figure
      (+0.31 %) to within a hundredth of a percent. 5/5 bridge checks, four services active, 18
      devices online, and **zero non-solarman errors** in the log since the restart (the
      `solarman-device` socket timeouts are the inverter and pre-date it — 76 of them in the six
      hours before).

      **What this cost:** the legacy two-second integrator does not run while Node-RED is stopped,
      so the building's own counter under-counts by the ~2.5 minutes of downtime — a few
      watt-hours at the ~700 W the building was drawing. Under-counting a sliver in the figure
      that was already the more trusted one is the safe direction, and it is gone at midnight.

- [x] **RM-057 (L) — one source of truth for consumed energy. 2026-09-08.** The operator's
      proposal; the evidence and the reasoning are in §0. The building's today/week/month are now
      the sum of the site's building meters, so the headline and the per-branch split are one
      number. The old integrated figure rides alongside as `energy_kwh_*_integrated` — the only
      independent measurement left, and what the RM-054 guard now compares against.

      **`buildingMeterIds()` is the whole idea in one function**: the topmost metered circuits of
      the declared tree. Not class `meter` — the outlets are downstream of a branch already
      counted, and what may be added together is a fact about wiring. A second site writes its
      own `circuits.mjs` and its totals follow.

      Threaded into `buildLatest` at build time exactly as `PHASE_MAP` is, so the bridge, the
      mock and the tests all run one implementation. An older flow that passes no meter list
      falls back to the legacy counters and behaves precisely as before — a test pins that.

      13 new tests (6 on the derivation, 7 on the totals), all suites green: 948 bridge, 545
      server, 1142 vitest, lint and build clean. Verified against the running app, all three
      periods: 26.53/26.53, 344.29/344.29, 1535.89/1535.89, and Overview 26.51 in both cards.
      RM-055's "· branches" label was **removed** — it existed to separate two figures that are
      now one, and a test pins that it does not come back.
      `shared/circuits.mjs`, `shared/registry.mjs`, `shared/buildLatest.mjs`,
      `node-red-bridge/build-flow.mjs`, `mock-bridge/server.mjs`, `server/shapeRows.mjs`,
      `server/scrubTelemetry.mjs`, `supabase/phase32_building_totals_summed.sql`,
      `src/lib/types.ts`, `src/lib/energyDisagreement.ts`, the two energy cards,
      `docs/bridge-contract.md`

      **REHEARSED BEFORE IT WENT NEAR THE LIVE PROJECT.** This repo has no migration runner —
      phase files are pasted into the SQL editor by hand — so `supabase/rehearse.sh` applied all
      32 in order against PostgreSQL 16 in a container on the Pi: **phase32 ok, all six functions
      still behaved.** `test/phase32-building-totals-summed-schema.test.mjs` pins what a
      rehearsal cannot — the six columns stay nullable and undefaulted, the hourly rollup carries
      them too, they are idempotent, and the apply-before-deploy ordering stays recorded. Three
      neuters fail it.

      **DEPLOYED 2026-09-08 15:26, frontend and flow.** Backup beside `flows.json`, a diff
      confirming the change touched **exactly one node of 41** (`Build latest readings`) and no
      source tab, dry run 4/4 tabs matched and 298 -> 298 nodes, then `--force --apply`. 5/5
      bridge checks. `dist` rebuilt at 15:27:04, `ibems-proxy` and `ibems-scheduler` restarted at
      15:27 for the `shared/` change. No errors in any unit's log. Measured immediately after,
      live:

      | period | branches | total served | integrated cross-check | branches vs integrated |
      |---|---|---|---|---|
      | today | 6.552 | **6.552** | 6.531 | +0.32 % |
      | week | 22.076 | **22.076** | 21.997 | +0.36 % |
      | month | 63.713 | **63.713** | 63.402 | +0.49 % |

      Exact on all three, which is the whole point, with the independent figure a few tenths of a
      percent behind — the healthy relationship. Fleet 18 of 20.

      **`phase32` applied by the operator and `ibems-ingest` restarted 15:31:33** — in that
      order, because the reverse fails silently: `shapeRows` names the new columns on every
      totals insert and PostgREST rejects the whole row for a column that does not exist, so an
      unmigrated database plus new server code stores **no totals at all** until somebody reads
      `ingestion_health`. **Checked rather than trusted before the restart:** a read-only GET
      against each of the six columns, run on the Pi so the service-role key never left it — six
      HTTP 200s. Two clean cycles immediately after (`wrote 20 readings + totals`), no errors in
      any unit.

      **The changeover is legible in the stored rows**, which is the best evidence it worked:

      | ts (UTC) | `energy_kwh_today` | `energy_kwh_today_integrated` |
      |---|---|---|
      | 07:33:00 | 6.619 | 6.597 |
      | 07:31:35 | 6.600 | 6.579 |
      | 07:31:00 | 6.591 | **null** |
      | 07:29:00 | 6.575 | **null** |

      **One impurity, recorded rather than smoothed over.** The flow deployed at 15:26 and the
      ingest daemon restarted at 15:31, so for those five minutes `energy_kwh_today` already held
      the SUMMED figure while the integrated column was still null. Rows before 15:26 hold the
      integrated figure in that column, as they always did. So
      `coalesce(energy_kwh_today_integrated, energy_kwh_today)` — the continuous-integrated-series
      rule the migration documents — is exact everywhere except those five rows, where it returns
      the summed figure instead. The two differ by ~0.3 % there, and nothing reads it that way
      today; it is written down so the first reader who does is not misled by it.

- [x] **RM-058 (M) — the shortfall direction is guarded, per branch. 2026-09-08.** RM-057 made
      both compared figures describe the same circuits, which removed the argument that made
      `energyDisagreement` one-sided: a branch reading BELOW its integration is no longer ordinary,
      it is energy measured and then lost. That is exactly RM-056's signature, and nothing caught
      it — an operator's eye did.

      **THE PER-BRANCH FIGURE WAS THERE ALL ALONG.** `<ctx>_energy` is the legacy engine's
      two-second integration of one meter's power, reset at local midnight. `buildLatest` already
      read it as the fallback for a meter with no register; it was never published, so the only
      cross-check the frontend could make was building-wide. **That is why RM-056 hid: 38 % of
      `mtr_arec_acu` over a window and 11.4 % across the day, against 6.7 % at the building.**
      Six times louder at the branch. It is published now as each row's
      `energy_kwh_today_integrated` — **only where the two are genuinely different numbers**, so
      an outlet (no cumulative register at all) and a register the backstop rejected carry
      nothing rather than a copy of themselves that could never disagree.

      **5 % and 0.15 kWh, both measured.** Each branch against its own integration at 15:35 on
      2026-09-08, after RM-056's fix and RM-056b's repair:

      | branch | register-derived | its own integration | difference |
      |---|---|---|---|
      | `mtr_co_yellow` | 2.228 | 2.256 | **−1.26 %** |
      | `mtr_lo_red` | 0.167 | 0.165 | +1.36 % |
      | `mtr_arec_acu` | 3.958 | 3.908 | +1.28 % |
      | `mtr_lo_yellow` | 0.302 | 0.301 | +0.29 % |

      Healthy sits inside ±1.4 %; the same meter under RM-056 read 2.652 against 2.993, **11.4 %
      short**. 5 % is ~4x the largest healthy shortfall and less than half the fault — the widest
      gap those two measurements leave. Deliberately tighter than the 25 % on the excess side,
      because that side has outages legitimately pushing it out and this one does not. The floor
      is 0.15 kWh rather than the building's 0.5: `mtr_lo_red` used 0.167 kWh in that whole day,
      so 0.5 would switch the check off for three branches of four. 0.15 is 10x the register's
      one-lump lag (~0.015 kWh on the busiest branch) and 3x the largest difference above.

      **What it honestly cannot do**, stated in the code rather than discovered later: it only
      guards branches drawing more than ~3 kWh a day, because below that the floor binds before
      the ratio. On a 0.17 kWh day no proportional test separates a fault from lump lag, and
      firing nightly on the small branches would teach the operator to ignore it. RM-056 bit the
      BIGGEST branch — the fault scaled with lump size — so this guards where that class lives.

      **THE NEUTER PASS CHANGED THE DESIGN AGAIN, the same way it did for RM-054.** The today-only
      rule was written at the call site, and removing it failed **nothing**: a week's register is
      always at least today's, so comparing it against today's integration can never report a
      shortfall. A rule no test can reach is a rule the suite is not holding, so it moved into
      `branchShortfalls` as a `period` argument, where a direct call with `'week'` is checkable.
      **Seven neuters now each fail the right tests** — floor, margin, direction, the
      missing-second-opinion guard, worst-first ordering, today-only, and publishing the field
      where it would be a copy of the reading.

      21 new tests. 1158 vitest, 959 bridge, 545 server, lint and build clean — `tsc` caught a
      type predicate that vitest and eslint both passed, which is the fourth time that ordering
      has paid.
      `shared/buildLatest.mjs`, `src/lib/energyDisagreement.ts`, `src/lib/types.ts`,
      `src/components/analytics/EnergySection.tsx`,
      `src/components/overview/EnergyBreakdownCard.tsx`, `docs/bridge-contract.md`

      **DEPLOYED 2026-09-08 15:50.** Backup beside `flows.json`, a diff confirming **exactly one
      node of 41** changed (`Build latest readings`) and no source tab, 298 -> 298 nodes, 5/5
      bridge checks. `dist` rebuilt, all three daemons restarted, two clean ingest cycles, zero
      non-solarman errors. Measured live immediately after — every branch now carries its own
      second opinion, and nothing is flagged:

      | branch | served | its own integration | difference |
      |---|---|---|---|
      | `mtr_co_yellow` | 2.307 | 2.336 | −1.27 % |
      | `mtr_lo_red` | 0.170 | 0.169 | +0.79 % |
      | `mtr_arec_acu` | 4.066 | 4.015 | +1.26 % |
      | `mtr_lo_yellow` | 0.303 | 0.302 | +0.31 % |

      `co1` carries no `energy_kwh_today_integrated` at all, which is the outlet rule holding in
      production rather than only in a test. Fleet 18 of 20.

- [x] **EX-169 — the phase28 columns are finally ASKED something. 2026-09-08.** phase28 gave
      `readings` six columns and EX-167 started filling them every minute. Nothing read them —
      the same shape as the capabilities that reached the browser and were discarded before
      EX-167, one layer along. Its migration names four questions; three are now answerable and
      the fourth has a query:

      | question | answered by |
      |---|---|
      | Which branch tripped its power warning, and when? | `fetchTroubleEpisodes`, kind `power_warn` |
      | Did this outlet report a fault before it went dark? | `fetchTroubleEpisodes`, kind `fault` |
      | Was it on the cloud or the local network when it stopped answering? | `fetchLastNetState` |
      | What is this meter's lifetime total? | `energyBetween` / `fetchEnergyBetween` |

      **THE ANSWER IS NOT A ROW LIST, and that is the whole design.** `readings` holds one row per
      device per minute, and on a healthy fleet every one says the same thing — returning rows
      returns thousands of identical answers to "when did this go wrong". The queries ask only
      for the abnormal (`fault <> 0`, `power_type = warn`, `net_state = no_net`) and fold
      consecutive rows into EPISODES: began here, ended here, lasted this long.

      **The only real decision is where one episode ends**, and it is not "the value changed". A
      device that reports a fault, goes off the air for two hours, returns still faulted and is
      fixed an hour later did not have one three-hour fault — it had two, and the hole between
      them is part of the story. `EPISODE_GAP_MS` (15 min) splits them, the same reasoning as
      `MAX_INTEGRATION_GAP_MS` and phase31's cap.

      **Two refusals worth naming.** `local_net` is NOT degraded — this site is `local-first`, so
      the LAN is where the system WANTS its devices, and flagging it would have put every meter in
      the trouble list on day one; only `no_net` is trouble, and a test says so. And
      `energyBetween` **refuses to difference across a counter reset**: phase28 stores the
      lifetime total raw because it is "monotonic except across a device reset", so a decrease
      makes the difference not a quantity of electricity. Both tempting answers — a negative
      number, or its absolute value — are fabrications, so it returns `null` with a reason, the
      same choice the scrub makes for an impossible field.

      Surfaced in the alerts popover, worded to keep one distinction: **every other row there is
      this system's inference** — a watchdog, a z-score, a fleet heuristic — **and these are the
      device's own report**. Where they disagree the device is the one wired to the circuit. A
      fault bitmap is decoded to English (`over-current`, not `1`), with a test asserting the
      label map covers exactly the bits the catalogue declares, so a vendor adding one fails there
      rather than showing an operator a raw code.

      **Nothing abnormal exists on this fleet** — checked the same day: zero rows with
      `fault <> 0`, zero `power_type = warn`, zero `net_state = no_net`. So every fixture is
      constructed and the empty result is a first-class case; verified in the running app, the
      popover reads *"Nothing outstanding"* rather than showing a spurious row. Polled at five
      minutes rather than the anomaly store's one, because an episode sits in a seven-day window
      and changes on the order of days. Four neuters each fail the right test, including adding
      `local_net` to the degraded set.
      `src/lib/capabilityEpisodes.ts` (+20), `src/lib/supabaseCapabilityHistory.ts` (+12),
      `src/stores/capabilityTroubleStore.ts`, `src/hooks/useLiveConnection.ts`,
      `src/components/layout/AlertsPopover.tsx` (+3)

- [x] **EX-168 — a diagnostic is not a setting, and the catalogue always said which is which.
      2026-09-08.** Found by opening the running app rather than by reading code. A meter's card
      rendered:

          [gear]  Device settings     net state cloud_net    device state working

      Both are `semantic: 'diagnostic'`. Neither is configuration. And on a meter that row
      contained **nothing else** — `cz_ct_*` declares none of the five real read-only settings —
      so the entire row was mislabelled, under a gear icon, among things like `switch_type` and
      `random_time`.

      **Why it is not a wording nit.** phase28's own migration says what `net_state` is for: *"A
      device that goes dark having last reported `no_net` was already in trouble; one that goes
      dark from `cloud_net` more likely lost the local segment. That distinction is what decides
      whether somebody has to drive to the office."* Filing that under settings puts the one field
      answering that question into the list a reader skims past.

      **The cause is RM-050's, one layer up:** a hand-written list standing in for a fact the
      catalogue already declares. `READ_ONLY_SETTINGS`'s own docblock admitted it — *"each
      installs unattended switching **or reports link state** inside the device"* — two different
      things named in one sentence and rendered in one row. `CapabilityMeta` now carries
      `semantic`, the settings list keeps only the five true settings, and `OPERATOR_DIAGNOSTICS`
      holds the two that describe the device rather than configure it.

      **Curated, not derived, and that distinction is the point.** `semantic` answers "setting or
      diagnostic" — a fact about the protocol, and the catalogue's business. It cannot answer "is
      this worth a human's attention", which is a product judgement: `voltage_coe`,
      `electric_coe`, `power_coe`, `electricity_coe`, `test_bit` and `sync_request` are all
      `diagnostic` and all noise on a card, so they stay in phase28's jsonb where they are kept
      but not shown. `fault` and `power_type` are excluded too — each already has a widget, and
      listing them again would report one fact twice.

      `no_net` is called out in `--bad` (an existing token `test/contrast.test.mjs` already
      measures in both themes); `local_net` and `cloud_net` read plain, because only one of the
      three is a problem.

      **Verified in the running app, both halves.** The meter now shows *"Reported by the device —
      net state cloud_net · device state working"* and **no** settings row; a light switch still
      shows *"Device settings"* and **no** diagnostics row — that half had to not change. Three
      neuters each fail the right tests, including putting the two back in the settings list.
      `npm run build` caught two type errors in the new test that vitest's type-stripping missed,
      which is the third time this project's own advice about running it has paid.
      `src/lib/capabilitySchema.ts`, `src/components/devices/capabilityWidgets.tsx`,
      `src/components/devices/widgetRegistry.ts`, `src/index.css`,
      `src/lib/capabilitySemantics.test.ts` (13), `src/components/devices/DeviceCard.test.tsx` (+6)

- [x] **EX-167 — the daemon keeps what the devices report beyond volts, amps and watts.
      2026-09-07.** Four questions could not be asked of the history at all, and all four were
      already on the wire — the devices have always reported them and this daemon discarded them
      every minute: which branch tripped its power warning, a meter's lifetime total, whether an
      outlet reported a fault before it went dark, and whether a device was on the cloud or the
      local segment when it stopped answering. `phase28` made room for them in Aug; nothing
      filled it, because the plan made it conditional on *"a working scrub"* — which EX-166 is.

      **Built from what the fleet actually sends, read off the live bridge first:** meters carry
      `net_state` (all four) and `total_energy{ch}` (all four), `power_type1` on `mtr_co_yellow`,
      and `warn_power` on none of them right now; outlets carry `fault: 0`; light switches carry
      none of the five. So every column had to tolerate absence, which is the ordinary case.

      **THE CHANNEL IS RESOLVED FROM THE CATALOGUE, NEVER ASSEMBLED.** `total_energy1` and
      `total_energy2` are two different branch circuits on one physical meter, and both codes
      arrive on both logical devices' payloads. A hand-built name would eventually put one
      circuit's lifetime total on the other's history — and it is not even uniform, since dp 113
      is `net_state` on the single-channel meter and `device_state2` on the dual-channel one while
      both are `class: 'meter'`. Neutering this one alone fails **twelve** tests.

      **A VALUE OUTSIDE A CLOSED VOCABULARY IS REFUSED HERE, NOT SENT.** `power_type` and
      `net_state` carry CHECK constraints, and a constraint violation does not fail one field:
      PostgREST rejects the whole batch, `writeOrBuffer` buffers it, and `flushBuffer` replays it
      at the head of every cycle for ever. That is the same permanent wedge EX-166's timestamp
      rule exists to stop, reached by a different route — so a drift between catalogue and
      hardware now costs one column and is counted as a scrub rejection, on the same counter and
      in the same health row.

      **AND THE MIGRATION ORDER NO LONGER MATTERS.** phase28's own header warns that widening the
      daemon first "would stop ingestion outright — on a table that is the history of a real
      building". These migrations are pasted in by hand, so that ordering is a human step. The
      daemon now detects the missing columns from PostgREST's own error, says so once naming the
      file to apply, drops the six, and keeps writing every field it wrote before — the same
      pattern phase30 proved live. Losing a not-yet-recorded feature for a while is survivable;
      losing the insert is the building's history stopping.

      The jsonb carries every capability that was NOT promoted, never a second copy — the
      migration says "every other decoded capability", and a value stored twice invites the two
      to disagree. An empty tail is `null` rather than `{}`, because "reported nothing" and
      "reported nothing beyond what was promoted" are different claims.
      Five neuters each fail the right tests. `test/phase28-reading-capabilities.test.mjs`'s
      *"shapeRows.mjs has indeed not been widened yet"* said of itself that it was what must be
      updated when this happened; it now asserts the opposite, and a new test checks the SQL's
      column list against the promoter's rather than a second hand-written list.
      `server/readingCapabilities.mjs` (+18), `server/shapeRows.mjs`, `server/ingest.mjs`,
      `server/ingest.test.mjs` (+4), `test/phase28-reading-capabilities.test.mjs`

      **DEPLOYED 2026-09-07, AND THE SAFETY NET WAS EXERCISED FOR REAL RATHER THAN IN A TEST.**
      It was deployed deliberately BEFORE the migration was applied, which is the order phase28's
      header calls catastrophic. The journal shows exactly one line —
      *"readings has no capability columns — apply supabase/phase28_reading_capabilities.sql.
      Recording without them; every pre-phase28 field is unaffected"* — followed by
      `wrote 20 readings + totals` on every tick since. Rows read back carry all seven
      pre-phase28 columns, `ingestion_health` is current, the outage buffer is empty and the
      scrub refused nothing. Without the guard this deploy would have stopped the building's
      history at that moment.

      **phase28 APPLIED AND VERIFIED 2026-09-08.** Restarted `ibems-ingest` — the daemon settles
      the missing-column question once per process — and the warning is gone. **18 of 20 devices
      now record something that was being discarded every minute;** the two that do not are
      `acu_main` and `sens_outside_temp`, both offline hardware that reports nothing. Checked
      against the wire rather than merely for non-null: all four meters' stored
      `total_energy_kwh` equals the live `total_energy{ch}` for their own channel exactly, their
      `net_state` matches, and co5's 17 wire keys became 16 long-tail keys plus `fault` promoted
      out — the no-second-copy rule holding in production. Zero scrub rejections, so nothing the
      catalogue declares has drifted from what the hardware sends.

- [x] **RM-050 (S) — `semantic` does some work. 2026-09-07.** The plan's Phase 6 was written
      against `dpParserPlan`, which hard-coded increment behaviour by matching the literal name
      `add_ele`. **RM-047 deleted that accumulation outright, so the original target no longer
      exists** — the only mentions left are comments explaining its removal. The concern survived
      one file over, and that is what this fixes.

      `shared/buildLatest.mjs` chooses between a meter's own daily counter and the bridge's
      integrator, and identified that counter as `dp['today_acc_energy' + (d.channel || 1)]` — a
      name assembled by hand. The catalogue already declares which capability that is
      (`semantic: 'cumulative_daily'`), and `shared/deviceCapabilities.mjs`'s own header names the
      mistake the field exists to prevent — *"assigning an increment to a cumulative"* — while
      `semantic` was, until now, **read by no production code at all**: declared, tested, and
      load-bearing on nothing.

      **What would have gone wrong.** A meter product coding its daily counter anything else — and
      the replication framework and RM-026's inverter both make a new product a real prospect —
      returns undefined from that lookup, falls silently through to the integrated value, and
      loses the accuracy EX-158 was built to gain. Nothing reports a fault; the number is just the
      worse one.

      **Latent, and provably so.** `DAILY_ENERGY_CODE_BY_DEVICE` resolves to
      `{mtr_co_yellow: today_acc_energy1, mtr_lo_red: today_acc_energy1, mtr_arec_acu:
      today_acc_energy1, mtr_lo_yellow: today_acc_energy2}` — character-for-character what the old
      literal produced for all four meters, including channel 2 for the dual meter's second
      branch. So this cannot change a single current reading, and the test for an older flow
      passing no map at all is what keeps that true.

      Derived once in `shared/registry.mjs` so the two callers that thread it in — the generated
      flow and the mock bridge — cannot drift. Four neuters each fail the right tests: reverting
      to the literal, reading the day base from a different dp than the reading it is subtracted
      from, ignoring the channel (which would attribute one branch circuit to its neighbour), and
      matching `cumulative_total` instead of `cumulative_daily`.
      `shared/deviceCapabilities.mjs`, `shared/buildLatest.mjs`, `shared/registry.mjs`,
      `node-red-bridge/build-flow.mjs`, `mock-bridge/server.mjs`,
      `test/semantic-driven-energy.test.mjs` (8)

      **DEPLOYED AND VERIFIED LIVE, 2026-09-07.** `deploy:pi --force --apply` after a timestamped
      backup: all four source tabs matched, no id collisions, 293 → 293 nodes, **5/5 bridge
      checks**, and no Node-RED restart needed — the admin API reloads the flow. The deployed
      transform carries the map, and the claim that it changes nothing is now measured rather than
      argued: every one of the four meters' `energy_kwh_today` still equals its own
      `today_acc_energy` capability exactly, so the semantic lookup resolved to precisely the dp
      the literal did. Fleet 18/20.

- [x] **RM-049 (S) — the hourly rollup's average is weighted by the time each sample stands for.
      Authored and rehearsed 2026-09-07; `supabase/phase31_readings_hourly_time_weighted.sql`
      awaits a hand-apply.** `roll_up_and_prune_readings` used a plain `avg(r.power_w)`, which is
      right only if every sample represents the same amount of time. Measured over 2026-09-05,
      the gaps between consecutive readings are 60 s ×3,498, 58 s ×423, 61 s ×318, 59 s ×317,
      **30 s ×313** and 92 s ×271 — and `r.ts` is the device's arrival time, so that is real meter
      cadence, not loop jitter.

      **How much it matters was measured before the migration was written**, because unequal
      intervals alone do not prove the two answers differ. Over 109 device-hours:

      | | plain vs time-weighted |
      |---|---|
      | median device-hour | **0.131 %** — genuinely fine |
      | p95 | 8.38 % |
      | worst (co5, 06:00) | **38.3 %** — 37.3 W reported against 51.5 W |

      So the typical hour is unaffected and the tail is badly wrong, in exactly the case that
      creates it: a device whose reporting cadence tracks its load, where a plain mean
      over-weights the closely-spaced samples that cluster around a change.

      **The timing is the good part.** `readings_hourly` is still EMPTY — retention has not rolled
      anything up — so this lands before a single bucket exists, with nothing to backfill and no
      series computed two different ways. That window closes the first time raw rows age past the
      retention horizon.

      **A weight capped at 300 s, defaulted to 60 s when there is no predecessor.** The cap is the
      same number as `MAX_INTEGRATION_GAP_MS` for the same reason, and the opposite response is
      correct: that code *skips* a long gap because inventing one fabricates kWh, this one *caps*
      it because dropping the sample would lose the only reading a sparse hour has. Same hazard,
      opposite handling, and the migration says so.

      **The per-column denominator filter is not new** — `phase10`'s `readings_archive` already
      does exactly this one level up, and states why: an unmetered device can be online with a
      null reading, and counting its weight dilutes the average. A light switch is in that state
      every minute of every hour.

      **REHEARSED AGAINST REAL POSTGRESQL 16, not just asserted.** `supabase/rehearse.sh` applies
      every migration in order in a throwaway container; the existing fixture is uniform
      one-minute spacing, so weighted and plain agree to the last digit there and it would have
      passed a broken weighting. Two fixtures were added that discriminate: unequal gaps with an
      exactly computable answer of **700** where a plain mean gives 340 and an uncapped weight
      gives 927.27, and an online-with-null-reading device that must average **100**, where
      counting the null's weight gives 50.

      **All three neuters were then run through the full rehearsal, and each returned exactly the
      wrong number predicted for it** — reverting to a plain `avg` gave 340, removing the cap gave
      927.27, dropping the per-column denominator filter gave 50 — with the restored file green
      again. The predicted values are written into the assertion messages, so a future failure
      says which of the three ways it broke.
      `supabase/phase31_readings_hourly_time_weighted.sql`, `supabase/rehearse.sh`

      **Recorded, not done:** `phase10`'s hour-to-day rollup weights each hour by
      `online_sample_count`, a count. An hour of 60 samples and one of 30 slower ones both span an
      hour, so that weighting is a proxy. Fixing it needs a `covered_seconds` column on
      `readings_hourly`; nothing has yet shown the proxy is wrong enough to matter, and an unused
      column is a worse answer than a written-down question.

- [x] **RM-048 (S) — a reading nobody took is no longer written down as zero. 2026-09-07.**
      The project's own rule — *omit, never zero* — violated in the one place that manufactures
      the values. Both generated tails opened with `parseFloat(flow.get("<ctx>_last_p")) || 0`
      and closed with an unconditional `flow.set`, so a packet carrying no telemetry — a
      connect-time status frame, a settings-only report — wrote a real `0` into flow context for
      a device that had never reported.

      **That reached the wire, which is what makes it worth fixing.** `build-flow.mjs`'s
      collectors read those exact keys, so `buildLatest` would publish `voltage: 0, current: 0,
      power_w: 0` as measured values — and the outlet tab's arrival timestamp would call them
      fresh, because a packet *did* arrive.

      **Latent, not active, and worth saying so rather than overstating it.** All eleven metered
      devices report, so the live context holds real values — checked on the Pi, every outlet
      carries a genuine `_last_v` near 228 V with `_last_p` at 0 because the sockets are actually
      off. A newly enrolled device, or any device whose first packet is a status frame, walks
      straight into it.

      **Three things deliberately unchanged.** `<ctx>_energy` keeps its `|| 0`: it is an
      accumulator, and zero is where a counter legitimately starts — absent and zero mean the
      same thing for it, which is precisely what makes them different for a reading. The arrival
      timestamp stays unconditional, because it is the outlet tab's only freshness signal and
      withholding it would make a reporting device look dead — the opposite failure, and a worse
      one. And the legacy `/ui` payload and the second output feeding the two-second totals
      engine still receive numbers, because neither lives in this repository and neither can be
      tested from here; the fallback is kept for display and simply never persisted.

      Three neuters each fail the right tests: restoring the unconditional writes, making the
      arrival stamp conditional, and the subtle one — `if (fresh.cur_power)` instead of
      `!== undefined`, which would treat a genuine 0 W as absent and is the exact mistake this
      change is about, one line over.
      `node-red-bridge/dpParserPlan.mjs`, `test/parser-absent-not-zero.test.mjs` (14)

      **DEPLOYED AND VERIFIED LIVE, 2026-09-07.** All eleven parsers rewritten — seven outlets
      6,721 → 8,158 bytes, four meters ~4,200 → ~4,550 — with 8 and 9 context keys preserved
      respectively, invariants held, after a timestamped `flows.json` backup. Read back from the
      live flow: `Outlet 5 Unified` and `C.O Yellow Unified` each show **3 conditional writes and
      0 unconditional `_last_v` writes**. Fleet 18/20 after the restart, and every one of the
      eleven metered devices reports a real voltage (225–231 V) with genuine zeros where the
      sockets are actually off — which is the distinction the change exists to preserve.

- [x] **RM-047a (S)** The options NOT taken, recorded so the choice can be re-argued rather than
      rediscovered.

      **Why the obvious fix is not available.** The meter path works by preferring
      `today_acc_energy`, a `cumulative_daily` register that is harmless to re-read. `pc_outlet`
      has no cumulative energy dp — all 17 are switches, countdowns, coefficients, diagnostics
      and the single `add_ele` increment — so there is nothing to difference against.

      **Why the transport cannot be asked either.** `dp-refresh` (device push, changed dps) and
      `data` (poll response, the whole retained dp table) leave
      `node-red-contrib-tuya-smart-device` as byte-identical messages on the same output. There
      is no downstream field, and subscribing to `dp-refresh` alone would lose the 60 s telemetry
      cadence — measured, co1 took 1,460 additions in a day against 1,440 polls, so essentially
      every packet reaching the accumulator is a poll.

      **The options, in the order they should be considered:**
      1. **Integrate power, and stop accumulating `add_ele`** — the path that was already the
         fallback, and the one this outlet class shipped with before the increment change.
         Cross-checked where both sources exist: over the same three-minute watch
         `mtr_co_yellow`'s own counter advanced 0.028 kWh while its power integrates to ~0.030 —
         within about 7%, against the 3,200% error being fixed. Needs a staleness guard so a
         device that stops reporting cannot compound its last wattage, which is the documented
         weakness of integration and the fault the increment change was reaching for.
      2. **Accumulate only on a CHANGED `add_ele`.** Correct for the stuck-value case that
         dominates today, but systematically under-counts a steady load, whose consecutive
         genuine increments are equal — the failure would be quiet and in the flattering
         direction, which is the worse kind.
      3. Patch the vendor node to mark the event. Rejected on sight: it puts a local edit in
         `~/.node-red/node_modules`, where nothing in this repository can verify it and a package
         upgrade removes it silently — the same exposure shape as `findTimeout` and the broker
         config.

      **Option 1 was taken — see RM-047 above**, where its cross-check is redone properly against
      five days of both figures rather than the single three-minute window quoted here.

- [ ] **RM-042 (S)** Retire `monthly_reports`, `monthly_building_reports` and
      `generate_monthly_report`, and drop the second RPC call in `server/reports.mjs`.
      **UNBLOCKED 2026-09-10 (RM-072).** The condition was that the period tables carry a full
      month in production and be compared against the legacy ones on real data rather than the
      rehearsal's fixtures. August 2026 has now gone through both paths and they agree to the
      digit — `monthly_building_reports` and `period_building_reports` both report
      `90.9468091666591` kWh for `2026-08-01`, read from the live project.

      **That comparison was the building row only, and the device rows do not agree — measured
      2026-09-13.** 7 of the 20 August device rows disagree on `energy_kwh`, every one of them an
      outlet (`co1` 1.09 legacy against 0.632137 period; `co4` 0.02 against 0). Sample counts,
      peaks and averages match exactly, so both saw the same observations. **The disagreement is
      explained, and the period table is the right one:** recomputed today from raw `readings` with
      the generators' own formula, the period figures are reproduced exactly and the legacy ones
      are not. `monthly_reports` was generated 2026-09-03, before RM-047b corrected the outlets'
      fabricated energy; `period_reports` was regenerated 2026-09-08, after it. The building row
      agrees because the building total is the four branch meters, which RM-047 never touched. So
      the legacy tables are not merely redundant — they hold known-inflated outlet figures, which
      strengthens the case for retiring them.

      **What remains is larger than a four-line change**, measured by reference count: the
      `generate_monthly_report` call in `server/reports.mjs` and its test (it runs inside
      **`ibems-ingest`**, so that is the service to restart); the dead frontend readers
      `getReportMonths` and `getDeviceReports` in `src/lib/supabaseReports.ts`, which nothing
      calls; the monthly tables' entries in `BACKUP_TABLES`, which RM-075's coverage test will
      require removing once they are dropped; `supabase/rehearse.sh`, whose phase12 assertions and
      phase27-against-phase12 comparison run *after* every migration is applied and would fail on a
      drop; `docs/storage-contract.md` and `docs/backup-policy.md`; phase27's one-time backfill
      block, which reads `monthly_building_reports` and so cannot be re-applied alone afterwards;
      and the migration itself — a `drop table` on production rows, which is the operator's to
      apply, and only after the code that uses the tables is deployed.

- [x] **RM-043 (S)** **DONE 2026-09-02, deployed.** **The office kiosk was running a week-old
      build and nothing said so.** MEASURED on the Pi: `ibems-kiosk.service` had been up since
      25 August 10:52; `dist/` was rebuilt 1 September 20:42. A single-page app never reloads
      itself, so the office display had been serving the 25 August bundle through four deploys —
      while the same URL over Tailscale, opened fresh each time, showed the current one. Nothing
      was broken, which is why nothing caught it: the report was "it looks different on the
      kiosk".

      *Immediate:* the kiosk service was restarted, which is all a deploy ever needed and is
      exactly the step nobody will remember next time.

      *Durable:* `src/lib/buildVersion.ts` plus `useBuildWatch`. The signal is the entry bundle's
      own hashed filename — Vite already derives it from the contents, so there is no version file
      to emit and nothing to keep in sync, and in development the entry is `/src/main.tsx` and
      never changes, so it is inert there rather than needing a special case. The booted name is
      read from the DOM, NOT remembered from a first poll: a tab that loaded build A and first
      polled after B shipped would otherwise adopt B as its baseline and never reload, which is
      the very case this exists to end.

      **A RELOAD MUST BE EARNED.** Every ambiguous answer — a failed fetch, a 502 page, HTML with
      no module script — resolves to "no new build", because a wrong reload puts the office
      display into a loop and that is far worse than an hour of stale build. Both guards were
      checked by breaking them: treating an unknown bundle as new fails two tests, and removing
      the idle check fails two more.

      *Who reloads:* the kiosk reloads itself, since nobody is standing at it to click anything;
      every other viewer gets a dismissible offer, because they may be mid-command and a page that
      refreshed under someone's hand would be a worse fault than the one being fixed. Once a new
      build is known the hook stops asking what is served and re-checks only for idleness, on a
      15s timer — at the 5-minute poll interval the idle guard would only ever have held a reload
      back if somebody happened to touch the screen in the minute before a poll.

      *A test bug worth recording:* the first version fired the interaction and then advanced a
      full poll interval, which simulates somebody who left five minutes ago, not somebody using
      the screen — and reported the working guard as broken.

- [x] **RM-044 (M)** **DONE 2026-09-02, applied live.** **The office is drawn, and the surveyed
      pack became a preset instead of being deleted.** `carePlan.ts` held the CARE office's layout
      as a build-time pack: it rendered wherever `SITE.scene_pack` named it, could not be edited,
      and could not be used anywhere else. The knowledge in it was real — the outlet coordinates
      came from the live Node-RED dashboard's own fixed `coords`, the ceiling grid from
      `LIGHT_PLAN`, which the 3D scene draws from too. Deleting it would have thrown that away;
      leaving it hard-coded kept the office undrawable.

      *`src/lib/planPresets.ts`* carries it as `care-office`, applied from Settings → Floor plan.
      After applying, the data is the source of truth and the preset is only the seed.

      **THE FRAME CHANGES, AND THAT WAS THE TRAP.** The pack's numbers are normalised against the
      320x550 **viewBox**; `plan_x`/`plan_y` mean "where in this ROOM", and the room rectangle is
      inset 10px on every side. Copying one into the other looks entirely correct — every value is
      still a plausible 0..1 — and puts every device a few percent out, in the same direction,
      with nothing to flag it. `toRoomFrame` is tested on the corners and asserted not to be the
      identity.

      *A room may now carry its own proportions* (`attrs.plan.aspect`, `parseAspect`), so this
      office draws as the 300:530 it has always been drawn as rather than as a square. A room that
      has not said stays square, and square still means "nobody has said" — `geometry.ts` is
      explicit that this room was never actually measured.

      *Applied to production 2026-09-02, from the same arithmetic the button uses rather than
      hand-copied numbers:* 14 devices into `CARE Office`, 7 outlets positioned, 7 circuits with
      3 lamps each, room aspect 0.5660. **All 14 load-shed tiers survived** — the bulk write
      builds on each device's effective config because the write is a whole-row upsert, and
      breaking that guard fails a test.

      *So `carePlan.ts` and the old `PlanShell.tsx` are deleted*, and `useControlPlan` no longer
      takes device coordinates from a pack. That closes FI-016's remaining half. Two tests went
      with the pack — a preference test and its anti-vacuity control — because there is no longer
      a second source for data to beat; what replaced them asserts that an undrawn site gets
      nothing rather than another building.

      **CORRECTED SAME DAY, twice.** The first version put the preset in `src/lib/planPresets.ts`
      and `test/device-ids-in-frontend.test.mjs` failed CI — correctly. That module ships to every
      deployment, so a replicated site would have carried this office's `co1`..`l7` in its bundle
      and offered them as a starting point for somebody else's room. The layout now lives in
      `src/components/control/plans/carePreset.ts`, one of the two directories that guard exempts
      **because they load only behind `SITE.scene_pack`**. `src/lib/planPresets.ts` keeps the
      machinery — types, `toRoomFrame`, `presetPlacements` — and names no device.

      And the drawn Control plan looked much worse than the pack it replaced: a bare square. Two
      causes, both fixed. `.control-outlet-plan--data` hard-coded `aspect-ratio: 1`, so a 300:530
      room drew as a square and stretched every device across it; the card now takes the room's
      own `attrs.plan.aspect`. And `DataPlanShell` draws only the sketched outline, which lost the
      glazed partition and the sliding door — facts about this building that the shape vocabulary
      cannot express. `CarePlanShell` restores them as a **pack**: loaded only when
      `SITE.scene_pack` names it, drawing no device and knowing no device id, re-expressed in the
      room's own 0..1 frame so it cannot sit a few percent off the pins beside it. A replicated
      deployment gets the sketched outline and is told it has no presets.

- [x] **RM-080 (S)** **DONE 2026-09-15 in code; the live rows are an operator step.** **CO6 and
      CO7 were drawn in each other's places.** The operator, from the physical installation: CO6 is
      on the right wall and CO7 on the glazed partition. Every copy of this layout descends from the
      original Node-RED template's `coords`, and that template had the pair the other way round —
      so all of them agreed with each other and none with the room.

      **Two sources draw an outlet, and a fix in one leaves the other wrong.** The Overview's 3D
      scene (`scene3d/geometry.ts`, `OUTLET_COORDS`) and its WebGL fallback
      (`scene3d/FloorPlanView.tsx`, `OUTLET_LAYOUT`) draw from code. The Control page's outlet plan
      and Settings → Floor plan draw **only** from `device_config.plan_x/plan_y` — there has been no
      code fallback since this entry's parent, RM-044 — and `control/plans/carePreset.ts` only seeds
      those rows when the preset is applied. All three code copies are swapped; `nearestWall` then
      moves CO6 to the right wall and CO7 onto the partition on its own, and CO7 at x=+1.5 clears the
      door gap exactly as CO6 did.

      *One trap, written into the file:* `FloorPlanView` labels each outlet `CO{i+1}` from its
      **array index**, so the swap changed the x/y values in place. Reordering the rows would have
      moved both pins and relabelled them back, and drawn exactly what was there before.

      *Pinned, and confirmed failing first* (4 failures against the old data): `geometry.test.ts`
      asserts the wall each FIXTURE is built on, not only what `nearestWall` returns for a pair of
      numbers — the table-driven cases alone would still pass on unswapped fixtures — and the
      door-gap clearance test now covers co5/co7. `carePreset.test.ts` pins CO6 and CO7's room-frame
      points to the exact values the live rows are corrected to, so the preset, the scene and the
      database cannot quietly drift apart again. `FloorPlanView.test.tsx` renders the fallback plan
      and asserts where the CO6 and CO7 **labels** are drawn — both halves of the index trap at once —
      and was neutered to prove it: against the unswapped component it fails, restored it passes.

      **The live rows, read 2026-09-15 with the service role, read-only:** still exactly the preset's
      values, never moved by hand — co6 `0.75 / 0.198113`, co7 `0.916667 / 0.339623`. **Until they
      are corrected, the Control page and Settings still draw the old positions.** The statement,
      for the Supabase SQL editor:
      ```sql
      begin;
      update public.device_config set plan_x = 0.9166666666666666, plan_y = 0.33962264150943394 where device_id = 'co6';
      update public.device_config set plan_x = 0.75,               plan_y = 0.1981132075471698  where device_id = 'co7';
      select device_id, plan_x, plan_y from public.device_config where device_id in ('co6','co7') order by device_id;
      commit;
      ```
      Both coordinates of each row change together and `space_node_id` is untouched, so phase23's
      both-or-neither constraint and its room-change trigger are satisfied. Settings → Floor plan can
      do the same in whole percents (92/34 and 75/20).

      *Ruled out, so nobody chases them:* the live Node-RED flow no longer carries an outlet
      floor-plan template (checked against `flows.json`); `ibems.layout.v1` in localStorage holds
      furniture only; `space_nodes.attrs.plan` holds the room's shape only. Circuit, sockets, protocol
      version and shed tier are identity rather than position, and are unchanged — both outlets are
      `C.O Yellow` and `group_3`. `docs/replication.md`'s "Not covered" row claiming the Control
      page still pins one building's outlets was stale since RM-044 and is corrected.

- [x] **RM-045 (S)** **DONE 2026-09-02, deployed.** **The stale flag covered the pin it
      described.** MEASURED on the office kiosk (800x480): four stale outlets rendered four
      "STALE" pills that hid CO1 and CO4 completely and most of the outlet plan with them. The
      flag is `position: absolute; top: 0; right: 0` inside a wrap that, on a plan, is only as
      wide as a ~24px pin — so the word is wider than the thing it labels. Not a regression from
      RM-044; it had always been like that, and only became obvious once several outlets went
      stale at once.

      `StaleDataBadge` gains `variant="dot"`: a 9px marker at the pin's corner, nudged outside by
      its own radius so it touches rather than covers. **The word is what shrinks, not the
      announcement** — the live region and its full sentence are identical in both variants, and
      a test asserts it, checked by making the compact variant drop its `aria-label`, which fails.
      The lists and the alerts popover keep the word, where there is room to say it.

- [x] **RM-046 — RESOLVED 2026-09-03. 18/20 online, and the recovery took BOTH halves.**
      Final state: every outlet, every light switch and all four meters online; discovery
      broadcasters **3 → 17**; Node-RED's journal **230 → 1 line a minute**. The only two still
      offline are `acu_main` and `sens_outside_temp`, which is RM-016 and unrelated — they have
      never been paired.
      **What fixed it, with the evidence for each step and the limits of the claim.** Three
      interventions, three outcomes:
      1. A power cycle into a congested channel (morning) — **made it worse.** 18 devices became 4.
      2. A channel change with no re-association (16:15, ch 11 → 1) — **recovered nothing.** The
         air was measurably fixed (interference score 93 → 0, Pi retry-discarded frames 93 → 2)
         and in 21 minutes not one device connected.
      3. A power cycle into the clean channel — **17 of 17 came back.**
      So neither was sufficient alone: the devices needed to re-associate, and they needed a
      clean channel for that association to succeed.
      **Where that reading is weaker than it looks, said plainly.** Each is a single observation
      and none was controlled. The channel at the time of the morning power cycle was never
      measured — 11 was read at 14:47, hours later — and the neighbouring APs are demonstrably
      hopping (one was seen on channel 10, then 13, then 8 across three scans within two hours).
      So "the morning cycle went into a congested channel" is inference, not measurement.
      **Which makes the fixed channel the load-bearing part of the fix, not the specific number.**
      If BEMS is left on auto it can wander back onto a busy channel and this recurs with no
      change on our side. Confirm it is pinned manually.
      Still not measured, and still only visible from the router's admin page: the AP's
      maximum-associated-clients setting, the DHCP pool, and why the LAN renumbered onto a
      different private /24 in the first place. The fleet being healthy does not answer any of
      the three, and the renumber remains unexplained.
      Nobody was told any of this while it was happening — see **EX-163**.

- [x] **RM-046 (historical detail, kept for the diagnosis)**
      **The access point was dropping the fleet.** 2026-09-03, after the RM-020 power cycle: 4 of
      18 devices online, only the three physical meters broadcasting, and the other fourteen
      associating and dropping continuously. The full measurement is in §0.
      **What makes this a network finding and not a bridge one:** the vendor cloud, which reaches
      these devices over the internet rather than our subnet, saw five of them change state
      between two `tuya:devices` runs minutes apart. Node-RED cannot cause a device to go offline
      to Tuya. The Pi itself is not the flapping party either — `NetworkManager` logged zero
      disconnects, signal 86 on the correct 2.4 GHz SSID, channel 11, and no competing AP visible.
      **THE CAUSE IS NOW MEASURED, 2026-09-03 — `npm run rf:survey`.** The device SSID is on
      **channel 11 with a foreign AP on channel 10 at signal 82 against its own 87**, 17 MHz of
      overlap. Adjacent-channel interference is the destructive kind: two APs on the SAME channel
      hear each other and take turns, but two on 10 and 11 overlap in frequency and cannot decode
      each other, so neither defers and they corrupt each other's frames.
      It explains **which** devices survive, which is what makes this testable rather than
      plausible. A strong client near the AP rides it out and a weak one does not: the Pi is at
      about −33 dBm and has never dropped, the meters in the panel stayed up, and the switches and
      outlets spread around the room are exactly the ones that churned. It also explains why a
      Node-RED restart cannot help and why the vendor cloud sees the same flapping.
      Scored across the three non-overlapping channels: **ch 1 = 31, ch 11 = 93, ch 6 = 118**.
      **The action is to move the AP to channel 1.** Note that channel 6 is *worse* than the
      channel in use — channels 4 and 5 carry strong APs that bite deep into it — so "just change
      the channel" is not enough guidance and picking 6 would make things worse.
      A subnet census the same day found only **7 live hosts on the whole /24**: the router and six
      clients, out of about twenty expected. So this is not an AP at its client ceiling with
      everything associated; it is most of the fleet unable to hold an association at all.
      **Still needs the router's admin page**, and none of it is visible from the Pi: the channel
      change itself, the maximum-associated-clients setting, and the DHCP pool.
      **The other lead, still open:** the AP renumbered its LAN onto a different private /24
      across the power cycle. A router does not renumber itself for no reason,
      and whatever did it is the best candidate for what else changed. Check its **maximum
      associated clients** and DHCP pool: eighteen Tuya devices plus the Pi, the kiosk and phones
      is a lot for consumer firmware dated 2020-09-27, and a client cap produces exactly this
      signature — some admitted, some refused, the set rotating.
      **Sequence on the day.** Re-run `npm run tuya:macs` immediately before acting, not the night
      before: the split moved twice inside an hour on 2026-08-26 and moved again between two runs
      on 2026-09-03. Then the AP. Only then power-cycle whatever is still dark to both the cloud
      and the segment — and note that a Node-RED restart was already tried on 2026-09-03 and
      recovered nothing, so this is the RM-021 case where restarting re-enters the same timeout
      loop rather than the `l6` case where it fixes things in two seconds.
      **Take `docs/physical-install.md` on the same trip** — its twelve `〔FILL IN〕` gaps need a
      camera and a panel read, and this is the visit that closes them (RM-033).
      Related: **RM-013** is the same root cause seen intermittently; this is it at fleet scale.

- [x] **RM-008** ~~Apply the three Phase 9 migrations.~~ **Done 2026-08-21.** Applied via the
      Supabase Management API; all four objects confirmed live (`readings_buckets`,
      `roll_up_and_prune_readings`, `readings_hourly`, `commands_complete_own_inflight`),
      PostgREST's schema cache reloaded, and the three daemons restarted onto Phase 9 code.
      Verified end to end against real data: a 7d request now returns 475 buckets whose
      newest point is ~9 minutes behind now, where the same window previously returned 1,000
      raw rows ending four days in the past. Every bucket covering the outage is a gap — 124
      of them, all with zero online samples and null power — while the 24 buckets reading
      746.5 W all predate the outage and all have real online samples, i.e. the meter was
      genuinely drawing that at the time. The over-cap guard raises through PostgREST as
      designed. Retention correctly reports nothing to do: the oldest reading is 2026-08-16,
      inside the 30-day window.

- [x] **RM-009** ~~Apply the three Phase 10-12 migrations and restart the ingest daemon.~~
      **Done 2026-08-22.** Applied by hand in the Supabase SQL editor, schema cache reloaded.
      All four tables answer over the data API and PostgREST advertises all six functions.

      *Rehearsed first:* `supabase/rehearse.sh` applied `schema.sql` and all twelve phase
      files in order against PostgreSQL 16 on the Pi, then drove every function against
      seeded data including the live failure shape — a meter frozen at 746.5 W while offline.
      All assertions passed; the two defects it surfaced were both in the harness, not the
      migrations.

      *Verified against production:* `readings_archive` returns real 6-hourly buckets, and
      every bucket with `online_count: 0` comes back `power_w: null` rather than charting the
      frozen value — the invariant proven on live data, not only in a container. Both
      destructive functions execute as no-ops against a cutoff nothing predates. `anon` gets
      404 on all four new functions and empty results on all three new tables, so the
      revoke-then-grant and the RLS both hold.

      *Daemon restarted onto the new code.* All three retention passes run and each names its
      own table; the report pass runs clean; ingestion resumed at 60s with
      `buffered_row_count: 0`, `last_error: null`, and zero error lines through a soak.

      **Two things this does NOT yet prove**, recorded so they are not assumed:
      1. `readings_hourly` is still empty — nothing is 30 days old, so the first real rollup
         lands around 2026-09-15. The rollup/raw seam that `readings_archive` merges has been
         exercised in the rehearsal but never in production. Worth re-checking then.
      2. The report has never run on a complete month. The first is September's, generated in
         early October.

- [x] **RM-001** ~~Put the Pi back on the same 2.4 GHz network as the field devices.~~
      **Done 2026-08-24, on site.** All four branch meters are online and reporting live,
      changing values; `total_power_w` and `avg_voltage` read real numbers again after four
      days of `null`.

      **The recorded root cause was incomplete, and acting on it alone would not have fixed
      this.** There were two independent faults:

      1. **Network.** The Pi was on the general office SSID (5 GHz, ch 36) — but the decisive fault was
         *client isolation*, not the band: the Pi (`…113`) and a laptop (`…173`) could not ping
         each other **on the same /24**. A band split on a bridged SSID cannot do that. The
         connection timestamps date it precisely — the Pi left the device SSID on Aug 20 at 14:38 and
         the devices dropped at 15:27. Fixed by bringing the saved device-SSID profile back up; the profile and PSK were
         already stored at `autoconnect-priority 30`, so it survives a reboot. The Pi also moved
         off a LAN whose address range accidentally overlapped the tailnet's own CGNAT range.
      2. **Protocol drift — the reason the meters stayed down after the network was fixed.**
         The field devices had moved to Tuya protocol **v3.4/v3.5** while the flow still declared
         3.1/3.3. This is what explains `mtr_co_yellow` dropping on **Aug 17, three days before
         anyone touched the Wi-Fi** — a fact the network theory never accounted for.

      Two live-flow config changes, each backed up first (`flows.json.bak-<ts>` on the Pi):
      - `findTimeout` `1000` -> `10000` ms on all 21 `tuya-smart-device` nodes. Measured: every
        device broadcasts on UDP 6667 every **5.0 s**, so a 1 s discovery window caught one in
        five, by luck. That is what 2,520 discovery timeouts per 30 minutes actually was, and it
        had been latent long before the outage.
      - `tuyaVersion` corrected per node to what each device actually announces: the 4 meters and
        all 7 light switches -> `3.5`, CO1/CO2/CO4/CO7 -> `3.4`. `tuyapi 7.7.1` supports both.

      **Neither change lives in `shared/registry.mjs` or the generated flow** — both are on the
      four hand-built source tabs.
      *Corrected 2026-08-24, after checking rather than assuming.* This first said a flow
      regeneration would revert them. It would not: `deploy.mjs` appends to the live flow
      (`merged = baseFlows.concat(bridgeNodes)`) and removes only bridge-tab nodes, so the source
      tabs survive, and no other script in this repo rewrites tuya node properties. The real
      exposure is quieter — nothing in the repo *declared* these values, so nothing verified
      them, and an old `flows.json` restore or an editor hand-edit would lose them with no diff
      and no alarm while looking exactly like a network fault. Closed by EX-021b.

- [x] **RM-010** ~~Apply `supabase/phase13_device_functions.sql`, then deploy the frontend.~~
      **Done 2026-08-24.** Applied by the operator in the Supabase SQL editor; frontend deployed
      to the Pi at `bd1cbdc` and the kiosk reloaded onto the new bundle.
      *Verified against the real project, not assumed:*
      - the exact select the frontend runs — all six original columns plus `functions` — returns
        200, with `functions: null` on the existing row, i.e. "not configured", which is the
        value that falls through to the class default;
      - the CHECK is live: an invalid element is rejected with `23514`
        (`device_config_functions_valid`) and the row is unchanged afterwards;
      - RLS still holds in both directions on the new column. `anon` SELECT returns `[]`, and an
        `anon` PATCH returns **204** — which is *not* a refusal but PostgREST's "success, nothing
        matched", the exact shape `server/proxy.mjs` already carries a warning about. Re-asking
        with `Prefer: return=representation` returns `[]` (zero rows affected) and a service-role
        read confirms the row unchanged. A 204 alone would not have been evidence.

- [x] **RM-001a** ~~Devices offline that need a physical check.~~ **Closed 2026-08-24.** The
      operator re-paired `co3`, `co5` and `co6` with new device ids and keys; all three now
      announce and report. 19 of 20 devices online.
      *Worth keeping:* they came back reporting `online: true` while their nodes still declared
      `3.1` and the devices announced `3.4` — the same "tolerating a lower version" trap recorded
      in `shared/tuyaNodeSettings.mjs`. Working was not evidence the declaration was right; the
      declarations were corrected to the measured value and those three left the unverified list.

- [x] **RM-015** ~~Apply `supabase/phase15_device_connectivity.sql`.~~ **Done 2026-08-24.**
      Applied and returning real data immediately. **Re-apply it** — the function was amended
      the same day to also return `expected_samples`; see EX-023b.
      *What running it revealed within minutes, which is the point of having built it:*
      the four branch meters sit at **100% uptime with zero transitions**, while every device
      that flaps is an outlet or a switch (30-98%, 2-8 transitions each in one hour). That
      narrows RM-013 considerably — this is not the whole fleet disassociating, it is the ~14
      distributed relays and not the 3 panel-mounted meters, which is the shape a client limit
      or an association problem makes, not the shape a bad radio makes.

- [x] **RM-017** ~~Apply `supabase/phase17_device_categories_sensor.sql`.~~ **Done 2026-08-25.**
      Verified the way RM-014 said to and the way I then failed to twice: the retired `kitchen`
      is refused with `23514` and the row is unchanged, which proves the constraint was replaced
      without writing anything. `server/schemaProbe.mjs` (EX-031b) now encodes both halves of
      that method so the next check does not depend on remembering it.

- [ ] **RM-020** Three of the seven convenience outlets need power cut and restored.
      *Acceptance:* `co4`–`co6` answer locally again, and stay answering for an hour.
      **Population as of 2026-08-26 evening: `co4`, `co5`, `co6` — but for two different
      reasons, which is new.** `co4` and `co6` are absent from the segment outright: no ARP
      entry, not associated to the AP. `co5` **is** associated and answers ARP, and still
      belongs here, because RM-021's software remedy was actually tried on it and failed.
      *This corrects an entry written earlier the same day*, which moved `co5` out of RM-020
      on the strength of its ARP reply alone. The ARP evidence was right; the inference from it
      was not. **Answering ARP proves the device's network layer is alive, not that a Tuya
      session can be established** — see RM-021 for the measurement.
      **Watch how fast this moved, because it is the point of the entry.** Inside a single
      session on 2026-08-26, `tuya:macs` first reported `co4` and `co5` both on the segment
      and only `co6` absent; twenty minutes later `co4` had gone `stale` → `absent` while
      `co5` was still answering. Two runs, two different answers, no intervention. A list of
      devices to power-cycle is a perishable good — **re-run `npm run tuya:macs` immediately
      before the trip**, not the day before.
      *Method note, since `STALE` is easy to misread:* an ARP entry in state `STALE` is a
      cached one the kernel has not confirmed, so it is weaker evidence than `REACHABLE`. The
      way to settle it is to force resolution and watch the transition. `co5` went to
      `REACHABLE` and then decayed back to `STALE` — which is exactly what a device that is
      associated but talking to nobody looks like — while `co7`, used as the positive control,
      held `REACHABLE` throughout because the bridge is actively polling it. `STALE` here is
      a symptom of being undiscoverable, not evidence of being gone.
      **Prior population, 2026-08-26 09:30: `co4`, `co5`, `co6`.** It was six; `co1`–`co3` returned
      once the Pi was moved back to the device network (RM-023), which is a reminder that
      "unreachable" was partly the Pi's own fault and worth ruling out before anyone drives in.
      **NARROWED 2026-08-25 evening, from six devices to two.** The claim below that all six had
      "lost both their inbound local path and their outbound cloud connection" was half right.
      Tuya's `/v1.0/iot-03/devices/factory-infos` returns each device's MAC; matched against the
      Pi's own `ip neigh`, four of the six — `co1`–`co4` — **still resolve**, meaning they
      answered an ARP request and are associated to the AP. Only `co5` and `co6` have no entry
      at all. Same symptom at the bridge, opposite remedies: this entry is now the two that
      genuinely need a person, and `co1`–`co4` moved to **RM-021**.
      The method touches no device and needs no local connection, which matters because probing
      these directly costs their single local connection slot — `npm run tuya:macs`
      (`server/macPresence.mjs`). `co7` was used as the positive control: its MAC resolves to
      the entry its working node uses.
      *The distinction this corrects is the expensive one:* "off the network" sends someone to
      the office; "on the network but not discoverable" is a config change. The cloud view alone
      cannot tell them apart, because a device can lose its *uplink* to Tuya while remaining
      perfectly well associated locally — which is exactly what these four did.
      **NEEDS SOMEONE AT THE OFFICE — power-cycle them.** Measured 2026-08-25: `co1`–`co6`
      read `online: false` **both** locally and in the Tuya cloud, `CO1` logged no successful
      connect in 40 minutes, and each was producing ~27 `find() timed out` entries per five
      minutes. Only `co7` and the seven lights survive.
      **A Node-RED restart was already tried and did NOT recover them.** That distinction is
      the whole content of this entry: the same restart *did* recover `l6` and took the fleet
      from 9/21 to 14/21, so these six are not the stuck-node case (RM-012, and the note now
      in `CLAUDE.md`) — they are the genuine one ADR-002 names, where the device has lost both
      its inbound local path and its outbound cloud connection and **power is the only
      recovery**. Cloud dispatch cannot help; that limitation is stated in RM-018 on purpose.
      Two of them (`co1`, `co3`) were still cloud-reachable ~20 minutes earlier and degraded
      during the session, which is RM-013 doing what RM-013 does. Not caused by the dispatch
      test run against `co1`: `co3` was never commanded and dropped identically.
      *Do not close this by restarting anything.* If they return without a power-cycle, that
      is new information and RM-013 needs it.

- [ ] **RM-021** `co1`–`co4` are on the segment but no longer discoverable.
      *Acceptance:* all four report `online: true` to the bridge and hold it for an hour.
      **No site visit needed — this is the half of RM-020 that has a software path.** All four
      answer ARP, so layer 2 works. What they have stopped doing is broadcasting their Tuya
      discovery datagram, and `find()` is the only way the bridge locates a device. Measured by
      a 40 s passive listen on the discovery ports: exactly 11 broadcasters, which is precisely
      the 12 online logical devices (the dual-channel meter is two logical readers of one
      physical box). None of `co1`–`co6` broadcast at all.
      **The fix the node already supports:** `deviceIp` is a documented property on every
      `tuya-smart-device` node and is **empty on all 19**. It is passed straight into tuyapi
      (`node_modules/node-red-contrib-tuya-smart-device/src/tuya-smart-device.js`), and tuyapi's
      `find()` returns immediately when both id and ip are set (`tuyapi/index.js`, the
      `isValidString(this.device.id) && isValidString(this.device.ip)` short-circuit) — going
      straight to a TCP connect and skipping the broadcast these four no longer send.
      **NOT YET PROVEN, and the gap is honest:** all four had their local port open and stable
      across three probe passes spanning 20 minutes. A key-matching sweep was then run against
      them — up to 18 handshake attempts per address. **These devices accept one local
      connection at a time**, so if the first attempt took the slot the rest tested nothing, and
      the sweep's "no key matched" result was discarded as unsound. Since that sweep all four
      have refused the port for over half an hour while still answering ARP. Whether a local
      session can still be established is therefore **open**, and it is the gate on this entry.
      *Ruled out:* a rotated local key. All 17 keys the cloud can vouch for match the flow
      (`npm run tuya:devices -- --verify-keys`).
      *Next step:* after a cooling-off period, **one** connect attempt per device with the
      correct key, `co7` first as a positive control. No sweeps. If they refuse a clean single
      attempt, this folds back into RM-020 and needs the visit after all.
      *If it succeeds:* the addresses must **not** be committed — this repo is public and
      `live-flow-baseline.json` would be the natural but wrong home for them. Commit the
      mechanism instead: resolve MAC → ARP → `deviceIp` at run time, which is also correct
      across DHCP changes. A DHCP reservation on the AP is the durable version and is an
      operator action.
      **Membership of this entry moves — watch it, do not memorise it.** Over 90 minutes on the
      evening of 2026-08-25 the set went `co1 co2 co3 co4` → `co3 co4`: `co2`'s ARP entry
      expired and it left the segment (becoming RM-020), while `co1` flapped cloud-online,
      offline and online again. Re-run `npm run tuya:macs` before acting; a list written down is
      stale within the hour.
      **A Node-RED restart cannot fix this, and that is measured, not assumed.** The reflex this
      project rightly has — restart before suspecting hardware, which recovered `l6` — does not
      apply, because `find()` can only locate a device that broadcasts. Two independent 40 s
      listens 90 minutes apart heard exactly 11 broadcasters both times, and none of `co1`–`co4`
      was among them, including while `co1` was cloud-ONLINE. Restarting would re-enter the same
      timeout loop.
      **`co3` CAME BACK ON ITS OWN at ~22:45 on 2026-08-25, with no power-cycle, no restart and
      no config change.** RM-020 asked for exactly this to be recorded if it happened. It
      resumed broadcasting (the bridge connected to it six times in the following forty minutes)
      and its local port reopened at the same time. Fleet went 12/21 → 13/21.
      *This revises the session's own conclusion.* The four had their local port open for the
      first 20 minutes, then shut immediately after a key-matching sweep was run against them,
      which looked like the sweep having occupied their single connection slot. `co3` recovering
      spontaneously — untouched for over an hour — points instead at the port tracking the
      device's overall network state: dormant device, no broadcast and no port; awake device,
      both. **The sweep was probably not the cause.** It was still the wrong thing to run, but
      it should not be recorded as the explanation.
      **What this means for the remedy:** these devices cycle back by themselves, so "dark" is
      not a terminal state and the churn is bidirectional. A static `deviceIp` is still the
      right fix — it would have held `co3` through the dormant window instead of losing it for
      hours — but the urgency is lower than a permanently dark device implies.
      **THE REMEDY WAS FINALLY TRIED, ON `co5`, 2026-08-26 — AND IT DID NOT WORK.** This entry
      had proposed `deviceIp` since 2026-08-25 without ever running it. It has now run.
      `co5` qualified on every stated criterion: dark to the vendor cloud, `online: false` to
      the bridge, and answering ARP (confirmed by forcing resolution and watching it reach
      `REACHABLE`, with `co7` as a positive control). It was given a static address resolved
      from ARP at run time. **The mechanism worked exactly as documented and bought nothing:**
      the log shows `findDevice(): Found device, going to connect` — the tuyapi short-circuit
      firing, discovery skipped — and then no connection, for six minutes. Zero successful
      connects; 14 timeouts. The address was correct and useless.
      **So the conclusion this entry was missing: ARP is not reachability.** ARP is answered by
      the device's network layer. A Tuya session needs its application layer, and ADR-002
      describes precisely the state where the second is gone while the first is healthy — an
      ESP device with an exhausted socket table. `deviceIp` cures a device that has stopped
      *broadcasting*; it does nothing for one that has stopped *listening*, and from the
      bridge's side those look identical. **`co5` folds back into RM-020**, exactly as this
      entry's own next-step said it should if a clean attempt was refused.
      **The change was reverted, and the reason is worth keeping.** A static address is not
      inert once it is wrong: `find()` short-circuits past discovery whenever id and ip are
      both set, so after the power-cycle that `co5` actually needs, a stale address would send
      every attempt to whatever now holds that lease — and the symptom would be the outlet
      staying dark *after* someone drove to the office to fix it, which is the worst available
      outcome. **A `deviceIp` is only as good as the moment it was resolved. Clear it or
      re-resolve it after any power-cycle.** The live flow was confirmed byte-identical to its
      pre-change backup afterwards, with all 19 nodes' `findTimeout` and `tuyaVersion` intact.
      **The mechanism is committed even though the outcome was negative** — EX-129,
      `npm run set-device-ip:pi`, dry-run by default and reversible. It resolves the address at
      run time from cloud MAC joined against ARP, so no address is ever written into this public
      repository and the value cannot go stale in a file. It is still the right first thing to
      try on the next device that is dark-but-on-segment, because it is free; it is simply no
      longer allowed to be described as a fix.
      *Earlier that same day:* **RESOLVED WITHOUT THE REMEDY, 2026-08-26 (morning).** `co1`,
      `co2` and `co3` are all online and on
      the segment; `co4`–`co6` were absent outright and were RM-020. Nothing was in this entry's
      state at that moment, and the static `deviceIp` has still never been applied.
      *What actually fixed it was RM-023* — returning the Pi to the device network. That is the
      uncomfortable part worth keeping: a night was spent characterising these devices as
      half-dead, and the AP outage the next morning reset them cleanly while stranding the Pi
      on the wrong SSID. **Rule out the Pi's own network before diagnosing the fleet's.**
      `npm run tuya:macs` answers that in one command and touches nothing.
      Leave this entry open: the condition is real, it recurs, and the `deviceIp` remedy is
      still the right one if a device sits on the segment and refuses to be discovered.

- [x] **RM-022** ~~Importing a route module loads every secret in `server/.env` into the
      process.~~ **Done 2026-08-25.** `npm run test:server` is now **299/299 on the Pi** — it
      was 290/295 there and fully green on a workstation, which is the shape of the bug.
      *Fix:* deleted the module-scope `loadDotEnv` from `server/enrollRoute.mjs` and
      `server/removeRoute.mjs`. Nothing replaced it and nothing needed to: the systemd unit
      already carries `EnvironmentFile=…/server/.env` (verified in the running process — five of
      five key variables present after a restart), and the two CLIs
      (`node-red-bridge/enroll-device.mjs`, `remove-device.mjs`) already load it themselves.
      The route modules read `process.env` lazily inside their handlers, so nothing observed the
      value at import time anyway — the call was pure side effect.
      *Guard:* `server/envHygiene.test.mjs`, in two halves on purpose. A behavioural half imports
      each route module in a clean child process and asserts it added no environment keys; a
      source half asserts no route module calls `loadDotEnv` at module scope. The behavioural
      half alone would be **asleep exactly where it matters least** — on a checkout with no
      `server/.env`, `loadDotEnv` is a silent no-op and the assertion passes vacuously. A third
      test pins the deployment assumption the fix rests on: if the unit ever loses its
      `EnvironmentFile`, the proxy starts with no credentials and fails as "the vendor cloud
      could not be reached", a wrong diagnosis this project has chased before.
      All three were confirmed to fail before the fix and pass after.
      *Verified beyond the suite:* proxy restarted and serving, `/api/tuya/devices`,
      `/api/enroll` and `/api/remove` all still gated at 401 rather than crashing, zero errors in
      the journal, and both CLIs still reach the vendor cloud —
      `server/enrollRoute.mjs`, `server/removeRoute.mjs`, `server/envHygiene.test.mjs`
      *What it was.* `server/enrollRoute.mjs` and `server/removeRoute.mjs` both called
      `loadDotEnv(...)` at module top level, so merely `import`ing one populated `process.env` with `TUYA_ACCESS_SECRET`,
      `SUPABASE_SERVICE_ROLE_KEY`, `BREAK_GLASS_PASSWORD_HASH`, `HARDWARE_DISPATCH_ENABLED` and
      the rest. `server/proxy.mjs` imports both, so this fires on every proxy start and in every
      test that spawns one. Demonstrated by importing `enrollRoute.mjs` alone and diffing
      `process.env` before and after — five secrets appear, with no function called.
      **Two consequences, and the second is the one that will cost time.**
      *Credential reach:* `CLAUDE.md` names `TUYA_ACCESS_SECRET` the most sensitive value in this
      system, ahead of the service-role key, because it reaches hardware directly and no RLS
      scopes it. An import should not be what loads it.
      *A suite that cannot pass where it matters:* **5 of 295 server tests fail on the Pi and
      pass on a workstation** — the tests that construct an unconfigured deployment
      (`/api/tuya/devices` → 501, `HARDWARE_DISPATCH_ENABLED` false by default, the gate-closed
      dispatch pair) get the Pi's *real* configuration instead of the empty one they set up.
      Confirmed pre-existing at a clean `HEAD`, so it is not a regression from this session.
      This is worse than a plain failure: the Pi is exactly where `docs/pi-session-brief.md`
      says to run the suite before deploying, so it trains you to accept five red tests, and the
      next real regression hides among them. This project already has "a green test suite is not
      proof" written down; this is the mirror image, and it is louder.
      *Fix direction:* load `.env` in the entrypoints (`proxy.mjs`, `ingest.mjs`, `scheduler.mjs`
      and the CLIs, which already do it) and never in an imported route module. Then assert the
      absence: a test that imports a route module and checks `process.env` is unchanged.

- [x] **RM-023** ~~The Pi falls back to the office SSID and never comes back.~~ **Fixed
      2026-08-26** by EX-106.
      **Observed, not theorised.** At 08:20:47 the device AP dropped the Pi's DHCP lease. At
      08:21:03 NetworkManager failed the connection (`link timed out`, reason `ssid-not-found`)
      and two seconds later auto-activated the general office SSID — which is 5 GHz. The device
      AP was back on the air within the hour at full signal, and **the Pi stayed on the office
      network anyway**. `autoconnect-priority` does not prevent this: it chooses among
      candidates at activation time and never roams away from a connection that works. Left
      alone it would have sat there indefinitely.
      *Cost while it lasted:* every field device unreachable — a discovery listen on the office
      subnet heard **zero** Tuya broadcasters — while the Pi kept internet, Tailscale and a
      working dashboard. Exactly the failure `CLAUDE.md` describes, arriving on its own rather
      than because anyone touched the config.
      *Why the fallback was kept rather than removed:* it is what preserved remote access during
      the outage. Deleting it would trade a recoverable problem for an unrecoverable one — a Pi
      with no uplink and nobody on site. The fix is to leave the fallback automatically once the
      preferred network returns, not to forbid it.
      *Recovery, for the record:* moving the Pi back took the fleet from a true 0/21 to **15/21**
      — the best reading in days. `co1`, `co2` and `co3` all returned, `co2` having been off the
      segment entirely the night before. The AP outage appears to have helped the devices, which
      re-associated cleanly on its return; the Pi was the only thing that did not.

- [x] **RM-024** ~~A half-open tuya session reports `online: true` with frozen readings.~~
      **Fixed and deployed 2026-08-26.**
      *The fix, in two halves.* `buildLatest` now derives when a metered device last actually
      reported, and (a) stamps `ts` with that instead of `now`, which re-arms the staleness
      watchdog that could previously never fire, and (b) drops `online` to false once that
      exceeds `STALE_READING_MS`. The energy tab writes no timestamp of any kind, so a new
      generated bridge step (`Track meter arrivals`) supplies one for those four meters; the
      outlet tab's own stamp is preferred where it exists.
      **The part that had to be measured, not reasoned.** The obvious rule — "the numbers
      stopped moving, so it is dead" — is WRONG here, and shipping it would have subtracted
      healthy circuits from the building totals. `mtr_lo_yellow` and `mtr_co_yellow` are two
      channels of ONE physical meter: over ten minutes the first sat byte-identical at 0 W while
      the second swung between 215 V and 229 V. Confirmed after deployment, where both read
      arrival ages of 3-44 s: they are reporting, their values are simply constant. So the
      signal is **arrival**, taken from the sample buffers that fill on every message regardless
      of whether the measurement changed.
      *Threshold* is ten minutes: measured, an online outlet's arrival stamp lagged up to 59 s
      and the energy tab drains its buffers on a five-minute cycle. Erring short is the
      dangerous direction — `online: false` removes a device from the totals.
      *Verified live:* fleet held at 15/21 across the deploy with no meter falsely dropping out,
      and timestamps now vary with real arrival instead of reading 0 s forever.
      Each of the four guards was confirmed to fail the suite when neutered —
      `shared/buildLatest.mjs`, `node-red-bridge/build-flow.mjs`, `test/reading-freshness.test.mjs`
      *What it was, found 2026-08-26 while diagnosing RM-023 and the reason that took as long
      as it did.* With the Pi on the wrong subnet and **no** device reachable, the bridge reported
      three meters as `online: true` carrying plausible wattage. The values were frozen — byte
      for byte identical across samples 25 seconds apart, for over half an hour:

      ```
      09:00:51  co_yellow=1214.4W/220.2V   arec_acu=595.5W/219.5V
      09:01:41  co_yellow=1214.4W/220.2V   arec_acu=595.5W/219.5V
      ```

      Two independent faults stack, and either alone would have been caught:
      1. The Pi's address changed out from under established TCP sessions, so no FIN was ever
         sent. The tuya nodes still believe they are connected and nothing disproves it.
      2. `shared/buildLatest.mjs` stamps `ts = now` unless the device reports its own time, so
         **the timestamp is synthesized and the staleness watchdog can never fire** on these
         rows. EX-029b already established that an offline device's timestamp is not evidence of
         anything; this is the same fact biting from the other side, where the device is not
         even marked offline.
      *Why it matters more than a cosmetic bug:* this is a dashboard stating, confidently and
      with units, that a building's circuits are drawing power it cannot actually observe. Every
      other honesty guard in this project (EX-029b, EX-102, the `—` never-0 rule) exists to stop
      exactly that, and they are all downstream of an `online` flag that was wrong.
      *Fix direction:* do not infer liveness from socket state alone. Either require a reading
      to have advanced within N poll intervals before reporting `online`, or have the tuya nodes
      apply a TCP keepalive short enough to notice a dead peer. The second is the real fix; the
      first is the cheap guard and is testable without hardware.

- [x] **RM-025** ~~`server/scheduler.test.mjs` fails intermittently when the Pi is busy.~~
      **Fixed 2026-08-26.** Verified against the acceptance criterion rather than by re-running
      until green: with six CPU burners pushing load to **13.2 on 4 cores** — roughly double the
      6-7 that used to break it — the server suite passed **311/311 three times consecutively**.
      *Cause:* every test spawned the real daemon, slept a fixed 2500 ms, killed it and
      asserted. Under load the daemon had not finished a cycle yet, so the assertion ran against
      a process that had done nothing. Lengthening the sleep only moves the load at which it
      breaks and makes every run pay for the worst case.
      *Fix:* wait for the OUTCOME, not for a duration. Each test now states the condition it
      actually cares about and stops the moment it holds; the timeout is a failure ceiling,
      never a wait. The suite got **faster** as a result — this file went from ~42 s of pure
      sleeping to 19 s.
      *The part that needed a production change:* a test asserting that nothing happened cannot
      poll for an outcome. The daemon now logs `first cycle complete` once, after its first
      completed tick, which is the only load-independent way to tell "it ran and did nothing"
      from "it had not got round to it yet". That line is worth having on the Pi regardless —
      "started" and "actually running its loop" are different claims, and only the second means
      a due schedule would have fired.
      *A second race, also closed:* `dueNowRow` pins a schedule to the minute the ROW is built
      in while the daemon judges due-ness by the minute its tick runs in. Built at HH:MM:59 the
      two disagree. Tests that need a due-now row now wait for enough of the minute to remain.
      **It also repaired a test that never tested its claim.** `does not fire the same minute
      twice, even though it checks more often than once a minute` waited 4 s against a 15 s
      loop, so exactly ONE tick ever ran and the guard was never exercised. Proven both ways:
      with the guard deleted it passed under the old timing and fails under the new. The tick
      interval is now tunable via `SCHEDULE_TICK_MS`, symmetric with the existing
      `SCHEDULE_REFRESH_MS`, so the test drives a dozen cycles in a fraction of the old runtime.
      `server/scheduler.mjs`, `server/scheduler.test.mjs`
      *What it was.* Measured 2026-08-26, with load pushed to ~6-7 on 4 cores by running the
      suite back to back. At low load: 299/299, repeatedly. At high load, roughly one run in two fails — and a
      **different** test each time (`does not fire the same minute twice`, `a due schedule is NOT
      dispatched when its audit row cannot be written`, `the audit row is attributed to whoever
      saved the schedule`, `with the gate closed a due schedule is audited as dry_run`). Never a
      test outside this file.
      Confirmed **not** caused by adding a test file: an extra file of twelve trivial tests did
      not reproduce it, and removing the new file did not prevent it. It is the load.
      *Why it is worth an entry rather than a shrug:* this is RM-022's lesson again. A suite that
      is green when the machine is idle and red when it is busy teaches you to re-run until it
      passes, which is indistinguishable from ignoring it — and the Pi is busy exactly when
      something is wrong and you most need the suite to mean something.
      *Likely cause:* these tests spawn real processes and wait on wall-clock minute boundaries;
      under load the process does not get scheduled inside the window they assume. Fix direction
      is to inject the clock rather than to lengthen the timeouts, which only moves the load at
      which it breaks.

- [ ] **RM-026** Deye solar inverter: read generation into the same store as everything else.
      *Acceptance:* inverter power and daily yield appear in `/api/readings/latest` and in
      Supabase alongside the meters, on the same cadence, with the same honesty rules.
      **VERIFIED STATE 2026-08-26 — the hardware is not on the network, so nothing can be
      built yet.** Checks, all negative:
      the configured address is in the logger stick's own **AP-mode subnet**, which has no route
      from the Pi and times out at the gateway; a sweep of the whole device subnet found **no
      host listening on the Solarman TCP port**; and a standard UDP logger-discovery broadcast
      drew **no reply** (only the Pi's own packet echoing back). ARP shows nothing on the segment
      but Tuya devices and the router.
      *(An earlier version of this line said "AP-mode **default**". The address is in that
      subnet but is not the vendor's default host — a small thing, but the difference between
      "nobody ever configured it" and "it was configured while the stick was in AP mode".)*
      **RE-VERIFIED 2026-08-26 evening, remotely, and still absent.** The re-check is worth
      more than the first one because it replaced a sweep with a **census**: every neighbour on
      the device subnet was forced to resolve, then each MAC was diffed against the cloud's own
      per-device MAC list. **Exactly one host on the segment is not a Tuya device: the router.**
      That is a stronger statement than "the Solarman port is closed" — it says there is no
      unaccounted host for the logger to *be*. The UDP discovery broadcast was repeated to both
      the subnet and global broadcast addresses; every datagram received was the Pi's own probe
      echoing back, and there were **zero genuine replies**.
      **Also checked, and worth recording because it closes a door somebody will otherwise try:
      there are no Solarman credentials** in `.env` or `server/.env`. So the vendor-cloud
      route is not quietly available as a way around the network problem — it would need
      credentials the operator has not provided, and it would trade a local read for a
      dependency on someone else's uptime.
      **What already exists**, and it is less than it looks: `node-red-contrib-solarman-devices`
      is installed, and the live flow has a `Deye Solar Inverter` tab containing **one node** —
      a `solarman-register` wired to nothing — plus a `solarman-device` config node holding the
      serial number and that unreachable address. No data path, no context keys, no registry
      entry, nothing in this repository. Treat it as a placeholder, not a partial build.
      **It is a placeholder that RUNS, though — corrected 2026-09-01.** "Wired to nothing" is
      true of the register node and describes the data path accurately, but it reads as inert and
      the config node is not: it holds a connection and retries, logging
      `Socket problem for <addr>:8899: Socket timeout` about **3 times per 30 minutes**. Harmless
      at that rate — the dead outlets' discovery loop is fifty times noisier — and it costs
      nothing to leave. Worth knowing only so that the first person to see it in the journal
      does not read a running node as evidence the integration is half-built, or go hunting for a
      fault in something that is waiting on hardware.
      **The prerequisite is an operator action, not a coding task:** join the logger stick to
      the device SSID (it is 2.4 GHz-only, like everything else here) and confirm it takes a
      DHCP lease on that subnet. Until `npm run tuya:macs`-style evidence shows it present,
      every integration shape below is untestable.
      **Then choose the shape — the two are genuinely different, and the second is not obviously
      better despite being what was asked for:**
      *(a) Direct, in Node-RED.* Use the installed `solarman-devices` nodes to poll the logger
      over its TCP port and write context keys the bridge collector already knows how to read.
      Follows the existing pattern exactly — one more collector, one more registry entry, and
      `buildLatest` treats it like any other meter, including the freshness rules from EX-107.
      No new moving parts, no new failure mode, and it is the only shape where the inverter
      appears in building totals without further work.
      *(b) Via MQTT.* A separate poller publishes to the Mosquitto broker already running on the
      Pi, and Node-RED subscribes. This is the shape the operator described. It adds a process
      to supervise and a broker to depend on, and the broker's current record is not encouraging
      — the only other thing that ever published to it (RM-005) has been silent for days and
      nobody noticed, because nothing watches it. **If (b) is chosen, a liveness check on the
      MQTT topic is part of the work, not an extra.**
      **DECIDED 2026-08-26 evening: (b), MQTT — reversing the recommendation above.** The
      entry recommended (a), and so did I when asked earlier the same day. The operator pushed
      back with a specific proposal — a pre-built local Solarman-to-MQTT bridge — and the
      evidence supports them rather than the entry. Four reasons, in order of weight:
      1. **The register map is the hard part, and it is already solved.**
         `kbialek/deye-inverter-mqtt` supports **`sun-5k-sg03lp1` by name**, across five
         metric groups (`deye_sg03lp1`, `deye_hybrid_battery`, `deye_hybrid_bms`,
         `deye_hybrid_timeofuse`, `settings`). Hand-modelling a hybrid inverter's battery,
         BMS and time-of-use registers on the `solarman-devices` nodes is exactly the work
         (a) was quietly assuming away.
      2. **There is a model-specific quirk that would have cost a day.** This inverter times
         out when asked for more than roughly 16 registers at once; the bridge exposes
         `DEYE_LOGGER_MAX_REG_RANGE_LENGTH` for it. Under (a) that surfaces as intermittent
         read failures, which read as a network fault — this project's most expensive failure
         shape, and one it has now paid for several times.
      3. **The liveness condition this entry attached to (b) is already met.** The bridge
         publishes `status` and `logger_status` topics of its own, so the check is a
         subscription rather than something to build. That was the main argument against (b).
      4. **Port ambiguity becomes configuration rather than diagnosis.** The stick may speak
         TCP on 8899, the AT protocol on 48899, or Modbus/TCP on 502 — newer SG03LP1 loggers
         ship with **8899 closed** — and the bridge selects with `DEYE_LOGGER_PROTOCOL`.
      *What (a) still had going for it, and what it costs to give up:* it is the only shape
      where the inverter reaches building totals with no further work, and it adds no process
      to supervise. Under (b) that plumbing is a subscriber plus a registry entry, and the
      broker becomes a dependency. Worth it, given 1 and 2.
      **The Pi is ready: Docker 29.7.2 (aarch64), Mosquitto active on 1883, ~5.5 GB RAM free.**
      **TWO THINGS TO SETTLE BEFORE THE BRIDGE IS INTRODUCED, one of them security:**
      - **DONE 2026-08-26 — the broker is locked down (EX-131).** It ran `allow_anonymous true`
        on 1883 and 9001 across every interface, on the device network, while the bridge is able
        to **write** to the inverter (active power regulation, battery parameters, time-of-use)
        behind its `DEYE_FEATURE_*` flags — so anything on that SSID could have commanded the
        inverter. It is now loopback-only. **Two consequences for this work:** keep every
        `DEYE_FEATURE_*` write flag **off**, and **run the container with host networking**,
        because a container on a default bridge network can no longer reach the broker. If a
        non-host network is genuinely needed, add a listener bound to the LAN address *with a
        `password_file`* — do not widen the loopback listener.
      - The broker still carries **zero traffic** (re-checked 2026-08-26), so no MQTT path in
        this system has ever been proven end to end. The first thing the bridge does is also
        the first real test of Node-RED's subscriber.
      **Do not put the serial number, the logger's address, or its password in this repository.**
      They belong in `server/.env` or the Node-RED credential store, like every other secret.

- [ ] **RM-013** Devices leave the 2.4 GHz network and rejoin.
      *Acceptance:* the AP holds one channel, and the announcing-host count stays at the full
      device count for an hour.
      **CONFIRMED cause — the access point re-selects its channel.** Observed 2026-08-25: the
      same BSSID (`…:36`) was on **channel 9**, and ~40 minutes later on **channel 11**. A
      channel change disassociates every client at once, which is exactly the clean, fleet-wide,
      binary dropping seen here and independently by Tuya's cloud. Auto-channel selection is on
      and should be pinned.
      **CORRECTION to what this entry said earlier.** It asserted a 20-client association limit
      as the cause. That was inferred from a single snapshot showing exactly 20 hosts — a round
      number is suggestive, not evidence, and I stated it with more confidence than one
      observation supports. The channel change is *directly observed*, so it now leads. A client
      cap may still contribute (a laptop on this SSID was evicted outright while devices were
      dropping), but it is a hypothesis and the channel hop is a fact.
      *Also ruled out by measurement:* airtime congestion (12-16% utilisation), signal (-46 to
      -48 dBm at the Pi, 95% at a laptop), encryption (WPA2/CCMP, not mixed WPA1/TKIP), local
      keys (all 19 verified against the cloud), protocol versions, and discovery timeout.
      **The fix is on the access point:** pin the channel (1, 6 or 11 — non-overlapping; it is
      already on 11), disable auto-channel selection, and raise the client limit above 30 while
      in there. Telnet (23) is also open alongside SSH on a network whose dispatch gate is live.

      *Channel pinned to 11 by the operator, 2026-08-25 ~08:45.* The AP has held 2462 MHz
      through every sample since, so that half is done. Devices bounced to 2/20 on apply (every
      client is disassociated when wireless config is applied) and had recovered to 8/20 within
      ten minutes. **Too early to judge** — the honest test is whether the announcing count
      holds over an hour, not whether it recovers.
      *The firmware exposes no client-limit setting*, so that lever is unavailable. If drops
      persist once settled, the next things to look for are an **idle/inactivity timeout** (many
      APs deauthenticate quiet clients, and metering devices that report on change are exactly
      that), WMM power-save, and airtime fairness. Failing those, a second AP.
      *Correction worth carrying:* an earlier note here claimed client isolation on the office
      SSID. That rested on the Pi being unable to ping a Windows laptop, which Windows Firewall
      alone explains — see CLAUDE.md. On the device SSID the Pi resolves other clients by ARP
      and reaches them, so there is no isolation.
      *Limitation of the cloud diagnostic, found while using it:* Tuya's online state is not
      instantaneous, so soon after a mass disassociation it can still report devices as up. The
      signal to trust is the set of offline devices **changing between runs** — which it did
      here, confirming genuine flapping rather than a stale snapshot.
      **Outcome measured an hour after the pin, 2026-08-25 09:48.** The pin worked, partially:
      the AP has held 2462 MHz throughout, discovery errors fell roughly 3x (270 per 10 min
      against ~840 before), and the online count is now **stable at 8/20 rather than rotating**.
      Stable-and-low is a different fault from flapping, and the change is real.
      **But 7 devices did not come back: `CO4-CO7` and `Light Switch 5-7`, offline to Tuya as
      well as to the bridge.** Contiguous ranges, and unreachable by either path — which is
      precisely the total-hang case RM-018's cloud fallback explicitly cannot recover. They need
      power cycling. Applying wireless config disassociates every client, and these are the ones
      that hung rather than rejoined.
      *So the remaining question splits in two:* whether the channel pin holds the fleet stable
      once those 7 are power-cycled back (the real test), and separately why a bounce hangs
      devices at all — which is socket pressure, and is what RM-018's second half addresses.
- [ ] **RM-018** Devices hang: the relay stops responding to local commands and the physical
      button does nothing, recoverable only by removing power. Seventeen devices across an
      office makes that a walk to a breaker per incident.
      *Acceptance:* a hung device can be recovered without cutting its supply.
      **FIRST, RESTART NODE-RED — it is free and it is not always the device (2026-08-25).**
      `l6` had been diagnosed the previous day as physically unreachable: `EHOSTUNREACH` at
      every protocol version, ARP `FAILED`, written up as RF range or a stale address and
      "needs eyes on the fixture". `sudo systemctl restart nodered` reconnected it in two
      seconds, and the operator then toggled the real fixture successfully. The same restart
      took the fleet from 9/21 to 14/21 online. A tuya node that has given up stays given up,
      and its symptoms are indistinguishable from a device that is out of range or unplugged —
      so a walk to the breaker can be a walk taken for a software fault. Restart first, then
      cut power only if the device is still dark. See RM-012.
      **Analysed in `docs/adr-002-device-recovery-path.md`.** A Tuya device holds two
      independent paths — inbound local TCP, and an outbound connection it keeps open to Tuya —
      and they fail separately. An ESP device with an exhausted socket table is unreachable
      locally while its cloud connection stays healthy, which is exactly "hung here, fine in the
      app". Measured support: two nodes hold two sessions to each of the two shared meters (16
      sessions for 14 devices), discovery hammered them at 2,520 failed attempts per 30 min
      before `findTimeout` was fixed, and Tuya currently reports ~12 online against the bridge's
      ~8.
      **Built, and as of 2026-08-25 actually reachable — it was not before.** Local stays
      primary (faster, works without internet, no vendor in the loop); cloud is the path that
      exists precisely when local has failed, and the audit row records `via` so a command
      that only survived through the cloud is visible as the warning it is.

      **It had never once fired, for two independent reasons, both silent.**
      *1. Local never reported failure.* `dispatchLocal` decided success on HTTP 2xx, but the
      Node-RED endpoint answers as soon as it ACCEPTS the message — the tuya node then fails
      asynchronously, after the response has gone. Commanding `co1` returned
      `{ok:true, via:"local"}` in 209 ms while Node-RED logged `Device not connected. Can't
      send the SET commmand` at the same instant. So the operator was told a command worked
      when it had not, AND the cloud branch below it was unreachable dead code.
      *2. Cloud dispatch could not authenticate.* `dispatchCloud.mjs` called `client.call()`
      directly while every other consumer called `ensureToken()` first, so it failed with
      `code 1010: token invalid`. Intermittent rather than dead, which is worse: a token
      warmed by an earlier call in the long-running proxy made it work, so it would pass a
      casual test and fail during a real incident.

      Fixed: `call()` now obtains its own token (at the source, so the next caller cannot
      repeat it), and `dispatchCommand` asks the bridge whether the device is online before
      attempting local — offline means a local SET cannot land, so it falls through to cloud
      rather than fabricating a success. An unknown answer is deliberately NOT treated as
      offline: a readings endpoint that hiccups must not reroute every command through the
      vendor.
      **Verified on real hardware:** cloud dispatch to `co1` — locally unreachable, cloud
      online — returned `{ok:true}` in 972 ms. That is the acceptance met: a device that
      cannot be reached locally was commanded without cutting its supply.
      `server/dispatchLight.mjs`, `server/dispatchCloud.mjs`, `server/tuyaCloud.mjs`,
      `server/proxy.mjs`
      **What it will not fix, so nobody expects otherwise:** a device with no cloud connection
      either (what Tuya reporting `offline` means) is reachable by neither path, and power
      remains the only recovery. This converts the common failure into a non-event, not the
      total one.
      *Caveat found while testing:* `GET /v1.0/devices/{id}/status` returns last-known values
      for an offline device rather than failing, so a successful status read is **not** proof of
      reachability. Trust the `online` flag; a command is the only real test.
      *Worth doing regardless:* collapse the two shared meters to one local session each (which
      would also make RM-019's channel interchange impossible by construction, since both
      channels would come from one atomic read), and back off failed discovery.
- [x] **RM-019** ~~The shared dual-channel meter swaps its two channels.~~ **Closed by
      construction 2026-08-25.** The two yellow channels used to arrive on two separate
      sessions, which is what allowed them to disagree about which snapshot they came from.
      EX-037b collapsed those to one session, so both parsers now read the *same message* and
      there is no ordering left for them to get wrong.
      *The detector stays* (`npm run check:meters`). It cost little and it is the only thing
      that would notice if this returned by some route nobody predicted — and the confirmed
      event on 2026-08-25 at 00:13 is exactly the kind of thing that is easy to stop believing
      once it stops happening.
      **It returned, 2026-09-19 — by the device itself, not by any route the flow controls.** The
      session collapse removed the only software cause there was; the meter re-assigns its clamps
      on its own. RM-122 corrects it at the source, and the detector now sees the hand-off shape
      this episode had.

- [ ] **RM-016** Two flow nodes reference devices that are not in the Tuya cloud project.
      **2026-09-17: the IR half is resolved; Outside Temp remains.** The operator re-paired the blaster
      (a Lasco "Smart IR" hub) and entered its id and key into `NBRIC IR Blaster`, which is now in the
      project with a matching key and announces v3.3. Waking it and everything it feeds is RM-114 to
      RM-121. `Outside Temp` has never been installed; its node stays quiesced and its flow unchanged,
      and RM-114 stops it borrowing the hub's readings. This entry closes when it is installed or removed.
      *Acceptance:* each is re-paired into the project, or removed from the flow and registry.
      **Resolution chosen 2026-08-25: leave them, quiesce them.** Re-pairing needs the physical
      devices and the Smart Life account, so it stays with the operator; removal was declined
      because `acu_main` reads the same `ac_dash_state` and would lose its temperatures too.
      The retry noise is stopped with `npm run quiesce:pi` (EX-098), and both devices now read
      honestly as offline rather than a fabricated ONLINE (EX-097). Re-pairing later is a
      `--undo` away. This stays open because the devices still cannot report.
      `NBRIC IR Blaster` and `Outside Temp` came back **NOT IN PROJECT** from
      `npm run tuya:devices`. They can never work — the ids in the flow belong to no device this
      account can see, which is why they have never announced and never will. Either they were
      removed from the Smart Life account, or they belong to a different one.
      This is also why `sens_outside_temp` has no real telemetry: `acu_main` and
      `sens_outside_temp` both read `ac_dash_state`, which the IR blaster feeds.

- [ ] **RM-070** Daylight-driven lighting and blinds. Measure how much natural light a room
      already has, so artificial lighting is not run against a bright window, and drive a
      motorised blind to use that daylight rather than shut it out.
      *Acceptance:* a daylight sensor reports a light level into `/api/readings/latest` and
      Supabase on the same cadence and under the same honesty rules as every other reading; a rule
      holds a lighting circuit off while measured daylight sits above a setpoint, with hysteresis;
      and blind position is commanded through the same gated, audited path as everything else.
      **BLOCKED ON HARDWARE THAT IS NOT PHYSICALLY INSTALLED**, reported by the operator
      2026-09-09. Verified in the code the same day, and it is worth stating precisely because the
      two devices are blocked differently from each other and from RM-016: there is no `lux`,
      `illuminance` or light-level member anywhere in `shared/`, so the catalogue cannot parse a
      reading it has no code for; and there is no blind, shade or cover class in the registry, so
      a blind is not merely unenrolled but **unrepresentable**. Neither is research — both are
      enrolment work once the devices are mounted.
      *Design notes worth keeping before anyone builds this.*
      It belongs in **Event-Driven**, beside the aircon loop, because it closes a loop on a sensor
      rather than on a clock or a demand limit. The aircon loop's safety posture transfers with one
      substitution: **the loop may decide whether a circuit needs to be on, but a person must
      always be able to switch a light on and have it stay on.** Daylight control that fights the
      light switch is the most common complaint made about these systems, and the aircon loop
      already has the mechanism — `manual_override_recent`, widened to cover every non-loop source.
      The lighting circuits are **on/off relays, not dimmers** (`class: 'switch'`), so this is a
      threshold with hysteresis, not a proportional dimming loop. The deadband matters more here
      than it does for the aircon: a light that hunts is visible to everyone in the room, where a
      setpoint that hunts is not.
      A blind would be **the first actuator in this system with travel time and intermediate
      positions**. `shared/commands.mjs`'s "action is absolute, never toggle" rule still holds —
      "go to 40%" is absolute — but a relay's readback is instantaneous and a blind's is not, so
      "did the command land?" and "has it finished moving?" become two different questions, and
      the audit trail currently only knows how to ask the first. Settle that in the command
      contract before the hardware arrives, not after.
      *Evidence for the page:* `src/components/automation/EventDrivenPanel.tsx` renders the card
      with this id beside it, so the claim can be checked rather than believed.

- [ ] **RM-012** `l6` (Light Switch 6) was a one-way link. **Reachable and controllable again
      2026-08-25 — recovered by a Node-RED restart, with nobody touching the fixture.**
      *Acceptance:* `ip neigh` resolves its address, and it stays online across an hour.
      *Remaining:* only the one-hour stability window. Reachability is no longer in question.

      **This overturns the 2026-08-24 diagnosis, and that matters more than the device.** It
      was recorded as not a configuration fault: discovery broadcasts arrived, but a direct
      probe returned `EHOSTUNREACH …:6668` at *every* protocol version and its address showed
      `FAILED` in the ARP table, so the conclusion was RF range, a power-save state or a stale
      address — "needs eyes on the fixture". No one ever went. Restarting Node-RED on
      2026-08-25 produced, within two seconds, `findDevice(): Found device, going to connect`
      then `Connected to device! name : Light Switch 6`; three commands then dispatched `-> OK`
      and the operator confirmed the physical fixture switching. Evidence of a live TCP session
      to :6668 is strictly stronger than the ARP resolution the acceptance asks for, which was
      only ever a proxy for reachability.

      **So the fault was node-side session state, not RF.** A tuya node that has given up stays
      given up: the retry loop keeps calling `findDevice()` against a socket that will never
      recover, and the symptom — permanent `EHOSTUNREACH`, ARP `FAILED` — is indistinguishable
      from a device that is out of range or unplugged. That is why a day of it read as a
      hardware problem.
      **Try `sudo systemctl restart nodered` BEFORE power-cycling anything** (see RM-018, where
      cutting power to each device was the assumed remedy). The same restart took the fleet
      from 9/21 to 14/21 online, so `l6` was not the only device stuck this way.
      Not yet a general rule: one restart, one observation. If a device is still dark after a
      restart, the hardware suspicion is back on.

- [x] **RM-011** ~~The `ACU` node is a second session to the `AREC ACU` branch meter.~~
      **Withdrawn 2026-08-24 — this was a wrong finding, corrected by the operator.** `ACU` and
      `AREC ACU` share a device id and local key **by design**: the aircon is the only load on
      the CARE ACU branch, so the meter measuring that branch is measuring the aircon. Two
      logical devices on one physical meter — the same arrangement `shared/registry.mjs` already
      documents for `mtr_co_yellow`/`mtr_lo_yellow`. The wiring says so plainly and I did not
      read it closely enough before filing: `AREC ACU` feeds the **Unified** parser (live
      V/A/W), `ACU` feeds the **Daily** parser (accumulated energy). Different purposes, one
      device.
      *The one real defect inside the false finding, now fixed:* `ACU` declared protocol `3.3`
      while that device announces `3.5`, which is why it alone logged 39 discovery timeouts in
      ten minutes. Matched to `AREC ACU`, and it has left the unverified list — its version is
      measured, because it is the same physical device.
      *Worth keeping:* "two nodes share a device id" is a normal shape here, not a smell. The
      question to ask is whether the wiring shows two purposes or one duplicated.

- [x] **RM-014** ~~Apply `supabase/phase14_device_categories.sql`, then deploy the frontend.~~
      **Done 2026-08-24.** Applied by the operator; the frontend was already deployed.
      Verified in both directions against the real project: `branch_circuit` is accepted, and
      the retired `hvac` is rejected with `23514`, leaving the row unchanged.
      *Method note worth keeping:* the first check wrote a valid new value to a production row
      to see whether it was accepted, which mutated real data to answer a question. The
      non-destructive form is to attempt a value the **new** constraint rejects — a failed write
      proves which constraint is active and leaves nothing behind. The row was restored.

- [x] **RM-002** ~~Verify the rotated light token against a real fixture.~~ **Done 2026-08-24,
      on site.** A light physically changed state from the dashboard, observed by the operator.
- [x] **RM-003** ~~Open the hardware-dispatch gate and confirm a real relay responds.~~
      **Done 2026-08-24, on site.** `HARDWARE_DISPATCH_ENABLED=true`, proxy restarted (it starts
      only if the token is present, so a clean start is itself evidence), and switches were
      toggled against real fixtures successfully. The first commands in this project's history to
      move real hardware.
      **Note the scope is wider than this entry originally claimed.** It said outlets and the ACU
      would still read `dry_run`; `server/dispatchLight.mjs` has listed
      `['switch','outlet_dual','acu_ir']` since `c287e4c`, so opening the gate made all three
      live at once. The Control page's "Outlets off" master now genuinely cuts every socket.
- [x] **RM-004 — DONE 2026-09-07. The re-check ran, and the answer was that the rule was
      wrong.** *Acceptance was:* a week of live-varying data with no unexplained alerts on the
      cyclical-load branch meters. Measured over the four days to 2026-09-07, on exactly that
      live-varying data: **2,833 anomalies** — iqr 2,152, both 667, zscore 14 — led by co6 (968),
      co5 (868) and `mtr_co_yellow` (698), which is the branch meter the acceptance names.
      **The median |z| across every flagged row was 2.37, against a threshold of 3.5.** The median
      thing this system called an anomaly was not anomalous by the other check at all, and 59.1%
      of flagged rows had an IQR fence collapsed to the ±3 W noise floor.

      **The mechanism, narrowed by running the numbers rather than reasoning about them — and my
      first explanation was wrong.** A switched outlet sits at 0 W, so `q1 = q3 = 0`, the floor
      substitutes 1 W and the Tukey fence becomes ±3 W. That alone is *not* enough: on an ALL-zero
      window the stddev floor makes z large too, both checks fire, and the sample is recorded
      either way. The false positive lives in a band one sample wide:

      | window | z | fence | method |
      |---|---|---|---|
      | ten zeros, then 74 W | 74.00 | [-3, 3] | `both` — kept |
      | nine zeros + one 74, then 74 | **3.00** | [-3, 3] | `iqr` — the 2,152 |
      | seven zeros + three 74s | 1.53 | [-166, 222] | `none` |

      One prior "on" sample lifts the stddev enough to pull z under threshold while two zeros
      still sit at both quartiles. **The second sample of every switch-on was an alarm.**

      Detection now requires the two checks to AGREE. On the measured window that is 2,833 → 667,
      **76.5% fewer**. It does not reintroduce the blind spot the noise floor exists to prevent,
      which is what makes it the right fix rather than merely a quieter one: a real jump on a flat
      window trips both checks at once and is still recorded, as are a step change on a variable
      circuit and a collapse to zero on a busy one.

      **What it gives up, stated rather than buried:** 14 rows of 2,833 — a value beyond 3.5σ that
      Tukey's deliberately generous "far out" fence still contains. There is a test that pins
      exactly that case.

      **Four neuters each fail the right tests**, including *raising the IQR noise floor* — the
      tempting alternative, which would have hidden the symptom without touching the reasoning.

      **The 2,833 existing rows are left alone.** They are the detector's own output, not a
      measurement of the building, and they are the evidence for this change; `method` tells them
      apart. The alerts popover looks back only 15 minutes
      (`src/lib/supabaseAnomalies.ts`), so they leave the UI on their own.
      `server/anomalyStats.mjs`, `server/anomalyAgreement.test.mjs` (11)
- [x] **RM-005** ~~Decide whether Mosquitto is still load-bearing or can be decommissioned.~~
      **Answered 2026-08-24.** RM-001 removed the one thing that explained the silence — the
      ESP32 is 2.4 GHz and the site was on 5 GHz — so the question is finally answerable, and the
      answer is that **nothing publishes.**
      - 90 s subscribed to `#` (every topic): zero messages.
      - `ss` on :1883: one client, Node-RED, over loopback. Nothing external is connected.
      - Of the 17 hosts now reachable on the LAN, 15 announce as Tuya devices and the other two
        are the gateway and a randomised-MAC host with no open ports — no ESP32-shaped host.
      What remains is one `mqtt in` node, "ESP32 AC Sniffer" on `nbric/ac/status` (Aircon tab),
      plus the `mqtt-broker` config node.
      **Deliberately not claimed:** that nothing has *ever* connected. The journal only reaches
      back ~20 h and holds a single mosquitto line with no connection entries, so it is not
      logging connections and proves nothing either way. The live evidence above is the whole
      basis for this answer.
      *Decommissioning is one action, not two:* removing the broker without also removing that
      `mqtt in` node leaves Node-RED logging a connection failure on every start. Low-risk to
      leave in place; the cost is only that Phase P would otherwise document "install Mosquitto"
      as a real step for a second building, which is the thing worth avoiding.
- [x] **RM-006** ~~Data retention: automatic cleanup so `readings` does not grow without bound.~~
      **Done 2026-08-21.** 30 days of per-minute resolution, rolled into permanent hourly
      buckets, pruned by `server/retention.mjs` on a 6-hourly check. Steady state ~830k rows
      in `readings`, ~175k rows/year in `readings_hourly`, both bounded. Was measured at
      130,367 rows after 4.7 days and growing ~27,700/day with nothing ever deleting a row.
- [x] **RM-006d** A backup policy for the Supabase project — the other half of the original
      RM-006, unaffected by the retention work above.
      *Acceptance:* a documented, verified backup, and a restore that has actually been tried.
      **A restore was performed 2026-09-22, 08:35 — `npm run restore:rehearse`
      (`supabase/restore-rehearse.sh`).** The day's export (19 tables, 12,960 rows) went into a
      throwaway PostgreSQL 16 with every migration applied first; every table's count matched
      `manifest.json`, and **every row, re-read from the restored table as JSON, equalled the JSON
      exported** — the type round trip on all 12,960 rows, not three spot checks. What doing it
      found, now in `docs/backup-policy.md`: the migrations seed `sites` and `dsm_thresholds`, so the
      backed-up tables are emptied before loading; `space_nodes` in id order needed five parents-first
      rounds for four rows; one account id had to exist first (recreated as a placeholder, which in a
      real restore is the operator account to recreate). `server/backup.test.mjs` holds the script to
      this module's table order. **Not exercised:** a scratch Supabase project and a frontend
      rendering the restored history (steps 2, 6, 7 of the doc's checklist) — a decision, in §0.
      **Earlier, half done.** The policy is written (`docs/backup-policy.md`) and the export tool is
      built and tested (`npm run backup`, `server/backup.mjs`). **No restore has been
      performed**, so this stays open: a backup nobody has restored is a belief, not a backup.
      The doc's final section is the checklist that closes it. Note also that `auth.users` is
      not exported — restored into a new project, every `commands` row keeps its audit
      content but loses its attribution.
      **Coverage and paging hardened 2026-09-13 (RM-075):** 19 tables instead of 10, every page
      keyed on a whole primary key, restore order checked against the migrations' foreign keys.
      That makes a restore more likely to work; it does not make this item done — **a restore has
      still never been performed.** RM-075 also found that for the tables whose user columns ARE
      foreign keys (`acu_rules`, `energy_tariffs`, `emission_factors`, `space_nodes`,
      `socket_config`, `site_ui_prefs`), a missing user is not lost attribution but a refused row.
- [ ] **RM-006c** Arm auto-shed. **Thresholds done 2026-08-24; tiers assigned 2026-08-31; what is left is one save from the Automation page — see below, the flag alone is not enough.**
      *Acceptance:* at least one device has a shed group, a threshold is set, and auto-shed is on.
      **Limits written, `auto_shed` deliberately left OFF:** `max_total_kw 2.21`,
      `max_phase_current 15.4` — 25% above a measured peak of 1,767.8 W / 12.30 A over 1,877
      readings (`npm run demand:profile`). A breach is now *detected and reported* on the
      dashboard while nothing switches on its own, which is the monitoring value with none of
      the risk. Both are editable on the Automation page; the operator expects to revise them,
      since the peak depends on what happens to be connected and tested at the time.
      **Tiers are now assigned — measured 2026-08-31.** All 14 shed-capable devices carry one:
      `l1`-`l7` in `group_1`, `co1`/`co4`/`co5` in `group_2`, `co2`/`co3`/`co6`/`co7` in
      `group_3`, written between 17:28 and 17:29 site time through the RM-006c editor. The
      classification gap this entry was opened for is closed.
      *Worth knowing before the flag is flipped:* `group_1` is the lighting, measured at ~16 W of
      a 919 W office-hours demand against a 2.21 kW ceiling, so the first shed step is the most
      visible action available and close to the least effective one. That is the operator's call
      and the tiers are editable; it is recorded here because nothing on screen says it.
      Auto-shed can reach switches, outlets and the aircon now that `DISPATCH_CLASSES` covers all
      three and the gate is open, and it never restores — so which circuits the building may lose
      unattended stays a facility decision, made in the Devices page rather than inferred.
      *Attribution is what actually arms this, and it is worth knowing before the toggle is
      flipped.* The write above went in as the service role, so `updated_by` is null — and
      `planShed` returns idle without an actor (`commands.requested_by` is NOT NULL, and a
      load-shed row is the last one anyone would want traced to an invented user). So auto-shed
      cannot fire even if the flag were set directly in the database. Saving from the UI stamps
      the real user and is the only path that arms it. That is a property to rely on, not a bug.

- [x] **RM-007** Sign in once on the office kiosk so it leaves the login screen.
      *Acceptance:* the kiosk shows the dashboard and stays signed in across a reboot.
      **Closed 2026-09-22: the reboot test happened.** The operator cut the office's power at
      07:42; the Pi cold-booted at 07:44:48; `ibems-kiosk` (user scope) is `active`; the proxy's
      first request from the kiosk origin came at 07:45:33 and was `OK`, and since boot it has
      logged **206 OK and 0 × 401** from that origin (the other 204 lines are CORS preflights). The
      session survived the boot through lightdm autologin without anyone touching the screen.
      **Mostly closed 2026-08-24, on site.** The kiosk is installed, `enabled`, `active`, and
      **signed in**: Chromium is up in `--kiosk` on the Wayland session against
      `http://127.0.0.1:5183/`, and the proxy logged **254 OK against 1 × 401** from the kiosk
      origin in an hour. EX-021's session-refresh fix is holding in production — the old loop
      ran 4,383 × 401 in 24 h.
      *Note for future passes:* `ibems-kiosk` is a **`--user` unit**. `systemctl is-active`
      in system scope reports it `inactive`/`not-found` and that is a false negative; use
      `systemctl --user` with `XDG_RUNTIME_DIR=/run/user/1000`.
      **What is left is only the reboot test** — that the session survives a cold boot via
      lightdm autologin has still never actually been exercised.
      *Narrowed 2026-09-02.* Two `systemctl --user restart ibems-kiosk` cycles (RM-043) confirmed
      the session survives a **Chromium process restart**: the profile at
      `~/.config/ibems-kiosk` holds an `sb-<project>-auth-token` in localStorage, and the proxy
      logged 2,061 authenticated requests from the kiosk origin in the hours after. So what is
      genuinely untested is now only the part a service restart cannot exercise — lightdm
      autologin starting the user manager from cold. That needs a real reboot, on site, with
      somebody able to reach the machine if it does not come back.


---

### Track B — replication. Making the system adaptable to any site.

Added 2026-08-26. Reasoning, and the two-tree model these all serve, in
`ibems-architecture-upgrade_2.md` §4–§7 (one level up, outside this repo).

**Why this exists.** The system works, and it works for exactly one room. The project's third
funded component is a framework letting other institutions replicate it, and a framework that
begins "open `shared/registry.mjs` and replace `co1..co7`" is not one. Seven specific couplings
are named in the architecture doc's §4; each item below removes one or more of them.

**The scope decision this reverses.** The 2026-08-10 architecture doc said "single-building
deployment … not a multi-tenant campus system", and the project tracker's item 1.9 recorded
"each building runs its own independent system". Each site still runs its own Pi and its own
stack — that part stands. What changes is that every relationship inside it becomes structural
rather than literal, and every row is stamped with the site it belongs to, so a shared cloud
later is configuration rather than a second migration.

**The property that constrains every item here:** the building must stay controllable with no
internet. EX-130 was built to guarantee it. Topology may live in Supabase; flow-critical wiring
may not.

- [x] **RM-027** ~~Site identity. Nothing in this system knew which building it was.~~
      **DONE 2026-08-27 — applied, deployed and verified against the live system.**
      Both migrations are in (`sites` plus `site_id` on the three tables that had none,
      probed read-only: 4/4 present, the seeded row matching `shared/sites/<id>/site.mjs`
      field for field). The Pi is at `bbf4993`; **399 bridge and 359 server tests pass ON
      THE PI**, which is the RM-022 acceptance and not the same claim as passing on a
      workstation. `verify:pi` 5/5 with `phase_current.blue` still null.
      *The evidence that the transitional default worked, which is the part worth keeping:*
      rows written by the OLD deployed code — which sends no `site_id` — came back stamped
      `mmsu-nberic-care` in production. That is the ordering hazard the rehearsal caught,
      demonstrated harmless on live data rather than argued about.
      *The riskiest change verified itself.* The scheduler's site-scoped read of
      `dsm_thresholds` would have failed **silently** if it returned nothing — schedules and
      auto-shed would simply never fire. It logged `loaded 4 schedule row(s); auto-shed off,
      0 device(s) assigned a shed tier`, which is RM-006c's real state, so it read the real
      row and not an empty set.
      *Incidentally observed:* the fleet went **8/20 to 15/20 across the deploy** — the seven
      light switches returned on their own. They had been offline to the vendor cloud as well
      as to the bridge earlier the same day, which is RM-013 doing what RM-013 does; the
      recovery is the access point's, not this deploy's, and is recorded so it is not
      mistaken for one.
      **One thing deliberately NOT verified live:** the 25 degree ACU policy floor. It is
      covered end to end by `server/proxy.test.mjs` against a real spawned proxy, and a
      refused command provably reaches neither the bridge nor the audit table — but
      exercising it in production means POSTing a command to a real building, and
      `docs/pi-session-brief.md` says to ask first every time.
      **The flow was not redeployed, and does not need to be.** Task 2 changed the generated
      flow's offset from `8 * 3600 * 1000` to `480 * 60000` — the same number of
      milliseconds. The live flow's behaviour is byte-identical, so a `deploy:pi --force`
      would buy nothing and is a flow write, which needs asking.
      *Prior state:* **BUILT 2026-08-26, NOT YET APPLIED.** Four commits: `3dea05d` the site module,
      `aa1e053` the timezone, `fbc77bf` the policy floor, `10fce92` the two migrations.
      *What is left is an operator action, not code:* apply `supabase/phase19_sites.sql`
      then `supabase/phase20_site_scoping.sql`, in that order, by hand in the SQL editor.
      **REHEARSED 2026-08-27 on the Pi, and it caught a defect that would have taken
      ingestion down.** `supabase/rehearse.sh` applied schema.sql and all nineteen phase
      files in order against PostgreSQL 16 in a throwaway container, then drove every
      function against seeded data. It failed twice before it passed.
      *The real one, and the reason this entry no longer says the migrations are safe to
      apply in any order:* `site_id` was NOT NULL **with no default**, and the daemons
      already running on the Pi do not send one — `ingestCycle.mjs` writes `building_totals`
      every 60 s and `updateHealth` upserts `ingestion_health`. Applying phase20 would have
      begun refusing every one of those writes within a minute, presenting as a Supabase
      outage rather than as a migration. **This plan had the ordering backwards in writing**
      ("Tasks 1-5 are safe to ship immediately; Task 6 goes after the migration"); without a
      default there is no safe order, only a choice of which side breaks. Each `site_id` now
      carries a transitional default, so the migration and the code deploy are
      order-independent — see the file's own header for when RM-030 removes it.
      The guarantee is **exercised, not asserted in prose**: the rehearsal performs the two
      inserts shaped exactly as the deployed daemons send them, with no `site_id`, and
      asserts each comes back stamped.
      *The harness one:* an assertion expected 120 `building_totals` rows and got 60,
      because the rollup exercised earlier in the same run had already folded hour 0 into
      `building_totals_hourly` and pruned those rows. The migration was fine; the check was
      coupled to an unrelated step's retention behaviour, and now compares against the
      table's own count. Same shape as the two harness defects RM-009's rehearsal found —
      which is now three for three, and the argument for never skipping it.
      `e186060`
      *Nothing is deployed and nothing is at risk meanwhile.* Every code change defaults to
      the current behaviour — `iso8`'s offset defaults to 480 and `test/contract.test.mjs`
      passes untouched, proven by neutering the default and watching it go red.
      **The query changes are deliberately NOT done yet** and must not be: swapping
      `.eq('id', 1)` for `.eq('site_id', …)` against a table with no such column is a
      PostgREST 400, and it would take the Automation page and the scheduler down. That is
      the second half of this entry, after the migrations are confirmed applied.
      *Shipped and live already, because it needed no schema:* **the aircon can no longer be
      commanded below 25 °C** — the university policy quoted in the funded plan, which the
      code had contradicted since the setpoint feature was built. Verified over real HTTP:
      18 returns `400 below_policy_floor`, 25 returns `202`. Closes §5 Q10.
      `shared/sites/mmsu-nberic-care/site.mjs`, `shared/siteConfig.mjs`,
      `supabase/phase19_sites.sql`, `supabase/phase20_site_scoping.sql`,
      `src/components/control/setpointOptions.ts`
      *Original statement of the problem, kept because it is what the migrations fix:*
      *Acceptance:* a second `sites` row can exist, this Pi writes only its own, and
      `npm run test:bridge` still asserts an identical `/api/readings/latest` shape.
      `supabase/schema.sql` makes `dsm_thresholds` a singleton — `check (id = 1)`, commented
      "One building, one Pi" — and `ingestion_health` the same. `building_totals` is keyed by
      `ts` alone. No table carries a site id, so two deployments cannot share a project and
      neither can be told apart in an export.
      Adds a `sites` table (id, display name, timezone, UTC offset, a `policy` jsonb) and a
      `shared/sites/<id>/` directory holding what varies per building. `shared/registry.mjs`
      becomes a thin composer and keeps exporting `DEVICE_REGISTRY`, `PHASE_MAP`, `METERED`,
      `TIMING` and `publicDevices()`, so **every existing import keeps working** — that is what
      makes this mechanical rather than a rewrite.
      *Does NOT close §5 Q8's report-timezone question, and the plan for this phase was wrong
      to say it would.* `generate_monthly_report`'s `p_tz` is already a parameter with a caller
      that passes a value, so changing its SQL default would be churn rather than a fix. The
      duplication that did need resolving — a hardcoded UTC offset in the bridge AND a zone in
      the report — is now one value in `SITE` with a test asserting the two forms agree. Whether
      that value matches what the devices actually reset their daily counters on is still
      unverified, and still needs a month reconciled by hand.
      `shared/buildLatest.mjs`'s `iso8()` hardcodes a fixed UTC offset and gains a parameter,
      defaulting to today's value so nothing changes shape.
      *First concrete use, and worth doing on its own merits:* `shared/commands.mjs` sets
      `ACU_MIN_C = 16`, while the university's own energy-efficiency policy — a Key Feature in
      the funded project plan — is "not lower than 25 °C". A per-site policy floor validated in
      `validateCommand` makes that a rule the system enforces rather than one the UI suggests.

- [x] **RM-028** ~~The space tree. `room` is free text and there is no rooms table.~~
      **DONE 2026-08-27 — acceptance met.** Devices are placed in a node from the Devices page,
      and `knownRooms()` no longer exists: the room list is a query over a declared tree.
      `ec4a63f` migration, `f10ab56` library, `347fb12` the anon revoke, `1c76b41` store,
      `a92c2ec` the Spaces panel, `1018bc5` the placement cut-over. **Applied to the live
      project and probed 5/5.**
      *Two bugs found by driving the page, neither reachable from the tests.* The Add button was
      enabled with Supabase unconfigured and produced a raw `Cannot read properties of null
      (reading 'auth')` — the store guarded `load()` and then used `supabase!` in every mutation,
      an assertion the unconfigured path falsifies, and the tests mock the client as present so
      they never could have caught it. And sourcing the room datalist from the tree alone
      **emptied it**: this site has `device_config.room` text and no tree yet, so the cut-over
      would have removed every existing suggestion during exactly the window they are needed.
      `knownRooms` survives as `recordedRoomLabels`, renamed to admit what it is and marked for
      retirement once sites are placed.
      *`room` is kept, not dropped* — the label a site shows before a tree exists, and the
      fallback when a placement points at a node the client no longer holds. `placementLabel`
      decides that precedence once and checks the node **resolves** rather than that an id is set.
      *CLOSED 2026-08-27.* `space_subtree` now refuses `anon` with `42501`, matching
      `node_totals`. Getting there took two attempts and the second failure was mine:
      **`phase21`'s header claimed "every statement is guarded, so a re-run is safe" and it was
      not.** PostgreSQL has no `create policy if not exists`, so the re-run raised `42710`, and
      because the SQL editor stops at the first error and those policies sit ABOVE the revoke,
      it aborted before reaching the fix it was being run for. The file looked re-applied and was
      not. **A false claim of idempotency is worse than an honest warning, because it is acted
      on** — a warning makes you check, a promise makes you stop. Both `phase19` and `phase21`
      now drop each policy before creating it, verified by applying each twice into a populated
      database (exit 0, in a container), and `test/migration-idempotency.test.mjs` fails any
      migration making that claim without earning it.
      *Verified after the fix, both directions:* `anon` gets zero rows on select, `42501` on
      insert, and cannot execute either RPC; a real insert round-trips through the service role
      and `space_subtree` returns it; the probe row was cleaned up.
      **One thing NOT verified, and it is worth stating rather than implying:** that
      `authenticated` can still SELECT. The policies were dropped and recreated, and the service
      role bypasses RLS, so nothing available from a script can answer it — minting a user token
      is not something the probe can do. The decisive check is a signed-in operator adding a
      space from the Devices page; if the recreated policy were missing, that write would fail
      with `42501`.
      *Prior state:* SCHEMA AND LIBRARY DONE 2026-08-27; NOT YET APPLIED, NO UI YET. `ec4a63f` the
      migration, `f10ab56` the tree library and Supabase layer.
      *Rehearsed on the Pi, exit 0*, with the tree exercised rather than pattern-matched:
      subtree depths, a subtree re-based to a mid-tree node, four kinds coexisting, a
      case-insensitive duplicate sibling refused, a parent delete cascading to its subtree,
      and a placement surviving that delete as NULL rather than being cascaded away.
      *The cycle guard is the one worth knowing about.* `parent_id` is user-editable and
      nothing prevents A -> B -> A; an unbounded recursive CTE against a cycle does not
      raise, it runs until something gives out. The walk is capped at 32 and the rehearsal
      builds a real cycle and asserts it stops at **exactly** that depth — reaching the cap
      is what proves the cap stopped it, since `UNION ALL` gives a cycle nothing to
      deduplicate it. Pinned that way because the neuter-check for this guard is a hang
      rather than a red test. The client carries its own cap for the same reason in a
      different place: the database's protects the database, not a browser building a tree
      from rows.
      **THE APPLY PATH HAS NOW BEEN RUN, 2026-08-31 — `scripts/rehearse-install.sh --apply`.**
      This entry said for days that it never had been, because there has only ever been one Pi and
      running it there would reinstall a working building. A container removes that objection.
      Five runs, each one finding something the previous one hid. Final state: **21 steps, zero
      failures**, on a machine with nothing on it.
      *Confirmed by reading the artifacts back, not by trusting the installer's report:* Node 22
      from NodeSource (`v22.23.2`), `npm ci`, a clean `tsc -b && vite build` producing
      `dist/index.html`, `serve` at `/usr/bin/serve`, the Node-RED official installer **and** the
      Tuya contrib node (both of which this file had guessed would refuse to run off a Pi), the
      loopback-only mosquitto config **byte-exact** — `listener 1883 127.0.0.1` / `::1`, the one
      line here that is a security property rather than a convenience — `server/.env` at mode
      `600`, and all four units installed with `User`, `Group`, `WorkingDirectory` and
      `EnvironmentFile` rewritten for a different account and checkout.
      **`systemctl` is a recording stub and that is stated everywhere it could mislead.** A
      container has no systemd, so the real installer aborts at step 5 and steps 6-8 — the ones
      that create `server/.env` and rewrite the units — never ran at all. The stub logs each call
      and returns 0; every call it swallowed is printed under a heading saying none of them
      happened. Nothing was enabled, nothing started, no unit validated by systemd. What the log
      does prove is the documented intent: mosquitto and four units enabled, **only** the
      dashboard started.

      **What five runs found, none of which reading the script had produced:**
      1. **`act()` discarded the output of every failing command.** A failed step printed four
         words and nothing else — at the one moment an operator needs the error. Found because
         the build broke and the run would not say why. Now captures and tails 20 lines.
      2. **Preflight checked that `sudo` works, not that the user is in the `sudo` group.** The
         Node-RED installer tests group membership and exits regardless of how sudo is configured,
         so a machine granted sudo through a `sudoers.d` rule passes preflight and fails at step 4
         — after the packages and the build are already installed. Now checked, with the `usermod`
         line, as a warning rather than a FAIL.
      3. **Two units in `server/` are neither installed nor mentioned.** Both exclusions are
         correct — `ibems-kiosk.service` is a `--user` unit needing a graphical session, and
         `ibems-wifi-prefer.service` is Wi-Fi, which this script never touches — but a second
         deployment had no way to learn the kiosk unit exists. Now named in the closing notes.
      4. **The closing notes still told the reader to hand-edit two migration files**, advice
         corrected elsewhere the same day. A message nobody reads on a provisioned machine is
         exactly where stale advice survives.
      5. **Two of the five findings were in the harness, and both mattered.** The first version
         copied an allow-list of files it judged the installer needed and omitted
         `tsconfig.app.json`, producing a build failure the installer had nothing to do with — a
         harness that omits a file reports a defect in the thing it is testing. And its summary
         counted the raw log, where `FAIL` is wrapped in a colour escape and `did` is not, so it
         matched every success and no failure and printed **"0 reported FAIL"** onto a screen with
         a FAIL visible on it. *The harness being wrong about the `sudo` group is also what
         surfaced finding 2* — had the container matched a Pi exactly on the first try, that gap
         would still be waiting for a real institution at step 4.
      *Still not exercised, and the guide still says so:* whether the services actually run.

      **The installer's dry run is also rehearsed on a bare machine, 2026-08-31** —
      `scripts/rehearse-install.sh`, a throwaway Debian container, the pattern `supabase/rehearse.sh`
      established for migrations. **`install.sh` had only ever run on one computer: the Pi that
      already had every package installed.** So every "already satisfied" branch was taken and not
      one of the "would install" branches had ever been exercised — which is exactly the half a
      second institution runs. The rehearsal took the other path for the first time: `warn node
      not installed`, then the NodeSource, npm, Node-RED, mosquitto, `server/.env` and unit-rewrite
      plans, all the way through. It completed clean.
      *The repo is copied in, not mounted*, so a bug that wrote to the checkout could not reach
      the host's; `node_modules` is excluded because its **absence** is one of the untested
      branches, and `server/.env` is stripped both because it holds live credentials and because
      the script branches on whether it exists.
      *What it cannot exercise is printed at the end rather than counted as passing:* `systemctl`
      needs a PID 1 a container does not have, the Node-RED installer checks for Pi hardware, and
      **`--apply` still has never been run**. That remains true and is stated in three places.
      **Running it found a defect immediately, which is the point.** The script's own closing
      instructions still told the reader that `phase19_sites.sql` and `phase20_site_scoping.sql`
      "name a site id you will need to change" — advice this session had already corrected
      elsewhere: apply both unedited, then `npm run site:sql`. A closing message nobody reads on a
      provisioned machine is exactly where stale advice survives. It now also points at
      `npm run preflight` in its verify step.

      **What is left:** apply `supabase/phase21_space_tree.sql`, then the tree editor UI,
      then switch `DeviceMetaEditor`'s room datalist over. `knownRooms()` is deliberately
      still in use — with no editor there is no way to create a node, so cutting now would
      trade real suggestions for an empty list.
      `devices.room` is nullable text; `device_config.room` is text with the comment "this
      building has no fixed room list". So an office, a lab and a floor cannot be grouped,
      rolled up, or scoped — the exact three things a second site needs.
      **One self-referencing `space_nodes` table with a `kind` column, not one table per level.**
      A table per level is precisely what makes a hierarchy rigid: it fixes the depth at schema
      time, so a site that is a single room and a site that is a campus cannot both fit.
      Subtree reads go through a `security invoker` recursive-CTE RPC, matching the pattern
      `readings_buckets` and `readings_archive` already established. **No `ltree` and no
      materialized path** until one is measured to be needed — the same discipline
      `docs/adr-001-timeseries-store.md` applies to reaching for a second datastore.
      The editor reuses `DeviceMetaEditor.tsx`'s existing draft/save/diff machinery
      (`effectiveConfig`, `isSameConfig`); nothing new is needed for the interaction.
      *Keep `device_config.room`,* backfilled, as a denormalised label — the additive discipline
      `supabase/phase7_device_config.sql`'s own header argues for.

- [x] **RM-029** ~~The circuit tree. `PHASE_MAP` is a constant naming four specific meters.~~
      **DONE 2026-08-27 — acceptance met, and the strongest form of it.** `510daf2`.
      `test/contract.test.mjs` passes **71/71 untouched** against the derived map, and the
      regenerated `bridge-flow.json` is **byte-identical** — the derivation reproduces the old
      constant exactly, list order included, so nothing downstream can tell the difference.
      `phase_current.blue` is still `null`.
      *`blue` stays an empty LIST, not a missing key.* `buildLatest` reads `PHASE_MAP.blue`
      directly and the UI renders it as "not metered" rather than a real zero, so `derivePhaseMap`
      emits all three phases whatever is wired to them — while the site's circuit file
      deliberately contains no Blue row, because there is no such branch to describe.
      *Two cross-checks this codebase had nowhere else, both neuter-verified:* every meter a
      circuit names must be a real registry device — a typo would silently drop a branch from the
      building total, giving a reading that looks plausible and is short by one circuit — and
      every branch meter must be claimed by exactly one circuit, which catches the opposite
      mistake. A third guard ties the two files that name the same circuits together, so renaming
      one no longer drifts the other.
      *One test was weak and is now not:* "the registry exports the derived map" passed against
      the OLD hand-written constant, because `deepEqual` cannot tell a derivation from an
      identical value. It now reads the source and fails if a meter id is still spelled out.
      **DELIBERATELY NOT a `circuits` table in Supabase**, which this entry originally implied.
      The electrical tree is **wiring**, and RM-027 already settled where wiring lives: rooms are
      operator-editable and change often, so the spatial tree went to Supabase; a panel changes
      when an electrician changes it, which is a deploy-level event. Putting it behind a network
      read would make the building totals depend on the internet — the property `EX-130` exists
      to protect. `branch_circuit` therefore stays a local name with a drift guard, rather than
      becoming a denormalised label off a `circuit_id` column.
      *Prior text:* The circuit tree. `PHASE_MAP` is a constant naming four specific meters.
      *Acceptance:* `test/contract.test.mjs`'s phase-total assertions pass unchanged against a
      derived map, and `phase_current.blue` is still `null` rather than `0` — the invariant
      `node-red-bridge/verify.mjs` explicitly checks.
      **This is a second tree, not a branch of the first, and conflating them is the mistake
      this entry exists to avoid.** Where a device *is* and what it is *wired to* are
      independent: a lighting circuit crosses rooms, and a room is fed by several circuits.
      Today the first is free-text `room` and the second is free-text `branch_circuit`
      (`'C.O Yellow'`), and neither can be traversed.
      `buildLatest(snap, REG, PHASE_MAP, nowMs)` already takes the map as a parameter, so the
      seam for deriving it exists and nothing downstream needs to change.

- [x] **RM-030** ~~Scoped aggregation. "This lab's consumption" is currently unanswerable.~~
      **DONE 2026-08-27 — applied and verified live, end to end.** `3e57c79` migration and
      rehearsal, `cc8f644` the client reader, `875c930` the Analytics card.
      *Probed against the live project:* `node_totals` is callable, and an unobserved scope
      returns NULL power rather than 0 **on real data**, not only in the rehearsal.
      *The card is where the honesty rule could last have been broken* — it renders through
      `formatNumber`, which owns the missing-is-a-dash rule, and never shows a dash without
      its reason beside it. Partial coverage is stated for the reason the Reports page states
      it: a number alone cannot tell a quiet room from an unplugged one.
      *It asks nothing until a space is chosen.* Defaulting to the first node would answer a
      question nobody asked, and on a site with several buildings the first is arbitrary.
      **It is useful only once a tree exists** — and one does: four nodes, all 14 configured
      devices placed, measured 2026-09-13 (this line said "still empty" after the tree was built
      on 2026-09-01). With no tree, the card says so and points at the Spaces panel rather than
      rendering blank.
      *Acceptance is met and exercised, not asserted.* The rehearsal seeds a window holding two
      observed samples (100 W, 300 W) and two OFFLINE rows carrying a frozen 999. If offline rows
      counted, the average would be 599.5 and the peak 999 — both plausible, both never measured.
      A floor's total includes its rooms; the window is half-open; and an unobserved scope
      reports **NULL, not 0**, pinned for two separate reasons (a room with no devices, and a
      room whose devices were all offline). **Neuter-checked:** coalescing the aggregates to 0
      fails with *"an empty room must report NULL power, got 0"*.
      *`phase20`'s transitional `site_id` defaults are retired here*, as that file said this phase
      would. They let phase20 land on a running system whose daemons predated Task 6 and they
      worked; Task 6 shipped, so the net is holding nothing up, and in a shared project a default
      would silently attribute a second Pi's rows to this site — wrong data recorded confidently
      is worse than a write that fails loudly. The columns stay NOT NULL. This inverted a
      rehearsal assertion rather than deleting it: it used to prove a writer with no `site_id`
      succeeded, and now proves such a writer is refused.
      **The `building_totals` primary key is deliberately NOT widened**, which phase20 floated for
      this phase on the reasoning that RM-030 would be touching the rollups anyway. It is not —
      `node_totals` is a new read path over `readings`. Changing a primary key underneath working
      rollup functions, for no benefit this phase can demonstrate, belongs to a phase that has a
      reason to test it.
      **What is left:** apply `supabase/phase22_node_totals.sql`, then the Analytics scope
      selector. The selector is worth little until a tree exists — and since 2026-09-01 one does
      (four nodes, all 14 configured devices placed; this line said "empty" until it was measured
      on 2026-09-13), so the tree-first half of that order is done.
      *Acceptance:* a node's total equals the sum of its descendants' devices, and an offline
      device contributes `null` rather than a frozen figure.
      A per-node totals RPC over `readings` joined through placement. **A new RPC, not a rewrite
      of `building_totals`** — that table holds real data and RM-009's rollup functions depend
      on its shape.
      The honesty rule from RM-024 and EX-107 extends here unchanged and is the part most likely
      to be got wrong: a node whose meters are all offline must report nothing, not zero.

- [x] **RM-031** ~~The 2D floor plan renders from data, not from literals.~~
      **DONE 2026-08-28 — applied and verified live, every constraint and the trigger.**
      `7e2903d` migration and rehearsal, `834cd7a` model and store, `1ac5e45` the view,
      `6872af2` styles.
      **Verified against the live project, 9 checks, and the probe restored itself.** Placing and
      positioning in one statement keeps the position; each range constraint names itself
      (`device_config_plan_x_range`, `_plan_y_range`, `_plan_both_axes`); a same-room write keeps
      the position; **a move to another room clears it**; and deleting a room succeeds and clears
      both placement and position — the case that makes the trigger necessary rather than tidy.
      The device row used was captured first and came back **byte-identical, `updated_at` and
      `updated_by` included**, and both throwaway nodes were removed.
      *A read-only probe alone could not have done this.* Every device here is unplaced, and the
      "a position needs a room" constraint is violated by any position on such a row — so it
      masks the two range constraints, and a rejected write proves only that *some* check fired.
      Isolating them needed a placed row; the trigger needed a successful update.
      *Measured on the way, and now recorded in the code rather than guessed at:* PostgREST
      returns these `numeric` columns as JSON **numbers**. `coercePlanCoord`'s string tolerance
      stays — the encoding is decided elsewhere and `count(*)` already caught this project out —
      but the comment no longer implies it is load-bearing.
      *Deployed and read back.* The Pi is at `43deda9`, rebuilt, and serving the new bundle
      (`index-22jg6l4F.js`, confirmed against the served HTML). All three suites pass **on the
      Pi** — 747 frontend, 466 bridge, 359 server — which RM-022 is the reason for checking.
      The exact column list `fetchDeviceConfigs` sends answers **200** with the **anon** key
      (empty array: `device_config` is `authenticated`-only, unchanged). That is the browser's
      own path proven without a login; the app itself stops at the sign-in screen and fetches
      nothing before auth, so the in-app path was not exercised and is not claimed.
      *The ordering hazard is spent, and worth keeping in the record:* `fetchDeviceConfigs`
      selects `plan_x,plan_y`, and before the migration that select answered **400 / `42703` /
      "column device_config.plan_x does not exist"** — measured, not assumed. On a project
      without phase23 the whole of `device_config` fails to load, rooms and load-shed tiers with
      it. The Pi pulls only when somebody pulls it (no timer; checked), so the order was in hand.
      *Acceptance is met, in both halves:* a site with no plan drawn renders its fleet grouped by
      tree node — placed and unplaced, nothing omitted — and a site with a plan renders it. No
      device id, room name or coordinate appears anywhere in `src/components/spatial/`.
      **A room's plan draws the devices in that room and no others**, which is the correctness
      rule the phase turns on. Coordinates are normalised against ONE node, so a device in a
      child room carries a position measured against the child's frame; drawing it in the
      parent's frame would put it somewhere nobody chose — and the drawing would look surveyed.
      Descendants are counted and named, not drawn.
      **The frame is square because nothing here has measured a room.** Inventing proportions
      would assert a fact nobody established. `space_nodes.attrs` can carry real dimensions when
      somebody measures them, and a 0..1 position converts into them without being re-entered.
      **The database owns the move, the client owns validity.** phase23's trigger clears a
      position when a device changes room: carried over, it would place the device at a spot
      nobody chose in a room it has never been in, drawn as confidently as a surveyed one — and
      the device editor's whole-row upsert produces exactly that payload. *The rehearsal changed
      the rule:* clearing on every move also cleared the write that places and positions in one
      statement, which is what an import or a provisioning script looks like. The two differ in
      one observable way — a carried-over payload has not changed the coordinates.
      **Neuter-checked** with the trigger commented out: *"a move must clear the position, got
      0.25/0.75"* — the stale position, in the new room. **Re-run safety earned, not asserted:**
      the file applied twice in one run, exit 0.
      *The whole-row upsert is the other trap, and it has its own test.* A device is dragged into
      place; a week later somebody edits its notes; the editor sends every column. A row builder
      that did not carry the position would null it, from a screen that never mentions the plan.
      **Placement is click-to-place, not drag — a deliberate deviation from what this entry used
      to say.** A drag needs pointer capture, behaves differently under touch, and is unreachable
      from a keyboard, so building it would have meant building this path anyway as the
      accessible one. Arm a device and click where it goes, or select a pin and type its position.
      `editableLayout.ts`'s `clampToRoom` was **not** reused as this entry proposed: it clamps
      metres against `geometry.ts`'s `ROOM`, so importing it would have pulled the CARE-specific
      module back into the generic plan — the exact coupling this phase exists to cut.
      *Verified in a real browser against real layout*, because the click maths is what jsdom
      cannot check: 15%/85% of a measured 520×520 frame put the marker centre at (253, 880)
      against (253, 881) predicted; a click at 25%/75% recorded `{x: 0.25, y: 0.7506}`, the
      0.0006 being the integer pixel aimed at and the proof that rounding works; clicking a pin
      selects it and records no placement; at 375px the frame shrinks to 278×278 with no
      horizontal overflow; and the Overview fallback renders the plan with **`threeChunksFetched:
      0`**, so RM-032's property survives.
      **`FloorPlanView` is not deleted and not changed.** It remains correct where it is — the
      `care` pack's own WebGL-unavailable fallback, inside the site it was surveyed for.

- [x] **RM-032** ~~The 3D scene becomes a site-gated pack.~~
      **DONE 2026-08-27.** `3edca87`. `SpatialView` loads a pack only when the site declares one.
      *Verified both ways in a browser*, because the claim is about what the network does: with
      the pack declared the canvas renders and `three` is fetched; with it null the notice renders
      and **`threeChunksFetched` is 0** — measured from `performance.getEntriesByType`, not
      inferred.
      *Stated precisely rather than overclaimed:* the chunk is still **built** — the dynamic
      import is in the module graph and the entry references it as a lazy target, confirmed in a
      production build with the pack nulled. What a site without a pack avoids is **downloading**
      it, which is the cost that matters. Removing it from the build too would mean the site
      directory owning the import, a larger restructure than this phase needs.
      **The fallback is deliberately NOT `FloorPlanView`**, which is the obvious choice and is
      wrong: the 2D plan pins `co1..co7` to literal coordinates, so at another site it would draw
      that site's devices into this site's room — worse than drawing nothing, because it looks
      right. Until RM-031 the honest answer is to say no view is configured, and why.
      *Found on the way, and it is where RM-031 had to start:* `FloorPlanView` imports
      `LIGHT_PLAN` from `scene3d/geometry.ts`, so the 2D plan and the 3D scene share a geometry
      module.
      **IS IT FINISHED? Yes for what it claimed, and two things it did not do are recorded here
      rather than left to be discovered** (asked and answered 2026-08-28).
      *Done and verified:* a site without a pack downloads none of the 3D — measured in a
      browser, `threeChunksFetched: 0` — and an unrecognised pack name degrades to the plan
      rather than throwing. Since RM-031 that fallback is a real spatial view, not a notice.
      *Not done, deliberately:* `src/components/scene3d/` was never moved to `src/scenes/care/`
      as the phase plan proposed. The pack still sits among the shared components, which costs
      nothing at runtime and is a rename away whenever it is worth doing.
      *Not done, and this one has a consequence:* `SCENE_PACKS` in `SpatialView.tsx` is a literal
      map, so a second site that WANTS a 3D pack must edit a shared file. A site with
      `scene_pack: null` — every scaffolded site — needs no edit at all, which is why this did
      not block RM-033. It is the same shape as FI-017 and belongs with the provisioning work.

- [ ] **RM-033** Site provisioning — FI-002 and FI-003, now buildable.
      **PART-BUILT 2026-08-28.** `4fb431b` one-file ownership, `5e3b378` the scaffolder,
      `f1d0269` the mock. **This is Milestone 6, due June 2027**; what remains is the packaging
      and the written guide, which need decisions rather than code.
      **One of the plan's end-to-end criteria is answered by construction, not by a run.** It
      asked to "confirm the Pi never writes a row carrying the other site's id" — an observation
      from a throwaway second site. The codebase gives something stronger: every site-scoped write
      takes its value from `SITE.id` (`server/ingest.mjs`, `server/shapeRows.mjs`,
      `server/scheduler.mjs`'s scoped read), `SITE` has exactly one import path, and
      `test/site-config.test.mjs` fails any production module under `shared`, `src`, `server`,
      `node-red-bridge` or `scripts` that names a site directory at all. A literal id cannot be
      written because a literal id cannot be present. Checked 2026-08-31 by reading the guard's
      own walk rather than assuming its reach.
      *What that guarantee does not cover, for whenever the "shared cloud later" in the plan's
      decision 1 arrives:* **device ids are not site-namespaced.** `co1` and `l1` are ids, not
      paths, so two buildings in one Supabase project would collide on `devices.id` and
      `readings.device_id`. Harmless under one-project-per-building, which is the current
      architecture, and the first thing to fix if that ever changes.

      *Acceptance (unchanged):* a second site is stood up from the guide by someone who did not
      build this, without hand-editing a device id.

      **Done so far, and each of these was a real edit a second deployment would have had to
      make:**
      - **`shared/siteConfig.mjs` is now the ONLY module naming a site.** Its own header always
        claimed "one line"; `shared/registry.mjs` also imported `CIRCUITS` straight from the site
        directory, so it was two — and the one nobody would remember wires a new site to another
        building's circuits. `PHASE_MAP` is derived from that tree, so a missed edit would not
        fail. It would report the wrong phase totals, confidently.
      - **FI-017 closed: `BUILT_IN_DEVICES` moved to `shared/sites/<id>/devices.mjs`.** Twenty-one
        pieces of hardware on one building's walls lived in the file every deployment shares. The
        CT circuit map and the two-logical-meters-on-one-box note went with them — that is
        documentation OF THIS BUILDING, and leaving it shared is how the next site inherits
        another building's wiring as fact. `DPS_MAPS` stayed: those describe Tuya firmware.
      - **`npm run site:new <slug>`.** Scaffolds the directory; refuses to overwrite; validates
        the slug *before* creating anything, because the slug is interpolated into a path.
        **It does not activate the site** — repointing `siteConfig.mjs` would take a running
        building offline, every device id stopping resolving, from a command that sounds
        additive. It prints the three lines instead.
      - The template asserts as little as possible: devices and circuits start **empty**, not
        seeded with plausible examples, and the timezone starts at UTC — a placeholder that is
        also true. An empty circuit tree derives to empty phase lists, so a new site reads "not
        metered" rather than zero.

      **What doing it found, which is why it was worth doing rather than describing.** The plan's
      own end-to-end check — scaffold a site, point at it, run it — was carried out, and:
      - the generated Node-RED flow **followed the site**: 2 devices instead of 20, and zero
        references to `co1` or `l1`;
      - **`npm run mock` crashed.** `TypeError: Cannot read properties of undefined (reading
        'toFixed')`. The mock named CARE's four branch-meter context keys as literals and looped
        `1..7` for outlets and lights. That is worse than an ordinary fixture bug: the mock is how
        a second deployment is developed *before* it has hardware, which is exactly the position
        another SUC is in. Fixed and covered — see `mock-bridge/fixturePlan.mjs`.
      - the guard added an hour earlier **caught the next commit**: `site:new`'s usage example
        read `mmsu-coe-annex`, and once that directory existed the test failed
        `scripts/site-new.mjs names mmsu-coe-annex`. A usage string is indistinguishable from a
        module wired to a site. It was also a plausible-sounding MMSU college that does not
        exist, which is its own reason not to ship it.
      - the throwaway sites were **deleted, not committed**. A fabricated building in the repo
        would read as a real one; a worked example belongs in the guide.

      - **`docs/replication.md`** — the software half of the framework, written as a transcript
        of the run above rather than as a design. Its "What this does not cover" table is the
        point: a replication framework quiet about its gaps is worse than a short one.
        *Corrected 2026-08-31:* it claimed the steps were carried out "end to end", which was
        not true of two of them. Steps 8 (a second Supabase project) and 9 (a space tree for a
        new site) were described from reading the code and are now marked as such. A step nobody
        has walked is worth less than one somebody has, and a document going to other
        institutions has to say which is which.

      **What OPENING THE PAGE found, 2026-08-31, which reasoning about the code had not.**
      Everything above was verified through data: the registry, the flow, the mock, the tests.
      Then a deployment was pointed at a scaffolded site and the dashboard was actually looked
      at. Two defects, both in the last place anyone would check because neither is data:
      - **The chrome named one building.** `1c47554`. Five literals — the nav chip, the page
        subtitle, the hero title, a climate tile and the date line — so every deployment
        displayed *"MMSU CARE Office · NBERIC"* in its header. All now come from `SITE`;
        `WEATHER_TZ`'s literal `'Asia/Manila'` now comes from `SITE.timezone` rather than being
        a second copy of a fact the site already declares. `test/site-naming.test.mjs` guards it,
        and states its own limit: it scans tokens that cannot be ordinary English, so it is a
        floor rather than a ceiling.
      - **A building with no meters reported using 0 kWh.** `33591d9`. Live Demand, voltage and
        the Blue phase all correctly read "—" or "not metered"; the three energy tiles read
        `0.00 kWh`. `buildLatest` was right — the zero was manufactured a layer earlier by a
        `reduce(..., 0)` over an empty list and faithfully passed on. RM-024's rule at the layer
        that SEEDS a figure, which is where it is easiest to miss because nothing there looks
        like a claim about a building.

      **The test suites are this building's regression suite, not a conformance suite** —
      measured, and now written into the runbook so a new institution does not think it broke
      something. On a scaffolded empty site: frontend 746/747, bridge **414/482**, server
      **329/359**. A sampled failure reads `Cannot use 'in' operator to search for 'voltage' in
      undefined` — a fixture looking up a device id the new site does not have. The consequence
      is real and is listed as a gap: a new deployment has nothing that tells it its OWN site
      directory is coherent.

      **Decided and built 2026-08-31, on your answers:**
      - **`LICENSE` — MIT.** `9e85439`. The repo had been public from the start with none, which
        made it unusable by the very institutions Milestone 6 exists to serve: "public" and
        "reusable" are not the same thing. *The copyright holder line names the university and
        needs confirming against the funding agreement* — that is a legal fact, not a code one.
      - **`scripts/install.sh` (FI-003) — a script, not a card image.** `fb96069`. Dry run by
        default; every change goes through one `act()` so the plan cannot diverge from the run,
        and a test enforces that no `sudo` escapes it. It refuses to touch Wi-Fi, refuses to open
        the broker past loopback, writes no secrets and does not deploy the flow — each for a
        reason this project has already paid for. **Its apply path has since been rehearsed in a
        container** — see the apply-path entry above — but **has never been run end to end on a
        real machine**, because `systemctl` was stubbed there and no unit was ever validated by
        systemd. The file says exactly that and a test keeps it saying so; the guard was sharpened
        rather than dropped, because the blanket claim had become false while the useful half of
        it stayed true.
      - **`docs/physical-install.md` — a template with 12 marked gaps**, not a finished guide.
        Structure, the commissioning checklist and every trap are written; photographs, part
        numbers and torque figures are marked `〔FILL IN〕` rather than invented. Nothing in it
        has been reviewed by an electrician and it says that first.
      - **`server/ibems-dashboard.service`, captured.** The installer's dry run on the real Pi
        reported the unit "not in the repo" — it had been running for weeks, declared nowhere.
        The same exposure CLAUDE.md records for `findTimeout` and mosquitto: a host-only fact a
        rebuild loses with no diff. Verified byte-identical to the live unit.

      **FI-002 landed 2026-08-31 — `npm run preflight`, 12 tests.** `docs/replication.md` named
      this as its own biggest gap: *"Day-one network setup … partly written down in `CLAUDE.md`'s
      site facts, not yet a procedure."* It is now a command. It answers a different question from
      `site:check`: that one reads the site *directory* offline and asks whether a description of a
      building is coherent; this reads the *deployment* and asks whether this machine can see the
      building — credentials, database, vendor account, radio segment, bridge, services. A site can
      be perfectly coherent on a machine that will never reach a device.
      *The rule it exists to enforce:* **a check that could not be run is never reported as fine.**
      An unchecked required item leaves the deployment not-ready, because a green light nobody
      earned is what someone standing in an unfamiliar building will believe. Run on a workstation
      it reports four errors and one unchecked, which is the correct answer there.
      *It writes nothing* — no credential created, no flow deployed, no Wi-Fi touched — and
      **prints no secret**: the observation shape carries `set`/`empty`/`absent` and never a value,
      with a test that passes values in to prove they cannot reach the output. An **empty**
      credential counts as missing, since `.env.example` ships every key with an empty value and a
      copied-but-unedited file has all the right names and none of the answers. A check whose
      prerequisite already failed is **skipped**, not counted as a second error — a wall of red
      teaches people to skip the tool.
      *Hearing no device broadcasts names the 2.4 GHz trap outright*, this project's most expensive
      misdiagnosis. A bind failure on the discovery port reports **unchecked** rather than silence:
      Node-RED's own tuya nodes may hold that port, and calling it "no devices" would accuse the
      network of a fault it does not have.

      **`npm run site:sql` closed the `sites` row, 2026-08-31 — 9 tests.** `phase19_sites.sql`
      seeded one literal id, so a second institution had to hand-edit a migration; editing a
      migration that has already run somewhere is how two databases stop agreeing about what has
      been applied. The statement is now generated from `shared/sites/<id>/site.mjs`, so the id
      cannot drift from `SITE.id` — the one pairing that matters, since every site-scoped write
      references it and nothing else reports an orphan. **It prints and does not execute**, the
      same line `install.sh`, `site:new` and `preflight` hold, and it is idempotent because an
      operator unsure whether they ran it will run it again.
      *Verified against production, not only against tests:* the generated statement reproduces
      the live `sites` row field for field, policy jsonb included.
      *Guarded:* the id is slug-validated before interpolation, apostrophes in a building name are
      doubled (`St John''s Annex` is an ordinary name and an unescaped one ends the literal
      mid-statement), an absent policy emits `'{}'::jsonb` rather than a null the column rejects,
      and a site missing any required field throws rather than emitting SQL with `undefined` in
      it — that statement would not fail, it would run and write nonsense.

      **What is left:**
      - filling in `physical-install.md`'s twelve gaps, which needs a site visit;
      - nothing, for the `sites` row. `phase20_site_scoping.sql` still contains this building's
        id, and **checked rather than assumed**: its three `update ... where site_id is null`
        statements match nothing on a fresh database, and the three `set default` statements are
        **dropped again by `phase22_node_totals.sql`**. Applied in filename order the pair is
        self-correcting. An earlier draft of this entry said a new deployment should skip them,
        which was worse advice than the truth — skipping `phase20` leaves the columns absent.

      **A sweep, after the third time.** Finding the same defect three times meant looking for
      the rest of it rather than fixing one more instance: **thirteen further `toLocale*String`
      calls** formatted a building fact — a meter reading, a device's last report, a forecast
      day — in whatever zone the reader's laptop was in, and every one of them also hardcoded
      `en-PH`.
      *The distinction that shapes the fix, and it is not "pin the timezone everywhere".* A
      timestamp describing the BUILDING must read the same to everyone, and now does
      (`src/lib/siteTime.ts`). A timestamp describing THIS READER's own action — "saved at
      14:32", the control log — is a fact about their session, so their own clock is the correct
      frame; those three call sites keep it and say why. The locale is the reader's everywhere:
      how a date is spelled belongs to them, which instant it is belongs to the building.
      `formatMonth`'s `timeZone: 'UTC'` is deliberately left alone — it labels a bare date
      string, not an instant, and UTC is what stops `2026-07-01` reading as "June".
      *Guarded:* no frontend module may hardcode a locale (neuter-checked), and the helper must
      pin `SITE.timezone`. 757 frontend tests pass in UTC and at +08.

      **A third, one layer under the clock.** `weatherClient.ts`'s `parseSiteTime` parsed
      Open-Meteo's timestamps — which come back in the SITE's zone with no offset suffix — as the
      READER's local time. Measured: a reader in New York produced hour labels **twelve hours
      out**, a forecast about the building timestamped in their own day. To its credit the old
      comment stated the assumption rather than hiding it ("the display device runs in the site's
      own timezone"); it was true of the kiosk and false of everyone else, which is why it
      survived. The site's own `utc_offset_minutes` is appended now.
      **Two of the existing tests were timezone-dependent and could not have caught it** — they
      set the clock with a bare local string, so the test and the parser shifted together and the
      shared bug stayed invisible. Both are re-anchored to absolute instants. *Verified in five
      zones* (UTC, Manila, New York, London, Auckland): 13/13 in each. **Neuter-checked:** remove
      the offset and five tests fail under UTC while all thirteen still pass on a +08 workstation
      — which is the RM-022 shape exactly, and the reason this was checked in more than one zone.

      **Two more found by looking rather than reasoning, 2026-08-31.** Both were in the same
      place: the building's *location* was not a declared site fact, so shared code invented one.
      - **The Overview clock showed the READER's time under the BUILDING's place name.** Neither
        `toLocaleTimeString` nor `toLocaleDateString` passed a `timeZone`. Measured: a viewer in
        New York saw `00:20` while the building read `12:20`, presented as the building's. The
        kiosk in the room was right only by coincidence, which is why nobody noticed. Verified in
        a browser reporting `Asia/Shanghai`: the page now shows `05:29` for a site declaring UTC
        while the browser's own clock reads `13:29`.
      - **An unlocated deployment showed the CARE office's weather as its own.**
        `src/config/weather.ts` held these coordinates as its own defaults, so any site that had
        not set `VITE_WEATHER_*` got Batac City's forecast under its own name — a measurement
        about somewhere else, presented as being about the reader's building. `site-naming`'s
        guard could not catch it: "batac" is derivable from neither the site id nor its display
        name.
      *`SITE.location` now carries it* (`place`, `lat`, `lon`, or null), env vars still override,
      and there is **no fallback**. An unlocated site renders its own state and **makes no
      forecast request at all** — verified: `forecastRequestsMade: 0`, and no mention of Batac
      anywhere on the page. `site:check` validates the shape and warns when it is null.

      **`npm run site:check` — the conformance check, built 2026-08-31.** The suites in this repo
      are this building's regression suite; this is the one a second deployment runs against its
      own directory. Twenty-two checks over identity, devices and circuits.
      *Empty is a warning, wrong is an error*, and that is the whole design: a scaffolded site has
      no devices and no circuits by deliberate choice, so if empty failed, the command would be
      broken at the moment it is most needed and the first thing anyone would learn is to skip it.
      *The faults it exists for are the ones nothing else shows.* A circuit naming a meter that
      does not exist does not crash — `PHASE_MAP` is derived, so the phase total silently omits a
      meter and the screen looks right. Two devices sharing a `ctx` overwrite each other in the
      flow's context store and the dashboard shows one twice. Demonstrated against a site seeded
      with `mtr_lightning` for `mtr_lighting` and two switches on one state key: both named, exit 1.
      *It approves this building*, which is the test that stops it measuring the wrong thing.
      **`DEVICE_CLASSES` now exists as a value**, not only a `@typedef` that enforces nothing at
      runtime, and the typedef derives from it. `src/lib/types.ts`'s union is held to the same
      list — two copies of five strings were a silent drift waiting to happen, in the direction
      where a class added to one and not the other renders as a device the UI cannot type.

- [x] **RM-034** ~~There is no CI. Every test run is manual.~~
      **DONE 2026-08-27 — green on the first run, both Node versions.** `dad1a26`,
      `.github/workflows/ci.yml`. Lint, type-checked build, and all three suites on push and PR.
      **The Node versions did not match and nothing said so.** The Pi runs **22**, this
      workstation runs **24**, and no `engines` field declared either. That is RM-022's shape
      exactly — five server tests once passed on a workstation and failed on the Pi, green in the
      only place anyone looked. CI runs **both** rather than picking one, so the divergence is
      visible instead of latent, and `package.json` now declares the range CI proves.
      *It runs with no `server/.env`*, which is the configuration several of those tests actually
      want. Verified before writing the workflow — the local `.env` was moved aside and all four
      suites run clean — rather than discovered on a first red build.
      *A step asserts `server/data/` is empty afterwards.* That directory holds the live
      command-audit outage queue on the Pi, and a full `test:server` run once left a fabricated
      command there. `server/testStatePaths.test.mjs` guards it; this checks the guard held.
      *The roadmap reminder warns and never blocks*, deliberately: a failing check would train
      people to bypass it for a typo fix, which is worse than the drift it prevents.
      **What CI will not do is prove a fix works.** "A green test suite is not proof" is written
      down here, twice earned. It catches regressions; the live read-back stays mandatory.
      **AND IT BUILDS A DIFFERENT BUNDLE FROM THE ONE THE PI SERVES — found 2026-08-28, nearly
      reported as a regression.** The Pi's `index` chunk is **564.84 kB**; the same commit on a
      workstation builds **337.29 kB**, with every other chunk byte-identical (same content
      hashes). The cause is not the machine: `src/config/supabase.ts` reads
      `import.meta.env.VITE_SUPABASE_*`, Vite substitutes those at build time, and with them
      unset the ternary folds to `null` and rolldown drops `@supabase/supabase-js` entirely —
      227 kB of it. Confirmed by grepping both bundles: `GoTrueClient` appears only in the Pi's.
      *Two consequences worth having written down.* A bundle-size comparison across machines is
      not like-for-like unless both carry the same `VITE_*` values — this one looked exactly like
      a 227 kB regression. And **CI's runner has no Supabase env either**, so its build exercises
      the null-client path and can never catch a regression in the configured one.
      *Acceptance:* a push runs all three suites and a type-checked build, and a red suite is
      visible without anyone remembering to look.
      No `.github/` directory exists. Over 1,200 test declarations across three suites
      (`npm test`, `npm run test:bridge`, `npm run test:server`) and a public repository, and
      nothing runs them except a person who remembers to.
      Also add the ROADMAP-drift warning that the original documentation prompt proposed and
      nobody built: **warn, never block**, when a commit touches `src/` or `server/` without
      touching `ROADMAP.md`. And a `LICENSE`, a repository description and topics — all three
      are currently empty on a public repo.
      *Two hazards to handle in the workflow rather than discover:* `test:server` spawns real
      processes and binds ports, which a shared runner may not tolerate; and it writes under
      `server/data/`, which `server/testStatePaths.test.mjs` guards on the Pi but which should
      be confirmed on a clean checkout too.
      *What CI will not do:* prove a fix works. This project has "a green test suite is not
      proof" written down, twice earned. CI catches regressions; the live read-back stays
      mandatory.

---

## 3. Future improvements (backlog)

### Charts

- [x] **FI-028 (S)** — The dark theme's chart series tokens fail the dataviz lightness band. Measured
  2026-09-17 with the categorical validator against `--bg-surface` #1e1e1e: `--green-bright` #3dbb8a is
  at L 0.71 and `--purple-bright` #c4b5fd at 0.81, and the base tokens (`--green` #32b585, `--purple`
  #a78bfa) still fail. Contrast and colour-blind separation pass. It affects every chart in the app
  (Analytics' lines and every report chart), so the fix is a re-stepped dark series in `index.css`,
  re-measured in both themes, not a report-only override.
  **Done 2026-09-17.**
  - **What changed, dark theme only** (the light values are untouched):

    | Token | Was | Now | OKLCH L |
    |---|---|---|---|
    | `--green-bright` | #3dbb8a | #26ab7b | 0.71 → 0.66, same hue and chroma |
    | `--purple-bright` | #c4b5fd | #924ed5 | 0.81 → 0.57, hue 293° → 304° |
    | `--red-bright` | #e56f63 | #df695e | 0.68 → 0.66, same hue |
    | `--sky-bright` (new) | #0ea5e9, a literal | #059ddf | 0.685 → 0.66, same hue |

  - **Analytics' seven-colour cycle failed too.** Measured the same way, slots 5 and 6 (`--red-bright` and
    the literal #0ea5e9) were over the band. The literal cannot differ by theme, so it became `--sky-bright`,
    defined in both theme blocks; the light value is unchanged.
  - **Why purple is not just darker.** Re-stepped into the band at blue's own lightness (#987ce9),
    purple is ΔE 0.1 from `--blue-bright` under simulated deuteranopia. Its old lightness was what kept
    the two apart, and "Power through the week" draws the four report series as lines that cross, so every
    pair matters, not only neighbours. A search over the band for violet hues found #924ed5. For every
    pair of the four it measures ΔE ≥ 15.9 with full colour vision and ≥ 9.6 under protanopia and
    deuteranopia, and it is 3.4:1 on `--bg-surface` and 3.1:1 on `--bg-surface-2`.
  - **Not changed: the base tokens.** `--green` and `--purple` are the text tier, and `test/contrast.test.mjs`
    measures them; no chart draws with them on screen. The dark palette's mirror in
    `docs/assets/src/tokens.css` is also unchanged, because it only feeds the README pictures, which were not
    re-rendered.
  - **Validator, after the change.** All checks pass for:
    - the dark report series, adjacent and all pairs, on both surfaces;
    - the dark Analytics cycle;
    - the light Analytics cycle, unchanged: the contrast warning on amber, green and sky lines is still
      relieved by legends and hover values;
    - the print palette, unchanged.
  - **Held by** `src/components/reports/charts/palette.test.ts`. For both themes, it reads the report
    series and Analytics' `PALETTE` array from source and checks:
    - the lightness band;
    - chroma of at least 0.10;
    - that neighbours are apart, with full colour vision (ΔE ≥ 15) and under protanopia and deuteranopia
      (≥ 8, Machado 2009).

    For the dark theme it also checks 3:1 on both surfaces, and every pair of the report series.
  - **Neuter checks.** Purple at #987ce9 fails the every-pair test, and the literal #0ea5e9 back in
    Analytics fails the band.
  - **Checked in a browser** (mock bridge, dev server): Analytics' lines computed to the new values in dark
    and to the old ones in light, with no console errors. A screenshot was not possible with the pane
    hidden, so the eye check joins the signed-in Reports check.
- [x] **FI-029 (S)** — **Blue and purple are one colour to a deuteranope, in the light theme and in print.**
  Found while doing FI-028. **Done 2026-09-17**, taking RM-105's light-theme half with it.
  - **What changed.**
    - Light `--purple` #7c3aed → **#6200be**. It is the text tier and the print palette's fourth series,
      mirrored in `palette.ts`.
    - Light `--purple-bright` #8b5cf6 → **#6f27e1**, the screen charts.
    - Both keep their hue and sit darker than their blue.
    - As text, `--purple` is now 8.2–9.3:1 (was 5.0–5.7), and `test/contrast.test.mjs` passes. Its only CSS
      use is the Control log's IR tag.
  - **After.** Every pair of the four report series, on screen in both themes and in print, is ΔE ≥ 15 for
    full colour vision and ≥ 8 under protanopia and deuteranopia. The validator passes light, print and
    Analytics' light cycle, which keeps its existing contrast relief on amber, green and sky.
  - **Held by** `palette.test.ts`: the every-pair test now runs for light, dark and `PRINT_PALETTE`. A
    neuter restoring #8b5cf6 fails it.
  - **Measured.** Every-pair separation between `--blue-bright` #3b82f6 and `--purple-bright` #8b5cf6 is
    ΔE 1.3 under simulated deuteranopia and 12.0 with full colour vision. The print palette's #1e5ce4 and
    #7c3aed measure 1.7 and 12.5.
  - **Why the usual check missed it.** Neighbours pass, and the validator checks neighbours by default.
    But "Power through the week" and Analytics draw these series as lines that cross, and in a PDF read
    on paper there is no hover to tell them apart.
  - **Relief today:** a legend on every chart, number tables in the Detailed PDF, and hover values on
    screen.
  - **The fix** is the one FI-028 made for the dark theme: a purple that differs from blue in lightness
    as well as hue. It changes the PDF's colours, so re-check the print guards in `palette.test.ts` and
    extend its every-pair test to the light theme and to `PRINT_PALETTE`.

### Onboarding
- ~~**FI-001** (L) Zero-touch device discovery.~~ **Done 2026-08-25** — engine EX-039b, wizard
  EX-040b. Adding a device is now a form on the Devices page: pick the vendor device, name it,
  preview, enrol. The local key comes from the cloud, and both the registry entry and the flow
  nodes are written from one validated decision.
- ~~**FI-002** (M) Day-one setup wizard for a new building: network and vendor-account linking.~~
  **Done 2026-08-31 as `npm run preflight`** — see RM-033. **It became a check, not a wizard, and
  that was the finding.** A wizard implies collecting credentials, and the two that matter here
  cannot be collected by this system: `TUYA_ACCESS_SECRET` reaches hardware directly with nothing
  scoping it and must never be handled outside `server/`, and the network join is a Wi-Fi change
  that `CLAUDE.md` forbids doing remotely — a wrong SSID loses the host with nobody on site to
  recover it. What a second institution actually needs is not something to type into; it is a
  straight answer to "did that work, and what is still wrong". So it reads, reports and exits,
  and every failing line prints the next step for a person to take.

### Replication
- **FI-003** (L) Packaging so a second site can be stood up without redoing the wiring by hand: install script or card image, plus a physical-install guide. **Promoted into RM-033** (2026-08-26). Its blocker was never the packaging — it was that a "site" was not a thing the code had a name for. RM-027 gives it one.

### Reporting
- ~~**FI-018** (S) The baseline numbers exist and no artifact carries them.~~ **Done 2026-08-31**
  — `server/baselineReport.mjs` (pure), `server/baseline-report.mjs` (fetch and write),
  `npm run baseline:report`, 13 tests. **Milestone 1 asks for "a baseline energy dataset and
  benchmarking summary"; `demand:profile` computed the statistics and printed them to a terminal
  nobody keeps.** An artifact is a different deliverable from a statistic: it has a date on it,
  it can be compared against next quarter, and it can be handed to someone who was not in the
  room. Both halves are written together — the CSV is the exact input to the Markdown beside it,
  so the pair cannot drift and a reader can check the summary rather than take it.
  *This is `RM-024` / `EX-107` applied to a document rather than a dashboard*, and a document is
  where overstating is easiest, because a table looks finished whatever went into it. Coverage is
  stated **before** any figure it qualifies, and includes the longest single gap — 80% coverage is
  a healthy month with a few restarts or three weeks up and a week dark, and only the gap tells
  them apart. An hour nobody observed renders `—`, never `0`. A day the meters missed half of is
  marked *partial* with the hours it actually saw, so its kWh reads as a floor rather than a
  total. A window under 1000 readings or 3 building-days heads itself **"This is not a baseline
  yet"** rather than producing a table that looks like the real thing — three days because two
  cannot separate a weekday from a weekend, and the weekend is most of the distance between a
  building's peak and its floor.
  *Energy is read from the meters' own daily counter, not integrated from power samples.*
  Integrating across a gap invents the energy used during an outage, and those are precisely the
  hours least like the ones either side of them.
  *Both guards were neutered and confirmed to fail* — removing the timezone shift broke four
  tests, and forcing the thin-sample check off broke the fifth.
  *The report also states what it does not say*: it is not normalised by floor area or occupancy,
  because neither is recorded and a kWh/m² figure from an assumed area would be the most quotable
  number in the document and the least true.
  *Output is gitignored.* Dated artifacts belong with the submission; a repository accumulating
  stale copies is how the wrong quarter gets cited.

      **Reading the first real report back found two things the tests had not.** `b6701e7` and
      the commit carrying this entry. This is the project's own rule — a green suite is not proof — earning itself
      again, on a run over **11,629 readings, 56.1% coverage, longest gap 5,731 minutes**:
      - **A day nobody watched left no row at all.** 2026-08-18 sat between the 17th and the 19th
        and was simply absent, as were the 21st to the 23rd — the four dark days of the outage
        that ended on the 24th. Every other rule in this file renders a gap as an em dash; an
        absent row renders it as *nothing*, and a reader scanning a column of dates does not
        notice the date that is not there. That is the quietest possible way to lose an outage
        from a document that goes to the university. Blank days are now filled across the
        observed span, and **counted separately**: the three-day floor counts days that were
        actually watched, so one reading either side of a fortnight's outage cannot promote
        itself to a benchmark on the strength of the days nobody saw.
      - **The blank rows then rendered `—–—`** in the observed-hours column — a range from
        nothing to nothing, which reads as a typo rather than as absence.
      *The figures themselves corroborate.* 2026-08-29 and 08-30 come in at 1.54 and 1.26 kWh
      against 21.83 on the 27th: that is a Saturday and a Sunday, and it is exactly the
      weekday/weekend separation the three-day minimum exists to protect.

### Aircon

- [ ] **FI-030** Bind an aircon remote explicitly when a site has more than one.
  - **Today.** `server/acRemote.mjs` takes the project's sole `infrared_ac` device and refuses with a
    reason when there are several.
  - **What a second aircon needs.** Somewhere to record which remote commands which `acu_ir` device.
    That place is not this public repository. It is probably a `device_config` column, or the IR hub
    API's own remote list once subscribed.
- [ ] **FI-031** Learn local IR codes beyond the library's one mode.
  - **Why.** The flow already records a learned code (dp 202 → the state manager's context). A guided
    "point the remote and press" flow, one state at a time, would let more states go over the LAN
    without the vendor cloud.
  - **The question to settle first.** How many states are worth learning: 5 modes × 15 degrees × 4 fans
    × 2 swings is 600 codes.
- [ ] **FI-032** Store the IR hub's room temperature and humidity.
  - **Today.** `server/shapeRows.mjs` stores electrical fields only, so the aircon's room readings exist
    live and nowhere else. Reports cannot show the room the energy was spent on.
- [ ] **FI-033** Enrol a new aircon from the page (Milestone 6).
  - **Today.** An IR hub is recognised but not enrollable: its node, parser, command logic and `/acu`
    endpoint are generated only by `aircon:pi` against an existing tab.
  - **What it needs.** A generator for the whole Aircon tab on a flow that has none, with its IR library
    supplied rather than extracted.

### Robustness
- **FI-026** (S) **One-sample health flickers on the hand-built tabs.** The ring buffer on 2026-09-14
  held `online: false` samples bracketed by equal readings — CARE ACU 12:46, L.O Yellow and C.O Yellow
  22:25, 05:52, 07:32, 07:51, co1 14:08, co5 14:18 — never coincident across independent devices, so a
  health flag dropping for one sample rather than an outage. RM-076 bridges them on the charts. The
  cause is on the four hand-built source tabs, which nothing in this repository generates, and was not
  investigated.
- [x] **FI-027** (M) **Persist sample quality.** `readings` stores `online` but not `frozen`, so a stored
  range cannot show a freeze and a report cannot leave one out. Follows RM-079, which is where the flag
  would first exist. **Storage half done 2026-09-22 (RM-133):** the row's `capabilities` carries
  `measurement_frozen` and `frozen_since` from the deploy on.
  **Report half built 2026-09-22 — `supabase/phase47_held_minutes.sql`, rehearsed; not applied (§0,
  Migrations).** The operator decided the same day that a HELD minute is not a recorded minute, its watts
  are in no power figure, and its energy is untouched. A held minute is one flagged `measurement_frozen`,
  or restated by RM-134's scrub (`scrub.rule = 'held_reading'`). Energy comes from the meter's own register,
  which was right. Stored reports are restated with a note, in phase44's pattern.
  - One rule, `reading_measured(online, capabilities)`, immutable so it inlines. It is used by the six
    report functions that read per-device `readings`, wherever they read `online`, except on the energy
    register: `report_hour_profile`, `report_device_daily_energy`, `report_recorded_minutes_devices`,
    `generate_monthly_report`, `report_hour_energy`, `generate_period_report`.
  - The rollup leaves held rows out of its power figures and its `online_sample_count`, and counts them in
    a new `readings_hourly.held_sample_count`. The rule survives the 30-day prune, and no reader of a rolled
    hour needed a change.
  - The migration is generated from each function's previous text. `test/phase47-held-minutes-schema.test.mjs`
    (19) puts `r.online` back where the rule stands and gets each earlier definition byte for byte, and
    checks that every remaining online-only filter is an energy register.
  - `supabase/rehearse.sh` applies it three times over a day in 2026-09-22's shape: measured, held and
    flagged, held and restated, measured at zero, then offline. **It passed:**
    - 180 recorded minutes, not 300;
    - average power 26.667 W and peak 40 W, not the held 55;
    - energy 0.079333, the register's;
    - an RM-123 swap-corrected row still counts;
    - a stored row reading 300 is restated to 180 with its first figure kept, and a second paste changes
      nothing;
    - after the rollup prunes the day, it regenerates to the same figures.
  - **Applied by the operator 2026-09-22 16:19 and read back:**
    - `readings_hourly.held_sample_count` exists, NULL on hours rolled before it.
    - `reading_measured` answers false for a held row and true for a plain one.
    - L.O Yellow's 09-22 recorded minutes are 527 where the old rule gave 895, and its hours 08–13 read
      0 minutes with no power.
    - **The restatement touched 8 older rows, which the header had said it would not:** August and the
      week of 08-17 for co1, co2, acu_main and sens_outside_temp, at 16:19. That was not held minutes but
      rollup drift: since phase44, retention has rolled August's raw rows into hourly buckets, and a rolled
      hour counts samples (capped at 60) where the raw path counts distinct minutes. Checked against the
      2026-09-15 export: counts moved 0–3 minutes; energy, peak and `generated_at` are identical; average
      power moved only for co2 (0.3013 → 0.3006 W for the month, 0.1435 → 0.1362 W for the week, as rolled
      hours are time-weighted). No note shows: the page prints one only when the whole-percent share changes.
      A restatement that recounts whenever a count differs will keep catching this drift. A future phase
      should restate only rows whose count changes for its own reason.

  **Deliberately not changed:** the building rows (`building_totals` has no per-branch flag; the held
  branch is named on the page), and the Analytics history functions `readings_buckets` / `readings_archive`.
  Their raw hours still average held watts; their rolled hours follow the rule. The 30-day buckets sit near
  the statement timeout (FI-034), and adding a jsonb read to every row there should wait for that fix.
- ~~**FI-021** (M) Meter arrival tracking.~~ **Done 2026-09-01 — EX-141.** The entry that stood
  here was **wrong about the mechanism**, and the correction is the more useful record: it
  claimed the tracker keyed on value change and had no arrival signal, when the energy
  collector's sample-buffer depth `n` was in the signature all along and does move per message.
  What was actually wrong was narrower and worse. See EX-141.
- ~~**FI-019** (M) The bridge listens on every interface, including the device segment.~~
  **Done 2026-09-01 — EX-144.**
- **FI-020** (S) **A switch's freshness is unmeasurable, and the UI cannot say so.**
  `buildLatest` stamps `ts = now` for any device with no `ctx`, so a switch's staleness watchdog
  can never fire — the same "an always-fresh timestamp cannot look old" failure the meters were
  fixed for in EX-107. Nothing is currently wrong: a switch's `online` comes from
  `global.lightStatus`, a real per-switch connection signal, which is what does the work. But
  EX-133 gave switches a 30 s budget that *by construction* cannot be exceeded, and a budget
  that cannot fire reads like a guarantee. Either the flow's `lightStatus.lastSeen` (which
  exists, and is already carried in the mock's fixture) should feed `seenAt`, or the class
  should declare that it has no measurable freshness and the UI should say "not measured"
  instead of implying live. The second is smaller and more honest; the first is better.
- ~~**FI-013** (S) The Outlet tab never polls its devices.~~ **Done 2026-08-25** — EX-038b.
- ~~**FI-009** (S) Narrow the three remaining whole-map store selectors — `FloorPlanView`, `AlertsPopover`, `EnergyBreakdownCard`.~~ **Closed 2026-09-16, not done**, after reading all three rather than reasoning about the shape of a selector a third time. `EnergyBreakdownCard` no longer selects anything: it reads `useBranchEnergy`, which holds one subscription shared with Analytics' card — the narrowing this asked for, arrived at from the other direction. `FloorPlanView` hands every reading to the lighting and outlet plans, which draw every fixture. `AlertsPopover` derives its badge from every device's latest reading and must keep doing so while it is closed, which is what a badge is for. Seven readers of `latestReadings` remain, each deriving over many devices; narrowing one would mean projecting to derived values whose identity changes on the same tick anyway. Reopen it only on a measurement that shows a cost — a profile of one tick — rather than on the shape of the code.
- ~~**FI-010** (M) The 24h chart has the same offline-blindness the 7d/30d charts just lost.~~ **Done 2026-08-25** — EX-102. The ring buffer records `online` per sample and `pointValue` suppresses a point marked offline, so an unreporting device leaves a gap rather than a flat line. Needs a flow deploy to take effect.
- ~~**FI-011** (S) Push delivery for the monthly report, once FI-005's channel exists.~~ **Done
  2026-09-16.** Email and Google Sheets stayed rejected for the reason this entry always gave — an
  SMTP credential or a service-account key would have to live next to a public checkout, to solve a
  problem the CSV download already solves (File -> Import). What it left open was "a second consumer
  of the alert channel", and that is what shipped: ntfy, no account, the topic the fleet alarm
  already uses.
  - **`server/reportNotice.mjs`** turns one stored `period_building_reports` row into the message, and
    reads the rows for the months a pass generated — one query, oldest first, and a month whose row
    does not come back is skipped rather than announced from what the generator was asked to build.
  - **The wording carries the page's rules**, which is the whole risk of a push: it is read on a phone
    by someone who will not open the page to check. A partial month says what share of its expected
    samples were recorded and calls its total **a floor**; a month with no samples reads **"not
    observed"** and prints no kWh at all; a missing figure is said rather than shown as a zero; and the
    stored share is **never called "readings coverage"**, because `online_sample_count` counts rows
    written — August 2026 is 48% by rows against 27% by readings, and RM-073 is still open on that.
    Every one of those is a test in `server/reportNotice.test.mjs`.
  - **Monthly only.** Weekly reports are generated too (RM-041), and four pushes a month is how a
    channel gets muted — after which the fleet alarm it also carries goes unread.
  - **Where it runs.** `ingest.mjs`'s report pass sends them, in its own try/catch: a push that failed
    is not a report that failed, and logging it as one would send somebody looking for a report that
    exists. The notifier is already inert without `NTFY_TOPIC`.
  - **Not yet seen in the wild.** No month generates until 2026-10-03. Tests are the whole of the
    evidence so far. **Ingest carries the code since 2026-09-17 12:04**: the three daemons had been
    started 2026-09-15 20:39, before this landed and before RM-092's `shared/circuits.mjs`, and a
    read-only check of `ActiveEnterTimestamp` against the files' mtimes found it — the EX-170 shape
    again, caught in the first-moves checks this time. Restarted together, read back: a clean start,
    the retention pass that was due ran, no minute of readings lost.
- **FI-012** (M) Partition `readings` by month if growth ever outgrows the current prune. The
  prune is a single unbounded `DELETE` in one transaction — fine at today's volumes, and the
  first thing to degrade as the table grows. Partitioning turns it into a `DROP TABLE` while
  staying inside RLS, Auth and the existing backups. See `docs/adr-001-timeseries-store.md`,
  which names this as the successor to reach for rather than a second datastore.
- ~~**FI-005** (S) An out-of-dashboard alert channel.~~ **Done 2026-08-25** — EX-103. Edge-triggered fleet alarm in the ingest daemon, delivered over ntfy (no account, no credential in a public repo). Set `NTFY_TOPIC` to enable; unset is a supported state.
- ~~**FI-015** (S) Serve the on-segment/absent split through the proxy so the Devices page can
  show it.~~ **Done 2026-08-26** — EX-128. Shipped as an endpoint plus a *conditional note*
  rather than the per-device column this asked for; the column needs a join the registry cannot
  currently make, which is FI-001. See EX-128.
- ~~**FI-016** (S) The Control page's outlet plan still pins `co1..co7` to literal coordinates.~~
  **DONE 2026-08-31.** `25cc516` the lookups, this commit the packs. It was bigger than the
  outlet plan: a guard written first (`test/device-ids-in-frontend.test.mjs`) measured **six**
  files, and they were **two different problems**.
  - **Four were singleton lookups by id** — `acu_main`, `sens_outside_temp`, `l1` — each really
    asking "the aircon", "the outdoor probe", "a lighting circuit" and answering with this
    building's name. At another site the climate tiles read `—` forever and the aircon buttons
    sent into nothing, silently. Fixed by selecting on `class` (`src/lib/siteDevices.ts`).
  - **Two were coordinate tables**, and they needed a pack rather than a lookup.
    `LightingMatrixCard` had the same defect as the outlet plan via `LIGHT_PLAN`, and both drew
    a room shell imported from the 3D pack's geometry — so **`partitionY` was measurably in the
    main chunk**, shipping this building's room dimensions to every deployment.
  **The Control plan is now a pack on RM-032's terms.** `src/components/control/plans/` loads
  only when `SITE.scene_pack` names it; `FloorPlanView` moved into `scene3d/` for the same
  reason, since it was a CARE plan in a directory named as though it were generic.
  *Measured after:* `partitionY`, `co1` and `co7` are **0** in the main chunk, and the pack sits
  in its own lazy chunks. With the pack nulled, **no pack chunk is fetched at all**.
  *The fallback is a sentence, not a second set of controls.* The first draft listed every device
  again — and the page's own tests caught it by finding two of everything, because
  `SwitchesListCard` and `OutletsListCard` already carry them. A site with no plan gets a note
  pointing at those lists; **23 controls remained reachable** with the pack off.
  *Verified on the live control surface, not only in tests:* pins land at the same percentages as
  the old `pct()` values (CO1 at 7.8125% = 25/320 exactly), 21 lamp cells and 7 row labels
  render, and clicking a puck posts one command logged as `Outlet 1 DP1 → off`.
  `src/components/control/OutletPlanCard.tsx` carries a third copy of the same survey, after
  `FloorPlanView` and `scene3d/geometry.ts` — and unlike those two it is **not** inside a scene
  pack, so it renders at every site. Found while closing RM-031, which built the replacement:
  `SpacePlanView` already draws a space's devices from data. The swap is small but not trivial,
  because the Control puck is an interaction (two commandable halves, pending state,
  corroboration) and not just a marker, so it needs the pin to accept children rather than a
  find-and-replace. *Until then, the honest statement is that the tree, the totals, the 2D plan
  and the 3D scene no longer name this building, and the Control page and `BUILT_IN_DEVICES`
  still do.*
- ~~**FI-017** (S) `BUILT_IN_DEVICES` never moved into the site directory.~~ **Done 2026-08-28**
  — `4fb431b`, with a derived guard: `test/site-config.test.mjs` fails if any of this building's
  device ids reappears in `shared/registry.mjs`, prose included. The generated flow came back
  byte-identical, which is the check that mattered. Original entry follows.
  ~~`BUILT_IN_DEVICES` never moved into the site directory.~~ `shared/registry.mjs`
  still holds this building's 21 devices inline, while `shared/sites/mmsu-nberic-care/` carries
  its identity, policy and circuits. RM-027 planned the move and it was not needed to make the
  rest of Track B work, so it was not done. A second site would edit the shared file — which is
  precisely the thing RM-033 has to make unnecessary. Mechanical: `registry.mjs` already composes
  `[...BUILT_IN_DEVICES, ...ENROLLED_DEVICES]`, so this is moving an array and changing one
  import.
- ~~**FI-006** (S) Wire `StaleDataBadge` into the remaining views that derive staleness inline.~~
  **Done 2026-08-31**, and it turned out not to be about the badge. 16 tests across
  `LiveDemandCard`, `MainPanelHealthCard` and `DsmThresholdsCard`.
  **Four components read `s.totals`; none applied the expiry rule that Analytics and Devices
  both use.** So `measured()` — written for the `co5` incident, where an outlet rendered
  `230.4 V / 2.23 A / 514 W` beside an OFFLINE badge — was never reaching the building's own
  figures. The feed goes quiet, the store keeps the last row, and the largest number on the
  dashboard carries on reading like a measurement. Now the demand figure, the three energy
  counters, the voltage and both phase currents go to `—` past five minutes.
  *The worst of it was not a number.* `MainPanelHealthCard` printed **BALANCED** and "Red and
  Yellow are within a comfortable range of each other" — a claim about the building's electrical
  state *right now* — from whatever row happened to be in the store. Expiring the inputs retires
  the sentence and the pill with them, and the phase bars no longer draw a width for a value the
  card will not print. A full bar beside an em dash is the same lie in a different medium.
  *`DsmThresholdsCard` is where it mattered most*, because it is the page where someone decides
  whether to arm a mechanism that cuts power to a working building unattended. Its two errors are
  symmetrical: a **BREACHED** flag from a ten-minute-old row is a false alarm, and **OK** from
  that same row is a false all-clear. There are now four states rather than two — `OK` had been
  standing in for three different situations, and a green word carries reassurance whichever one
  produced it.
  **The fourth was found by looking at the page, not by a test.** With the card rendering against
  the mock, the readout said `Live: 13.9 A max phase` beside a status of **NO READING** — the
  reading was there; the *threshold* was unset. Two absences with two different fixes, one a
  missing number on that very form and the other a bridge that has stopped reporting, so they get
  two words: **NO LIMIT SET** and **NO READING**, both muted rather than green. The unit tests
  had agreed with the conflation because they only ever set thresholds.
  **The badge itself was the wrong instrument and is deliberately not used.** `LiveDemandCard`
  already carries a LIVE/STALE/RECONNECTING pill; adding a second "stale" flag beside it would
  have put two freshness indicators in one card. The pill was reporting only the *link* — messages
  were arriving, so it said LIVE while the totals row underneath had stopped advancing. Those are
  different facts and the one a reader looking at "1.23 kW" needs is the second, so the pill now
  answers both and is a live region, which it was not: a span that silently swaps its text
  announces nothing, and a figure going stale is the most important state change on a monitoring
  dashboard.
  *`FloorPlanView` was left alone on purpose.* It already dims per-device via SVG opacity, and
  `StaleDataBadge` renders a `div` — it cannot wrap SVG. Announcing staleness on the plan needs a
  different mechanism and is not this item.
  *Neuter-verified:* forcing `isReadingExpired` to `false` failed 8 of the 16.

### Accessibility
- ~~**FI-007** (S) `--good` on `--good-soft` measures 4.45:1 against the page background.~~
  **Done 2026-08-31**, and the entry understated it. FI-007 read this as one token's latent
  hazard — *"passes everywhere it currently renders, but will fail the first time a green badge is
  placed directly on the page."* Extending FI-008's guard to the composition rather than the token
  showed **it was already live in three of the four dark-theme semantics**, on `.badge--*`, which
  the shared `Badge` component renders across the app.
  **Why a badge is the worst case in the palette.** `.badge--good { background: var(--good-soft);
  color: var(--good); }` — the tint is translucent, so it composites onto whatever surface the
  badge sits on and pulls that surface *towards the text colour*, which is the one direction that
  destroys contrast. Every pair lost between 0.4 and 1.5 against its plain-surface figure.
  Measured worst cases before: dark `--bad` **3.75:1**, dark `--blue` **3.63:1**, dark `--good`
  **3.97:1**, light `--warn` and light `--blue` **4.27** and **4.24**.
  **Lowering the tint alpha could not fix it, which is the finding that changed the approach.**
  Solved numerically: light `--warn` and dark `--blue` stay under AA *even at alpha 0*, because
  those text tokens sit at 4.24–4.58 on the darkest flat surface before any tint exists. So the
  text tokens moved instead — darker in light, lighter in dark, 1–7 per channel in light and
  13–20 in dark, same hue throughout. Every shift also *raises* contrast on plain surfaces, so
  nothing was traded away to buy this.
  *One tint did move, for a different reason.* Dark `--red-soft` derived from `--red` while the
  light theme's derives from `--red-bright`. That inconsistency was self-defeating: the chip
  lightened further every time `--red` was lightened, pushing badge text back under AA exactly
  when the text colour was raised to clear it. Dark now follows the light convention.
  *Verified in a real browser on the actual `.badge--*` elements*, not only in the file — light
  good/warn/bad **4.85 / 4.83 / 5.44**, dark **4.62 / 5.81 / 4.56**, all over `--bg-surface-2`,
  the worst flat surface.
  *`scene3d/tokens.ts` mirrors `--good` and `--warn` into Three.js materials and was updated with
  them*; its own drift guard reads the first occurrence in the stylesheet and confirms the pair.
  *The guard now covers seven text/tint pairs across both themes*, including the four the
  stylesheet does not compose today — a `-soft` token exists to be the background for its matching
  text colour, and that is the palette's contract whether or not a component has used it yet.

### Developer experience
- ~~**FI-008** (S) A contrast regression guard.~~ **Done 2026-08-31** — `test/contrast.test.mjs`,
  8 tests. Every text token measured against every surface that carries text, in **both themes**:
  8 × 8 × 2 = 128 pairs, held to WCAG AA 4.5:1. The palette cannot know what size type a token
  will be used at, so it is held to the normal-text bar rather than the 3:1 large-text one.
  **It found a real one on its first run.** Dark `--red` was `#e06155`, verified at 4.8:1 against
  `--bg-surface` and never against `--bg-surface-2` — where it measures **4.33:1**, under AA, on
  a surface twenty-odd rules use. Nothing rendered red text there yet, which is exactly the
  FI-007 pattern this file exists to get ahead of: passes everywhere it currently appears, fails
  the first time it is placed somewhere new. Raised to `#e6675b` (4.65:1 there, 5.13:1 on
  `--bg-surface`) — six per channel, below a visible difference and above the bar.
  *Confirmed in a real browser, not only in the file:* `getComputedStyle` on the live dark
  cascade returns `#e6675b` and the same two ratios to the hundredth.
  **And the first fix was incomplete, which the widened guard then caught.** `--bad` is a
  hand-copied duplicate of `--red` carrying the comment `= --red`; raising `--red` left the copy
  four lines away still at 4.33:1. It has to stay a duplicate — `scene3d/tokens.ts` mirrors it
  into a Three.js material and three.js cannot resolve `var()`, and the mirror's own drift guard
  reads the first `--bad:` in the file — so `--good`/`--warn`/`--bad` joined the measured set and
  the equality the comment merely asserted is now a test. A comment cannot notice a drift; a
  duplicate that nothing checks is a bug with a delay on it.
  **Deliberately measures pairs the app does not compose today.** Checking only current
  compositions would make this file agree with every latent hazard instead of finding them,
  which is how `--red` survived.
  *Deliberately not measured:* `--accent` (2.15:1 in light — the stylesheet ships `--accent-text`
  for exactly this reason) and `--faint`/`--faintest`, which are documented decoration-only.
  Asserting those would record a rule the palette already states rather than find anything.
  *Two parsing traps, both paid for while writing it, both now documented in the file.* `:root`
  also appears inside `@media (prefers-contrast: high)`, which redefines `--muted` and
  `--muted-2`; folding that in made `--muted` measure identically to `--txt` — a wrong number
  that looked entirely plausible. And a translucent token is not a colour until composited:
  `--glass` over `--bg-page` resolves to `rgb(251,252,253)`, the exact figure `src/index.css`
  documents for its own hand-verification, and a test asserts that agreement — which is what
  ties this file's arithmetic to the palette's.
  *The maths is self-tested* (black on white = 21:1, a colour on itself = 1:1, `#767676` on white
  = 4.54:1) so a passing palette cannot mean a broken formula, and **both halves were neutered
  and confirmed to fail** — the dark half by the real `--red` defect, the light half by a
  synthetic `--muted-2`.
  *What it does not do:* read the DOM. It measures the palette, not the page, so text on a
  gradient or an inline colour is still only findable in a browser — which is what found the
  1.14:1. `test/design-tokens.test.mjs` remains the cheaper guard beside it: that one catches a
  token name that never existed, this one catches a name that exists and cannot be read.

---

## 4. Known contradictions & doc drift


**Resolved 2026-09-17 by RM-100:**

| Was | Now |
|---|---|
| This file said the kiosk is **1024×600** (RM-082d and the sticky-bar comment in `index.css`, `ReportControlBar.tsx`, the chart-width comments) *and* **800×480** (RM-071c/e, EX-158's kiosk row). The Reports control bar's sticky threshold was measured against the first. | The display is **800×480** — read from the Pi's own DRM connector (`DSI-1` reports one mode, `800x480`), not from either document. Every 1024 in `src/` is corrected; RM-101 re-measured the bar at that width. |

**Resolved 2026-09-13 by EX-170:**

| Was | Now |
|---|---|
| `CLAUDE.md` and `docs/pi-session-brief.md` said `server/` and `shared/` changes need `sudo systemctl restart ibems-proxy ibems-scheduler` | Three daemons load that code, and `ibems-ingest` was the one left out — it was found on the Pi still running `shared/sites/` modules replaced four days earlier, and was restarted and read back at 12:40 the same day. Both documents name all three, the brief carries the restart map, and `test/service-restart-map.test.mjs` derives that map from the unit files and fails when either disagrees. |

**Resolved 2026-09-09 by RM-066..069:**

| Was | Now |
|---|---|
| `FI-022` appeared as both `- [ ]` and `- [x]` in this file | Ticked. The later entry was the true one; the checkbox was never updated when the work landed. |
| `AutomationPage.tsx` told operators nothing it saved reached hardware | It reads its reach from `/api/capabilities` and says which state the deployment is in. |
| `shared/commands.mjs` pointed at a roadmap entry for per-socket scheduling that did not exist | RM-066 exists, and the note's suggested `UNIQUE(device_id, socket)` was wrong — that is the same blocker one level down. |
| `test/socket-fanout.test.mjs`'s header asserted two caller facts | Both are now false by design; the header is corrected in place. |
| `test/migration-idempotency.test.mjs` counted only `create policy` and `create trigger` | It counts `alter table … add constraint` too — the statement `phase6_schedules_unique_fix.sql` itself used. It immediately flagged `phase27`, which turned out to guard its constraints the other legal way (`pg_constraint` lookup), so that form is recognised too. |

| # | Contradiction | Sources | Believed |
|---|---|---|---|
| ~~1~~ | ~~"Stage 1 is view-only…"~~ | — | **Resolved.** `README.md`'s Rules section now says "Control exists, but hardware dispatch is gated" and describes the audit-row-first ordering accurately. |
| ~~2~~ | ~~`package.json` `description` says "view-only"~~ | — | **Resolved.** It describes audited, gate-controlled dispatch. |
| ~~3~~ | ~~Architecture planning proposed MQTT + Home Assistant as the device layer~~ | — | **Resolved 2026-08-26 at the source.** The code was always right; the fix was to stop the planning doc from saying otherwise. `ibems-architecture-upgrade_2.md` (one level up, outside this repo) was rewritten: Home Assistant is now recorded as *not adopted*, MQTT as *not the device bus*, and both sit in a settled-decisions table so they are not re-proposed. It had been steering readers into planning around a component nobody was going to install. |
| 4 | Mosquitto is described as dropped, but the broker is installed and running on the Pi | planning docs vs. the live host | **Both, partially — and now measurably idle.** The bridge genuinely does not use MQTT; the broker is still installed, running, and subscribed to by one flow node. As of 2026-08-26 it carries **no traffic at all**: five minutes on every topic, zero messages (§5 Q2). So it is not a second device layer, it is a dependency nothing currently feeds — which is the thing to weigh before RM-026 chooses to route the inverter through it. **RM-026 has since chosen it**, so the broker acquires its first real consumer — and a liveness check on that topic is part of that work, not an extra, precisely because nothing noticed the last publisher going silent. |
| ~~5~~ | ~~`README.md` points at a Stage 1 plan path outside the repo~~ | — | **Resolved.** `README.md` now points at `ROADMAP.md` and the two in-repo docs. |

---

## 5. Unverified / needs confirmation

1. ~~**Why did every Tuya device drop at once?**~~ **Answered 2026-08-24, on site — and
   the earlier answer was wrong in a way that mattered.** It was recorded as a 2.4/5 GHz band
   mismatch. On site that turns out to be two faults: the Pi's SSID had **client isolation**
   (it could not reach a host on its own /24, which a band split cannot cause), *and* the
   devices had moved to Tuya protocol v3.4/v3.5 while the flow still declared 3.1/3.3. Only
   the second explains `mtr_co_yellow` dropping three days earlier than everything else. Both
   fixed — see RM-001.

2. ~~**Is the ESP32 still publishing its AC status?**~~ **Answered 2026-08-26: no.** The
   previous answer excused the silence — the ESP32 is 2.4 GHz and the Pi was on 5 GHz, so the
   outage explained it. That excuse is now gone: with the Pi back on the device SSID, a
   five-minute subscription to **every** topic on the local broker saw zero messages. The broker
   is running and the flow still subscribes to `nbric/ac/status`. So the ESP32 itself is silent,
   and has been for days with nothing noticing — which is the more useful finding, because it
   says any MQTT path here needs a liveness check to be trustworthy (see RM-026(b)).
3. ~~**Was the light token ever exercised against real hardware?**~~ **Answered 2026-08-25.**
   The operator toggled `l6` from the Control page and the physical fixture responded, with
   three `POST /api/command` calls logged `-> OK` and Node-RED showing `Connected to device!`
   for that node. Rotation was already confirmed (the old token is rejected); this closes the
   other half — the new token drives real hardware.
4. **Is there a backup of the Supabase project?** The repo now *configures* one — `npm run
   backup` and `docs/backup-policy.md` — but nothing has *verified* one. No restore has been
   tried, and whether Supabase itself takes a backup depends on a plan tier this pass could
   not check. See RM-006d.
5. ~~**Should `--good` be corrected pre-emptively** (FI-007), or left until a green badge actually
   lands on the page background?~~ **Answered 2026-08-31: the question had a false premise.** It
   was not waiting to fail — measuring the composition rather than the token showed three of the
   four dark-theme semantics were *already* under AA on the badges the app renders today. "Leave
   it until it fails" is only a real option when you have checked whether it has.
5b. ~~**Should device readings move to a purpose-built time-series database?**~~ **Answered
   2026-08-21, amended 2026-08-22** — including the stronger form of the question, "Supabase
   as the brain and InfluxDB as the engine, with Google Sheets for reporting". The answer is
   one Postgres store, with the triggers that would reverse it and the partitioning step to
   try first both written down: `docs/adr-001-timeseries-store.md`. The amendment records the
   measured evidence (auto-shed alone spans telemetry, thresholds, device config and the audit
   trail in one 15-second decision) and the one argument against that is not technical.
6. ~~**What retention period is wanted for `readings`?**~~ **Answered 2026-08-21: 30 days of
   per-minute resolution, with permanent hourly buckets behind it** (RM-006). Chosen by the
   operator so a year-scale energy claim stays defensible without the raw table growing
   without bound.
7. **Has the Analytics 7d/30d fix been seen in a real browser?** The truncation is fixed and
   unit-tested, but the end-to-end check needs RM-008 applied first, and needs a browser —
   the duplicate-CORS-header incident recorded in `server/proxy.mjs` was invisible to curl.
8. **Everything Phase 10-13 asserts about the live database is unverified.** This pass was
   written from a workstation with no Supabase credentials, no `psql` and no Docker, and the
   Supabase MCP connector was not authorised. Specifically unconfirmed: that the three new
   migrations parse and run; the project's plan tier and therefore whether Supabase takes any
   backup of its own (`docs/backup-policy.md` turns on this); current row counts; and whether
   the report timezone default (`Asia/Manila`) matches what the Tuya devices actually reset
   their daily counters on. The last one is worth a deliberate check — the report's energy
   figures depend on it, and it is invisible until a month is reconciled by hand.
   **RM-027 is where it gets fixed rather than merely checked:** the timezone is currently a
   SQL default AND a hardcoded UTC offset in `shared/buildLatest.mjs`, two places that can
   disagree with each other. It becomes one per-site value.
9. ~~**Has the Reports page been seen with real data?**~~ **Answered by measuring it,
   2026-09-10 (RM-072).** It has. `period_building_reports` carries four weekly rows and one
   monthly row generated from production readings — August 2026 at 90.95 kWh from 21,421 of
   44,640 expected samples (48% coverage, so the page's own "partial" caveat is the common
   case rather than the edge one), peak 4,551 W, 127 commands, and the week of 2026-08-31 at
   46.08 kWh with **100%** coverage. The unit tests were never the doubt; this question was
   about whether the generator had ever run against real rows, and it has.
   **Two things the real rows say that the fixtures did not.** The monthly figure agrees to
   the digit with the legacy `monthly_building_reports` row for the same month — which is
   exactly the comparison **RM-042** has been waiting for, so RM-042 is no longer blocked. And
   the anomaly counts are not credible as findings: 2,136 for August and 3,428 for the week of
   2026-08-31, in a building whose median demand is 105 W. `server/anomalyStats.mjs` already
   requires z-score and IQR to agree; this says that is still not enough, and a report must
   qualify that number rather than print it as a headline. Recorded rather than rendered.

10. ~~**Is 16 °C an acceptable aircon setpoint here?**~~ **Answered by building it,
    2026-08-26.** The floor is 25, it lives in `SITE.policy`, and `validateCommand` enforces
    it server-side — so a request that never went through the dashboard is refused too.
    `ACU_MIN_C` was deliberately left at 16: that is what the IR library has codes for, a
    hardware bound, and a policy may narrow it but never widen it. **If 25 is wrong, one
    value in one file changes it.** Original question: `shared/commands.mjs` sets `ACU_MIN_C = 16`
    and validates it server-side, so the Control page can legitimately command it. The funded
    project plan's Key Features state the university's policy as **"not lower than 25 °C"**.
    Either the floor is wrong or the plan is describing an aspiration rather than a rule, and
    only the operator knows which. If it is a rule, RM-027's per-site policy is where it belongs
    — a UI that merely hides the option is not enforcement, and this system's own convention is
    that the bound lives beside the validator.

11. **Is occupancy-sensing hardware actually being bought?** The plan's Key Features list
    "lighting system controlled via motion sensors and timers". Timers exist. No occupancy or
    motion member exists in `src/lib/types.ts`'s `DeviceClass` union, and no such device is
    enrolled or visible in the vendor project. This is less a software gap than an unanswered
    procurement question, and the answer decides whether it is a phase or a footnote.

12. **Where is the baseline report?** Milestone 1 wants a "baseline energy dataset and
    benchmarking summary", and its two open checklist items are the last ones in Activity 1.
    `npm run demand:profile` computes the figures — it is what produced the DSM limits — but it
    prints to a terminal and leaves nothing citable behind. The Reports page already has the CSV
    serializer and the coverage-honesty logic this would need (EX-033, EX-034), so the gap is an
    output, not a calculation.
