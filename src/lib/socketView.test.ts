import { describe, it, expect } from 'vitest';
import { controlView, isCommandable } from './socketView';
import type { PendingCommand } from '@/stores/commandStore';
import type { Reading } from './types';

const pending = (overrides: Partial<PendingCommand>): PendingCommand => ({
  command_id: 'x',
  device_id: 'co3',
  socket: 1,
  desired: 'on',
  observedBefore: 'off',
  phase: 'sending',
  issuedAt: Date.now(),
  ackedAt: null,
  error: null,
  ...overrides,
});

const reading = (socket_states: { 1: 'on' | 'off'; 2: 'on' | 'off' } | undefined): Reading => ({
  device_id: 'co3',
  ts: new Date().toISOString(),
  online: true,
  state: socket_states?.[1] === 'on' || socket_states?.[2] === 'on' ? 'on' : 'off',
  socket_states,
});

describe('controlView', () => {
  it('is unknown with no reading and nothing pending', () => {
    expect(controlView(undefined, undefined, 1)).toEqual({ kind: 'unknown' });
  });

  it('is idle, showing the feed value, when nothing is pending', () => {
    expect(controlView(reading({ 1: 'on', 2: 'off' }), undefined, 1)).toEqual({ kind: 'idle', value: 'on' });
    expect(controlView(reading({ 1: 'on', 2: 'off' }), undefined, 2)).toEqual({ kind: 'idle', value: 'off' });
  });

  it('reads device-level state (no socket) for a switch/acu_ir target', () => {
    const r: Reading = { device_id: 'l1', ts: '', online: true, state: 'on' };
    expect(controlView(r, undefined, undefined)).toEqual({ kind: 'idle', value: 'on' });
  });

  it('is pending and shows the desired value while a command is in flight', () => {
    const p = pending({ phase: 'sending', desired: 'on', observedBefore: 'off' });
    expect(controlView(reading({ 1: 'off', 2: 'off' }), p, 1)).toEqual({ kind: 'pending', value: 'on', from: 'off' });
  });

  it('is pending during confirming too, not just sending', () => {
    const p = pending({ phase: 'confirming', desired: 'on' });
    expect(controlView(reading({ 1: 'off', 2: 'off' }), p, 1).kind).toBe('pending');
  });

  it('is failed and shows the FEED value (the truth), not the desired one — rollback is automatic', () => {
    const p = pending({ phase: 'failed', desired: 'on', error: 'The device did not report the new state.' });
    // Feed still says off — the command never landed.
    expect(controlView(reading({ 1: 'off', 2: 'off' }), p, 1)).toEqual({
      kind: 'failed',
      value: 'off',
      desired: 'on',
      error: 'The device did not report the new state.',
    });
  });

  it('a failed command with no reading at all falls back to a null value, not unknown', () => {
    const p = pending({ phase: 'failed', desired: 'on', error: 'boom' });
    expect(controlView(undefined, p, 1)).toEqual({ kind: 'failed', value: null, desired: 'on', error: 'boom' });
  });
});

/**
 * Reported on site 2026-08-24: outlets could not be switched at all. Their controls were
 * disabled whenever the reading was stale, and because nothing polls an outlet (FI-013) the
 * reading is stale almost always — so an outlet only became operable in the seconds after it
 * happened to push a change. Lights were unaffected only because they report continuously.
 *
 * Freshness of a measurement and reachability of a device are different facts travelling
 * different paths: telemetry arrives from the device, a command goes out through the proxy
 * and the bridge. `IrCommandCenterCard` already refused to conflate them.
 */
describe('isCommandable', () => {
  const at = (online: boolean): Reading => ({
    device_id: 'co1',
    ts: new Date(0).toISOString(),
    state: 'off',
    online,
  });

  it('allows a command to a device the bridge still calls online, however old the reading', () => {
    expect(isCommandable(at(true))).toBe(true);
  });

  it('refuses a command to a device the bridge reports offline — the dispatch would not land', () => {
    expect(isCommandable(at(false))).toBe(false);
  });


  it('allows a command before any reading has arrived — `controlView` reports unknown, and that is what gates the toggle', () => {
    expect(isCommandable(undefined)).toBe(true);
  });
});
