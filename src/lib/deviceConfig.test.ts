import { describe, it, expect } from 'vitest';
import {
  emptyDeviceConfig,
  normalizeDeviceConfig,
  isSameConfig,
  coerceCategory,
  coerceLoadShedGroup,
  resolveDisplayName,
  resolveRoom,
  effectiveConfig,
  metaSummary,
  knownRooms,
  type DeviceConfig,
} from './deviceConfig';
import type { Device } from './types';

const cfg = (over: Partial<DeviceConfig> = {}): DeviceConfig => ({ ...emptyDeviceConfig('co1'), ...over });
const dev = (over: Partial<Device> = {}): Device => ({
  id: 'co1',
  display_name: 'Outlet 1',
  class: 'outlet_dual',
  room: null,
  dps_map: 'type_b',
  status: 'active',
  ...over,
});

describe('normalizeDeviceConfig', () => {
  it('trims text fields', () => {
    expect(normalizeDeviceConfig(cfg({ room: '  Lab 2  ', notes: ' check breaker ' }))).toMatchObject({ room: 'Lab 2', notes: 'check breaker' });
  });

  it('collapses a cleared box to null, so "cleared" and "never set" are the same row state', () => {
    expect(normalizeDeviceConfig(cfg({ room: '', displayNameOverride: '   ' }))).toMatchObject({ room: null, displayNameOverride: null });
  });

  it('drops an enum value this UI has no option for rather than sending it to a CHECK constraint', () => {
    expect(normalizeDeviceConfig(cfg({ category: 'plasma' as never, loadShedGroup: 'group_9' as never }))).toMatchObject({ category: null, loadShedGroup: null });
  });

  it('keeps the device id', () => {
    expect(normalizeDeviceConfig(cfg()).deviceId).toBe('co1');
  });
});

describe('coerceCategory / coerceLoadShedGroup', () => {
  it('passes through the values the database CHECK accepts', () => {
    expect(coerceCategory('office_equipment')).toBe('office_equipment');
    expect(coerceLoadShedGroup('never')).toBe('never');
  });
  it('maps null and unknown alike to null', () => {
    expect(coerceCategory(null)).toBeNull();
    expect(coerceCategory('Lighting')).toBeNull(); // case matters — the column stores lowercase
    expect(coerceLoadShedGroup('')).toBeNull();
  });
});

describe('isSameConfig', () => {
  it('ignores deviceId and compares only the five editable fields', () => {
    expect(isSameConfig(cfg({ room: 'Lab 2' }), { ...cfg({ room: 'Lab 2' }), deviceId: 'l1' })).toBe(true);
  });
  it('sees a single changed field', () => {
    expect(isSameConfig(cfg({ notes: 'a' }), cfg({ notes: 'b' }))).toBe(false);
  });
});

describe('resolveDisplayName', () => {
  it('prefers the override', () => {
    expect(resolveDisplayName(dev(), cfg({ displayNameOverride: 'Reception outlet' }))).toBe('Reception outlet');
  });
  it('falls back to the registry name with no config at all, and with an empty override', () => {
    expect(resolveDisplayName(dev(), undefined)).toBe('Outlet 1');
    expect(resolveDisplayName(dev(), cfg())).toBe('Outlet 1');
  });
});

describe('resolveRoom', () => {
  it('lets the operator-recorded room win over the registry field', () => {
    expect(resolveRoom(dev({ room: 'Old Room' }), cfg({ room: 'CARE Office' }))).toBe('CARE Office');
  });
  it('still shows a registry room if one ever appears there', () => {
    expect(resolveRoom(dev({ room: 'Old Room' }), cfg())).toBe('Old Room');
  });
  it('is null when neither source has one — every device today', () => {
    expect(resolveRoom(dev(), undefined)).toBeNull();
  });
});

describe('effectiveConfig', () => {
  it('prefers a draft, then the saved row, then an empty config', () => {
    const saved = { co1: cfg({ room: 'Saved' }) };
    const draft = { co1: cfg({ room: 'Draft' }) };
    expect(effectiveConfig(draft, saved, 'co1').room).toBe('Draft');
    expect(effectiveConfig({}, saved, 'co1').room).toBe('Saved');
    expect(effectiveConfig({}, {}, 'l1')).toEqual(emptyDeviceConfig('l1'));
  });
});

describe('metaSummary', () => {
  it('joins only the parts that are recorded', () => {
    expect(metaSummary(cfg({ room: 'CARE Office', category: 'lighting' }))).toBe('CARE Office · Lighting');
    expect(metaSummary(cfg({ loadShedGroup: 'never' }))).toBe('Protected');
  });
  it('is empty when nothing is recorded, so 22 rows do not each grow a line of em-dashes', () => {
    expect(metaSummary(cfg())).toBe('');
    expect(metaSummary(undefined)).toBe('');
  });
});

describe('knownRooms', () => {
  it('lists each recorded room once, sorted, ignoring devices with none', () => {
    expect(knownRooms({ co1: cfg({ room: 'Lab 2' }), l1: cfg({ room: 'CARE Office' }), l2: cfg({ room: 'Lab 2' }), l3: cfg() })).toEqual(['CARE Office', 'Lab 2']);
  });
});
