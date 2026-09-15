import { describe, it, expect } from 'vitest';
import { hitAt, isHitKey, stepHit } from './hitNavigation';
import type { Hit } from './types';

const cell = (x: number, y: number, label: string): Hit => ({ x, y, w: 10, h: 10, label, value: label });
// a b
// c d
const GRID = [cell(0, 0, 'a'), cell(10, 0, 'b'), cell(0, 10, 'c'), cell(10, 10, 'd')];

describe('hitAt', () => {
  it('finds the hit under a point, and none in a margin', () => {
    expect(hitAt(GRID, 15, 5)).toBe(1);
    expect(hitAt(GRID, 25, 5)).toBeNull();
  });

  it('gives a shared edge to one hit only', () => {
    expect(hitAt(GRID, 10, 5)).toBe(1);
  });
});

describe('stepHit', () => {
  it('starts at the first value, or the last for End', () => {
    expect(stepHit(GRID, null, 'ArrowRight')).toBe(0);
    expect(stepHit(GRID, null, 'ArrowDown')).toBe(0);
    expect(stepHit(GRID, null, 'End')).toBe(3);
  });

  it('stops at either end rather than wrapping', () => {
    expect(stepHit(GRID, 3, 'ArrowRight')).toBe(3);
    expect(stepHit(GRID, 0, 'ArrowLeft')).toBe(0);
  });

  it('moves up and down within a column, and stays put where there is no row', () => {
    expect(stepHit(GRID, 0, 'ArrowDown')).toBe(2);
    expect(stepHit(GRID, 3, 'ArrowUp')).toBe(1);
    expect(stepHit(GRID, 1, 'ArrowUp')).toBe(1);
  });

  it('knows which keys are its own', () => {
    expect(isHitKey('ArrowUp')).toBe(true);
    expect(isHitKey('Tab')).toBe(false);
    expect(isHitKey('Enter')).toBe(false);
  });
});
