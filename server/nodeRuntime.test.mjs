/**
 * Guards the Node runtime the server suite runs on — server/nodeRuntime.mjs.
 *
 * `server/proxy.test.mjs` failed about one run in thirty on the Windows workstation with
 * `TypeError: fetch failed` caused by `read ECONNRESET`, in a different test each time, while Linux
 * CI stayed green. Nothing in the tests or the fake servers was resetting anything: the spawned proxy
 * PROCESS was dying mid-request with exit status 0xC0000409 — no stderr, no `exit` handler — and
 * Windows resets every socket a dead process leaves open. A rerun passing proved nothing either way.
 *
 * The defect is in libuv's Windows TCP connect, which every outbound `fetch` goes through. These tests
 * pin which runtimes carry it, and fail the suite outright on one that does, so the next occurrence
 * names its cause instead of looking like a flaky network test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasWindowsLoopbackOverrun } from './nodeRuntime.mjs';

test('Node on Windows before the libuv fix carries the connect-time stack overrun', () => {
  // v24.15.0 is the workstation's runtime, where the crash was caught; 22.x and 25.x never received
  // the fix, and 26.0.0 shipped before it.
  for (const version of ['v24.0.0', 'v24.15.0', 'v22.23.2', 'v25.9.0', 'v26.0.0']) {
    assert.equal(hasWindowsLoopbackOverrun({ platform: 'win32', version }), true, version);
  }
});

test('the releases carrying the fix are clear, including every later line', () => {
  for (const version of ['v24.16.0', 'v24.21.0', 'v26.1.0', 'v26.9.0', 'v27.0.0']) {
    assert.equal(hasWindowsLoopbackOverrun({ platform: 'win32', version }), false, version);
  }
});

test('no other platform is affected — the defect is in libuv’s Windows-only source', () => {
  // Which is why CI and the Pi, both Linux, never saw it on the same Node versions.
  assert.equal(hasWindowsLoopbackOverrun({ platform: 'linux', version: 'v24.15.0' }), false);
  assert.equal(hasWindowsLoopbackOverrun({ platform: 'darwin', version: 'v22.23.2' }), false);
});

test('the server suite is not running on a Node that kills its own spawned daemons', () => {
  // Deliberately a failure, not a skip. On an affected runtime every test that spawns the proxy is a
  // coin toss that reports as ECONNRESET; failing here every run is the deterministic outcome.
  assert.equal(
    hasWindowsLoopbackOverrun({ platform: process.platform, version: process.version }),
    false,
    `Node ${process.version} on Windows has the libuv TCP-connect stack buffer overrun (libuv#5107): ` +
      'spawned daemons die with 0xC0000409 mid-request and the tests report `fetch failed` / ECONNRESET. ' +
      'Upgrade Node to 24.16.0 or later (or 26.1.0 or later).',
  );
});
