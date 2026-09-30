/**
 * Tests for server/edgeWatchdog.mjs — where the database's "the edge has gone silent" notice goes
 * (RM-150, F-034).
 *
 *     node --test server/edgeWatchdog.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { watchdogRowFrom, maskTopic } from './edgeWatchdog.mjs';

test('the row carries the edge\'s own topic and server, defaulting to the public server', () => {
  assert.deepEqual(watchdogRowFrom({ NTFY_TOPIC: ' ibems-alerts ' }, 'site-a'), {
    row: { site_id: 'site-a', ntfy_server: 'https://ntfy.sh', ntfy_topic: 'ibems-alerts' },
  });
  assert.equal(watchdogRowFrom({ NTFY_TOPIC: 't', NTFY_SERVER: 'https://ntfy.example/' }, 's').row.ntfy_server, 'https://ntfy.example');
});

test('no topic, or one the server would refuse, is an error, never a row', () => {
  assert.match(watchdogRowFrom({}, 's').error, /NTFY_TOPIC is not set/);
  assert.match(watchdogRowFrom({ NTFY_TOPIC: 'x'.repeat(65) }, 's').error, /64/);
  assert.match(watchdogRowFrom({ NTFY_TOPIC: 't', NTFY_SERVER: 'ntfy.example' }, 's').error, /http/);
});

test('the topic is never printed whole', () => {
  assert.equal(maskTopic('ibems-alerts-secret'), 'ibe********');
  assert.equal(maskTopic('abc'), '****');
  assert.doesNotMatch(maskTopic('ibems-alerts-secret'), /alerts/);
});
