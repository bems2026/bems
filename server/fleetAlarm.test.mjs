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
import { createFleetAlarm, loadKnownOnline } from './fleetAlarm.mjs';

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

/**
 * THE BLIND SPOT, measured 2026-09-03 and the reason `knownOnline` exists.
 *
 * The fleet went from 18 devices to 4 after a site power cycle and stayed there for nine hours.
 * **No alert was ever sent.** `ibems-ingest` restarted at 07:51 with sixteen devices already
 * offline; because none of them was observed online during that process, none entered
 * `everOnline`, so none could ever count as down, so the alarm never armed.
 *
 * The module's own docblock claimed the opposite — that a restart "re-arms the alarm ... because
 * a restart is also when the operator is most likely to want to know the fleet came back up
 * wrong". A restart in fact DISARMS it, for precisely the devices that are already broken, which
 * is exactly that case. The reasoning was sound and the conclusion was backwards.
 *
 * The fix is to seed the set from devices that have a history of being online, which the
 * database already knows. That keeps the furniture guard intact: a device that has NEVER
 * reported online has no history, so it still cannot contribute.
 */
test('a device that was working before the daemon started still counts as down', () => {
  // The nine-hour blind spot, as one assertion.
  const alarm = createFleetAlarm({ knownOnline: ['a', 'b', 'c'] });
  const event = alarm.observe([down('a'), down('b'), down('c')]);
  assert.equal(event?.kind, 'stuck');
  assert.deepEqual(event.devices, ['a', 'b', 'c']);
});

test('a device with no history still cannot raise the alarm, however long it is offline', () => {
  // The furniture guard the seeding must not break: the quiesced IR blaster and outside-temp
  // sensor have never reported online, so they have no history and must stay uncounted.
  const alarm = createFleetAlarm({ knownOnline: ['a'] });
  for (let i = 0; i < 50; i++) {
    assert.equal(alarm.observe([up('a'), down('acu_main'), down('sens_outside_temp')]), null);
  }
});

test('seeding is additive — devices seen online at run time still join the set', () => {
  const alarm = createFleetAlarm({ knownOnline: ['a'] });
  assert.equal(alarm.observe([up('a'), up('b'), up('c')]), null);
  const event = alarm.observe([down('a'), down('b'), down('c')]);
  assert.equal(event?.kind, 'stuck');
});

test('an absent or failed seed degrades to the old behaviour, never to alarming on everything', () => {
  // The seed is a database read and databases are unreachable sometimes. Failing that read must
  // not manufacture a fleet alarm — the daemon starts blind, exactly as it did before.
  for (const seed of [undefined, null, [], 'nonsense', 42]) {
    const alarm = createFleetAlarm({ knownOnline: seed });
    assert.equal(alarm.observe([down('a'), down('b'), down('c')]), null, `seed ${JSON.stringify(seed)}`);
  }
});

test('a seeded alarm still fires only on the edge, not every tick', () => {
  const alarm = createFleetAlarm({ knownOnline: ['a', 'b', 'c'] });
  assert.equal(alarm.observe([down('a'), down('b'), down('c')])?.kind, 'stuck');
  for (let i = 0; i < 20; i++) assert.equal(alarm.observe([down('a'), down('b'), down('c')]), null);
});

test('a seeded alarm still reports recovery', () => {
  const alarm = createFleetAlarm({ knownOnline: ['a', 'b', 'c'] });
  alarm.observe([down('a'), down('b'), down('c')]);
  assert.equal(alarm.observe([up('a'), up('b'), up('c')])?.kind, 'recovered');
});

/**
 * THE SEED'S OWN BUG, measured 2026-09-03 within an hour of shipping the seed above.
 *
 * The first implementation asked one bulk question — `readings?online=is.true&limit=20000`. It
 * came back with **1,000 rows out of 145,350 matching**, because PostgREST caps result sets
 * server-side and says nothing about it. The distinct devices in that arbitrary slice were 15 of
 * 18, so the seed silently restored the blind spot for three devices.
 *
 * This project has met that cap before — `supabaseHistory.ts` carries `assertNotTruncated`,
 * `demand-profile.mjs` paginates around it — which is what makes writing it a third time worth
 * a test rather than a comment.
 */
test('the seed asks one device at a time, so a server row cap cannot truncate it', async () => {
  const asked = [];
  const select = async (table, query) => {
    asked.push(query);
    // A server that caps at one row, which is what the real one effectively did.
    return [{ device_id: 'x' }];
  };
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const got = await loadKnownOnline({ select, deviceIds: ids });
  assert.deepEqual(got.sort(), ids);
  assert.equal(asked.length, ids.length, 'one query per device, not one query for all of them');
  for (const q of asked) assert.match(q, /device_id=eq\./, 'each query must name its device');
});

test('a device with no online history in the window is not seeded', async () => {
  const select = async (_t, query) => (query.includes('device_id=eq.a') ? [{ device_id: 'a' }] : []);
  const got = await loadKnownOnline({ select, deviceIds: ['a', 'b'] });
  assert.deepEqual(got, ['a']);
});

test('a device whose query fails is omitted, never assumed good', async () => {
  // This feeds an alarm. A device wrongly seeded lets a transient read failure raise a fleet alert.
  const select = async (_t, query) => {
    if (query.includes('device_id=eq.b')) throw new Error('timeout');
    return [{ device_id: 'a' }];
  };
  const got = await loadKnownOnline({ select, deviceIds: ['a', 'b'] });
  assert.deepEqual(got, ['a']);
});

test('every query failing returns null, which the caller reads as start unseeded', async () => {
  const select = async () => { throw new Error('database down'); };
  assert.equal(await loadKnownOnline({ select, deviceIds: ['a', 'b'] }), null);
});

test('an empty or missing device list returns null rather than an empty seed', async () => {
  const select = async () => [];
  assert.equal(await loadKnownOnline({ select, deviceIds: [] }), null);
  assert.equal(await loadKnownOnline({ select, deviceIds: undefined }), null);
});

test('the window is the configured number of days back from now', async () => {
  let seen = null;
  const select = async (_t, query) => { seen = query; return []; };
  const nowMs = Date.parse('2026-09-03T12:00:00Z');
  await loadKnownOnline({ select, deviceIds: ['a'], days: 7, nowMs });
  assert.ok(seen.includes(encodeURIComponent('2026-08-27T12:00:00.000Z').replace(/%3A/g, '%3A')) || seen.includes('2026-08-27'), seen);
});
