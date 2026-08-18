import { describe, it, expect } from 'vitest';
import { deviceConfigRowToModel, deviceConfigsToMap, deviceConfigToRow } from './supabaseDeviceConfig';

describe('deviceConfigRowToModel', () => {
  it('maps a full row to the model shape', () => {
    expect(
      deviceConfigRowToModel({
        device_id: 'co1',
        room: 'CARE Office',
        category: 'office_equipment',
        load_shed_group: 'never',
        display_name_override: 'Reception outlet',
        notes: 'near the front door',
      }),
    ).toEqual({
      deviceId: 'co1',
      room: 'CARE Office',
      category: 'office_equipment',
      loadShedGroup: 'never',
      displayNameOverride: 'Reception outlet',
      notes: 'near the front door',
    });
  });

  it('drops a category/load_shed_group value this UI has no option for, same as the pure coercers', () => {
    expect(
      deviceConfigRowToModel({
        device_id: 'co1',
        room: null,
        category: 'submarine',
        load_shed_group: 'group_9',
        display_name_override: null,
        notes: null,
      }),
    ).toMatchObject({ category: null, loadShedGroup: null });
  });
});

describe('deviceConfigsToMap', () => {
  it('keys the array by device id', () => {
    const map = deviceConfigsToMap([
      { device_id: 'co1', room: 'Lab', category: null, load_shed_group: null, display_name_override: null, notes: null },
      { device_id: 'l1', room: null, category: null, load_shed_group: null, display_name_override: null, notes: null },
    ]);
    expect(Object.keys(map).sort()).toEqual(['co1', 'l1']);
    expect(map.co1.room).toBe('Lab');
  });

  it('returns an empty map for no rows', () => {
    expect(deviceConfigsToMap([])).toEqual({});
  });
});

describe('deviceConfigToRow', () => {
  it('builds the upsert row, normalizing text and stamping the actor', () => {
    expect(
      deviceConfigToRow(
        { deviceId: 'co1', room: '  CARE Office  ', category: 'office_equipment', loadShedGroup: 'never', displayNameOverride: null, notes: '' },
        'user-1',
      ),
    ).toEqual({
      device_id: 'co1',
      room: 'CARE Office',
      category: 'office_equipment',
      load_shed_group: 'never',
      display_name_override: null,
      notes: null,
      updated_by: 'user-1',
    });
  });

  it('allows a null actor — break-glass sessions never reach this far, but the type must not lie', () => {
    expect(deviceConfigToRow({ deviceId: 'l1', room: null, category: null, loadShedGroup: null, displayNameOverride: null, notes: null }, null).updated_by).toBeNull();
  });
});
