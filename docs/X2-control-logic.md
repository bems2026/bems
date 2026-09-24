---
title: Control and automation logic
purpose: Where each control strategy is implemented, how a setting reaches the edge, and when the system refuses to act (plane X2)
audience: [integrator, administrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo de220ee
evidence: [E-041, E-057, E-065, E-071, E-120, E-121, E-122, E-123, E-131, E-164, E-172, E-174, E-185, E-194, E-195, E-196, E-197, E-198, E-199]
---

# Control and automation logic

[`X2a-control-strategy.md`](X2a-control-strategy.md) is authoritative on strategy: the triggers, the six strategies,
the priority order, the control flow and the test manual. This chapter is how iBEMS realises them, file by file, and
where it does not yet.

The command path, from a click or a due schedule to a relay, is drawn in
[00 § Following one reading and one command](00-overview.md#following-one-reading-and-one-command).

## What it is

### Where each strategy lives

| Strategy (X2a §3) | As built | Runs | Evidence |
|---|---|---|---|
| **Open loop:** the clock | `server/scheduler.mjs` (`tick`), deciding with `server/schedulePlan.mjs` (`resolveDue`) | Every 15 s; each schedule fires once, in the minute its `on` or `off` time names | E-071, E-195 |
| **Feedback:** hold a room at a target | The aircon loop: `acuTick`, deciding with `server/acuLoopPlan.mjs` (`planSetpoint`) | Every 15 s, stepping at most once per rule's interval | E-194, E-197 |
| **Setpoint reset** | The same loop: it moves the unit's setpoint as a lever to hold the **room** at its target | as above | X2a §3.3 |
| **Rule- and policy-based** | The command validator (`shared/commands.mjs`); the room-floor check when a rule is saved (`upsert_acu_rule`) and in the loop | On every command; on every save | E-120, E-121, E-198 |
| **Demand-side management** | Auto-shed: `shedTick`, deciding with `server/shedPlan.mjs` (`planShed`) | Every 15 s, one tier per pass | E-123, E-194 |
| **Predictive and optimising** | Not implemented. The Automation page lists optimum start and stop as not installed, with its blocker. | — | E-174 |

All three loops run inside **one daemon**, `ibems-scheduler`, so they can see each other's state. The aircon loop needs
that: a schedule that switches the unit off must stop the loop stepping, and in one process that is a variable, not a
race [`server/scheduler.mjs`, the note above `acuTick`].

**The flow does not schedule.** Node-RED's own schedule arrays (`sched_1..7`, `outlet_sched_1..7`, `ac_sched`) are empty,
and nothing in the flow writes them [E-057]. They bypass the gate and the audit trail, so they must stay empty. The
flow's *AC Master Logic* only turns a requested aircon state into an IR frame ([01](01-field-devices.md)).

### How a setting reaches the edge

Nothing is pushed. The page writes a row, and the edge reads it on its next pass.

| Setting | The page writes | Read by | Takes effect |
|---|---|---|---|
| A schedule | `schedules` | The scheduler | Within 60 s of saving (its refresh), then at the scheduled minute |
| Demand limits, auto-shed on or off | `dsm_thresholds` | The scheduler | Within 60 s; judged every 15 s |
| Shed tiers | `device_config.load_shed_group`, `socket_config.load_shed_group` | The scheduler | Within 60 s |
| An aircon room-target rule | `acu_rules`, through `upsert_acu_rule` (checked against the live floor) | The scheduler | Within 60 s |
| The room-temperature floor | `sites.policy`, through `set_acu_min_room_target` | The proxy, live; **the loop, not at all**: it uses the build value (F-033) | Next command at the proxy; the loop only after a rebuild and restart |
| The dispatch interlock | `HARDWARE_DISPATCH_ENABLED` in `server/.env` | The proxy and the scheduler, **at start** | After restarting both [E-131] |

Evidence: E-071 (refresh 60 s, tick 15 s), E-121, E-198.

### The priority order, as built

X2a §4 lists seven inputs; the first that applies wins. **iBEMS has no arbiter that applies that list** [E-194]. Each
loop acts on its own, and the order emerges from what each one does:

| X2a priority | As built | Holds? |
|---|---|---|
| 1 · Safety interlocks | The hardware setpoint range (16–30 °C) is refused outright [E-120]. The aircon loop never switches a unit on or off, and steps at most once per interval [E-197]. **No minimum off-time exists** for any relay [E-194]. | Partly |
| 2 · Manual override | A person's command goes straight through the proxy and is not held. The next schedule edge replaces it, which X2a names as usually the right expiry. **Auto-shed does not yield**: it sheds a load a person restored on its next pass, while the breach lasts [E-194]. The aircon loop does yield (`manual_override_recent`) [E-197]. | Partly (F-031) |
| 3 · Institutional policy | The room floor refuses a rule saved below it without a written reason [E-121]. A manual setpoint below it is sent, and the warning is recorded [E-120]. "Never shed" protects a relay [E-123]. | Yes, with F-033 |
| 4 · Demand shedding | Only relays with a tier; one tier per pass; never restores; needs an armed limit **and** an owner on record [E-123, E-164] | Yes |
| 5 · Conditions | The aircon room-target loop. Occupancy, daylight and air quality are not installed. | Where installed |
| 6 · Schedule | Fires at its edges. **It does not check whether auto-shed switched the relay off**, so an `on` edge restores a shed load [E-194]. | Partly (F-031) |
| 7 · Default state | Whatever the relay last held. On power loss, the device's own power-on setting decides ([01](01-field-devices.md)). | Device-defined |

Until F-031 is decided, operators should know the two conflicts:
- **Fighting auto-shed from the Control page does not work** while the building is over its limit. Lower the load
  elsewhere, or raise the limit.
- **A schedule can restore a shed load at its `on` minute**, after which auto-shed may shed it again within 15 s.

### What a schedule record looks like

A `schedules` row [E-195]:

| Column | Meaning |
|---|---|
| `device_id`, `socket` | The relay. `socket` is null for a switch, 1 or 2 for an outlet's sockets. |
| `rule` | `{"on": "07:00", "off": "18:00", "days": "1111100"}`. `days` is seven characters, **Monday first**, `1` meaning active. Either time may be absent. |
| `enabled` | Armed or not. An unarmed row never fires. |
| `label` | Up to 60 characters, so a stack of rules reads as a day |
| `updated_by` | Required: the account that saved it, and the owner of every command it fires |
| `created_at`, `updated_at` | Order and audit |

Rules that shape firing:
- Several rows may stack on one relay; exact duplicates are refused.
- In one minute, **off wins** over on, within a row and across rows.
- A `days` value that is missing or malformed matches no day, so an unfinished rule never fires.
- `Date.getDay()` counts from Sunday, and the stored days from Monday. The conversion lives in one place
  (`appDayIndex`).

### How demand thresholds are evaluated

Every 15 s the scheduler reads the building total and each device's reading from the bridge, then `planShed`
decides [E-123]:

1. **Breach?** The highest phase current against `max_phase_current`, and the total power against `max_total_kw`.
   Either limit may be unset.
2. **Allowed to act?** Auto-shed must be armed, and the thresholds must name the account that armed it. Otherwise a
   breach is logged ("DSM breach, no action taken") and nothing is switched.
3. **What to shed:** the first tier, in the order 1, 2, 3, that still has a relay **on**, judged per socket.
   Unassigned and "never" relays are never candidates.
4. **Fire:** one audited command per relay, noted `auto-shed <tier>: <breach>` [E-185].
5. **Next pass:** measure again. If still over, the next tier goes. Nothing is ever switched back on.

### The dispatch interlock

`HARDWARE_DISPATCH_ENABLED` in `server/.env` decides whether a recorded command reaches hardware at all. With it off,
every command is still validated and recorded, as `dry_run`, and nothing moves [E-122]. The proxy and the scheduler read
it at start, and both refuse to start with it on but no `LIGHT_API_TOKEN` [E-199].

**On the pilot it is on** [E-041]. This manual records the setting and never changes or recommends changing it (G7).
Changing it is the site's decision, and the form below records that decision.

**Dispatch interlock record**

| Field | Entry |
|---|---|
| Site | |
| Setting after this change | on / off |
| Date and time it took effect (both daemons restarted) | |
| Read back from the scheduler's start line (`dispatch=OPEN` or `dispatch=closed`) | |
| Reason | |
| Tests passed beforehand (X2a §8: T1 Control and T2 Reliability at least) | |
| Who decided (role, not only name) | |
| Who carried it out | |
| Who was told: the building's occupants and the facility manager | |

### When the system refuses to act

Every refusal is named, and none is silent. Codes are what the proxy returns and the audit note records.

**Before anything is recorded, at the proxy:**

| Condition | Code |
|---|---|
| No valid session | `401 unauthorized` |
| A break-glass session | `403 break_glass_cannot_command` [E-172] |
| Malformed body, unknown device, a meter or sensor, a bad action | `invalid_body`, `unknown_device`, `not_commandable`, `invalid_action` |
| An outlet without a socket, or a socket that does not exist | `socket_required`, `invalid_socket`, `socket_not_applicable` |
| A setpoint outside 16–30 °C, or on a device with no setpoint | `invalid_target_c`, `target_c_not_applicable` |
| Aircon mode, fan or swing not valid, or sent to another class | `invalid_mode`, `invalid_fan`, `invalid_swing`, `ac_state_not_applicable` |
| A capability write the catalogue does not allow | `invalid_capability`, `unknown_capability`, `capability_not_applicable` |
| The audit row cannot be written and the database gave an answer (a refusal, not an outage) | `audit_log_unreachable`: **no row, no dispatch** [E-065, E-196] |

**Recorded, and then not dispatched:**

| Condition | Result |
|---|---|
| The interlock is off, or the class is not dispatchable (`switch`, `outlet_dual` and `acu_ir` are) | The row is `dry_run` [E-122, E-196] |
| The device is offline, the bridge unreachable or refusing, or no local route exists for an aircon state | The row is `failed`, with `device_offline`, `bridge_unreachable`, `bridge_rejected` or `no_dispatch_route` in the note |
| The final status update is lost | The row stays `dispatching` (F-006) |

**Automation that holds rather than acts** [E-197]:

| Loop | Holds when |
|---|---|
| Schedules | Disarmed; no `updated_by`; no days selected; no times; an unknown device or socket; a device with no dispatch path |
| Auto-shed | Not armed; no owner on record; no breach; nothing tiered is on |
| Aircon loop | Disarmed; outside its window; the unit off or offline; the sensor stale; a recent command from a person or another rule; waiting out its interval; a direction reversal too soon; at its target; at the 16 °C floor or 30 °C ceiling; a target below the floor with no recorded reason |

The Automation page shows each hold in words, from the same vocabulary the daemon uses, and a test keeps the two in
step [E-197]. One of those sentences is out of date (F-032).

## What you need

| Item | Specification that matters |
|---|---|
| The scheduler running | `ibems-scheduler`, with `server/.env` holding the service-role key and, if dispatch is on, `LIGHT_API_TOKEN` [03](03-edge.md) |
| Accounts that own the rules | Every rule's `updated_by` must be a real account ([X1](X1-security.md)) |
| A decided priority order | X2a §4, signed off, with the as-built gaps above accepted or fixed (F-031) |

## How to install

The logic ships with the edge ([03](03-edge.md)). There is nothing separate to install. Before arming anything:

| Step | Action | Expected result |
|---|---|---|
| 1 | Confirm the scheduler started with the dispatch state you expect | `journalctl -u ibems-scheduler \| grep -m1 dispatch=` shows `OPEN` or `closed` |
| 2 | Run X2a §8's T1 and T2 tests with the interlock as it will be used | Each test passes and is recorded |
| 3 | Arm one schedule on one visible load | It fires at its minute; a `commands` row with `source = 'schedule'` appears |

**Tested.** Step 1 is how E-041 was read. Steps 2 and 3 have not been re-run for this manual.

## How to configure

Rules and thresholds are set in the app ([05](05-interface.md#user-guide)); the edge picks them up (see the table
above). Two environment settings tune the loops, and neither needs changing on a normal site:

| Variable | Default | Effect |
|---|---|---|
| `SCHEDULE_REFRESH_MS` | 60 000 | How often the scheduler re-reads rules |
| `SCHEDULE_TICK_MS` | 15 000 | How often the three loops run |

## How to verify

| Check | How | Pass looks like |
|---|---|---|
| Schedules fire | After an armed schedule's minute: `select requested_at, device_id, status, note from commands where source = 'schedule' order by requested_at desc limit 5;` | A row within a minute of the scheduled time, `dispatched` (or `dry_run` with the interlock off) |
| Auto-shed acts once per tier | In a test window, set a limit just below live demand, with auto-shed armed and one relay in tier 1 | Only tier 1 sheds; nothing is restored; the note names the breach |
| The loop yields | Change the aircon setpoint by hand while a rule is active | The rule's reason on the page becomes `manual_override_recent` or `setpoint_changed_externally`, and the loop later steps from the new value |
| No flow schedules | Node-RED's context for `sched_*`, `outlet_sched_*`, `ac_sched` | All empty [E-057] |

## How to operate

- **Read the holds, not the silence.** When automation does nothing, the Automation page says why, per rule.
- **Restore shed loads by hand**, after the demand is understood, and not while the building is still over its limit.
- **Change the room floor, then re-save each aircon rule**, until F-033 is fixed, so that each is checked against the
  new floor.
- **The 19 rows stuck at `dispatching`** (F-006) are open. Q-08 gives the read-only journal check.

## How it fails

| Symptom | Likely cause | Check that tells the causes apart | Fix | How to confirm it held |
|---|---|---|---|---|
| A schedule never fires | Disarmed, no owner, no days, or a device with no dispatch path | The Automation page's reason for that rule [E-197] | Arm it, re-save it signed in, or pick days | A `schedule` row in `commands` at the next minute |
| A schedule fires on the wrong day | Days misread | `rule.days` is Monday first | Re-save from the page, which writes the right order | It fires on the intended day |
| Commands recorded but nothing moves | The interlock is off | `dispatch=` in the scheduler's start line; rows are `dry_run` | The site's decision (G7) | — |
| A load a person switched on goes off again | Auto-shed, while the building is over its limit | A `dsm_autoshed` row just after the person's command | Reduce demand, or change the limit (F-031) | No new shed rows |
| A shed load came back on | A schedule's `on` edge | A `schedule` row at that minute | Accept it, or stop that schedule during peaks | — |
| The aircon rule does nothing | A hold | The rule's reason on the page | Per the reason | The loop steps |
| A row stays at `dispatching` | The status update was lost | The scheduler's journal around `requested_at` (Q-08) | None needed for the relay; the row is an honest unknown | — |

## Field issue log

| Date | Symptom | Root cause | Fix | Evidence | Lesson |
|---|---|---|---|---|---|
| — | Scheduled and auto-shed commands could move a relay with no audit row | The two callers dispatched first and recorded after, and disagreed on what a failed insert meant | One record-then-act path for both | E-065 | A safety rule implemented twice is right only once |
| — | A WAN outage removed every command, though the devices were local | The audit insert needed the internet | A local audit buffer, one file per writer; refusals still refuse | E-196 | Keep the safety property; move it to your side of the link |
| — | An outlet's two relays shed as one | Tiers were stored per device | Tiers per socket (RM-067) | E-123 | The unit of control is the relay |

## What to keep on the shelf

| Item | Why |
|---|---|
| The signed priority order (X2a §4), with F-031's decision | It is what an operator argues from |
| The dispatch interlock record, kept current | Who turned the building's automation on, and why |
| X2a §8's latest test record | Proof that the logic works as written |
