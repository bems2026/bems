import { describe, it, expect } from 'vitest';
import { dispatchScope } from './dispatchScope';
import type { Device, DeviceClass } from '@/lib/types';

const dev = (id: string, cls: DeviceClass): Device => ({
  id,
  display_name: id,
  class: cls,
  room: null,
  dps_map: null,
  status: 'active',
});

const ALL = [dev('l1', 'switch'), dev('co1', 'outlet_dual'), dev('acu_main', 'acu_ir'), dev('mtr_a', 'meter')];

describe('dispatchScope', () => {
  it('is closed while capabilities are still unknown — never assume open before a real response', () => {
    expect(dispatchScope(ALL, null).state).toBe('closed');
  });

  it('is closed when the gate reports no dispatching classes at all', () => {
    expect(dispatchScope(ALL, []).state).toBe('closed');
  });

  it('is partial when lights dispatch but outlets and the ACU do not', () => {
    const scope = dispatchScope(ALL, ['switch']);
    expect(scope.state).toBe('partial');
    expect(scope.live).toEqual(['switch']);
    expect(scope.simulated).toEqual(['outlet_dual', 'acu_ir']);
  });

  it('is full only when every commandable class present actually dispatches', () => {
    const scope = dispatchScope(ALL, ['switch', 'outlet_dual', 'acu_ir']);
    expect(scope.state).toBe('full');
    expect(scope.simulated).toEqual([]);
  });

  it('ignores meters and sensors — they are not commandable, so they can never be "not dispatching"', () => {
    const scope = dispatchScope([dev('l1', 'switch'), dev('mtr_a', 'meter'), dev('s1', 'sensor_temp_humidity')], ['switch']);
    expect(scope.state).toBe('full');
    expect(scope.simulated).toEqual([]);
  });

  it('only reports classes actually present on the page — a class the gate lists but no device has is not claimed', () => {
    const scope = dispatchScope([dev('co1', 'outlet_dual')], ['switch']);
    expect(scope.live).toEqual([]);
    expect(scope.simulated).toEqual(['outlet_dual']);
    expect(scope.state).toBe('closed');
  });

  it('treats an empty device list as closed rather than "full with nothing", which would read as an all-clear', () => {
    expect(dispatchScope([], ['switch']).state).toBe('closed');
  });
});
