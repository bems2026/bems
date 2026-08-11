import { describe, it, expect } from 'vitest';
import { phaseBalance } from './mainPanelHealth';

describe('phaseBalance', () => {
  it('is balanced (not unbalanced) with no readings yet — unknown, not a real imbalance', () => {
    expect(phaseBalance(null, null)).toEqual({ balanced: true, spread: null, heavier: null });
  });

  it('is balanced with no readings even if only one side is missing', () => {
    expect(phaseBalance(6, null)).toEqual({ balanced: true, spread: null, heavier: null });
  });

  it('is balanced when the spread is small', () => {
    const r = phaseBalance(6.1, 4.9);
    expect(r.balanced).toBe(true);
    expect(r.spread).toBeCloseTo(1.2);
    expect(r.heavier).toBe('red');
  });

  it('is unbalanced past the 3.5A spread threshold', () => {
    const r = phaseBalance(10, 5);
    expect(r.balanced).toBe(false);
    expect(r.spread).toBe(5);
    expect(r.heavier).toBe('red');
  });

  it('is exactly at the threshold is still unbalanced (strict less-than)', () => {
    expect(phaseBalance(3.5, 0).balanced).toBe(false);
  });

  it('identifies yellow as the heavier phase when it is larger', () => {
    expect(phaseBalance(4, 9).heavier).toBe('yellow');
  });
});
