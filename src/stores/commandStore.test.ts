import { describe, it, expect, vi, afterEach } from 'vitest';
import { useCommandStore, targetKey } from './commandStore';
import { useDeviceStore } from './deviceStore';
import { BridgeFetchError } from '@/lib/bridgeClient';
import * as bridgeClient from '@/lib/bridgeClient';
import type { CommandAck, Reading } from '@/lib/types';

vi.mock('@/lib/bridgeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bridgeClient')>();
  return { ...actual, sendCommand: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
  useCommandStore.setState({ pending: {}, cloudRecoveries: {} });
  useDeviceStore.setState({ devices: [], latestReadings: {}, totals: null, history: {} });
});

const co3on: Reading = { device_id: 'co3', ts: new Date().toISOString(), online: true, state: 'on', socket_states: { 1: 'off', 2: 'off' } };

describe('targetKey', () => {
  it('keys a socket target as device:socket', () => {
    expect(targetKey('co3', 1)).toBe('co3:1');
  });
  it('keys a whole-device target (no socket) as the bare device id', () => {
    expect(targetKey('l1', undefined)).toBe('l1');
  });
});

describe('useCommandStore.send', () => {
  it('goes sending -> confirming on a successful ack', async () => {
    useDeviceStore.setState({ latestReadings: { co3: co3on } });
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue({
      command_id: 'x', device_id: 'co3', socket: 1, action: 'on', target: 'CO3_1',
      accepted_at: '', confirmed: false, confirmation: 'none', note: '',
    });

    const promise = useCommandStore.getState().send('co3', 1, 'on');
    expect(useCommandStore.getState().pending['co3:1'].phase).toBe('sending');
    expect(useCommandStore.getState().pending['co3:1'].observedBefore).toBe('off'); // read from the feed at send-time

    await promise;
    expect(useCommandStore.getState().pending['co3:1'].phase).toBe('confirming');
    expect(useCommandStore.getState().pending['co3:1'].ackedAt).not.toBeNull();
  });

  it('goes sending -> failed with a readable message on a bridge rejection', async () => {
    vi.mocked(bridgeClient.sendCommand).mockRejectedValue(new BridgeFetchError('HTTP 400: bad', 400, 'invalid_socket'));
    await useCommandStore.getState().send('co3', 1, 'on');
    const p = useCommandStore.getState().pending['co3:1'];
    expect(p.phase).toBe('failed');
    expect(p.error).toMatch(/misconfigured/);
  });

  it('a network-level failure (not a BridgeFetchError) gets a generic message', async () => {
    vi.mocked(bridgeClient.sendCommand).mockRejectedValue(new Error('network down'));
    await useCommandStore.getState().send('l1', undefined, 'on');
    expect(useCommandStore.getState().pending['l1'].error).toBe('The command could not be sent.');
  });

  it('a superseding second command for the same target wins — the first ack is dropped', async () => {
    let resolveFirst!: (v: CommandAck) => void;
    vi.mocked(bridgeClient.sendCommand)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({
        command_id: 'second', device_id: 'co3', socket: 1, action: 'off', target: 'CO3_1',
        accepted_at: '', confirmed: false, confirmation: 'none', note: '',
      });

    const first = useCommandStore.getState().send('co3', 1, 'on');
    const second = useCommandStore.getState().send('co3', 1, 'off'); // supersedes before the first resolves
    await second;
    expect(useCommandStore.getState().pending['co3:1'].desired).toBe('off');

    resolveFirst({ command_id: 'first', device_id: 'co3', socket: 1, action: 'on', target: 'CO3_1', accepted_at: '', confirmed: false, confirmation: 'none', note: '' });
    await first;
    // The stale first ack must not clobber the second command's pending entry.
    expect(useCommandStore.getState().pending['co3:1'].desired).toBe('off');
  });
});

