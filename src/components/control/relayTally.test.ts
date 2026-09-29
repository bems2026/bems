import { describe, it, expect } from 'vitest';
import { tallyRelays, tallyText } from './relayTally';
import type { PendingCommand } from '@/stores/commandStore';
import type { Device, Reading, SwitchState } from '@/lib/types';

const sw = (id: string): Device => ({ id, display_name: id, class: 'switch', room: null, dps_map: null, status: 'active' });
const outlet = (id: string): Device => ({ id, display_name: id, class: 'outlet_dual', room: null, dps_map: 'type_b', status: 'active' });
/** Built field by field, not by spreading a `Partial<Reading>`: under `exactOptionalPropertyTypes`
 * a spread partial can carry an explicit `undefined`, which `Reading` refuses. */
const reading = (id: string, f: { state?: SwitchState; online?: boolean; socket_states?: Reading['socket_states'] } = {}): Reading => {
  const r: Reading = { device_id: id, ts: '2026-09-29T08:00:00+08:00', online: f.online ?? true, state: f.state ?? null };
  if (f.socket_states) r.socket_states = f.socket_states;
  return r;
};
const pending = (device_id: string, desired: 'on' | 'off', socket?: 1 | 2): PendingCommand => ({
  command_id: 'c',
  device_id,
  socket,
  desired,
  observedBefore: desired === 'on' ? 'off' : 'on',
  phase: 'sending',
  issuedAt: 0,
  ackedAt: null,
  error: null,
});

describe('tallyRelays', () => {
  it('counts whole-device relays as on, off, or unavailable', () => {
    const t = tallyRelays(
      [sw('l1'), sw('l2'), sw('l3')],
      { l1: reading('l1', { state: 'on' }), l2: reading('l2', { state: 'off' }) },
      {},
    );
    expect(t).toEqual({ on: 1, off: 1, unavailable: 1, total: 3 });
  });

  it('counts each socket of a dual outlet on its own', () => {
    const t = tallyRelays([outlet('co1'), outlet('co2')], { co1: reading('co1', { socket_states: { 1: 'on', 2: 'off' } }) }, {}, [1, 2]);
    expect(t).toEqual({ on: 1, off: 1, unavailable: 2, total: 4 });
  });

  // The same derivation the toggles use (`useRelayState`): a command in flight shows its desired
  // value, so the count and the lamp beside it can never disagree while a relay is switching.
  it('counts a relay that is switching as the state it was asked for', () => {
    const t = tallyRelays([sw('l1')], { l1: reading('l1', { state: 'off' }) }, { l1: pending('l1', 'on') });
    expect(t.on).toBe(1);
  });

  // An offline device still carries its last state, but nobody can switch it: counting it as "on"
  // or "off" would promise a control the page refuses.
  it('counts a device the bridge reports offline as unavailable, whatever its last state', () => {
    const t = tallyRelays([sw('l1')], { l1: reading('l1', { state: 'on', online: false }) }, {});
    expect(t).toEqual({ on: 0, off: 0, unavailable: 1, total: 1 });
  });
});

describe('tallyText', () => {
  it('says how many are on, and names the unavailable only when there are some', () => {
    expect(tallyText({ on: 2, off: 5, unavailable: 0, total: 7 })).toBe('2 of 7 on');
    expect(tallyText({ on: 1, off: 1, unavailable: 1, total: 3 })).toBe('1 of 3 on · 1 unavailable');
    expect(tallyText({ on: 10, off: 4, unavailable: 0, total: 14 }, 'sockets')).toBe('10 of 14 sockets on');
  });
});
