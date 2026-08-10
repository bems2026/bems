import { describe, it, expect } from 'vitest';
import { lightMaterialState, outletSocketMaterialState } from './materials';
import { TOKENS } from './tokens';
import type { Reading } from '@/lib/types';

const fresh = new Date().toISOString();
const old = new Date(Date.now() - 60_000).toISOString();

describe('lightMaterialState', () => {
  it('is dim/muted with no reading at all — unknown, not off', () => {
    const s = lightMaterialState(undefined);
    expect(s.color).toBe(TOKENS.muted2);
    expect(s.opacity).toBeLessThan(1);
  });

  it('is dim/muted when the reading is stale, even if it last said "on"', () => {
    const r: Reading = { device_id: 'l3', ts: old, online: true, state: 'on' };
    const s = lightMaterialState(r);
    expect(s.color).toBe(TOKENS.muted2);
  });

  it('is accent-emissive when on and fresh', () => {
    const r: Reading = { device_id: 'l3', ts: fresh, online: true, state: 'on' };
    const s = lightMaterialState(r);
    expect(s.color).toBe(TOKENS.accent);
    expect(s.emissiveIntensity).toBeGreaterThan(1);
  });

  it('is dark and non-emissive when off and fresh — a real known-off state, not unknown', () => {
    const r: Reading = { device_id: 'l3', ts: fresh, online: true, state: 'off' };
    const s = lightMaterialState(r);
    expect(s.color).toBe(TOKENS.bgSurface2);
    expect(s.emissiveIntensity).toBeLessThan(0.1);
    expect(s.opacity).toBe(1); // "known off" is not the same visual state as "unknown"
  });
});

describe('outletSocketMaterialState', () => {
  const co1: Reading = {
    device_id: 'co1',
    ts: fresh,
    online: true,
    state: 'on',
    socket_states: { 1: 'on', 2: 'off' },
  };

  it('reads each socket independently — this is the whole point of dual-socket outlets', () => {
    expect(outletSocketMaterialState(co1, 1).color).toBe(TOKENS.accent);
    expect(outletSocketMaterialState(co1, 2).color).toBe(TOKENS.bgSurface2);
  });

  it('is muted for both sockets when the reading is stale', () => {
    const stale: Reading = { ...co1, ts: old };
    expect(outletSocketMaterialState(stale, 1).color).toBe(TOKENS.muted2);
    expect(outletSocketMaterialState(stale, 2).color).toBe(TOKENS.muted2);
  });

  it('is muted with no reading at all', () => {
    expect(outletSocketMaterialState(undefined, 1).color).toBe(TOKENS.muted2);
  });
});
