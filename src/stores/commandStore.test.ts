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

  /**
   * The message must name the thing that actually failed.
   *
   * Every 502 used to read "The bridge did not accept the command (502)", so a device the
   * bridge could not reach was reported as the bridge itself failing — the misreading behind a
   * "bridge not reachable" fault report on 2026-08-31, raised while the bridge was serving
   * readings the whole time. A sentence naming the wrong subsystem is worse than none, because
   * it gets acted on.
   */
  it('names the offline device rather than blaming the bridge', async () => {
    vi.mocked(bridgeClient.sendCommand).mockRejectedValue(new BridgeFetchError('HTTP 502: device_offline', 502, 'device_offline'));
    await useCommandStore.getState().send('co5', 1, 'on');
    const p = useCommandStore.getState().pending['co5:1'];
    expect(p.error).toMatch(/this device is offline/i);
    expect(p.error).not.toMatch(/the bridge did not accept/i);
  });

  it('says the bridge is unreachable only when the bridge really is', async () => {
    vi.mocked(bridgeClient.sendCommand).mockRejectedValue(new BridgeFetchError('HTTP 502: bridge_unreachable', 502, 'bridge_unreachable'));
    await useCommandStore.getState().send('l1', undefined, 'on');
    expect(useCommandStore.getState().pending['l1'].error).toMatch(/bridge could not be reached/i);
  });

  it('says nothing was sent when the audit trail could not be written', async () => {
    // The record-then-act refusal. "Failed" alone would leave an operator wondering whether a
    // relay moved; this is the one failure where it definitely did not.
    vi.mocked(bridgeClient.sendCommand).mockRejectedValue(new BridgeFetchError('HTTP 502: audit_log_unreachable', 502, 'audit_log_unreachable'));
    await useCommandStore.getState().send('l1', undefined, 'on');
    expect(useCommandStore.getState().pending['l1'].error).toMatch(/nothing was sent/i);
  });

  it('tells a break-glass user why their command was refused, instead of implying a fault', async () => {
    vi.mocked(bridgeClient.sendCommand).mockRejectedValue(new BridgeFetchError('HTTP 403: break_glass_cannot_command', 403, 'break_glass_cannot_command'));
    await useCommandStore.getState().send('l1', undefined, 'on');
    expect(useCommandStore.getState().pending['l1'].error).toMatch(/view-only/i);
  });

  it('claims nothing about which subsystem failed when the bridge sent no code', async () => {
    // An older proxy, or a code this build has not heard of. Naming the bridge here would be a
    // guess, and guessing is what produced the fortnight-long misdiagnosis.
    vi.mocked(bridgeClient.sendCommand).mockRejectedValue(new BridgeFetchError('HTTP 502', 502));
    await useCommandStore.getState().send('l1', undefined, 'on');
    const message = useCommandStore.getState().pending['l1'].error ?? '';
    expect(message).toMatch(/not accepted/i);
    expect(message).not.toMatch(/bridge|device/i);
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

  /**
   * The reported fault, as a test: switching an outlet worked, and the app said it had not.
   *
   * The bridge polls an outlet once a minute, so between polls its `ts` is routinely ~55s old
   * while the Outlet Logic Hub has already echoed the commanded socket state within one WS push.
   * The success path below requires the reading not be stale — so under the old global 30s
   * budget, roughly half of all successful outlet commands missed it, waited out
   * COMMAND_CONFIRM_MS, and were reported as "the device did not report the new state" on a
   * relay that had physically moved.
   *
   * The staleness conjunct itself is right and stays: it is what stops a frozen echo from an
   * offline device confirming a command that never landed (the test above). What was wrong was
   * the budget it consulted.
   */
  it('confirms an outlet command when the feed echoes it, even though the meter timestamp is 55s old between polls', () => {
    const issuedAt = 1_000_000;
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'confirming', issuedAt, ackedAt: issuedAt + 100, error: null } },
    });
    const now = issuedAt + 3000;
    const betweenPolls: Reading = {
      device_id: 'co3',
      ts: new Date(now - 55_000).toISOString(),
      online: true,
      state: 'on',
      socket_states: { 1: 'on', 2: 'off' },
      stale_after_ms: 150_000,
    };
    useCommandStore.getState().reconcile([betweenPolls], now);
    expect(useCommandStore.getState().pending['co3:1']).toBeUndefined();
  });

  it('distinguishes "the device disagreed" from "the device has not spoken since" instead of asserting the first', () => {
    // Both used to render as "The device did not report the new state." — a claim that the
    // device answered and contradicted the command. When the reading predates the command
    // that claim is not available: nothing has been heard either way, and the relay may well
    // have moved. Saying so is the difference between a fault report and a shrug.
    const issuedAt = 1_000_000;
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'confirming', issuedAt, ackedAt: issuedAt + 100, error: null } },
    });
    const now = issuedAt + 100 + 6001; // the confirm window runs from ackedAt, not issuedAt
    const olderThanTheCommand: Reading = {
      device_id: 'co3',
      ts: new Date(issuedAt - 1000).toISOString(),
      online: true,
      state: 'off',
      socket_states: { 1: 'off', 2: 'off' },
      stale_after_ms: 150_000,
    };
    useCommandStore.getState().reconcile([olderThanTheCommand], now);
    const failed = useCommandStore.getState().pending['co3:1'];
    expect(failed.phase).toBe('failed');
    expect(failed.error).toMatch(/has not reported since/i);
  });

  it('still says the device disagreed when the reading genuinely postdates the command', () => {
    const issuedAt = 1_000_000;
    useCommandStore.setState({
      pending: { 'co3:1': { command_id: 'x', device_id: 'co3', socket: 1, desired: 'on', observedBefore: 'off', phase: 'confirming', issuedAt, ackedAt: issuedAt + 100, error: null } },
    });
    const now = issuedAt + 100 + 6001; // the confirm window runs from ackedAt, not issuedAt
    const answered: Reading = {
      device_id: 'co3',
      ts: new Date(issuedAt + 2000).toISOString(),
      online: true,
      state: 'off',
      socket_states: { 1: 'off', 2: 'off' },
      stale_after_ms: 150_000,
    };
    useCommandStore.getState().reconcile([answered], now);
    expect(useCommandStore.getState().pending['co3:1'].error).toMatch(/did not report the new state/i);
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
