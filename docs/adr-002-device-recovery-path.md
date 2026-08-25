# ADR-002 — Recovering a device that has stopped responding

**Status:** proposed, 2026-08-25
**Context:** operator reports devices "hanging" — the relay will not switch from the app or the
dashboard, the physical button does nothing, and the only recovery is removing power. With
seventeen devices spread across an office, that is a walk to a breaker per incident.

## What is actually happening

A Tuya device holds two independent paths:

| Path | Socket | Used by |
|---|---|---|
| **Local** | inbound TCP :6668 on the LAN | this bridge (`tuya-smart-device` nodes) |
| **Cloud** | outbound TLS to Tuya, kept alive by the device | the Smart Life app, the Cloud API |

These fail separately, and that is the whole basis of what follows. An ESP-based device has a
small socket table; if inbound sessions are not closed cleanly it stops accepting new ones. The
device is then unreachable locally while its outbound cloud connection is still perfectly
healthy — it looks "hung" from here and fine from the app.

Two measurements support this being the local path specifically:

- **Two nodes hold two concurrent sessions to one physical device.** `C.O yellow`/`L.O yellow`
  share `a3afa68c`, and `AREC ACU`/`ACU` share `a348dc84`. Sixteen TCP sessions to :6668 are
  open for fourteen devices.
- **Discovery has hammered these devices.** Before `findTimeout` was corrected, Node-RED logged
  2,520 failed discovery attempts per thirty minutes, each one a connection attempt.

And the gap is directly observable: Tuya reports ~12 devices online while the bridge sees ~8.

## The decision

**Add cloud dispatch as a fallback, not as a replacement.**

When a local command fails, retry it through the Tuya Cloud API. A device whose inbound socket
table is exhausted still holds its outbound cloud connection, so a cloud command reaches it —
turning a walk to the breaker into a retry that already happened by the time anyone notices.

Local stays primary. It is faster, works when the internet does not, and does not depend on a
vendor. Cloud is the path that exists precisely when local has failed.

### What this does not fix, stated plainly

If a device is *fully* wedged — no cloud connection either, which is what Tuya reporting it
`offline` means — then neither path reaches it and power really is the only recovery. Cloud
dispatch converts the *common* failure (local-only) into a non-event; it cannot convert the
total one.

Note also that `GET /v1.0/devices/{id}/status` returns last-known values for an offline device
rather than failing, so a successful status read is **not** proof the device is reachable. The
`online` flag is the thing to trust, and a command is the only real test.

## Doing less harm in the first place

Worth doing regardless, because they reduce how often this happens:

1. **One local session per physical device.** Two nodes reading one meter double the socket
   pressure for no benefit — one node can feed both parsers, and the two channels would then
   come from a single atomic read (which would also make RM-017's interchange impossible by
   construction).
2. **Back off on failed discovery** rather than retrying at a fixed rate forever.

## Rejected

- **Correcting nothing and power-cycling by hand.** The status quo, and the reason for this ADR.
- **Cloud as the primary path.** Adds an internet dependency and a vendor to a building control
  system that currently works on the LAN, to solve a failure that is the exception.
- **A switchable relay upstream of each device**, so "reboot" is remote. Real, and the only
  answer for a fully-wedged device, but it is an electrical install rather than a change here —
  worth costing separately if total hangs turn out to be common.
