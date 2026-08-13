import { describe, it, expect, afterEach } from 'vitest';
import { ROOM } from './geometry';
import { clampToRoom, pastePosition, nextRotation, isValidEditableItem, parseLayoutJson, loadLayout, saveLayout, clearSavedLayout, LAYOUT_STORAGE_KEY, exportLayoutFilename, newItemId, type EditableItem } from './editableLayout';

afterEach(() => window.localStorage.clear());

const item = (over: Partial<EditableItem> = {}): EditableItem => ({ id: 'a', kind: 'desk', x: 0, z: 0, ry: 0, ...over });

describe('clampToRoom', () => {
  it('leaves an already-clear point untouched', () => {
    expect(clampToRoom(0, 0)).toEqual({ x: 0, z: 0 });
  });

  it('pulls a point outside the room back to the wall margin', () => {
    const { x } = clampToRoom(ROOM.minX - 5, 0);
    expect(x).toBeGreaterThan(ROOM.minX);
    expect(x).toBeLessThan(0);
  });

  it('clamps independently on each axis', () => {
    const p = clampToRoom(ROOM.maxX + 5, ROOM.minZ - 5);
    expect(p.x).toBeLessThan(ROOM.maxX);
    expect(p.z).toBeGreaterThan(ROOM.minZ);
  });
});

describe('pastePosition', () => {
  it('offsets away from the source point', () => {
    const p = pastePosition({ x: 0, z: 0 });
    expect(p.x).toBeGreaterThan(0);
    expect(p.z).toBeGreaterThan(0);
  });

  it('still lands inside the room when the source is already against a wall', () => {
    const p = pastePosition({ x: ROOM.maxX - 0.1, z: ROOM.maxZ - 0.1 });
    expect(p.x).toBeLessThan(ROOM.maxX);
    expect(p.z).toBeLessThan(ROOM.maxZ);
  });
});

describe('isValidEditableItem', () => {
  it('accepts a well-formed item', () => {
    expect(isValidEditableItem(item())).toBe(true);
  });

  it.each(['desk', 'table', 'dispenser', 'shelf', 'bench'])('accepts kind %s', (kind) => {
    expect(isValidEditableItem(item({ kind: kind as EditableItem['kind'] }))).toBe(true);
  });

  it.each([
    ['not an object', 'nope'],
    ['null', null],
    ['missing id', { kind: 'desk', x: 0, z: 0, ry: 0 }],
    ['empty id', { id: '', kind: 'desk', x: 0, z: 0, ry: 0 }],
    ['bad kind', { id: 'a', kind: 'sofa', x: 0, z: 0, ry: 0 }],
    ['non-numeric x', { id: 'a', kind: 'desk', x: '0', z: 0, ry: 0 }],
    ['NaN z', { id: 'a', kind: 'desk', x: 0, z: NaN, ry: 0 }],
    ['Infinity ry', { id: 'a', kind: 'desk', x: 0, z: 0, ry: Infinity }],
  ])('rejects %s', (_label, value) => {
    expect(isValidEditableItem(value)).toBe(false);
  });
});

describe('nextRotation', () => {
  it('advances by 45 degrees', () => {
    expect(nextRotation(0)).toBeCloseTo(Math.PI / 4, 10);
  });

  it('wraps back to (near) zero after a full turn', () => {
    let ry = 0;
    for (let i = 0; i < 8; i++) ry = nextRotation(ry);
    expect(ry).toBeCloseTo(0, 10);
  });

  it('never returns a negative or >=2π value, including from an already-large ry', () => {
    const ry = nextRotation(100);
    expect(ry).toBeGreaterThanOrEqual(0);
    expect(ry).toBeLessThan(Math.PI * 2);
  });
});

describe('parseLayoutJson', () => {
  it('parses a valid array', () => {
    const parsed = parseLayoutJson(JSON.stringify([item({ id: 'a' }), item({ id: 'b', kind: 'table' })]));
    expect(parsed).toHaveLength(2);
    expect(parsed?.[1].kind).toBe('table');
  });

  it('rejects malformed JSON rather than throwing', () => {
    expect(parseLayoutJson('{not json')).toBeNull();
  });

  it('rejects a JSON value that is not an array', () => {
    expect(parseLayoutJson(JSON.stringify(item()))).toBeNull();
  });

  it('rejects the whole payload if even one item is invalid, rather than dropping just that row', () => {
    expect(parseLayoutJson(JSON.stringify([item({ id: 'a' }), { id: 'b', kind: 'sofa', x: 0, z: 0, ry: 0 }]))).toBeNull();
  });
});

describe('loadLayout / saveLayout / clearSavedLayout', () => {
  it('round-trips through localStorage', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', kind: 'table', x: 1, z: 2, ry: 1.5 })];
    expect(saveLayout(items)).toBe(true);
    expect(loadLayout()).toEqual(items);
  });

  it('returns an empty layout when nothing has been saved yet', () => {
    expect(loadLayout()).toEqual([]);
  });

  it('drops corrupted storage instead of surfacing it as a crash', () => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, 'not json at all');
    expect(loadLayout()).toEqual([]);
  });

  it('clearSavedLayout removes the key so a later load starts empty', () => {
    saveLayout([item()]);
    clearSavedLayout();
    expect(loadLayout()).toEqual([]);
  });
});

describe('newItemId', () => {
  it('never returns the same id twice in a row', () => {
    const ids = Array.from({ length: 20 }, () => newItemId());
    expect(new Set(ids).size).toBe(20);
  });
});

describe('exportLayoutFilename', () => {
  it('embeds the date so successive exports do not silently overwrite each other by name', () => {
    expect(exportLayoutFilename(new Date('2026-08-13T10:00:00Z'))).toBe('ibems-layout-2026-08-13.json');
  });
});
