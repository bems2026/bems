/**
 * `npm run mock:stop` kills whatever holds port 1880. On the Pi that port is the LIVE Node-RED
 * bridge, and on 2026-09-02 running this there stopped production — the dashboard, the ingestion
 * daemon and the scheduler all lost their data source at once.
 *
 * It is an easy mistake to reach for, not an unlikely one: `npm run mock` cannot bind on that
 * box precisely because Node-RED already holds the port, and `mock:stop` is what the failure
 * message suggests. So the guard is on identity, not on the port.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeMock } from '../mock-bridge/stop.mjs';

test('a real mock process is recognised', () => {
  assert.equal(looksLikeMock('/usr/bin/node /home/bems/bems/mock-bridge/server.mjs'), true);
  assert.equal(looksLikeMock('node mock-bridge/server.mjs --port=1880'), true);
});

test('the live Node-RED bridge is NOT mistaken for a mock', () => {
  // The exact command line the Pi's `nodered` unit runs.
  assert.equal(looksLikeMock('node-red --max-old-space-size=256 -v'), false);
  assert.equal(looksLikeMock('/usr/bin/node /usr/lib/node_modules/node-red/red.js'), false);
});

test('an unreadable command line is treated as not-ours', () => {
  // A pid whose /proc entry cannot be read is unknown, and unknown must not be killed.
  for (const value of ['', null, undefined]) assert.equal(looksLikeMock(value), false);
});
