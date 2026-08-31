# Physical installation — CT meters, relay modules, IR blaster

> **THIS IS A TEMPLATE WITH GAPS, NOT A FINISHED GUIDE.** Every `〔FILL IN〕` marks something
> only a person at the CARE office can supply: a photograph, a part number, a torque figure, a
> measured distance. The structure and everything not marked comes from the running system and
> from what this project has already learned the hard way; the marked parts are unwritten, and
> pretending otherwise would be worse than leaving them visible.
>
> **Nothing here has been reviewed by an electrician.** Written 2026-08-31 to give the site visit
> a checklist to fill in, not to be followed as-is.

**Audience:** an electrician plus one person from the receiving institution's facilities team.
**Prerequisite:** the software side is up and reachable — see [`replication.md`](./replication.md).

---

## 0. Before anyone opens a panel

⚠ **Current transformers go around a live conductor.** A CT with an open secondary on an
energised conductor can develop dangerous voltage across its terminals. Shorting links stay on
until the CT is wired to the meter.

⚠ **Everything in section 2 is inside a distribution panel.** In the Philippines this is
licensed work. The rest of this document assumes a qualified electrician is doing it and that
the relevant circuits are isolated and locked off.

**What is NOT electrical work and can be done by anyone:** the Raspberry Pi, the network, the IR
blaster, and every software step.

| Check | Why |
|---|---|
| Single-line diagram of the panel obtained | You cannot decide which circuits to meter without it |
| Isolation and lock-off agreed with the building | |
| A spare breaker way, or a plan for the Pi's supply | The Pi needs permanent power near the panel or near the devices |
| 〔FILL IN: PPE and permit-to-work required by the institution〕 | |

---

## 1. What you are installing

The CARE office deployment, as a reference point — **this is what exists, not a specification
for what another building needs**:

| Kind | Count | What it does |
|---|---|---|
| CT branch meters | 4 | Measure whole circuits at the panel: lighting, outlets, and two aircon feeds |
| Dual relay outlets | 7 | Switch and meter one double socket each |
| Lighting relay switches | 7 | Switch a lighting circuit; no metering |
| IR blaster | 1 | Sends aircon commands (setpoint, mode) |
| Temp/humidity sensor | 1 | Ambient reference |

A second building needs its own survey. The count above is a consequence of one office's panel
and one office's fixtures.

### Parts list

〔FILL IN: the actual bill of materials — manufacturer, model and rating for each of the five
kinds above, plus CT ratings and the aircon's IR protocol/brand. This is genuinely unknown to
the repository: device *classes* are recorded, part numbers are not.〕

**One thing the software does know and you should match:** the field devices speak **Tuya
protocol v3.4 / v3.5** and are **2.4 GHz only**. Verified by decrypting their own discovery
broadcasts (2026-08-24), not from a datasheet. Substituting a device that speaks a different
protocol means new bridge work, not just a different part number.

---

## 2. CT meters at the panel

**Placement.** One CT per circuit you want to see separately. Metering a circuit you will never
act on adds a number nobody uses; not metering one you will act on makes the whole load-shed
feature guesswork.

**Orientation matters.** A CT clamped backwards reports a negative or zero reading. The arrow or
`K→L` marking faces the load.

〔FILL IN: photograph of the CHNT sub-panel with the four CTs in place, clamp orientation
visible.〕

〔FILL IN: which physical breaker each CT is on, by way number.〕

**Record the circuit map as you go.** This is the single most important thing to write down, and
the CARE office's own version exists only as a comment transcribed from a 2019 dashboard:

```
L.O red     -> the room's lighting circuits
L.O yellow  -> OUTDOOR ACU (separate unit, right side outside the room)
C.O yellow  -> convenience outlets
ACU meter   -> indoor ACU
```

It goes into `shared/sites/<slug>/circuits.mjs`. Get it wrong and every phase total is
confidently wrong — the dashboard cannot tell.

**Two logical meters can share one physical device.** At CARE, two of the four are one box
reading different DPS ranges. Device identity in this system is the *logical* meter, never the
Tuya device id. If your hardware does this, note which are paired.

### Phases

