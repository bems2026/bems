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
  placementLabel,
  recordedRoomLabels,
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
    expect(coerceCategory('branch_circuit')).toBe('branch_circuit');
    expect(coerceLoadShedGroup('never')).toBe('never');
  });
  it('maps null and unknown alike to null', () => {
    expect(coerceCategory(null)).toBeNull();
    expect(coerceCategory('Lighting')).toBeNull(); // case matters — the column stores lowercase
    expect(coerceLoadShedGroup('')).toBeNull();
  });
  it('drops the values phase 14 retired, so a row written before it reads as uncategorised', () => {
    // A row can still hold one of these if the migration has not been applied to a given
    // project yet. Rendering it would put an option in the <select> that the CHECK now
    // rejects, so the next save would 400 on a field the operator never touched.
    for (const retired of ['hvac', 'office_equipment', 'kitchen']) {
      expect(coerceCategory(retired)).toBeNull();
    }
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

/**
 * RM-028 — placement in the space tree replaces the free-text room.
 *
 * `room` is KEPT rather than dropped: it is the label a site still shows before anyone has
 * built a tree, and dropping a column holding real operator input is not reversible by
 * re-running a migration. What changes is precedence — the tree wins where it says anything.
 */
describe('recordedRoomLabels', () => {
  it('still lists the rooms operators have already typed', () => {
    // TRANSITIONAL, and the reason it survives the cut to the tree: the live site has room text
    // in device_config and no tree yet, so sourcing the datalist from the tree alone would take
    // away every existing suggestion during exactly the window they are needed.
    expect(recordedRoomLabels({ co1: cfg({ room: 'Lab 2' }), l1: cfg({ room: 'CARE Office' }), l2: cfg({ room: 'Lab 2' }), l3: cfg() }))
      .toEqual(['CARE Office', 'Lab 2']);
  });

  it('is empty once nobody has typed one', () => {
    expect(recordedRoomLabels({ l3: cfg() })).toEqual([]);
  });
});

describe('space placement', () => {
  const NODES = [
    { id: 'b', site_id: 's', parent_id: null, kind: 'building' as const, name: 'NBERIC', sort_order: 0, attrs: {} },
    { id: 'r', site_id: 's', parent_id: 'b', kind: 'room' as const, name: 'CARE Office', sort_order: 0, attrs: {} },
  ];

  it('a fresh config is unplaced', () => {
    expect(emptyDeviceConfig('co1').spaceNodeId).toBeNull();
  });

  it('placement counts as an edit, so the Save button appears for it', () => {
    expect(isSameConfig(cfg(), cfg({ spaceNodeId: 'r' }))).toBe(false);
  });

  it('an empty string from a cleared <select> normalises to null, not to ""', () => {
    expect(normalizeDeviceConfig(cfg({ spaceNodeId: '' })).spaceNodeId).toBeNull();
  });

  it('the tree path wins over the typed room when a device is placed', () => {
    expect(placementLabel(dev(), cfg({ spaceNodeId: 'r', room: 'Old Text' }), NODES)).toBe('NBERIC / CARE Office');
  });

  it('falls back to the typed room when the device is not placed', () => {
    expect(placementLabel(dev(), cfg({ room: 'Lab 2' }), NODES)).toBe('Lab 2');
  });

  it('falls back to the typed room when the node is gone, rather than showing nothing', () => {
    // on delete set null clears the placement server-side, but a stale draft or an in-flight
    // delete can leave an id pointing at a node this client no longer has.
    expect(placementLabel(dev(), cfg({ spaceNodeId: 'vanished', room: 'Lab 2' }), NODES)).toBe('Lab 2');
  });

  it('is empty when neither is recorded, so a caller can render nothing at all', () => {
    expect(placementLabel(dev({ room: null }), cfg(), NODES)).toBe('');
  });
});
