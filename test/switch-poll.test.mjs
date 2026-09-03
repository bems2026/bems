/**
 * The light-switch poller.
 *
 * WHY IT EXISTS, measured: after the generated collector went live all seven lights were online
 * and reporting relay state while carrying NO capabilities, because a `tdq` switch volunteers its
 * countdown, power-on mode, switch type and inching setting essentially never. Every outlet and
 * meter had a full set within minutes — the outlets only because `outletPollPlan` already asks
 * them. This is that fix for the class it left out.
 *
 * The poll function is EXECUTED here rather than string-matched: a poller that skips the wrong
 * device, or skips every device, produces exactly the symptom it was written to cure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planSwitchPoll, validateSwitchPoll, switchNodes, switchIds, pollFnFor,
  POLL_FN_ID, POLL_INJECT_ID, POLL_INTERVAL_S,
} from '../node-red-bridge/switchPollPlan.mjs';
import { POLL_INJECT_ID as OUTLET_INJECT_ID } from '../node-red-bridge/outletPollPlan.mjs';

/** A flow whose switch nodes are deliberately NOT in numeric order, as the real one is not. */
const flow = () => [
  { id: 'tab1', type: 'tab', label: 'Switch' },
  ...[2, 3, 5, 6, 7, 4, 1].map((n) => ({
    id: `sw${n}`, type: 'tuya-smart-device', z: 'tab1', deviceName: `Light Switch ${n}`, wires: [[`tag${n}`], []],
  })),
  ...[2, 3, 5, 6, 7, 4, 1].map((n) => ({ id: `tag${n}`, type: 'change', z: 'tab1', name: `tag L${n}`, wires: [['collect']] })),
  { id: 'collect', type: 'function', z: 'tab1', name: 'Collect status', func: "global.set('lightStatus', {});", wires: [[]] },
  // A meter node, to prove the matcher does not sweep up every tuya device on the flow.
  { id: 'mtr', type: 'tuya-smart-device', z: 'tab2', deviceName: 'C.O yellow', wires: [[], []] },
];

/** Run a generated poll function the way Node-RED would. */
const runPoll = (src, lightStatus) => {
  const global = { get: () => lightStatus, set: () => {} };
  return new Function('global', src)(global);
};

test('finds the light switches and nothing else', () => {
  assert.deepEqual(switchNodes(flow()).map((n) => n.deviceName), [
    'Light Switch 2', 'Light Switch 3', 'Light Switch 5',
    'Light Switch 6', 'Light Switch 7', 'Light Switch 4', 'Light Switch 1',
  ]);
});

test('ids come from the node NAME, not from flow order', () => {
  // The real flow lists them 2,3,5,6,7,4,1. Deriving from position would poll every light under
  // its neighbour's health entry — skipping the wrong device, which is worse than not skipping.
  assert.deepEqual(switchIds(flow()), [2, 3, 5, 6, 7, 4, 1]);
});

test('installs exactly one inject and one function, wired one output per switch', () => {
  const before = flow();
  const plan = planSwitchPoll(before);
  assert.equal(plan.unchanged, false);
  assert.equal(plan.added.length, 2);

  const fn = plan.flows.find((n) => n.id === POLL_FN_ID);
  assert.equal(fn.outputs, 7);
  assert.deepEqual(fn.wires, [['sw2'], ['sw3'], ['sw5'], ['sw6'], ['sw7'], ['sw4'], ['sw1']]);

  const inject = plan.flows.find((n) => n.id === POLL_INJECT_ID);
  assert.equal(inject.repeat, String(POLL_INTERVAL_S));
  assert.deepEqual(inject.wires, [[POLL_FN_ID]]);
  assert.deepEqual(validateSwitchPoll(before, plan.flows), []);
});

test('the poll skips a light already known disconnected', () => {
  const out = runPoll(pollFnFor([2, 3, 5, 6, 7, 4, 1]), {
    2: { conn: 'CONNECTED' }, 3: { conn: 'DISCONNECTED' }, 5: { conn: 'ERROR' },
  });
  assert.deepEqual(out.map((m) => (m === null ? 'skip' : 'poll')),
    ['poll', 'skip', 'skip', 'poll', 'poll', 'poll', 'poll']);
});

test('a light with no health entry at all is polled', () => {
  // Unknown must poll — refusing to would keep a light that has never reported silent forever,
  // which is the exact state this poller exists to escape.
  const out = runPoll(pollFnFor([1, 2]), {});
  assert.deepEqual(out.map((m) => (m === null ? 'skip' : 'poll')), ['poll', 'poll']);
  assert.deepEqual(out[0], { payload: { operation: 'GET' } });
});

test('a wiped or absent lightStatus polls everything rather than nothing', () => {
  const out = runPoll(pollFnFor([1, 2, 3]), undefined);
  assert.equal(out.filter((m) => m !== null).length, 3);
});

test('the payload is the GET the tuya node answers on its normal output', () => {
  // That is what lets `tag L<n>` and `Collect status` handle the reply unchanged — nothing
  // downstream needs to know a poll happened.
  const out = runPoll(pollFnFor([1]), { 1: { conn: 'CONNECTED' } });
  assert.deepEqual(out, [{ payload: { operation: 'GET' } }]);
});

test('re-running changes nothing', () => {
  const once = planSwitchPoll(flow());
  const twice = planSwitchPoll(once.flows);
  assert.equal(twice.unchanged, true);
  assert.equal(twice.flows.length, once.flows.length);
});

test('an existing poller is upgraded when the switch set changes, not left stale', () => {
  const installed = planSwitchPoll(flow()).flows;
  const withEighth = [
    ...installed,
    { id: 'sw8', type: 'tuya-smart-device', z: 'tab1', deviceName: 'Light Switch 8', wires: [[], []] },
  ];
  const plan = planSwitchPoll(withEighth);
  assert.equal(plan.unchanged, false);
  assert.deepEqual(plan.upgraded, [POLL_FN_ID]);
  assert.equal(plan.added.length, 0);
  assert.equal(plan.flows.find((n) => n.id === POLL_FN_ID).outputs, 8);
  assert.deepEqual(validateSwitchPoll(withEighth, plan.flows), []);
});

test('it does not fire in the same instant as the outlet poller', () => {
  // Both repeat every 60 s on one radio segment. Sharing an onceDelay would put fourteen
  // simultaneous queries on it every minute, which is the kind of self-inflicted burst that
  // reads later as a flaky network.
  const plan = planSwitchPoll(flow());
  const mine = plan.flows.find((n) => n.id === POLL_INJECT_ID);
  assert.notEqual(POLL_INJECT_ID, OUTLET_INJECT_ID);
  assert.notEqual(mine.onceDelay, '10', 'the outlet poller already uses 10');
});

test('the validator refuses a plan that touched anything else', () => {
  const before = flow();
  const plan = planSwitchPoll(before);
  const tampered = plan.flows.map((n) => (n.id === 'sw1' ? { ...n, wires: [[]] } : n));
  assert.match(validateSwitchPoll(before, tampered).join('\n'), /was modified/);

  const orphaned = plan.flows.map((n) => (n.id === POLL_FN_ID ? { ...n, wires: [['ghost']] } : n));
  assert.match(validateSwitchPoll(before, orphaned).join('\n'), /non-existent ghost/);
});

test('a flow with no switches is left alone', () => {
  const plan = planSwitchPoll([{ id: 'tab1', type: 'tab', label: 'Switch' }]);
  assert.equal(plan.unchanged, true);
  assert.match(plan.reason, /no light switch nodes/);
});
