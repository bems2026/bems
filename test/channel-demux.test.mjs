/**
 * The shared dual-channel meter's channel assignment, decided from evidence and nothing else.
 *
 * Every fixture below is a shape the live meter actually produced between 2026-09-19 and
 * 2026-09-21 — read from `readings` and `readings.capabilities`, not invented. The two premises the
 * rules rest on were confirmed by the operator on 2026-09-21: the lighting branch cannot draw more
 * than the ceiling, and the outlet branch is never at 0 A.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITY_PROFILES } from '../shared/deviceCapabilities.mjs';
import {
  classifySample,
  dpSwapMapFor,
  nextChannelState,
  readChannels,
  renumberDps,
  swapChannelCodes,
} from '../shared/channelDemux.mjs';

const RULES = Object.freeze({ ceiling_w: 150 });
const P = CAPABILITY_PROFILES.cz_ct_double;

/** A channel as the classifier sees it. `state` is the device's own `device_state<n>` enum. */
const ch = (p, c, state = 'working') => ({ p, c, state });

// The loads, as measured: lighting on (LED, PF 0.41), outlet standby (PF 0.75), daytime outlets,
// and a channel the device has put into `monitor` (exactly 0 W / 0.000 A).
const LIGHTS = ch(41.2, 0.427);
const STANDBY = ch(40.3, 0.232);
const DAYTIME = ch(754.4, 6.831);
const IDLE = ch(0, 0, 'monitor');

// --- classifySample: one sample's evidence, or null ------------------------------------------

test('a channel above the ceiling is the outlet branch: on channel 2 that means swapped', () => {
  assert.deepEqual(classifySample({ ch1: IDLE, ch2: DAYTIME }, RULES), { assignment: 'swapped', rule: 'ceiling' });
});

test('a channel above the ceiling on channel 1 means the assignment is direct', () => {
  assert.deepEqual(classifySample({ ch1: DAYTIME, ch2: IDLE }, RULES), { assignment: 'direct', rule: 'ceiling' });
});

test('both channels above the ceiling is a contradiction and decides nothing', () => {
  assert.equal(classifySample({ ch1: DAYTIME, ch2: ch(500, 4) }, RULES), null);
});

test('a channel the device holds in monitor (0 A) is the lighting branch: on channel 1 that means swapped', () => {
  // 2026-09-19 08:11 — channel 1 went to monitor while channel 2 carried 37 W of outlet standby.
  assert.deepEqual(classifySample({ ch1: IDLE, ch2: STANDBY }, RULES), { assignment: 'swapped', rule: 'idle' });
});

test('a channel at 0 W / 0 A without the monitor enum still counts as idle', () => {
  assert.deepEqual(classifySample({ ch1: STANDBY, ch2: ch(0, 0, 'working') }, RULES), { assignment: 'direct', rule: 'idle' });
});

test('the monitor enum with current flowing is NOT idle — the premise is 0 A, not a label (RM-134)', () => {
  // Until the meters were polled, `device_state<n>` arrived only when it changed, so every `monitor`
  // this classifier had seen came with exactly 0 W / 0 A. A poll delivers the label every minute,
  // and its meaning is the vendor's, not measured: live L.O Red carried `monitor` at 26.6 W. The
  // outlet branch at night standby must not read as the lighting branch because of a word.
  assert.equal(classifySample({ ch1: ch(40.3, 0.232, 'monitor'), ch2: LIGHTS }, RULES), null);
  assert.equal(classifySample({ ch1: STANDBY, ch2: ch(26.6, 0.3, 'monitor') }, RULES), null);
});

test('both channels idle decides nothing', () => {
  assert.equal(classifySample({ ch1: IDLE, ch2: IDLE }, RULES), null);
});

test('two working channels under the ceiling decide nothing — lights and standby are both about 40 W', () => {
  assert.equal(classifySample({ ch1: STANDBY, ch2: LIGHTS }, RULES), null);
  assert.equal(classifySample({ ch1: LIGHTS, ch2: STANDBY }, RULES), null);
});

