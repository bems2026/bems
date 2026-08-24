import { describe, it, expect } from 'vitest';
import { Plug, Lightbulb, Gauge, Snowflake, Thermometer } from 'lucide-react';
import {
  DEVICE_CLASS_CATALOG,
  DEVICE_CLASS_ORDER,
  classesWhere,
  analyticsGroups,
  ANALYTICS_GROUP_ORDER,
} from './deviceClassCatalog';
import type { DeviceClass } from './types';

const ALL: DeviceClass[] = ['outlet_dual', 'switch', 'meter', 'acu_ir', 'sensor_temp_humidity'];

describe('DEVICE_CLASS_CATALOG', () => {
  it('describes every device class, so a new class cannot be added without deciding how it behaves', () => {
    expect(Object.keys(DEVICE_CLASS_CATALOG).sort()).toEqual([...ALL].sort());
  });

  it('orders classes for display without omitting or inventing one', () => {
    expect([...DEVICE_CLASS_ORDER].sort()).toEqual([...ALL].sort());
  });
});

/**
 * Characterization tests. Each block below is the literal table this catalog replaces, copied
 * from its old home. They exist to prove the consolidation changed no behaviour — if a value
 * here has to be edited to make the suite pass, the refactor moved something it should not
 * have.
 */
describe('preserves the tables it replaces', () => {
  it('matches DevicesView.CLASS_FILTER_LABEL', () => {
    const was = {
      outlet_dual: 'Outlets',
      switch: 'Lighting Switches',
      meter: 'Branch Meters',
      acu_ir: 'Air Conditioning',
      sensor_temp_humidity: 'Sensors',
    };
    for (const c of ALL) expect(DEVICE_CLASS_CATALOG[c].label).toBe(was[c]);
  });

  it('matches DevicesView.CLASS_PILL_LABEL', () => {
    const was = { outlet_dual: 'outlet', switch: 'switch', meter: 'meter', acu_ir: 'aircon', sensor_temp_humidity: 'sensor' };
    for (const c of ALL) expect(DEVICE_CLASS_CATALOG[c].pill).toBe(was[c]);
  });

  it('matches DevicesView.CLASS_ORDER', () => {
    expect(DEVICE_CLASS_ORDER).toEqual(['outlet_dual', 'switch', 'meter', 'acu_ir', 'sensor_temp_humidity']);
  });

  it('matches deviceIcons.CLASS_ICON', () => {
    const was = { outlet_dual: Plug, switch: Lightbulb, meter: Gauge, acu_ir: Snowflake, sensor_temp_humidity: Thermometer };
    for (const c of ALL) expect(DEVICE_CLASS_CATALOG[c].icon).toBe(was[c]);
  });

  it('matches deviceClass.SWITCHABLE_CLASSES', () => {
    expect(classesWhere('switchable').sort()).toEqual(['acu_ir', 'outlet_dual', 'switch']);
  });

  it('matches the Analytics branches/outlets split, which was a hardcoded union', () => {
    expect(analyticsGroups()).toEqual(['branches', 'outlets']);
    expect(classesWhere('metered').sort()).toEqual(['meter', 'outlet_dual']);
    expect(DEVICE_CLASS_CATALOG.meter.analyticsGroup).toBe('branches');
    expect(DEVICE_CLASS_CATALOG.outlet_dual.analyticsGroup).toBe('outlets');
  });
});

describe('the properties that make a class self-describing', () => {
  it('gives a metered class an analytics group and an unmetered class none', () => {
    for (const c of ALL) {
      const spec = DEVICE_CLASS_CATALOG[c];
      expect(spec.metered).toBe(spec.analyticsGroup !== null);
    }
  });

  it('never marks a class both switchable and a pure sensor — a meter has nothing to switch', () => {
    expect(DEVICE_CLASS_CATALOG.meter.switchable).toBe(false);
    expect(DEVICE_CLASS_CATALOG.sensor_temp_humidity.switchable).toBe(false);
  });
});

describe('ANALYTICS_GROUP_ORDER', () => {
  it('covers every group a class claims, so the two cannot drift apart', () => {
    const claimed = ALL.map((c) => DEVICE_CLASS_CATALOG[c].analyticsGroup).filter((g): g is string => g !== null);
    for (const g of claimed) expect(ANALYTICS_GROUP_ORDER).toContain(g);
  });
});
