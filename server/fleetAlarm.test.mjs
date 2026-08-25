/**
 * The out-of-dashboard alarm's decision logic (FI-005).
 *
 * WHY THIS IS A STATE MACHINE AND NOT AN `if`: the ingest daemon ticks every 60 s. A
 * level-triggered check would send the same notification every minute for as long as the fault
 * lasted — six outlets down overnight is 480 notifications, and the first thing anyone does
 * with that is mute the channel, which is strictly worse than having no alerting at all. It has
 * to fire on the EDGE, once per transition.
 *
 * WHY "EVER ONLINE" IS TRACKED: the same reason `fleetStuck` splits on `online_samples`. Two
 * devices here are offline permanently by design (the quiesced IR blaster and outside-temp
 * sensor); counting them would put the fleet over the threshold from the moment the daemon
 * starts and hold it there forever.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFleetAlarm } from './fleetAlarm.mjs';

const up = (id) => ({ device_id: id, online: true });
const down = (id) => ({ device_id: id, online: false });

test('says nothing while everything is healthy', () => {
  const alarm = createFleetAlarm();
  assert.equal(alarm.observe([up('a'), up('b'), up('c')]), null);
});

test('fires once when enough devices that were up go down together', () => {
  const alarm = createFleetAlarm();
  alarm.observe([up('a'), up('b'), up('c')]);
  const event = alarm.observe([down('a'), down('b'), down('c')]);
  assert.equal(event.kind, 'stuck');
  assert.deepEqual(event.devices, ['a', 'b', 'c']);
});

test('stays silent on every tick after the first — the whole point', () => {
  const alarm = createFleetAlarm();
  alarm.observe([up('a'), up('b'), up('c')]);
  assert.equal(alarm.observe([down('a'), down('b'), down('c')]).kind, 'stuck');
  for (let i = 0; i < 10; i++) {
    assert.equal(alarm.observe([down('a'), down('b'), down('c')]), null, 'a repeat is noise');
  }
});

test('never counts a device it has not seen online — the quiesced case', () => {
  // The IR blaster and outside-temp sensor are offline permanently and on purpose. Counting
  // them would trip the alarm at startup and hold it there for good.
  const alarm = createFleetAlarm();
  assert.equal(alarm.observe([down('blaster'), down('sensor'), down('x'), down('y')]), null);
});

test('a device counts from the moment it has been seen up once', () => {
  const alarm = createFleetAlarm();
  alarm.observe([up('a')]);
  alarm.observe([up('b')]);
  alarm.observe([up('c')]);
  assert.equal(alarm.observe([down('a'), down('b'), down('c')]).kind, 'stuck');
});

test('does not fire below the threshold', () => {
  const alarm = createFleetAlarm();
  alarm.observe([up('a'), up('b'), up('c')]);
  assert.equal(alarm.observe([down('a'), down('b'), up('c')]), null);
});

test('reports recovery once, so the channel closes the loop it opened', () => {
  const alarm = createFleetAlarm();
  alarm.observe([up('a'), up('b'), up('c')]);
  alarm.observe([down('a'), down('b'), down('c')]);
  const back = alarm.observe([up('a'), up('b'), up('c')]);
  assert.equal(back.kind, 'recovered');
  assert.equal(alarm.observe([up('a'), up('b'), up('c')]), null, 'and only once');
});

test('can fire again after a recovery — this is not a one-shot', () => {
  const alarm = createFleetAlarm();
  alarm.observe([up('a'), up('b'), up('c')]);
  alarm.observe([down('a'), down('b'), down('c')]);
  alarm.observe([up('a'), up('b'), up('c')]);
  assert.equal(alarm.observe([down('a'), down('b'), down('c')]).kind, 'stuck');
});

test('ignores the totals row and anything without a boolean online', () => {
  const alarm = createFleetAlarm();
  alarm.observe([up('a'), up('b'), up('c')]);
  const event = alarm.observe([
    { device_id: '_totals' },
    { device_id: 'z', online: null },
    down('a'), down('b'), down('c'),
  ]);
  assert.deepEqual(event.devices, ['a', 'b', 'c']);
});

test('a device missing from a tick is not treated as offline', () => {
  // A reading absent from one poll is a gap in the feed, not a claim about the hardware.
  // Inferring "down" from silence is how a bridge hiccup becomes a fleet alarm.
  const alarm = createFleetAlarm();
  alarm.observe([up('a'), up('b'), up('c')]);
  assert.equal(alarm.observe([]), null);
});

test('the threshold is configurable, because three is a judgement not a law', () => {
  const alarm = createFleetAlarm({ threshold: 2 });
  alarm.observe([up('a'), up('b')]);
  assert.equal(alarm.observe([down('a'), down('b')]).kind, 'stuck');
});