test('the ceiling rule is consulted before the idle rule', () => {
  // Channel 2 above the ceiling AND channel 1 idle agree here; make them disagree to prove precedence:
  // channel 1 idle says swapped, channel 1 above the ceiling says direct. Above the ceiling wins.
  assert.deepEqual(classifySample({ ch1: ch(600, 5, 'monitor'), ch2: STANDBY }, RULES), { assignment: 'direct', rule: 'ceiling' });
});

test('a missing reading on either side decides nothing', () => {
  assert.equal(classifySample({ ch1: null, ch2: DAYTIME }, RULES), null);
  assert.equal(classifySample({ ch1: { p: null, c: null, state: null }, ch2: DAYTIME }, RULES), null);
});

// --- nextChannelState: hysteresis with a two-sample debounce -------------------------------

const at = (ts, ch1, ch2) => ({ ts, ch1, ch2 });

test('with no history and no evidence the state is seeded direct, and says so', () => {
  const s = nextChannelState(null, at(1000, STANDBY, LIGHTS), RULES);
  assert.equal(s.assignment, 'direct');
  assert.equal(s.rule, 'seed');
  assert.equal(s.since, 1000);
});

test('the first evidence is adopted at once — there is nothing to debounce against', () => {
  const s = nextChannelState(null, at(1000, IDLE, DAYTIME), RULES);
  assert.equal(s.assignment, 'swapped');
  assert.equal(s.rule, 'ceiling');
  assert.equal(s.since, 1000);
});

test('one contradicting sample does not flip the state; a second agreeing one does', () => {
  const s0 = nextChannelState(null, at(0, DAYTIME, IDLE), RULES); // direct, certain
  const s1 = nextChannelState(s0, at(60, IDLE, DAYTIME), RULES);
  assert.equal(s1.assignment, 'direct', 'a single glitch must not move the assignment');
  assert.equal(s1.since, 0);
  const s2 = nextChannelState(s1, at(120, IDLE, DAYTIME), RULES);
  assert.equal(s2.assignment, 'swapped');
  assert.equal(s2.rule, 'ceiling');
  assert.equal(s2.since, 120, 'the flip is dated at the sample that confirmed it');
});

test('a sample with no evidence between two agreeing ones keeps the pending flip alive', () => {
  const s0 = nextChannelState(null, at(0, DAYTIME, IDLE), RULES);
  const s1 = nextChannelState(s0, at(60, IDLE, DAYTIME), RULES);
  const s2 = nextChannelState(s1, at(120, STANDBY, LIGHTS), RULES); // both ~40 W: nothing to say
  assert.equal(s2.assignment, 'direct');
  const s3 = nextChannelState(s2, at(180, IDLE, DAYTIME), RULES);
  assert.equal(s3.assignment, 'swapped');
});

test('a sample that agrees with the current state clears a pending flip', () => {
  const s0 = nextChannelState(null, at(0, DAYTIME, IDLE), RULES);
  const s1 = nextChannelState(s0, at(60, IDLE, DAYTIME), RULES); // pending swapped ×1
  const s2 = nextChannelState(s1, at(120, DAYTIME, IDLE), RULES); // direct again
  const s3 = nextChannelState(s2, at(180, IDLE, DAYTIME), RULES); // pending swapped ×1, not ×2
  assert.equal(s3.assignment, 'direct');
});

test('no-evidence samples carry the state forward and count as the carry rule', () => {
  const s0 = nextChannelState(null, at(0, DAYTIME, IDLE), RULES);
  const s1 = nextChannelState(s0, at(60, STANDBY, LIGHTS), RULES);
  assert.equal(s1.assignment, 'direct');
  assert.equal(s1.since, 0);
  assert.equal(s1.lastRule, 'carry');
});

test('the state is never mutated in place', () => {
  const s0 = nextChannelState(null, at(0, DAYTIME, IDLE), RULES);
  const frozen = JSON.stringify(s0);
  nextChannelState(s0, at(60, IDLE, DAYTIME), RULES);
  assert.equal(JSON.stringify(s0), frozen);
});

