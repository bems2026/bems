import { describe, it, expect } from 'vitest';
import { fleetById, EMPTY_FLEET, type CloudDevice } from './tuyaFleet';

describe('fleetById', () => {
  it('keys devices by their Tuya id — the one identifier both sides share', () => {
    const map = fleetById([
      { id: 'a1', name: 'CO1', online: true },
      { id: 'b2', name: 'L1', online: false },
    ]);
    expect(Object.keys(map).sort()).toEqual(['a1', 'b2']);
    expect(map.a1.online).toBe(true);
  });

  it('skips an entry with no id rather than creating an undefined key', () => {
    const map = fleetById([{ name: 'nameless' } as CloudDevice, { id: 'a1', name: 'CO1' }]);
    expect(Object.keys(map)).toEqual(['a1']);
  });

  it('handles an empty fleet', () => {
    expect(fleetById([])).toEqual({});
  });
});

describe('EMPTY_FLEET', () => {
  it('starts as loading, not as ready-and-empty', () => {
    // Ready-and-empty would render "no cloud device" against every row while the request is
    // still in flight, which is a claim rather than a waiting state.
    expect(EMPTY_FLEET.status).toBe('loading');
    expect(EMPTY_FLEET.byId).toEqual({});
  });
});
