/**
 * The site's declaration of which meter pair shares one physical dual-channel device, and the two
 * physical facts the demux may rely on. Held to the registry so a renamed device or a changed
 * profile cannot leave the demux pointing at nothing — silently, on the tab that feeds every
 * per-circuit figure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE, BUILT_IN_DEVICES } from '../shared/registry.mjs';
import { CAPABILITY_PROFILES } from '../shared/deviceCapabilities.mjs';

const byId = new Map(BUILT_IN_DEVICES.map((d) => [d.id, d]));

test('the yellow CT pair is declared, with the operator-confirmed facts of 2026-09-21', () => {
  assert.ok(Array.isArray(SITE.channel_demux), 'SITE.channel_demux is a list');
  const pair = SITE.channel_demux.find((p) => p.devices.includes('mtr_lo_yellow'));
  assert.ok(pair, 'the L.O Yellow / C.O Yellow pair is declared');
  assert.deepEqual(pair.devices, ['mtr_co_yellow', 'mtr_lo_yellow'], 'channel 1 first, channel 2 second');
  assert.equal(pair.ceiling_w, 150);
  assert.equal(pair.never_idle, 'mtr_co_yellow');
});

test('every declared pair is two registry meters on one two-channel product, channels 1 and 2 in order', () => {
  for (const pair of SITE.channel_demux) {
    assert.equal(pair.devices.length, 2);
    const [a, b] = pair.devices.map((id) => byId.get(id));
    assert.ok(a && b, `${pair.devices} both exist in the registry`);
    assert.equal(a.capability_profile, b.capability_profile, 'same product');
    assert.equal(CAPABILITY_PROFILES[a.capability_profile]?.channels, 2, 'a two-channel product');
    assert.equal(a.channel, 1);
    assert.equal(b.channel, 2);
    assert.ok(pair.devices.includes(pair.never_idle), 'never_idle names one of the pair');
    assert.ok(Number.isFinite(pair.ceiling_w) && pair.ceiling_w > 0);
    // The ceiling must sit far below what an outlet branch draws on an office day, or the rule
    // would never fire; and above the lighting branch's real draw, or it would fire wrongly.
    assert.ok(pair.ceiling_w < 400 && pair.ceiling_w > 60, `ceiling ${pair.ceiling_w} W is between the two loads`);
  }
});