test('Saturday 2026-09-19, as recorded: swapped by the morning hand-off, back by the evening one', () => {
  // 07:50 channel 2 carried the standby load and a 258 W compressor spike — the ceiling rule fires
  // on channel 2 first; 08:11 channel 1 goes to monitor; the outlets run all day on channel 2;
  // 17:20 channel 2 goes to monitor while channel 1 picks up the dusk lights.
  let s = nextChannelState(null, at(0, ch(40.6, 0.443), ch(39.1, 0.227)), RULES);
  assert.equal(s.assignment, 'direct');
  s = nextChannelState(s, at(1, ch(40.2, 0.441), ch(258.2, 2.665)), RULES);
  s = nextChannelState(s, at(2, ch(39.6, 0.45), ch(221.4, 2.522)), RULES);
  assert.equal(s.assignment, 'swapped');
  assert.equal(s.rule, 'ceiling');
  s = nextChannelState(s, at(3, IDLE, ch(37.4, 0.223)), RULES);
  s = nextChannelState(s, at(4, IDLE, ch(543.3, 4.217)), RULES);
  assert.equal(s.assignment, 'swapped');
  s = nextChannelState(s, at(5, ch(5.2, 0.546), IDLE), RULES);
  s = nextChannelState(s, at(6, ch(40.6, 0.23), IDLE), RULES);
  assert.equal(s.assignment, 'direct');
  assert.equal(s.rule, 'idle');
  assert.equal(s.since, 6);
});

// --- dp plumbing: what the flow node and the scrub both need ---------------------------------

test('the dp swap map pairs each channel-1 dp with its channel-2 twin by base code, nothing else', () => {
  const map = dpSwapMapFor(P);
  assert.deepEqual(map, {
    103: 113, 104: 114, 105: 115, 106: 116, 107: 117, 108: 118, 109: 119, 110: 120, 111: 121, 112: 122,
    113: 103, 114: 104, 115: 105, 116: 106, 117: 107, 118: 108, 119: 109, 120: 110, 121: 111, 122: 112,
  });
});

test('renumberDps trades the two channels and leaves the device-wide dps and unknown keys alone', () => {
  const map = dpSwapMapFor(P);
  const dps = { 101: 'request', 105: 7544, 106: 6831, 113: 'monitor', 115: 390, 123: 89320141, 999: 'x' };
  const out = renumberDps(dps, map);
  assert.deepEqual(out, { 101: 'request', 115: 7544, 116: 6831, 103: 'monitor', 105: 390, 123: 89320141, 999: 'x' });
  assert.deepEqual(dps, { 101: 'request', 105: 7544, 106: 6831, 113: 'monitor', 115: 390, 123: 89320141, 999: 'x' }, 'input untouched');
  assert.deepEqual(renumberDps(out, map), dps, 'its own inverse');
});

test('readChannels decodes the classifier inputs from raw dps at the catalogue scale', () => {
  const raw = { 103: 'monitor', 105: 0, 106: 0, 113: 'working', 115: 7544, 116: 6831, 117: 2290 };
  assert.deepEqual(readChannels(raw, P), {
    ch1: { p: 0, c: 0, state: 'monitor' },
    ch2: { p: 754.4, c: 6.831, state: 'working' },
  });
});

test('readChannels reports a channel it has never seen as absent, not as zero', () => {
  const out = readChannels({ 115: 390, 116: 393 }, P);
  assert.deepEqual(out.ch1, { p: null, c: null, state: null });
  assert.deepEqual(out.ch2, { p: 39, c: 0.393, state: null });
});

test('swapChannelCodes trades decoded capability codes between channels, keeping device-wide ones', () => {
  const caps = { cur_power1: 5, cur_current1: 0.05, device_state1: 'monitor', cur_power2: 400, all_energy: 1, net_state: 'cloud_net' };
  assert.deepEqual(swapChannelCodes(caps, P), {
    cur_power2: 5, cur_current2: 0.05, device_state2: 'monitor', cur_power1: 400, all_energy: 1, net_state: 'cloud_net',
  });
});
