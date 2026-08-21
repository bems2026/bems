import { describe, it, expect } from 'vitest';
import {
  MISSING, isPresent, formatNumber, formatWithUnit, formatVolts, formatAmps,
  formatWatts, formatKw, formatWattsAsKw, formatKwh, shareOfTotal,
} from './format';

describe('the missing-value rule', () => {
  it('renders null and undefined as an em dash, never 0', () => {
    // The rule this module exists for: "no data" and "zero watts" are different facts
    // about a building, and conflating them is how a dead sensor reads as an idle one.
    expect(formatNumber(null)).toBe(MISSING);
    expect(formatNumber(undefined)).toBe(MISSING);
    expect(MISSING).toBe('—');
  });

  it('renders a real zero as a real zero', () => {
    expect(formatNumber(0, 1)).toBe('0.0');
    expect(formatWatts(0)).toBe('0 W');
  });

  it('treats NaN and Infinity as missing, not as numbers', () => {
    // A division that went wrong upstream must not render as "NaN" on a wall display.
    expect(formatNumber(NaN)).toBe(MISSING);
    expect(formatNumber(Infinity)).toBe(MISSING);
    expect(isPresent(NaN)).toBe(false);
  });

  it('drops the unit when the value is missing', () => {
    // "—V" reads as a volt reading of unknown size; what is true is that there is none.
    expect(formatVolts(null)).toBe(MISSING);
    expect(formatWatts(undefined)).toBe(MISSING);
    expect(formatKwh(null)).toBe(MISSING);
  });
});

describe('unit formatters keep the resolutions the meters actually report', () => {
  it('volts to one decimal', () => expect(formatVolts(231.44)).toBe('231.4V'));
  it('amps to two, since branch currents are often under 1 A', () => expect(formatAmps(0.389)).toBe('0.39A'));
  it('watts whole, since a tenth of a watt is noise here', () => expect(formatWatts(746.5)).toBe('747 W'));
  it('kW to two decimals', () => expect(formatKw(1.234)).toBe('1.23 kW'));
  it('converts watts to kW in one place', () => expect(formatWattsAsKw(746.5)).toBe('0.75 kW'));
  it('takes an arbitrary unit and digit count', () => expect(formatWithUnit(24.51, '°C', 1)).toBe('24.5°C'));
});

describe('shareOfTotal', () => {
  it('computes a plain percentage', () => {
    expect(shareOfTotal(25, 100)).toBe(25);
  });

  it('returns 0 for a zero total rather than dividing by zero', () => {
    // An Infinity here would render as a bar wider than its own track.
    expect(shareOfTotal(5, 0)).toBe(0);
    expect(Number.isFinite(shareOfTotal(5, 0))).toBe(true);
  });

  it('returns 0 when either side is missing', () => {
    expect(shareOfTotal(null, 100)).toBe(0);
    expect(shareOfTotal(25, null)).toBe(0);
  });

  it('clamps to 100, so a part exceeding its total cannot overflow a bar', () => {
    expect(shareOfTotal(150, 100)).toBe(100);
  });

  it('handles a negative total as missing rather than producing a negative width', () => {
    expect(shareOfTotal(5, -10)).toBe(0);
  });
});
