import { describe, it, expect } from 'vitest';
import {
  DEVICE_FUNCTIONS,
  FUNCTION_OPTIONS,
  coerceFunctions,
  functionsOf,
  hasFunction,
  partitionByFunction,
} from './deviceFunctions';
import { emptyDeviceConfig, type DeviceConfig } from './deviceConfig';
import type { Device, DeviceClass } from './types';

const dev = (id: string, cls: DeviceClass): Device =>
  ({ id, display_name: id, class: cls, room: null, status: 'active' }) as Device;

const withFunctions = (id: string, functions: DeviceConfig['functions']): DeviceConfig => ({
  ...emptyDeviceConfig(id),
  functions,
});

describe('functionsOf', () => {
  it('falls back to the class default when a device has no configuration of its own', () => {
    expect(functionsOf(dev('l1', 'switch'), undefined)).toEqual(['control', 'scheduling']);
    expect(functionsOf(dev('mtr_lo_red', 'meter'), undefined)).toEqual(['monitoring']);
  });

  it('treats a null `functions` as "not configured", not as "no functions"', () => {
    expect(functionsOf(dev('l1', 'switch'), withFunctions('l1', null))).toEqual(['control', 'scheduling']);
  });

  it('lets a device override its class default entirely', () => {
    const cfg = withFunctions('l1', ['control']);
    expect(functionsOf(dev('l1', 'switch'), cfg)).toEqual(['control']);
  });

  it('honours an explicitly empty list — a device deliberately given no role is not unconfigured', () => {
    const cfg = withFunctions('co5', []);
    expect(functionsOf(dev('co5', 'outlet_dual'), cfg)).toEqual([]);
    expect(hasFunction(dev('co5', 'outlet_dual'), cfg, 'control')).toBe(false);
  });
});

/**
 * The defaults exist to reproduce today's page membership exactly, so introducing
 * configurability cannot quietly change which devices appear where. Each expectation below is
 * the current behaviour of the page named.
 */
describe('class defaults reproduce current page membership', () => {
  const cases: Array<[DeviceClass, string[]]> = [
    ['outlet_dual', ['control', 'monitoring', 'scheduling']],
    ['switch', ['control', 'scheduling']],
    ['meter', ['monitoring']],
    ['acu_ir', ['control', 'scheduling']],
    ['sensor_temp_humidity', ['monitoring']],
  ];

  it.each(cases)('%s defaults to %j', (cls, expected) => {
    expect(functionsOf(dev('x', cls), undefined)).toEqual(expected);
  });

  it('keeps light switches off the power pages — they control, they do not meter', () => {
    expect(hasFunction(dev('l1', 'switch'), undefined, 'monitoring')).toBe(false);
    expect(hasFunction(dev('l1', 'switch'), undefined, 'control')).toBe(true);
  });

  it('keeps meters off the control pages — there is nothing on a meter to switch', () => {
    expect(hasFunction(dev('mtr_lo_red', 'meter'), undefined, 'control')).toBe(false);
    expect(hasFunction(dev('mtr_lo_red', 'meter'), undefined, 'scheduling')).toBe(false);
  });
});

describe('coerceFunctions', () => {
  it('keeps a valid list, in canonical order rather than the order it arrived in', () => {
    expect(coerceFunctions(['scheduling', 'control'])).toEqual(['control', 'scheduling']);
  });

  it('drops values that are not functions rather than throwing or passing them through', () => {
    expect(coerceFunctions(['control', 'teleportation'])).toEqual(['control']);
  });

  it('de-duplicates', () => {
    expect(coerceFunctions(['control', 'control'])).toEqual(['control']);
  });

  it('maps a missing value to null — "not configured" — and an empty list to an empty list', () => {
    expect(coerceFunctions(null)).toBeNull();
    expect(coerceFunctions(undefined)).toBeNull();
    expect(coerceFunctions([])).toEqual([]);
  });

  it('rejects a non-array outright, which is what a hand-edited row can produce', () => {
    expect(coerceFunctions('control' as unknown as string[])).toBeNull();
  });
});

describe('FUNCTION_OPTIONS', () => {
  it('offers every function exactly once, so the editor cannot omit one silently', () => {
    expect(FUNCTION_OPTIONS.map((o) => o.value)).toEqual([...DEVICE_FUNCTIONS]);
  });
});

describe('partitionByFunction', () => {
  const devices = [dev('co1', 'outlet_dual'), dev('l1', 'switch'), dev('mtr_lo_red', 'meter')];

  it('splits on the class defaults when nothing is configured', () => {
    const { included, excluded } = partitionByFunction(devices, {}, 'control');
    expect(included.map((d) => d.id)).toEqual(['co1', 'l1']);
    expect(excluded.map((d) => d.id)).toEqual(['mtr_lo_red']);
  });

  it('moves a device across the split when its own configuration says so', () => {
    const configs = { l1: withFunctions('l1', ['monitoring']) };
    const { included, excluded } = partitionByFunction(devices, configs, 'control');
    expect(included.map((d) => d.id)).toEqual(['co1']);
    expect(excluded.map((d) => d.id)).toEqual(['l1', 'mtr_lo_red']);
  });

  it('reports what it left out, so a page can say so instead of silently omitting devices', () => {
    const { excluded } = partitionByFunction(devices, {}, 'monitoring');
    expect(excluded.map((d) => d.id)).toEqual(['l1']);
  });

  it('preserves input order in both halves', () => {
    const { included } = partitionByFunction([...devices].reverse(), {}, 'control');
    expect(included.map((d) => d.id)).toEqual(['l1', 'co1']);
  });
});
