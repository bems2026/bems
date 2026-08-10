import { describe, it, expect } from 'vitest';
import { TIMING } from './timing';
import { TIMING as SHARED_TIMING } from '../../shared/registry.mjs';

describe('TIMING', () => {
  it('matches shared/registry.mjs exactly — the bridge, mock, and frontend must agree', () => {
    expect(TIMING).toEqual(SHARED_TIMING);
  });
});
