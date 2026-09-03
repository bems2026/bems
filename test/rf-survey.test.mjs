/**
 * The 2.4 GHz survey's arithmetic — the part that turns a scan into a recommendation.
 *
 * WHY THE SCORING IS NOT JUST "PICK THE QUIETEST CHANNEL". Two APs on the SAME channel hear each
 * other and take turns; CSMA/CA is built for it and it degrades gracefully. Two APs on channels
 * 10 and 11 overlap in frequency but cannot decode each other, so neither defers and they corrupt
 * each other's frames. A naive score that treated a strong co-channel neighbour as worse than a
 * strong adjacent one would recommend moving AWAY from the safe case and into the destructive one.
 *
 * Measured at the CARE office 2026-09-03, which is the fixture below: the device SSID sat on
 * channel 11 with a foreign AP on channel 10 at signal 82 against its own 87.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreChannel, parseWifiList, surveyIsCredible } from '../scripts/rf-survey.mjs';

/** The real scan from the Pi, 2026-09-03. */
const CARE_OFFICE = [
  { ssid: 'AP_2769941640', chan: 4, signal: 75 },
  { ssid: 'AP_2782891892', chan: 5, signal: 74 },
  { ssid: 'NBERIC_OPEN', chan: 6, signal: 54 },
  { ssid: 'DIRECT-onDCP-T720DW_BR1a33', chan: 6, signal: 69 },
  { ssid: 'AP_2383586117', chan: 10, signal: 82 },
  { ssid: 'NBERIC_Administrator', chan: 13, signal: 54 },
];

test('channel 1 is the recommendation for the measured CARE office scan', () => {
  const ranked = [1, 6, 11].map((ch) => ({ ch, cost: scoreChannel(ch, CARE_OFFICE) })).sort((a, b) => a.cost - b.cost);
  assert.equal(ranked[0].ch, 1);
});

test('moving off the channel in use is worth doing, by a wide margin', () => {
  // The decision-relevant claim, and NOT "11 is the worst of the three" — it is not. Channel 6
  // scores worse still here, because channels 4 and 5 carry strong APs that bite deep into it.
  // Asserting the false version would have shipped a recommendation to move from a bad channel
  // to the only worse one.
  const ch11 = scoreChannel(11, CARE_OFFICE);
  const ch6 = scoreChannel(6, CARE_OFFICE);
  const ch1 = scoreChannel(1, CARE_OFFICE);
  assert.ok(ch11 > ch1 * 2, `the channel in use (${ch11}) must be materially worse than the best (${ch1})`);
  assert.ok(ch6 > ch11, `channel 6 (${ch6}) is worse than 11 (${ch11}) here — the trap this test exists to pin`);
});

test('a co-channel neighbour is scored far gentler than an adjacent one of the same strength', () => {
  // The whole point. Same signal, same distance in the scan — but one is survivable and one is not.
  const coChannel = scoreChannel(6, [{ ssid: 'x', chan: 6, signal: 80 }]);
  const adjacent = scoreChannel(6, [{ ssid: 'x', chan: 5, signal: 80 }]);
  assert.ok(adjacent > coChannel * 3, `adjacent ${adjacent} must dominate co-channel ${coChannel}`);
});

test('a channel with nothing near it scores zero', () => {
  assert.equal(scoreChannel(1, [{ ssid: 'x', chan: 11, signal: 90 }]), 0);
});

test('overlap is graded by how far apart the channels are, not treated as all-or-nothing', () => {
  const one = scoreChannel(6, [{ ssid: 'x', chan: 4, signal: 80 }]);
  const two = scoreChannel(6, [{ ssid: 'x', chan: 5, signal: 80 }]);
  assert.ok(two > one, 'a closer channel must cost more');
  assert.ok(one > 0, 'two channels apart still overlaps and must not score clean');
});

test('a stronger interferer costs more than a weaker one at the same offset', () => {
  assert.ok(scoreChannel(1, [{ ssid: 'x', chan: 3, signal: 90 }]) > scoreChannel(1, [{ ssid: 'x', chan: 3, signal: 20 }]));
});

test('5 GHz neighbours are excluded — they cannot interfere with a 2.4 GHz device fleet', () => {
  const rows = parseWifiList('NBERIC:36:57\nBEMS:11:87\nNBERIC_OPEN:149:40');
  assert.deepEqual(rows.map((r) => r.chan), [11]);
});

test('an SSID containing a colon survives parsing', () => {
  // nmcli -t is colon-delimited and escapes nothing useful; splitting from the right is why.
  const rows = parseWifiList('Guest:Wifi:6:70');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ssid, 'Guest:Wifi');
  assert.equal(rows[0].chan, 6);
  assert.equal(rows[0].signal, 70);
});

test('a hidden SSID is kept, because it still occupies the air', () => {
  const rows = parseWifiList(':11:80');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ssid, '<hidden>');
});

test('malformed scan lines are skipped rather than thrown on', () => {
  assert.deepEqual(parseWifiList(''), []);
  assert.deepEqual(parseWifiList('nonsense\n\nSSID:notanumber:70'), []);
});

/**
 * A failed scan and a clear band look identical from here, and only one of them is good news.
 *
 * Measured 2026-09-03, minutes after the channel really was changed: `nmcli dev wifi rescan`
 * needs privilege, NetworkManager answered "not authorized", `wifi list` returned only the
 * connected AP, and this script printed *"No adjacent-channel clash with this network. The radio
 * environment is not the fault."* It had measured nothing at all. A survey that hands out an
 * all-clear it did not earn is worse than no survey.
 */
test('a scan that returned nothing is refused, not reported as a clear band', () => {
  const v = surveyIsCredible([], true);
  assert.equal(v.credible, false);
  assert.match(v.why, /nothing/);
});

test('a scan showing only our own network is refused — that is what a failed rescan looks like', () => {
  const v = surveyIsCredible([{ ssid: 'BEMS', chan: 1, signal: 86 }], true);
  assert.equal(v.credible, false);
});

test('a real scan is credible', () => {
  assert.equal(surveyIsCredible(CARE_OFFICE, true).credible, true);
});

test('a refused rescan on an otherwise real scan is believed, but carries a staleness caveat', () => {
  // The results are probably fine — they are just possibly cached. Refusing outright here would
  // make the script useless on a Pi without passwordless sudo.
  const v = surveyIsCredible(CARE_OFFICE, false);
  assert.equal(v.credible, true);
  assert.match(v.why, /stale|cached/);
});
