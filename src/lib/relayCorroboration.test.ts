import { describe, it, expect } from 'vitest';
import { corroborate } from './relayCorroboration';
import type { Device, Reading } from './types';

const outlet: Device = { id: 'co3', display_name: 'Outlet 3', class: 'outlet_dual', room: null, dps_map: 'type_b', status: 'active', sockets: ['CO3_1', 'CO3_2'] };
const light: Device = { id: 'l1', display_name: 'Light 1', class: 'switch', room: null, dps_map: null, status: 'active' };

const reading = (power_w: number | undefined, s1: 'on' | 'off', s2: 'on' | 'off'): Reading => ({
  device_id: 'co3',
  ts: new Date().toISOString(),
  online: true,
  state: s1 === 'on' || s2 === 'on' ? 'on' : 'off',
  power_w,
  socket_states: { 1: s1, 2: s2 },
});

describe('corroborate', () => {
  it('is unmeasured for any class with no meter at all', () => {
    expect(corroborate(light, undefined)).toBe('unmeasured');
    expect(corroborate(light, { device_id: 'l1', ts: '', online: true, state: 'on' })).toBe('unmeasured');
  });

  it('is indeterminate with no reading yet', () => {
    expect(corroborate(outlet, undefined)).toBe('indeterminate');
  });

  it('is contradicted when both sockets are commanded off but real power is measured', () => {
    expect(corroborate(outlet, reading(120, 'off', 'off'))).toBe('contradicted');
  });

  it('is no-load, not contradicted, when both sockets are off and power reads ~0', () => {
    expect(corroborate(outlet, reading(0, 'off', 'off'))).toBe('no-load');
    expect(corroborate(outlet, reading(1.2, 'off', 'off'))).toBe('no-load'); // under the noise epsilon
  });

  it('is drawing when both sockets are on and power is real', () => {
    expect(corroborate(outlet, reading(180, 'on', 'on'))).toBe('drawing');
  });

  it('is no-load, not contradicted, when both sockets are on but nothing is plugged in', () => {
    expect(corroborate(outlet, reading(0, 'on', 'on'))).toBe('no-load');
  });

  it('is indeterminate when exactly one socket is on — the meter cannot attribute the draw', () => {
    expect(corroborate(outlet, reading(90, 'on', 'off'))).toBe('indeterminate');
    expect(corroborate(outlet, reading(90, 'off', 'on'))).toBe('indeterminate');
  });

  it('is indeterminate when power_w is missing even though socket_states exist', () => {
    expect(corroborate(outlet, reading(undefined, 'off', 'off'))).toBe('indeterminate');
  });
});
