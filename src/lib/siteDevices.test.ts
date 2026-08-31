import { describe, it, expect } from 'vitest';
import { devicesOfClass, primaryOfClass } from './siteDevices';
import type { Device } from './types';

const dev = (id: string, cls: Device['class']): Device => ({
  id,
  display_name: id.toUpperCase(),
  class: cls,
  room: null,
  dps_map: null,
  status: 'active',
});

/** Ids this building does not use, so a test passing here says nothing about that building. */
const fleet: Device[] = [
  dev('sw10', 'switch'),
  dev('sw2', 'switch'),
  dev('cooler', 'acu_ir'),
  dev('probe', 'sensor_temp_humidity'),
  dev('ct-main', 'meter'),
];

describe('devicesOfClass', () => {
  it('returns every device of the class', () => {
    expect(devicesOfClass(fleet, 'switch').map((d) => d.id)).toEqual(['sw2', 'sw10']);
  });

  it('sorts numerically, so l2 comes before l10', () => {
    // A plain string sort puts `sw10` before `sw2`, which would make "the first lighting
    // circuit" the tenth one at any site with more than nine.
    expect(devicesOfClass(fleet, 'switch').map((d) => d.id)).toEqual(['sw2', 'sw10']);
  });

  it('returns an empty list rather than throwing for a class the site has none of', () => {
    expect(devicesOfClass(fleet, 'outlet_dual')).toEqual([]);
  });
});

describe('primaryOfClass', () => {
  it('finds the site aircon without knowing what it is called', () => {
    expect(primaryOfClass(fleet, 'acu_ir')?.id).toBe('cooler');
  });

  it('returns null when the site has no such device', () => {
    // Callers must render this state. A site with no aircon should show no aircon control,
    // not a button that sends a command to nothing.
    expect(primaryOfClass(fleet, 'outlet_dual')).toBeNull();
  });

  it('picks the first by id, not the first in the array', () => {
    expect(primaryOfClass(fleet, 'switch')?.id).toBe('sw2');
  });
});