describe('useCommandStore.reconcile', () => {
  const row = (device_id: string, socket_states: { 1: 'on' | 'off'; 2: 'on' | 'off' }): Reading => ({
    device_id, ts: new Date().toISOString(), online: true,
    state: socket_states[1] === 'on' || socket_states[2] === 'on' ? 'on' : 'off',
    socket_states,
  });

  it('drops the pending entry once the feed agrees with the desired value', () => {
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'confirming', issuedAt: 1000, ackedAt: 1100, error: null } },
    });
    useCommandStore.getState().reconcile([row('co3', { 1: 'on', 2: 'off' })], 2000);
    expect(useCommandStore.getState().pending['co3:1']).toBeUndefined();
  });

  it('holds a pending command that has not been acked yet, even if the feed disagrees', () => {
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'sending', issuedAt: 1000, ackedAt: null, error: null } },
    });
    useCommandStore.getState().reconcile([row('co3', { 1: 'off', 2: 'off' })], 1500);
    expect(useCommandStore.getState().pending['co3:1'].phase).toBe('sending');
  });

  it('holds within COMMAND_CONFIRM_MS of the ack even if the feed still disagrees', () => {
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'confirming', issuedAt: 1000, ackedAt: 1100, error: null } },
    });
    useCommandStore.getState().reconcile([row('co3', { 1: 'off', 2: 'off' })], 1100 + 6000 - 1);
    expect(useCommandStore.getState().pending['co3:1'].phase).toBe('confirming');
  });

  it('marks failed once past COMMAND_CONFIRM_MS with the feed still disagreeing', () => {
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'confirming', issuedAt: 1000, ackedAt: 1100, error: null } },
    });
    useCommandStore.getState().reconcile([row('co3', { 1: 'off', 2: 'off' })], 1100 + 6000 + 1);
    expect(useCommandStore.getState().pending['co3:1'].phase).toBe('failed');
  });

  it('sweeps a failed entry after 15s so a forgotten error pill does not sit forever', () => {
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'failed', issuedAt: 1000, ackedAt: 1100, error: 'boom' } },
    });
    useCommandStore.getState().reconcile([row('co3', { 1: 'off', 2: 'off' })], 1000 + 15_000 + 1);
    expect(useCommandStore.getState().pending['co3:1']).toBeUndefined();
  });

  it('does not resolve as confirmed success when the matching reading is stale (device offline) — a frozen coincidental match is not real confirmation', () => {
    // Caught live alongside the Node-RED health-signal fix: a command sent to a device
    // that's already offline could resolve as "confirmed" purely because the bridge kept
    // echoing a frozen last-known state that happened to already match what was
    // commanded — the device never actually received anything.
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'confirming', issuedAt: 1000, ackedAt: 1100, error: null } },
    });
    const staleMatchingReading: Reading = { device_id: 'co3', ts: new Date().toISOString(), online: false, state: 'on', socket_states: { 1: 'on', 2: 'off' } };
    useCommandStore.getState().reconcile([staleMatchingReading], 2000);
    // Falls through to the existing ackedAt/COMMAND_CONFIRM_MS logic instead of the
    // success shortcut — well within the confirm window here, so it just keeps waiting.
    expect(useCommandStore.getState().pending['co3:1'].phase).toBe('confirming');
  });

  it('leaves a pending entry alone when its device is absent from this frame', () => {
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'confirming', issuedAt: 1000, ackedAt: 1100, error: null } },
    });
    useCommandStore.getState().reconcile([row('l1', { 1: 'on', 2: 'off' })], 999_999);
    expect(useCommandStore.getState().pending['co3:1'].phase).toBe('confirming');
  });
});

describe('useCommandStore.dismiss', () => {
  it('removes the named pending entry', () => {
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'failed', issuedAt: 0, ackedAt: null, error: 'boom' } },
    });
    useCommandStore.getState().dismiss('co3:1');
    expect(useCommandStore.getState().pending['co3:1']).toBeUndefined();
  });
});

/**
 * Cloud-recovered commands are remembered, because they are the earliest warning available.
 *
 * A command that only landed through the vendor cloud SUCCEEDED — the relay moved and the
 * operator sees a normal confirmation — while meaning the device has stopped answering on the
 * LAN. On 2026-08-25 that fallback was found never to have worked at all, and the local path
 * had been reporting false success on top of it; now that both are fixed, a cloud recovery is
 * a real signal and the only place it appeared was a database column nobody has open.
 *
 * Kept here rather than in the session command log because the log lives under
 * `components/control` and a store must not import upwards from it — and because the alerts
 * bell, which already reads stores and owns acknowledgement, is where a fault belongs.
 */
describe('commandStore cloud recoveries', () => {
  const ack = (via: CommandAck['via']): CommandAck => ({
    command_id: 'c1', device_id: 'co3', socket: 1, action: 'on', target: 'CO3_1',
    accepted_at: new Date().toISOString(), confirmed: false, confirmation: 'none', note: '', via,
  });

  it('records a device whose command only landed through the cloud', async () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack('cloud'));
    await useCommandStore.getState().send('co3', 1, 'on');
    expect(useCommandStore.getState().cloudRecoveries.co3).toBeGreaterThan(0);
  });

  it('records nothing when the local path worked — the normal case must stay quiet', async () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack('local'));
    await useCommandStore.getState().send('co3', 1, 'on');
    expect(useCommandStore.getState().cloudRecoveries.co3).toBeUndefined();
  });

  it('records nothing for a dry run, where no path was attempted', async () => {
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(ack(null));
    await useCommandStore.getState().send('co3', 1, 'on');
    expect(useCommandStore.getState().cloudRecoveries.co3).toBeUndefined();
  });

  it('tolerates an older bridge whose ack has no via field at all', async () => {
    const older = { ...ack('local') } as CommandAck;
    delete (older as { via?: unknown }).via;
    vi.mocked(bridgeClient.sendCommand).mockResolvedValue(older);
    await useCommandStore.getState().send('co3', 1, 'on');
    expect(useCommandStore.getState().cloudRecoveries.co3).toBeUndefined();
  });
});
