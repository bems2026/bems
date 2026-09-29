/**
 * Guards scripts/context-flush.mjs — RM-148, Stage 6: Node-RED saves its context every 5 minutes
 * instead of every 30 seconds. Measured 2026-09-29: the bridge's 3.7 MB of context, rewritten at
 * every save, was about two thirds of the SD card's 19 GB of writes a day.
 *
 * `settings.js` is not in this repository, and the stock file is mostly commented-out examples —
 * several of them `contextStorage` blocks. The edit must touch the one line Node-RED reads, or
 * refuse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { withContextFlush } from '../scripts/context-flush.mjs';
import { contextFlushFrom } from '../scripts/preflight.mjs';

const stock = [
  '/**',
  ' * contextStorage: {',
  ' *    default: { module: "localfilesystem" },',
  ' * }',
  ' */',
  '/*',
  '    default: { module: "localfilesystem" },',
  '*/',
  'module.exports = {',
  '    // default: { module: "localfilesystem" },',
  '    contextStorage: {',
  '        default: { module: "localfilesystem" },',
  '    },',
  '};',
].join('\n');

test('it sets the flush on the one line Node-RED reads, and nothing else', () => {
  const out = withContextFlush(stock, 300);
  assert.deepEqual(contextFlushFrom(out), { module: 'localfilesystem', flushIntervalS: 300 });
  const changed = out.split('\n').filter((line, i) => line !== stock.split('\n')[i]);
  assert.deepEqual(changed, ['        default: { module: "localfilesystem", config: { flushInterval: 300 } },']);
});

test('a file already set is left as it is', () => {
  const once = withContextFlush(stock, 300);
  assert.equal(withContextFlush(once, 300), once);
});

test('a file it does not recognise is refused rather than guessed at', () => {
  assert.throws(() => withContextFlush('module.exports = {};', 300), /no active contextStorage default/);
  const twice = stock.replace('    },\n};', '    },\n    contextStorage2: {\n        default: { module: "localfilesystem" },\n    },\n};');
  assert.throws(() => withContextFlush(twice, 300), /2 active/);
});
