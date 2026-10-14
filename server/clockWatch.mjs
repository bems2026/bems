/**
 * Steps of the wall clock, measured against the monotonic one — RM-163h, 2026-10-14.
 *
 * WHY. The Pi 4 has no battery-backed clock; it takes the time from the internet (systemd-timesyncd). After a
 * power cut with no internet it restarts at a saved time, ingest stamps every minute against it, and the
 * clock jumps when the internet returns. That jump is exactly the error of every minute stamped before it, so
 * ingest measures it here and re-times those minutes (`archive.shiftTimes`). The monotonic clock never jumps,
 * so the wall clock's change between two ticks, less the monotonic clock's, is the step.
 *
 * Under `CLOCK_STEP_MS` is NTP slewing a drifting clock, not a step.
 */

export const CLOCK_STEP_MS = 30_000;

export function createClockWatch({ stepMs = CLOCK_STEP_MS } = {}) {
  let last = null;
  return {
    /** @returns {number|null} the step since the last observation (positive: forward), or null. */
    observe({ wallMs, monoMs }) {
      const prev = last;
      last = { wallMs, monoMs };
      if (!prev) return null;
      const step = (wallMs - prev.wallMs) - (monoMs - prev.monoMs);
      return Math.abs(step) >= stepMs ? Math.round(step) : null;
    },
  };
}
