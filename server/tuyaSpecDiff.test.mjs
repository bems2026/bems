import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fingerprint, similarity, matchProfiles, diffProfile, diffWritability, hasDrift,
} from './tuyaSpecDiff.mjs';

const single = {
  id: 'cz_ct_single',
  capabilities: [
    { code: 'cur_power1', dp: 105, access: 'ro', kind: 'value', scale: 1, unit: 'W' },
    { code: 'net_state', dp: 113, access: 'ro', kind: 'enum', range: ['cloud_net', 'no_net'] },
  ],
};
const double = {
  id: 'cz_ct_double',
  capabilities: [
    { code: 'cur_power1', dp: 105, access: 'ro', kind: 'value', scale: 1, unit: 'W' },
    { code: 'device_state2', dp: 113, access: 'ro', kind: 'enum', range: ['close', 'working'] },
    { code: 'net_state', dp: 124, access: 'ro', kind: 'enum', range: ['cloud_net', 'no_net'] },
  ],
};
const asProduct = (key, profile) => ({ key, capabilities: profile.capabilities });

test('similarity counts dp->code pairs both sides agree on', () => {
  assert.equal(similarity(fingerprint(single.capabilities), fingerprint(double.capabilities)), 1);
  assert.equal(similarity(fingerprint(double.capabilities), fingerprint(double.capabilities)), 3);
});

test('each cloud product is claimed by at most one profile', () => {
  // The two meter profiles share dps 101-112 exactly, so a greedy per-profile match would let
  // both claim the dual-channel product and then report the single-channel one as missing
  // everything it has. This is the case that exists on the real fleet.
  const { matched, unmatched } = matchProfiles(
    [single, double],
    [asProduct('p_single', single), asProduct('p_double', double)],
  );
  assert.equal(unmatched.length, 0);
  const pairing = Object.fromEntries(matched.map((m) => [m.profile.id, m.product.key]));
  assert.deepEqual(pairing, { cz_ct_single: 'p_single', cz_ct_double: 'p_double' });
});

test('a profile with no overlapping product is reported unmatched, not mispaired', () => {
  const alien = { id: 'alien', capabilities: [{ code: 'x', dp: 900, access: 'ro', kind: 'bool' }] };
  const { matched, unmatched } = matchProfiles([alien], [asProduct('p_double', double)]);
  assert.equal(matched.length, 0);
  assert.deepEqual(unmatched.map((p) => p.id), ['alien']);
});

test('a changed scale is an error — it silently moves the decimal point', () => {
  const drifted = { key: 'p', capabilities: [
    { code: 'cur_power1', dp: 105, access: 'ro', kind: 'value', scale: 2, unit: 'W' },
    { code: 'net_state', dp: 113, access: 'ro', kind: 'enum', range: ['cloud_net', 'no_net'] },
  ] };
  const findings = diffProfile(single, drifted);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'scale_mismatch');
  assert.equal(hasDrift(findings), true);
});

test('a moved dp is an error', () => {
  const drifted = { key: 'p', capabilities: [
    { code: 'cur_power1', dp: 105, access: 'ro', kind: 'value', scale: 1, unit: 'W' },
    { code: 'net_state', dp: 124, access: 'ro', kind: 'enum', range: ['cloud_net', 'no_net'] },
  ] };
  assert.equal(diffProfile(single, drifted).some((f) => f.kind === 'dp_mismatch'), true);
});

test('a code the catalogue does not carry is a warning, not a failure', () => {
  const extended = { key: 'p', capabilities: [
    ...single.capabilities,
    { code: 'brand_new', dp: 200, access: 'ro', kind: 'bool' },
  ] };
  const findings = diffProfile(single, extended);
  assert.deepEqual(findings.map((f) => [f.kind, f.severity]), [['new_upstream', 'warn']]);
  assert.equal(hasDrift(findings), false);
});

test('an inferred unit is not compared, but becoming declared is reported', () => {
  const ours = { id: 'p', capabilities: [
    { code: 'add_ele', dp: 17, access: 'ro', kind: 'value', scale: 3, unit: 'kWh', unit_inferred: true },
  ] };
  const silent = { key: 'p', capabilities: [{ code: 'add_ele', dp: 17, access: 'ro', kind: 'value', scale: 3 }] };
  assert.deepEqual(diffProfile(ours, silent), []);

  const declared = { key: 'p', capabilities: [
    { code: 'add_ele', dp: 17, access: 'ro', kind: 'value', scale: 3, unit: 'Wh' },
  ] };
  const findings = diffProfile(ours, declared);
  assert.equal(findings[0].kind, 'unit_now_declared');
  assert.equal(hasDrift(findings), false);
});

test('claiming write access the vendor refuses is always an error', () => {
  // This is the only finding here that could move a relay, so it never degrades to a warning.
  const ours = { id: 'p', capabilities: [{ code: 'sync_request', dp: 101, access: 'rw', writable: true, kind: 'enum' }] };
  const theirs = { key: 'p', capabilities: [{ code: 'sync_request', dp: 101, access: 'ro', kind: 'enum' }] };
  const findings = diffWritability(ours, theirs);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'writable_but_readonly');
  assert.equal(hasDrift(findings), true);
});

test('a silent upstream field does not contradict the catalogue', () => {
  const ours = { id: 'p', capabilities: [{ code: 'a', dp: 1, access: 'ro', kind: 'value', scale: 0, unit: '' }] };
  const theirs = { key: 'p', capabilities: [{ code: 'a', dp: 1, kind: 'value' }] };
  assert.deepEqual(diffProfile(ours, theirs), []);
});

test('units compare case-insensitively — the vendor writes both kWh and kwh', () => {
  const ours = { id: 'p', capabilities: [{ code: 'e', dp: 1, access: 'ro', kind: 'value', scale: 3, unit: 'kWh' }] };
  const theirs = { key: 'p', capabilities: [{ code: 'e', dp: 1, access: 'ro', kind: 'value', scale: 3, unit: 'kwh' }] };
  assert.deepEqual(diffProfile(ours, theirs), []);
});
