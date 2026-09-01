import { describe, it, expect } from 'vitest';
import { deviceConfigRowToModel, deviceConfigsToMap, deviceConfigToRow } from './supabaseDeviceConfig';

describe('deviceConfigRowToModel', () => {
  it('maps a full row to the model shape', () => {
    expect(
      deviceConfigRowToModel({
        device_id: 'co1', functions: null,
        space_node_id: null,
        plan_x: null, plan_y: null,
        room: 'CARE Office',
        category: 'outlet',
        load_shed_group: 'never',
        display_name_override: 'Reception outlet',
        notes: 'near the front door',
      }),
    ).toEqual({
      deviceId: 'co1', functions: null,
      spaceNodeId: null,
      planX: null, planY: null, planFixtures: [],
      room: 'CARE Office',
      category: 'outlet',
      loadShedGroup: 'never',
      displayNameOverride: 'Reception outlet',
      notes: 'near the front door',
    });
  });

  it('drops a category/load_shed_group value this UI has no option for, same as the pure coercers', () => {
    expect(
      deviceConfigRowToModel({
        device_id: 'co1', functions: null,
        space_node_id: null,
        plan_x: null, plan_y: null,
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
      { device_id: 'co1', functions: null,
        space_node_id: null, room: 'Lab', category: null, load_shed_group: null, display_name_override: null, notes: null },
      { device_id: 'l1', functions: null,
        space_node_id: null, room: null, category: null, load_shed_group: null, display_name_override: null, notes: null },
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
        { deviceId: 'co1', functions: null,
      spaceNodeId: null, planX: null, planY: null, planFixtures: [], room: '  CARE Office  ', category: 'outlet', loadShedGroup: 'never', displayNameOverride: null, notes: '' },
        'user-1',
      ),
    ).toEqual({
      device_id: 'co1', functions: null,
        space_node_id: null,
      plan_x: null, plan_y: null, plan_fixtures: [],
      room: 'CARE Office',
      category: 'outlet',
      load_shed_group: 'never',
      display_name_override: null,
      notes: null,
      updated_by: 'user-1',
    });
  });

  it('allows a null actor — break-glass sessions never reach this far, but the type must not lie', () => {
    expect(deviceConfigToRow({ deviceId: 'l1', functions: null,
      spaceNodeId: null, planX: null, planY: null, planFixtures: [], room: null, category: null, loadShedGroup: null, displayNameOverride: null, notes: null }, null).updated_by).toBeNull();
  });
});

describe('plan position on the wire (RM-031)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    device_id: 'co1', functions: null, space_node_id: 'lab', plan_x: 0.25, plan_y: 0.75,
    room: null, category: null, load_shed_group: null, display_name_override: null, notes: null,
    ...over,
  });

  it('reads a stored position', () => {
    expect(deviceConfigRowToModel(row())).toMatchObject({ planX: 0.25, planY: 0.75 });
  });

  it('reads a numeric column that arrived as a string', () => {
    // MEASURED 2026-08-28: the live project returns `plan_x` as a JSON number, so this branch is
    // not load-bearing today. It stays because `count(*)` reached this codebase as a string and
    // `rowToNodeTotals` carries that scar — a silent null here would render every device as
    // unplaced and look exactly like a feature nobody finished.
    expect(deviceConfigRowToModel(row({ plan_x: '0.25', plan_y: '0.75' }))).toMatchObject({ planX: 0.25, planY: 0.75 });
  });

  it('reads a row from a deployment where the migration has not been applied', () => {
    expect(deviceConfigRowToModel(row({ plan_x: undefined, plan_y: undefined }))).toMatchObject({ planX: null, planY: null });
  });

  it('sends the position back on a write, so an unrelated edit cannot erase it', () => {
    // THE TRAP THIS EXISTS FOR. `writeDeviceConfig` upserts the WHOLE row. A device is dragged
    // into place; later someone edits its notes; the editor sends every column. A row builder
    // that did not carry the position would null it — from a screen that never mentioned the
    // plan, with no error and nothing to notice.
    const model = deviceConfigRowToModel(row());
    expect(deviceConfigToRow({ ...model, notes: 'checked the breaker' }, null)).toMatchObject({
      plan_x: 0.25,
      plan_y: 0.75,
      notes: 'checked the breaker',
    });
  });

  it('sends nothing rather than an invalid position', () => {
    const model = deviceConfigRowToModel(row({ plan_y: null }));
    expect(deviceConfigToRow(model, null)).toMatchObject({ plan_x: null, plan_y: null });
  });
});
