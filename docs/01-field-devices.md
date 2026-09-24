---
title: Field devices
purpose: Select, size, install, pair, calibrate and maintain the field devices (L1)
audience: [installer, integrator]
status: Draft
last_verified: 2026-09-24
applies_to: repo 8e398f8 · edge checkout fcb1ff6
evidence: [E-022, E-043, E-051, E-056, E-083, E-110, E-111, E-112, E-115, E-117, E-118, E-119, E-125, E-132, E-135, E-138, E-145, E-146, E-147, E-148, E-149, E-150, E-151, E-152, E-179]
---

# Field devices

This chapter covers what [Device roles and catalogue](01a-device-roles.md) assumes:

- choosing and sizing a device for a load
- getting it wired, paired, keyed and mapped
- proving it reads true
- keeping it that way

The roles, the twelve device types, their function block diagrams and their states are all in 01a, so read that first.
The hardware half of installation, with its site-specific gaps marked, is [physical-install](physical-install.md).

## What it is

### The devices, as built

iBEMS runs on **Tuya-ecosystem Wi-Fi devices**. They are driven over the local network with each device's own key,
with no vendor cloud in the path [E-051]. They speak **Tuya LAN protocol v3.3–v3.5** and are **2.4 GHz only**
[E-051, E-132]. The software has device classes for five types: branch meter, metered outlet, lighting switch,
infrared air-conditioner commander, and temperature and humidity sensor [E-110]. The other seven types in 01a are
Planned.

A device that speaks a different protocol, or joins a different ecosystem, needs new bridge work, not just a different
part number.

### Local credentials: what they are and where they live

Three facts identify a device to the edge server:

- its **device id**
- its **local key**, the credential that lets anything on the LAN drive it
- its **protocol version**

| Fact | How it is obtained | Where it is stored | What changes it |
|---|---|---|---|
| Device id, local key | From a key tool's export, loaded with **Add Device → Import keys** or `npm run keys:import` (a dry run until `--apply`). Keys are never printed, only their length. [E-145] | The proxy's credential store, `server/data/device-credentials.json`, mode 0600. It is also held on each device node in the live flow. Neither is in the repository. [E-043, E-145] | **Re-pairing the device** in the vendor app issues a new key, and possibly a new id. A restart does not change it. [E-145] |
| Protocol version | Heard on the LAN: the proxy listens passively and records each device's announced version [E-146] | On the device node, in the live flow [E-132] | A firmware update. **A node declaring the wrong version fails like a network fault** [E-132]. |

Delete the key tool's export once it is imported: the store is the one copy that should exist [E-145]. The names of
the files that hold these credentials are listed in [X1 Security](X1-security.md). Their values appear in no
document (G1).

### Datapoint mapping

A device reports numbered datapoints. What each number means, its scale and its unit are decided **per product**, in
the capability catalogue `shared/deviceCapabilities.mjs`. Two products of the same class can use one datapoint number
for different things [E-135]. The conversion is **value ÷ 10^scale × unit factor**. The catalogue can be checked
against the vendor's live device model with `npm run tuya:spec`, which needs the optional vendor cloud credentials.
The parsers on the device tabs are generated from the catalogue, not edited by hand.