Each metered circuit declares a phase (`red`, `yellow`, `blue`). A phase with no meter reports
**"not metered"**, never zero — the CARE office has no Blue-phase meter and the dashboard says
so rather than drawing a flat line at zero.

〔FILL IN: the building's supply — single-phase or three-phase, and which phase each metered
circuit sits on.〕

---

## 3. Relay outlets and lighting switches

**Outlets** replace an existing double socket. Each has two independently switchable and metered
sockets.

**Lighting switches** replace a wall switch and carry no metering — their consumption is seen at
the lighting CT instead, which is why the lighting circuit needs one.

〔FILL IN: photograph of a fitted outlet and a fitted switch, and the back-box depth needed.〕

⚠ **Label every device physically as you fit it**, with the id it will have in the system
(`co1`, `l1`, …). The dashboard can tell you a device is offline; it cannot tell you which faceplate
that is, and an unlabelled fleet turns a five-minute fix into a room-by-room search.

⚠ **Do not put a relay on anything that must not lose power** unattended. Load-shed switches
things off without asking and, by design, never switches them back on: restoring load unattended
is not recoverable by a person, so it is deliberately manual. Anything that must ride through —
a server, a fridge, medical equipment — either gets no relay or gets marked "never shed" in the
app.

---

## 4. The IR blaster

Sits in line of sight of the aircon's receiver.

〔FILL IN: mounting position and distance, with a photograph. The CARE unit needed re-pairing
once (`ROADMAP.md` RM-016); note what worked.〕

The setpoint floor is **policy, not hardware**: the site's `acu_min_setpoint_c` is what the
building allows, and it is enforced server-side. The IR library's own lower bound is a separate,
lower number. Do not conflate them when testing.

---

## 5. Network

This is the step that has cost this project the most time, twice.

⚠ **The Pi must sit on the same 2.4 GHz segment as the devices**, and that segment must not have
client isolation. A Pi on a 5 GHz SSID has working internet, working remote access, and **every
device reading offline** — which looks exactly like a software fault and is not one.

- Put the devices on a **dedicated 2.4 GHz SSID** if you can. CARE does.
- To test whether two hosts can see each other, use **ARP, not ping**. A Windows machine drops
  ICMP by default, so a silent ping proves nothing. If `ip neigh` resolves the other host's MAC,
  layer 2 works.
- Devices broadcast for discovery every **5 seconds**, so any discovery timeout must be well
  above that. This was set to 1000 ms once and produced thousands of failures an hour.

〔FILL IN: SSID naming convention, AP model and placement, and whether the institution's IT
department must provision the VLAN.〕

---

## 6. Commissioning checklist

Work down this list; each line is a thing to observe, not to assume.

- [ ] Every device appears in the app's device list
- [ ] Every device reads **online** — if not, **restart Node-RED before suspecting hardware**. A
      stuck node is indistinguishable from an unplugged device, and this cost a day once. Only if
      it is still dark is a hardware fault earned.
- [ ] Each CT reads a plausible non-zero power with a known load on, and near-zero with it off
- [ ] No CT is negative (clamp reversed)
- [ ] Toggling each relay from the app moves the real fixture — **watched, physically**
- [ ] Each outlet's two sockets switch independently and are not swapped
- [ ] The aircon responds to a setpoint change
- [ ] Phase totals match a clamp meter on the incomer, within tolerance
      〔FILL IN: what tolerance the institution accepts〕
- [ ] Every device is labelled physically with its system id
- [ ] The circuit map is written into `circuits.mjs` and the phase totals look right
- [ ] Devices placed into the space tree, and positioned on their room's plan
- [ ] A power cut and restore leaves everything reconnected 〔FILL IN: observed, or not yet〕

**A green dashboard is not commissioning.** This project has "a green test suite is not proof"
written down twice, both times earned. Watch the fixture move.

---

## 7. Handover

〔FILL IN: who holds the Tuya account, who holds the Supabase project, who is called when a
device drops, and what the institution's own maintenance schedule is.〕

Handed over with the system:

- `docs/replication.md` — standing the software up
- `ROADMAP.md` — what exists, what does not, and the evidence for both
- `CLAUDE.md` — the traps, in the section titled "site facts worth never re-deriving"
