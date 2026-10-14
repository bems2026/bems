import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClockWatch, CLOCK_STEP_MS } from './clockWatch.mjs';

/**
 * RM-163h (2026-10-14). The Pi 4 has no battery clock: it takes the time from the internet. After a power cut
 * with no internet it restarts at a saved time, logs every minute against it, and jumps forward when the
 * internet returns. The jump is the error of every minute logged before it, so it is measured here: the wall
 * clock against the monotonic one, which never jumps.
 */

test('steady ticks are no step', () => {
  const w = createClockWatch();
  assert.equal(w.observe({ wallMs: 1_000_000, monoMs: 0 }), null);
  assert.equal(w.observe({ wallMs: 1_060_000, monoMs: 60_000 }), null);
  assert.equal(w.observe({ wallMs: 1_120_500, monoMs: 120_000 }), null, 'half a second of NTP slew is not a step');
});

test('a jump of the wall clock against the monotonic one is a step, and its size', () => {
  const w = createClockWatch();
  w.observe({ wallMs: 1_000_000, monoMs: 0 });
  assert.equal(w.observe({ wallMs: 1_000_000 + 60_000 + 2 * 3_600_000, monoMs: 60_000 }), 2 * 3_600_000);
  assert.equal(w.observe({ wallMs: 1_000_000 + 120_000 + 2 * 3_600_000, monoMs: 120_000 }), null, 'measured once');
  assert.ok(CLOCK_STEP_MS <= 60_000);
});

test('a step backwards is a step too', () => {
  const w = createClockWatch();
  w.observe({ wallMs: 10_000_000, monoMs: 0 });
  assert.equal(w.observe({ wallMs: 10_000_000 + 60_000 - 600_000, monoMs: 60_000 }), -600_000);
});

test('ingest measures the clock each tick, and re-times only when the clock had not synchronised at its start', async () => {
  // Read from the source: ingest is a daemon no test spawns.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./ingest.mjs', import.meta.url), 'utf8');
  assert.match(src, /async function tick\(\) \{\s*let synced = null;\s*noteClock\(\);/, 'before this tick\'s rows are stamped');
  assert.match(src, /clockUnsyncedAtStart = ntpSynchronized\(\) === false;/, 'unknown (no timedatectl) is not unsynchronised');
  assert.match(src, /if \(!clockUnsyncedAtStart \|\| !archive \|\| !clockMarkIds\) \{/);
  assert.match(src, /clockUnsyncedAtStart = false;\s*try \{\s*const r = archive\.shiftTimes\(/, 'once');
  const unit = readFileSync(new URL('./ibems-clock-save.service', import.meta.url), 'utf8');
  assert.match(unit, /^ExecStart=\/usr\/bin\/touch \/var\/lib\/systemd\/timesync\/clock$/m);
  assert.match(unit, /^Type=oneshot$/m);
});