**Verify every unit individually**, by reading its values against a known load (see [How to verify](#how-to-verify)).
Agreement between two units of one model is not evidence about the third.

**Two logical meters can share one physical device.** A dual-channel CT meter carries two circuits. The device itself
has been seen to swap which clamp it reports under which channel. So identity in iBEMS is the *logical* meter, never
the vendor's device id, and the channel assignment is decided from physical facts the operator states, never guessed
[E-147].

### What a Commander cannot know

An infrared commander is **open loop**. It sends a code, and the air-conditioner never answers [E-151]:

- The system cannot know whether the unit received the code.
- It cannot know which mode the unit is really in.
- It cannot know whether someone changed it by hand with the original remote.

What it can know is the **room**. A temperature and humidity reading in the same room is the evidence a command landed.
The room-target loop uses exactly that ([X2a §3.3](X2a-control-strategy.md#33-setpoint-reset-when-the-target-and-the-dial-are-different-numbers)).
At the pilot, that room reading comes from the infrared hub's own sensor [E-125].

If the unit's IR protocol can be decoded, the flow builds any state from one captured frame. It refuses to install that
generator unless it rebuilds every captured code exactly. If the protocol cannot be decoded, each state you intend to
use must be captured, and some settings may be reachable only through the vendor's cloud [E-151].

### Naming and identity that survive a second building

Every device has a short, permanent **id** in the site's device file, `shared/sites/<slug>/devices.mjs`. Each building
is its own site: its own directory, and a `site_id` on every table [E-149]. So ids need to be unique only within one
site. `npm run site:check` refuses duplicate ids, duplicate context prefixes and duplicate state keys, because any of
them makes two devices overwrite each other's readings [E-148].

Use an id that says the device's role and position, not its brand: for example `outlet-3` or `light-1`. The pilot's
own list is in [99](99-worked-example.md). **Label the physical device with that id as you fit it.** A dashboard can say a device is offline, but it cannot say which faceplate that is.

## What you need

| Item | Specification that matters |
|---|---|
| Devices, by role | The role table in [01a §4](01a-device-roles.md#4-choosing-what-you-need), and a device of a class iBEMS supports (above) |
| Protocol | Tuya LAN v3.3–v3.5, 2.4 GHz Wi-Fi [E-051] |
| Rating | Each switching device rated above the circuit's **real** load, with margin, not its nameplate. The pilot's part numbers and ratings are not recorded [UNVERIFIED — confirm at site]. |
| Current transformers | Sized to the circuit's breaker rating, split-core for retrofit [UNVERIFIED — confirm at site: the pilot's CT ratings are unrecorded] |
| A reference instrument | A clamp meter, for calibration and acceptance |
| A key tool | Something that exports each device's id and local key from the vendor account [E-145] |
| A vendor-app account | **Institution-owned**, never a person's own, with a handover procedure ([X1](X1-security.md)) |
| People | A **licensed electrical practitioner** for panel work. One person from the facilities team. |

## How to install

!!! danger "Electrical work"
    Panel work and fixed wiring are performed or directly supervised by a **licensed electrical practitioner** under the
    Philippine Electrical Code. Every circuit is **isolated, locked out, tagged and proven dead** before work begins.
    Nothing in this chapter is done live. Current transformers have their own hazard: **an open secondary on a live
    conductor can develop a dangerous voltage**, so a CT's shorting links stay on until it is wired to its meter [E-150].

### Survey and plan the circuits

**Precondition.** The panel's single-line diagram is in hand, and access is agreed with the building owner.

| Step | Action | Expected result |
|---|---|---|
| 1 | Obtain the panel's single-line diagram | Every breaker way named |
| 2 | Choose which circuits to meter and which to switch ([01a §4](01a-device-roles.md#4-choosing-what-you-need)) | A written list, each with its role |
| 3 | For each switched circuit, confirm the load may lose power unattended. Anything that must ride through gets no relay, or is marked "never shed". | Each switched circuit marked sheddable or never-shed |
| 4 | Record the supply type (single- or three-phase) and each metered circuit's phase | A phase for every metered circuit [UNVERIFIED — confirm at site for the pilot] |
| 5 | Assign each device its id and write it into the device record ([01a §1](01a-device-roles.md#the-device-record)) | One row per device, before anything is bought |

**Done when.** The device record is complete and reviewed by the electrician.

### Fit the meters, switches and outlets

Follow [physical-install §2–§4](physical-install.md). It is the checklist to take on the visit, and its gaps are
filled on site, never by inference. The rules that govern every fitting are in
[01a §5](01a-device-roles.md#5-installing):

- clamp arrow towards the load
- one clamp, one named circuit, written down at once
- never switch a compressor load
- label every device

**Done when.** Every device is fitted and labelled, the panel is photographed, and each CT's breaker way is recorded
[UNVERIFIED — confirm at site for the pilot].

### Pair and key each device

**Precondition.** The device network is up ([02 Network](02-network.md)), and the edge server is on it ([03 Edge](03-edge.md)).

| Step | Action | Expected result |
|---|---|---|
| 1 | Pair the device in the vendor app, under the **institution's** account, on the 2.4 GHz device network | The app shows it online |
| 2 | Watch Add Device on the Devices page | The device appears within seconds, with its protocol version, heard on the LAN [E-146] |
| 3 | Export the ids and keys with the key tool, then import them (Add Device → Import keys, or `npm run keys:import -- <file>`, then `--apply`) | "stored", with key lengths shown, never values [E-145] |
| 4 | Delete the export file | Only the credential store holds the key |
| 5 | Enrol the device (Add Device) | It appears in the registry and in the flow, and reports within a minute [E-056] |

**Done when.** The device reads **online** and shows plausible values.

**Rollback.** Remove the device with the Devices page's remove action, or `npm run remove:pi` (a dry run first).

## How to configure

| What | Where | Rule |
|---|---|---|
| Device id, class, branch circuit | `shared/sites/<slug>/devices.mjs` | Ids never change, and `site:check` must pass [E-148] |
| The circuit map | `shared/sites/<slug>/circuits.mjs` | The single most important thing to get right. A wrong branch makes every total confidently wrong. |
| Shed group per switched socket | The app: *Automation → State-Driven*, the load-shed tiers panel, beside the demand limit it serves [E-179]. A device's Metadata tab edits the same field, and its hint wrongly says nothing sheds from it (F-028). | Unassigned means never shed |
| Protocol version, discovery timeout | The device's node in the live flow | Set from what the device announces. Back up the flow first [E-132]. |

## How to verify

This is **calibration and acceptance**: a pass is something a person watches happen, not a screen that looks right.

| Check | Do this | Pass looks like |
|---|---|---|
| Each CT reads true | Switch a known load on the circuit on and off, and compare with a clamp meter on the same conductor | Within the tolerance the institution accepts [UNVERIFIED — confirm at site: the tolerance is not yet agreed] |
| No CT reversed | Every metered circuit under load | No negative or zero reading with load present [E-150] |
| Phase totals | A clamp meter on the incomer against the dashboard's phase totals | Within tolerance |
| Each relay moves the right thing | Switch it from the app, with a second person watching the fixture | The named fixture changes, and nothing else does |
| Each outlet socket | Switch socket 1, then socket 2 | Each switches alone, and they are not swapped |
| The commander | Change the setpoint from the app | The unit responds, and the room reading moves within the loop's wait |
| Silence is honest | Unplug a device and wait past 600 s | Its figures disappear, and totals drop by its share, not to zero [E-111] |

Record each result with the date, the instrument and who witnessed it. The full commissioning suite is
[X2a §8](X2a-control-strategy.md#8-test-manual).

## How to operate

| Every | Check | Good looks like |
|---|---|---|
| Day | The kiosk's device list | No silent device you cannot explain |
| Month | A spot check of one CT against a clamp meter | Within tolerance |
| After any re-pair | The device's key, and its node's identity | Keys re-imported and the node rebound (`rebind:pi`) [E-145] |
| After air-conditioner service | Every IR command you use | The unit responds to each |
| Year | The electrician re-torques CT and relay terminals and inspects the enclosures | No heat marks, and the labels are intact |

The maintenance intervals above are recommendations, not measured practice [UNVERIFIED — to be set by the
institution].

## How it fails

| Symptom | Likely cause | Check that tells the causes apart | Fix | How to confirm it held |
|---|---|---|---|---|
| The device never appears | It is not on the device network (a 5 GHz SSID, or not paired), or client isolation blocks discovery | Is it online in the vendor app? Does Add Device hear its announcement within ~5 s [E-146]? | Pair it on the 2.4 GHz device network; remove client isolation ([02](02-network.md)) | It appears in Add Device and stays |
| It appears, then goes silent | A connection that gave up, or the device lost power or network | Is it still in the neighbour table (ARP, not ping) [E-117]? Does the vendor app see it? | Restart Node-RED first [E-118]; then the ladder in [01a §7](01a-device-roles.md#7-troubleshooting) | It reports past the offline threshold (600 s) |
| Implausible values | The wrong product mapping, a scale error, or a frozen clamp | Compare against a clamp meter. Is the reading flagged frozen [E-152]? | Fix the catalogue entry for that product [E-135], or the clamp | Readings match the reference |
| Zero with load present | A CT on the wrong conductor or reversed, or a channel swap on a dual-channel meter | Does its twin channel read the missing load [E-147]? Which way is the arrow? | Refit the clamp, arrow to the load, or state the channel facts | The reading follows the load on and off |
| Switches from the kiosk, not from off site | The remote path, not the device | Does the same command work from a LAN browser? Is the mesh network up? | See [02](02-network.md) remote access and [05](05-interface.md) | The command works on both paths |
| Switches, but the state never updates | Nothing polls the device, or it is a Commander with no feedback | Is the device polled (`preflight` `flow_polls`) [E-119]? Is it a Commander? | Add the poll. For IR, judge by the room reading. | The browser reconciles the new state [E-115] |
| Two devices show the same identity | A duplicate id, context prefix or state key | `npm run site:check` [E-148] | Give each a unique id and prefix | `site:check` passes, and each device shows its own values |
| Stops responding after re-pairing | Re-pairing issued a new local key, and possibly a new id | Does the device announce a new id on the LAN [E-146]? Is the old node dark? | Re-import the keys, then `rebind:pi` (a dry run first) [E-145] | It reports within a minute, and the old identity is gone |

## Field issue log

Site specifics are in [99](99-worked-example.md).

| Date | Symptom | Root cause | Fix | Evidence | Lesson |
|---|---|---|---|---|---|
| 2026-08-24 | Devices never connected | The node declared a different protocol version from the one the device announced (Confirmed) | Matched each node to its announcement | E-132 | Read what the device announces, not the datasheet |
| 2026-08-25 | A device written up as a hardware fault | Its connection had given up in software (Confirmed) | A Node-RED restart, now automated | E-118, E-022 | Restart before you drive anywhere |
| 2026-09-15 | A branch mislabelled for years | The circuit map was transcribed from an old comment | The operator confirmed the map on site | physical-install §2 | Check a branch against what its meter reads |
| 2026-09-19 | One dual-channel meter reported two circuits under swapped channels | The device itself swapped channel attribution (Confirmed) | A demux decided from stated physical facts | E-147 | The logical meter is the identity, never the vendor device |
| 2026-09-22 | A circuit held a stale reading for hours | Nothing polled the meters (Confirmed) | A 60 s poll on every device | E-119 | A value nobody asked for again is a memory |

## What to keep on the shelf

| Spare | Why | Lead time |
|---|---|---|
| One of each supported device class | A failed switch or outlet can be swapped and re-keyed in minutes | [UNVERIFIED] |
| Two current transformers of each rating in use | A damaged clamp takes its circuit out of every total | [UNVERIFIED] |
| Labels and a label printer | An unlabelled device is not maintainable | — |
| The key tool, and access to the institution's vendor account | Re-pairing needs both | — |
