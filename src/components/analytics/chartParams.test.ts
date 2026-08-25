import { describe, it, expect } from 'vitest';
import { pointValue, formatParamValue, CHART_PARAM_ORDER } from './chartParams';
import type { HistoryPoint } from '@/lib/types';

const point = (o: Partial<HistoryPoint> = {}): HistoryPoint => ({
  ts: '2026-08-25T10:00:00+08:00',
  power_w: 514,
  voltage: 230.4,
  current: 2.23,
  ...o,
});

describe('pointValue', () => {
  it('returns the value for a point that carried it', () => {
    expect(pointValue(point(), 'power')).toBe(514);
    expect(pointValue(point(), 'voltage')).toBe(230.4);
  });

  it('returns undefined rather than 0 for a field the point never carried', () => {
    // Voltage and current were added to the ring buffer later than power, so on a
    // long-running bridge their series begin partway through the window. A 0 there would be a
    // fabricated reading; undefined is a gap, which is what actually happened.
    expect(pointValue({ ts: 't', power_w: 100 }, 'voltage')).toBeUndefined();
  });

  it('returns undefined for a missing point entirely', () => {
    expect(pointValue(undefined, 'power')).toBeUndefined();
  });

  /**
   * FI-010. A device that has been offline all day still had its last known wattage copied
   * into every sample, so the 24h chart drew a confident flat line for hardware that was not
   * reporting — the same dishonesty already fixed for the 7d/30d charts and, on 2026-08-25,
   * for the aircon's ONLINE flag.
   *
   * Fixed here rather than at each chart because `pointValue` is the single place a point
   * becomes a plotted number, and every consumer already treats `undefined` as a gap. A point
   * with no `online` field is left alone: those predate the change and their state is genuinely
   * unknown, so suppressing them would erase real history to make a point about honesty.
   */
  it('suppresses every reading on a point the bridge marked offline', () => {
    const offline = point({ online: false });
    for (const param of CHART_PARAM_ORDER) {
      expect(pointValue(offline, param)).toBeUndefined();
    }
  });

  it('keeps readings on a point explicitly marked online', () => {
    expect(pointValue(point({ online: true }), 'power')).toBe(514);
  });

  it('keeps readings on an older point that carries no online field at all', () => {
    // Points buffered before this change have no `online`. Their state is unknown, not false —
    // dropping them would delete real history in the name of honesty.
    const older: HistoryPoint = { ts: 't', power_w: 400 };
    expect(pointValue(older, 'power')).toBe(400);
  });
});

describe('formatParamValue', () => {
  it('formats each parameter to its own precision and unit', () => {
    expect(formatParamValue(514.4, 'power')).toBe('514 W');
    expect(formatParamValue(230.44, 'voltage')).toBe('230.4 V');
    expect(formatParamValue(2.234, 'current')).toBe('2.23 A');
  });
});
