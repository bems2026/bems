import { describe, it, expect } from 'vitest';
import { AC_MODES, AC_FANS, LOCAL_LIBRARY_STATE } from '@shared/acState.mjs';
import { AC_MODE_OPTIONS, AC_FAN_OPTIONS, seedDraft, draftSummary, commandedSummary, dispatchPathFor } from './acControl';
import type { Reading } from '@/lib/types';

/**
 * The aircon panel's decisions, kept out of the card — the split `setpointOptions.ts` and
 * `dispatchScope.ts` already make.
 *
 * The one worth reading is `dispatchPathFor`: the panel says where a state will go BEFORE Send, and
 * refuses to offer a Send that has nowhere to go. A state the local IR library cannot express needs
 * the vendor cloud; on a site with no cloud route (or a lapsed subscription) the honest control is a
 * disabled one with the reason, not a button that fails after the operator has walked to the unit.
 */

const reading = (over: Partial<Reading> = {}): Reading =>
  ({ device_id: 'acu_main', ts: '2026-09-17T15:00:00+08:00', online: true, state: 'on', ...over }) as Reading;

describe('options', () => {
  it('offers every mode and fan speed the contract accepts, in vendor order', () => {
    expect(AC_MODE_OPTIONS.map((o) => o.value)).toEqual([...AC_MODES]);
    expect(AC_FAN_OPTIONS.map((o) => o.value)).toEqual([...AC_FANS]);
  });
});

describe('seedDraft', () => {
  it('opens on the last COMMANDED state, so the panel shows what the unit was told', () => {
    expect(seedDraft(reading({ setpoint_c: 22, ac_mode: 'dry', ac_fan: 'high', ac_swing: true }))).toEqual({
      mode: 'dry', setpoint_c: 22, fan: 'high', swing: true,
    });
  });

  it('falls back to the defaults with no history', () => {
    expect(seedDraft(undefined)).toEqual({ mode: 'cool', setpoint_c: 25, fan: 'auto', swing: false });
  });
});

describe('summaries', () => {
  it('reads a draft the way the confirm dialog and the button say it', () => {
    expect(draftSummary({ mode: 'dry', setpoint_c: 22, fan: 'high', swing: true })).toBe('Dry · 22 °C · fan high · swing on');
  });

  it('describes what was last sent, or says nothing has been', () => {
    expect(commandedSummary(reading({ state: 'on', setpoint_c: 24, ac_mode: 'cool', ac_fan: 'auto', ac_swing: false }))).toBe('Cool · 24 °C · fan auto · swing off');
    expect(commandedSummary(reading({ state: 'off', setpoint_c: 24 }))).toBe('Off');
    expect(commandedSummary(reading({ state: 'on', setpoint_c: undefined }))).toBeNull();
    expect(commandedSummary(undefined)).toBeNull();
  });
});

describe('dispatchPathFor', () => {
  const library = { ...LOCAL_LIBRARY_STATE, setpoint_c: 24 };
  const dry = { mode: 'dry' as const, setpoint_c: 24, fan: 'high' as const, swing: true };

  it('a state the local library holds goes over the LAN once the library is verified', () => {
    expect(dispatchPathFor(library, { cloud: 'ready', verified: true })).toEqual({ via: 'local' });
  });

  it('while unverified, it goes through the cloud first when the cloud is ready', () => {
    expect(dispatchPathFor(library, { cloud: 'ready', verified: false })).toEqual({ via: 'cloud' });
  });

  it('while unverified with no cloud, the local library is still the path — with nothing better', () => {
    expect(dispatchPathFor(library, { cloud: 'unresolved', verified: false })).toEqual({ via: 'local' });
  });

  it('a state only the cloud can express goes through the cloud when it is ready', () => {
    expect(dispatchPathFor(dry, { cloud: 'ready', verified: true })).toEqual({ via: 'cloud' });
  });

  it('a state only the cloud can express, with no cloud, is blocked with the reason', () => {
    const blocked = dispatchPathFor(dry, { cloud: 'unresolved', verified: true });
    expect('blocked' in blocked && blocked.blocked).toMatch(/vendor cloud is not answering/);
    const localOnly = dispatchPathFor(dry, { cloud: 'local-only', verified: true });
    expect('blocked' in localOnly && localOnly.blocked).toMatch(/local-only/);
    const none = dispatchPathFor(dry, { cloud: 'unconfigured', verified: true });
    expect('blocked' in none && none.blocked).toMatch(/not configured/);
  });

  it('a proxy that has not said is treated as no cloud, never as a ready one', () => {
    const r = dispatchPathFor(dry, { cloud: null, verified: null });
    expect('blocked' in r).toBe(true);
  });
});
