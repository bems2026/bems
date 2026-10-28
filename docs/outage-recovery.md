# Power outages and the field network — what happens, and what recovers it

Written after the operator's outage test of 2026-09-21 (RM-131): mains cut to the whole CARE
office — field devices, Pi and access point — then restored. This is what the evidence showed, what
now happens on its own, and the two things only a person can do.

## What an outage does to this system

The persistent journal (RM-125) recorded the whole sequence:

| Time | What happened | Why it matters |
|---|---|---|
| 17:02:43 | Pi boots (~30 s after power). | The access point takes ~2 minutes. |
| 17:02:55 | Pi joins the office 5 GHz SSID, because the device SSID is not up yet. | On that network every field device reads `online: false` and looks like a code fault. |
| 17:08:19 | The Wi-Fi watchdog moves the Pi back to the device SSID. | Now 90 s after boot and every 5 min, not 3 min / 15 min. |
| 17:08–18:11 | Every switch and outlet connects, then drops with `ECONNRESET`, refuses TCP for a minute or two, reconnects — 12 to 20 times each. | The devices' Wi-Fi is unstable while the AP settles after a cold boot (RM-046). |
| ~18:11 → | All fourteen, and the IR hub, go silent to `find()`. | **They are not gone.** Each still answers ARP and accepts TCP on 6668; they simply stop sending the UDP discovery broadcast Node-RED's `find()` waits for. |

So the state after an outage is: devices associated and reachable, nodes unable to discover them,
`find() timed out` forever. A Node-RED restart cannot fix that — there is nothing to find — and
neither can waiting. On 2026-09-03 what fixed it was power-cycling the devices into a clean
channel; that restarts their announcements, which is why it "worked".

## What now happens on its own

- **`ibems-wifi-prefer.timer`** — first check 90 s after boot, then every 5 min: the Pi is back on
  the device SSID within a minute or two of the AP appearing.
- **`ibems-lan-map.timer`** — every 10 min, a 30 s passive listen on the discovery ports. Every
  device that announces is remembered in `server/data/lan-map.json` with its address and MAC.
  Devices announce after they boot, so the map fills during the first minutes after any power
  event — the moment it is worth catching.
- **`ibems-fleet-recover.timer`** — every 5 min: for each node the bridge reports offline, one TCP
  probe of its static address (or, unpinned: announced in the last 15 min *and* answering now). Reachable-but-offline on
  two consecutive checks, and not within an hour of the last restart nor 10 min of boot, restarts
  Node-RED. It never restarts for a device nothing can reach, and it says `ADDRESS DRIFT` when a
  pinned node's device has announced from a different address — the case reservations prevent.
  Every decision is in the journal: `journalctl -t ibems-fleet-recover`.

## The two things a person does — once each

**1. Give every node its address (`deviceIp`), so discovery is never needed again.**
A node with a static address connects directly; the broadcast stops mattering. The map supplies
the addresses without the vendor cloud:

```bash
npm run set-device-ip:pi -- --host=127.0.0.1 --from-lan-map           # dry run — what it would set
cp ~/.node-red/flows.json ~/.node-red/flows.json.bak-ips-$(date +%F-%H%M%S)
npm run set-device-ip:pi -- --host=127.0.0.1 --from-lan-map --apply
```

The map only holds devices that have announced while the listener ran. Right after an outage that
is all of them; on a quiet day it may be only the meters. If the fleet is dark and silent now, the
fastest way to make every device announce is the one the operator already has: power-cycle the
field devices (the breaker), wait two minutes, run the dry run and see the map fill. Alternatively,
with IoT Core renewed (RM-121), the tool's default mode maps every device through the cloud in one
run and needs no announcement at all.

**2. Reserve those addresses on the access point**, so the next outage does not renumber them:

```bash
npm run set-device-ip:pi -- --host=127.0.0.1 --reservations
```

prints the MAC → address table to type into the AP's DHCP reservations (and the Pi's own). With the
reservations in place a static `deviceIp` is permanent; without them it is right until the AP's
lease table forgets, which is exactly what a power cycle does.

While at the AP's admin page, RM-046's items still stand: **pin the 2.4 GHz channel** (it was
auto; the 09-03 recovery needed a clean one), set the DHCP lease to a day or more, and make sure
"AP isolation" / "client isolation" is off. None of these are visible from the Pi.

## The one thing that removes the problem instead of recovering from it

A small UPS on the access point and the Pi. The devices reboot into a network that never went
away, associate to a settled AP, get their reserved addresses, and the nodes reconnect by address.
The flapping hour and the silent fleet both come from the AP's cold boot; a UPS makes that boot not
happen. A 600 VA unit runs both for well over an hour.

## When the internet drops but the power does not (2026-10-07 to 14, RM-163)

The device network's mobile uplink ran out of data for a week. What the system does about it now, on its own
(ADR-0017):

- **It keeps logging.** The Pi archives every minute whatever the internet does. Uploads stop and resume; when it is
  more than an hour behind it uploads every minute, in batches that shrink to fit a slow link. The Control page says
  how far behind the cloud is.
- **Reports wait.** A day, week or month is not built while the Pi still owes rows from it, and one built before
  late rows arrived is built again once they are up.
- **Local sign-in and control still work** (ADR-0016), and the schedules keep running from the configuration the
  scheduler keeps on the Pi.
- **A frozen meter is flagged and announced.** The CT meters may stall during a long loss of the vendor cloud: they
  keep answering with one reading, voltage included. After 12 hours (sooner while drawing power) the reading is
  flagged frozen, the minutes since it stuck are marked, and an alert names the meter.

What a person does:

1. Top up the uplink. Nothing on the Pi needs touching, and its Wi-Fi must not be changed.
2. If an alert names a held meter while the internet is down: **wait for the internet.** The meters resume by
   themselves within minutes of it returning; a refresh request, a Node-RED restart and a power cycle while it is
   down do not revive them (2026-10-28, E-260). Their registers keep counting, so the held energy is estimated on
   resuming and shown as such in the reports. A meter still held an hour after the internet returned is a fault:
   then power-cycle its supply.
3. If the Pi restarted during the outage, it resumed within a minute of the cut (the clock-save timer, if installed)
   and re-times what it logged once the internet returns. A battery RTC module removes even that minute.

## After the next outage, in order

1. Wait 5 minutes. Check `curl -s http://127.0.0.1:1880/api/readings/latest` — how many `online`.
2. `journalctl -t ibems-fleet-recover -n 5` — has the watchdog seen reachable-but-offline nodes?
   If it has, it will restart Node-RED itself within ten minutes.
3. If devices are dark and silent: `npm run set-device-ip:pi -- --host=127.0.0.1 --from-lan-map`
   (dry run). If the map has them, apply; if not, they have not announced — power-cycle the
   devices, wait, repeat.
4. `sudo systemctl restart nodered` if anything is still stuck after the addresses are set.

What this does not cover: a device that is genuinely off the network (no ARP, no TCP). That is
still a walk to the breaker — RM-020 — and the watchdog will not pretend otherwise.
