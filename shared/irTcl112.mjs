/**
 * The aircon's IR frames, built from the protocol rather than captured one by one — 2026-09-22.
 *
 * WHAT THE CAPTURED CODES TURNED OUT TO BE. The sixteen codes in the live `AC Master Logic` (OFF and
 * 16..30 °C, captured before this project began, with no record of their mode, fan or swing) were
 * decoded on 2026-09-22. Every one is a TCL112AC frame: header 23 CB 26 01 00, 112 bits, byte 13 the
 * sum of bytes 0..12, each byte transmitted least-significant bit first. The fifteen ON codes are
 * cool, fan auto, swing off; the checksums all verify. The field layout is IRremoteESP8266's
 * `Tcl112Protocol` (src/ir_Tcl.h):
 *
 *   byte 5  bit 2 power (the other bits are kept from the captured frame)
 *   byte 6  bits 0-3 mode — heat 1, dry 2, cool 3, fan 7, auto 8
 *   byte 7  bits 0-3 31 - setpoint
 *   byte 8  bits 0-2 fan — auto 0, low 2, medium 3, high 5; bits 3-5 vertical swing, 7 on / 0 off
 *   byte 13 checksum
 *
 * WHY GENERATE. The captured library can say only "cool, fan auto, swing off" at sixteen setpoints.
 * Every other state went to the vendor cloud's virtual remote — and the cloud is an IoT Core
 * subscription this project uses only to extract keys, which lapsed on 2026-09-17. Learning codes from
 * the remote one state at a time would need 5 modes x 4 fans x 2 swings x 15 setpoints captures.
 * Generating them needs one captured ON frame, and is checked by reproducing all fifteen captured ON
 * codes byte for byte (`test/ir-tcl112.test.mjs`).
 *
 * The Tuya hub's `key1` wrapping is `001&^` + the bit count as four hex digits (0070 = 112) + the frame
 * as hex (bytes bit-reversed) + `@%`. OFF is never generated: the captured OFF frame is sent as it is.
 *
 * `tcl112Code` is SELF-CONTAINED on purpose — it references nothing outside its own body — because the
 * flow generator inlines its source into a Node-RED function node, which cannot import.
 */

/** The app's modes and fans as TCL112 field values. `tcl112Code` carries its own copy; tests hold them equal. */
export const TCL112_MODES = Object.freeze({ cool: 3, heat: 1, auto: 8, fan: 7, dry: 2 });
export const TCL112_FANS = Object.freeze({ auto: 0, low: 2, medium: 3, high: 5 });

/**
 * A full ON state as the hub's `key1`, built on a captured ON frame — or null when the template is not
 * a TCL112 ON frame or the state is not one this aircon's remote can express.
 *
 * @param template  a captured `key1` for an ON state (any setpoint)
 * @param state     { power: 'on', mode, setpoint_c: 16..30, fan, swing }
 */
export function tcl112Code(template, state) {
  const MODES = { cool: 3, heat: 1, auto: 8, fan: 7, dry: 2 };
  const FANS = { auto: 0, low: 2, medium: 3, high: 5 };
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  if (!state || state.power !== 'on' || !own(MODES, state.mode) || !own(FANS, state.fan) || typeof state.swing !== 'boolean') return null;
  const t = state.setpoint_c;
  if (!Number.isInteger(t) || t < 16 || t > 30) return null;

  const m = /^001&\^0070([0-9A-Fa-f]{28})@%$/.exec(String(template));
  if (!m) return null;
  const rev = (b) => {
    let r = 0;
    for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
    return r;
  };
  const bytes = m[1].match(/../g).map((h) => rev(parseInt(h, 16)));
  const header = [0x23, 0xcb, 0x26, 0x01, 0x00];
  for (let i = 0; i < header.length; i++) if (bytes[i] !== header[i]) return null;
  if ((bytes[5] & 0x04) === 0) return null; // an OFF frame is not a template for an ON one

  bytes[6] = (bytes[6] & 0xf0) | MODES[state.mode];
  bytes[7] = (bytes[7] & 0xf0) | (31 - t);
  bytes[8] = (bytes[8] & 0xc0) | FANS[state.fan] | (state.swing ? 0x38 : 0);
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += bytes[i];
  bytes[13] = sum & 0xff;
  return '001&^0070' + bytes.map((b) => rev(b).toString(16).toUpperCase().padStart(2, '0')).join('') + '@%';
}

/** A `key1` back into its fields, for tests and diagnostics. Null if it is not a TCL112 frame. */
export function decodeTcl112(code) {
  const m = /^001&\^0070([0-9A-Fa-f]{28})@%$/.exec(String(code));
  if (!m) return null;
  const rev = (b) => {
    let r = 0;
    for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
    return r;
  };
  const bytes = m[1].match(/../g).map((h) => rev(parseInt(h, 16)));
  if (bytes[0] !== 0x23 || bytes[1] !== 0xcb || bytes[2] !== 0x26) return null;
  const nameOf = (table, v) => Object.keys(table).find((k) => table[k] === v) ?? null;
  const sum = bytes.slice(0, 13).reduce((a, b) => a + b, 0) & 0xff;
  return {
    bytes,
    power: bytes[5] & 0x04 ? 'on' : 'off',
    mode: nameOf(TCL112_MODES, bytes[6] & 0x0f),
    setpoint_c: 31 - (bytes[7] & 0x0f),
    fan: nameOf(TCL112_FANS, bytes[8] & 0x07),
    swing: ((bytes[8] >> 3) & 0x07) === 0x07,
    checksumOk: sum === bytes[13],
  };
}
