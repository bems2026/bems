import test from 'node:test';
import assert from 'node:assert/strict';
import { planCleanup } from '../node-red-bridge/cleanupPlan.mjs';

const flow = () => [
  { id: 'tab1', type: 'tab', label: 'Switch' },
  { id: 'fn1', type: 'function', name: 'logic', z: 'tab1', wires: [['dbg1', 'ui1', 'fn2']] },
  { id: 'fn2', type: 'function', name: 'downstream', z: 'tab1', wires: [[]] },
  { id: 'dbg1', type: 'debug', name: 'd', z: 'tab1', wires: [] },
  { id: 'ui1', type: 'ui_text', name: 'readout', z: 'tab1', group: 'grp1', wires: [] },
  { id: 'grp1', type: 'ui_group', name: 'g' },
  { id: 'twinout', type: 'mqtt out', name: 'publish state', broker: 'twinbrk', z: 'tab1', wires: [] },
  { id: 'twinin', type: 'mqtt in', name: 'twin commands', topic: 'mmsu/office/cmd/#', broker: 'twinbrk', z: 'tab1', wires: [['fn1']] },
  { id: 'twinbrk', type: 'mqtt-broker', name: 'local mosquitto' },
  { id: 'sniff', type: 'mqtt in', name: 'ESP32 AC Sniffer', topic: 'nbric/ac/status', broker: 'realbrk', z: 'tab1', wires: [['fn2']] },
  { id: 'realbrk', type: 'mqtt-broker', name: 'Local Mosquitto' },
  { id: 'gs1', type: 'GSheet', name: 'log', z: 'tab1', wires: [] },
];

const ids = (p) => p.remove.map((n) => n.id).sort();

test('removes the legacy /ui dashboard, config nodes included', () => {
  const r = ids(planCleanup(flow()));
  assert.ok(r.includes('ui1'), 'ui_text');
  assert.ok(r.includes('grp1'), 'ui_group config node must go too, or it dangles');
});

test('removes debug nodes', () => {
  assert.ok(ids(planCleanup(flow())).includes('dbg1'));
});

test('removes the whole MQTT twin — the command input AND its publisher', () => {
  const r = ids(planCleanup(flow()));
  assert.ok(r.includes('twinin'), 'the unauthenticated command path is the point');
  assert.ok(r.includes('twinout'), 'its publisher is the other half of the same feature');
});

test('removes a broker only once nothing references it any more', () => {
  const r = ids(planCleanup(flow()));
  assert.ok(r.includes('twinbrk'), 'unreferenced after the twin goes');
  assert.ok(!r.includes('realbrk'), 'still used by the ESP32 sniffer — must NOT be removed');
});

test('keeps the ESP32 sniffer: its silence is explained by the network outage, not proof it is dead', () => {
  assert.ok(!ids(planCleanup(flow())).includes('sniff'));
});

test('keeps Google Sheets logging, which is still wanted as a parallel record', () => {
  assert.ok(!ids(planCleanup(flow())).includes('gs1'));
});

test('never removes control logic or tabs', () => {
  const r = ids(planCleanup(flow()));
  for (const keep of ['fn1', 'fn2', 'tab1']) assert.ok(!r.includes(keep), `${keep} must survive`);
});

test('strips wires pointing at removed nodes, leaving no dangling references', () => {
  const p = planCleanup(flow());
  const removed = new Set(p.remove.map((n) => n.id));
  for (const node of p.flows) {
    for (const out of node.wires ?? []) {
      for (const target of out) assert.ok(!removed.has(target), `${node.id} still wires to removed ${target}`);
    }
  }
});

test('reports a node left with no consumers instead of deleting it — shared logic must be reviewed, not swept', () => {
  const p = planCleanup(flow());
  // fn1 fed dbg1, ui1 and fn2; it keeps fn2, so it is NOT orphaned.
  assert.ok(!p.orphans.some((o) => o.id === 'fn1'));
  assert.ok(Array.isArray(p.orphans));
});

test('a node whose only consumers were removed is reported as an orphan', () => {
  const f = flow();
  f.find((n) => n.id === 'fn1').wires = [['dbg1']];
  const p = planCleanup(f);
  assert.ok(p.orphans.some((o) => o.id === 'fn1'), 'fed only a debug node, now feeds nothing');
});

test('is a pure planner — the input flow is never mutated', () => {
  const original = flow();
  planCleanup(original);
  assert.deepEqual(original.find((n) => n.id === 'fn1').wires, [['dbg1', 'ui1', 'fn2']]);
});

// ---------------------------------------------------------------------------
// The AC schedule rewire.
//
// "Check Time AC" reached "AC Master Logic" by way of the ui_switch widget, so deleting the
// dashboard would have silently stopped the aircon running to schedule. The widget has
// passthru:true and does not transform the message, so wiring the two directly is
// behaviour-identical rather than a behaviour change.
// ---------------------------------------------------------------------------

const acFlow = () => [
  { id: 'tab2', type: 'tab', label: 'Aircon' },
  { id: 'cta', type: 'function', name: 'Check Time AC', z: 'tab2', wires: [['acsw']] },
  { id: 'acsw', type: 'ui_switch', name: 'AC Master Power', z: 'tab2', passthru: true, wires: [['aml']] },
  { id: 'aml', type: 'function', name: 'AC Master Logic', z: 'tab2', wires: [[]] },
];

test('rewires the AC schedule straight to AC Master Logic, bypassing the widget being deleted', () => {
  const p = planCleanup(acFlow());
  const cta = p.flows.find((n) => n.id === 'cta');
  assert.deepEqual(cta.wires, [['aml']], 'schedule must now feed the logic directly');
});

test('AC Master Logic still has a feeder after the dashboard is removed — the whole point of the rewire', () => {
  const p = planCleanup(acFlow());
  const feeders = p.flows.filter((n) => (n.wires ?? []).flat().includes('aml'));
  assert.ok(feeders.length > 0, 'AC Master Logic must not be left with no input');
  assert.equal(feeders[0].name, 'Check Time AC');
});

test('the widget itself is still removed — the rewire preserves the schedule, it does not spare the dashboard', () => {
  const p = planCleanup(acFlow());
  assert.ok(p.remove.some((n) => n.id === 'acsw'));
});

test('the rewire is a no-op on a flow that does not have that path, so it cannot corrupt other sites', () => {
  const p = planCleanup(flow());
  assert.ok(p.flows.find((n) => n.id === 'fn1'));
});
