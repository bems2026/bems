/**
 * The settings each `tuya-smart-device` node in the live Node-RED flow is expected to carry.
 *
 * WHY THIS FILE EXISTS
 * These nodes live on the four hand-built source tabs, which `build-flow.mjs` does not
 * generate — so until now nothing in this repo said what they should hold, and nothing could
 * notice when they changed. That is the quiet failure: `deploy.mjs` does not revert them (it
 * appends the bridge tab and leaves the source tabs alone), but restoring an older
 * `flows.json`, rebuilding the Pi, or a hand-edit in the Node-RED editor loses them with no
 * diff and no alarm. The symptom is every device reading `online: false`, which looks exactly
 * like a network fault and is not one. This file turns that into a test failure.
 *
 * PROVENANCE — measured on site 2026-08-24, not chosen
 * `findTimeout` was 1000 ms while every device broadcasts its discovery datagram on UDP 6667
 * every 5.0 s (measured across all 14 then-reachable devices, avg interval 5.0 s to one
 * decimal). A 1 s listen therefore caught roughly one device in five, by luck, which is what
 * 2,520 discovery timeouts per 30 minutes actually was. 10 s gives two full intervals.
 *
 * The versions are each device's own announcement, read by decrypting its discovery broadcast
 * — v3.4 with the well-known AES-ECB udp key, v3.5 with AES-GCM. They are not guesses, and
 * they are not all the same: the four branch meters and the seven light switches announce
 * v3.5, while CO1/CO2/CO4/CO7 announce v3.4.
 *
 * A device tolerating a *lower* declared version is not evidence the declaration is right.
 * CO1 answered a direct query at 3.1, 3.3 and 3.4 alike, and CO3 reconnected while still
 * declared 3.1 — but every v3.5 device stayed dark until its node said 3.5. Match the
 * announcement; do not infer from something happening to work.
 *
 * Keyed by the node's `deviceName` rather than by registry device id on purpose: three of
 * these nodes (`ACU`, `NBRIC IR Blaster`, `Outside Temp`) back two registry devices between
 * them, so device id is not a key here. The node name is what the flow actually uses.
 *
 * Contains no device ids and no local keys — the two things that would make this file unsafe
 * in a public repo. Those stay on the Pi.
 */

/** Two full broadcast intervals of headroom. See the provenance note above. */
export const TUYA_FIND_TIMEOUT = '10000';

/** Node `deviceName` -> the protocol version that device announces. */
export const TUYA_NODE_VERSIONS = {
  'C.O yellow': '3.5',
  'L.O red': '3.5',
  'AREC ACU': '3.5',
  'L.O yellow': '3.5',
  CO1: '3.4',
  CO2: '3.4',
  CO3: '3.4',
  CO4: '3.4',
  CO5: '3.4',
  CO6: '3.4',
  CO7: '3.4',
  'Light Switch 1': '3.5',
  'Light Switch 2': '3.5',
  'Light Switch 3': '3.5',
  'Light Switch 4': '3.5',
  'Light Switch 5': '3.5',
  'Light Switch 6': '3.5',
  'Light Switch 7': '3.5',
  'Outside Temp': '3.3',
  'NBRIC IR Blaster': '3.3',
  ACU: '3.5',
};

/**
 * Nodes whose declared version is NOT known to match a live announcement, and why.
 *
 * These six devices were not announcing on the LAN when the survey ran, so their declarations
 * are simply whatever the flow already had. Recording that explicitly matters: an unverified
 * value that sits in the same table as twenty verified ones will be read as verified.
 * Narrowed 2026-08-24 (second pass): CO3, CO5 and CO6 were re-paired with new device ids and
 * keys, and all three now announce **v3.4** — so their declarations are measured rather than
 * inherited, and they have left this list. Note they had been running at 3.1 and reporting
 * online, which is exactly the "tolerating a lower version" trap described above: working was
 * never evidence the declaration was right.
 *
 * The two that remain do not announce on the LAN at all, so their versions stay unverifiable by
 * this method.
 *
 * `ACU` left the list once its situation was understood rather than guessed at. It shares a
 * device id and local key with `AREC ACU` **by design**: the aircon is the only load on the
 * CARE ACU branch, so the meter measuring that branch is measuring the aircon. Two logical
 * devices on one physical meter — the same arrangement `registry.mjs` already documents for
 * `mtr_co_yellow`/`mtr_lo_yellow`, and visible in the wiring: `AREC ACU` feeds the *Unified*
 * parser (live V/A/W) while `ACU` feeds the *Daily* parser (accumulated energy). Its version is
 * therefore measured, not assumed — it is the same physical device, so it is 3.5. It had been
 * declared 3.3, which is why it alone logged 39 discovery timeouts in ten minutes.
 */
export const TUYA_VERSION_UNVERIFIED = new Set(['Outside Temp', 'NBRIC IR Blaster']);

/** Compares a live/baseline flow against the declarations above. Pure; no I/O. */
export function findSettingsDrift(flowNodes) {
  const drift = [];
  const seen = new Set();
  for (const n of flowNodes) {
    if (n.type !== 'tuya-smart-device') continue;
    const name = n.deviceName;
    seen.add(name);
    const expectedVersion = TUYA_NODE_VERSIONS[name];
    if (expectedVersion === undefined) {
      drift.push({ node: name, field: 'declaration', expected: 'an entry in TUYA_NODE_VERSIONS', actual: 'none' });
    } else if (n.tuyaVersion !== expectedVersion) {
      drift.push({ node: name, field: 'tuyaVersion', expected: expectedVersion, actual: n.tuyaVersion });
    }
    if (n.findTimeout !== TUYA_FIND_TIMEOUT) {
      drift.push({ node: name, field: 'findTimeout', expected: TUYA_FIND_TIMEOUT, actual: n.findTimeout });
    }
  }
  for (const name of Object.keys(TUYA_NODE_VERSIONS)) {
    if (!seen.has(name)) drift.push({ node: name, field: 'presence', expected: 'a node in the flow', actual: 'missing' });
  }
  return drift;
}
