/**
 * The demux's decision travels from the source tab's flow context to `/api/readings/latest`, so
 * every stored row can say how its channel was attributed (RM-122). Three hops, each checked
 * against the code that ships: the energy collector string, `buildLatest`, and — in
 * `server/ingest.test.mjs` — the ingest shaping.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildLatest } from '../shared/buildLatest.mjs';
import { DEVICE_REGISTRY, PHASE_MAP, STALE_AFTER_MS_BY_CLASS } from '../shared/registry.mjs';

const NOW = 1786000000000;
const meter = (over = {}) => ({ v: '225.4', c: '6.546', p: '717.3', e: '8.0437', h: true, ...over });
const snap = (co_yel, lo_yel2) => ({
  energy: { meters: { co_yel: meter(co_yel), lo_red: meter(), arec: meter(), lo_yel2: meter(lo_yel2) }, totals: {} },
  outlet: { meters: {}, state: { status: {} } },
  switch: { state: {}, health: {} },
  aircon: { state: {} },
  arrivals: { co_yel: NOW, lo_red: NOW, arec: NOW, lo_yel2: NOW },
});
const rows = (s) => buildLatest(s, DEVICE_REGISTRY, PHASE_MAP, NOW, undefined, STALE_AFTER_MS_BY_CLASS);

test('a meter whose collector carries a channel map publishes it, with when and why', () => {
  const cm = { assignment: 'swapped', rule: 'ceiling', since: NOW - 3600000, lastRule: 'carry', flips: 2, pending: null };
  const out = rows(snap({ cm }, { cm }));
  const co = out.find((r) => r.device_id === 'mtr_co_yellow');
  const lo = out.find((r) => r.device_id === 'mtr_lo_yellow');
  assert.deepEqual(co.channel_map, { assignment: 'swapped', rule: 'ceiling', since: '2026-08-06T14:06:40+08:00', flips: 2 });
  assert.deepEqual(lo.channel_map, co.channel_map);
});

test('a meter with no channel map publishes no field at all — older flows and single-channel meters', () => {
  const out = rows(snap({}, {}));
  for (const r of out) assert.equal('channel_map' in r, false, `${r.device_id} must not carry a channel_map`);
});

test('the energy collector reads each meter\'s channel map into the snapshot', () => {
  // The collector is a string in build-flow.mjs; run the generated flow's copy of it.
  const flow = JSON.parse(readFileSync(new URL('../node-red-bridge/bridge-flow.json', import.meta.url), 'utf8'));
  const collector = flow.find((n) => n.name === 'Bridge collect: Energy Monitoring - Set time');
  assert.ok(collector, 'energy collector present in the generated flow');
  const store = { co_yel_channel_map: { assignment: 'direct', rule: 'idle', since: 1, flips: 0 } };
  const msg = new Function('msg', 'flow', collector.func)({}, { get: (k) => store[k] });
  assert.deepEqual(msg.snapshot.energy.meters.co_yel.cm, store.co_yel_channel_map);
  assert.equal(msg.snapshot.energy.meters.lo_red.cm, undefined);
});
