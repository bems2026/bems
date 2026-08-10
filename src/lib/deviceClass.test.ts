import { describe, it, expect } from 'vitest';
import { hasSwitchableState } from './deviceClass';

describe('hasSwitchableState', () => {
  it.each([
    ['outlet_dual', true],
    ['switch', true],
    ['acu_ir', true],
    ['meter', false],
    ['sensor_temp_humidity', false],
  ] as const)('%s -> %s', (cls, expected) => {
    expect(hasSwitchableState(cls)).toBe(expected);
  });
});
