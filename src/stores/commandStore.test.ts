import { describe, it, expect, vi, afterEach } from 'vitest';
import { useCommandStore, targetKey, resetCommandQueueForTests, MAX_COMMANDS_IN_FLIGHT } from './commandStore';
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
  resetCommandQueueForTests();
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
    // Let the first command claim its slot and reach the wire. Since FI-024 a command superseded
    // while still QUEUED is dropped instead of sent — a different and desirable outcome, covered
    // separately below. This test is about the other case: an ack arriving late from a command
    // that really was dispatched.
    await Promise.resolve();
    await Promise.resolve();
    const second = useCommandStore.getState().send('co3', 1, 'off'); // supersedes before the first resolves
    await second;
    expect(useCommandStore.getState().pending['co3:1'].desired).toBe('off');

    resolveFirst({ command_id: 'first', device_id: 'co3', socket: 1, action: 'on', target: 'CO3_1', accepted_at: '', confirmed: false, confirmation: 'none', note: '' });
    await first;
    // The stale first ack must not clobber the second command's pending entry.
    expect(useCommandStore.getState().pending['co3:1'].desired).toBe('off');
  });
});

/**
 * FI-024 — bounded concurrency for the master actions.
 *
 * `OutletPlanCard`'s all-on/all-off fires fourteen commands with no await and no cap, and the
 * lighting matrix seven. What that costs is NOT device socket contention, which was the original
 * suspicion and is wrong: `tuyapi` already serialises per device — `index.js:410`, *"Queue this
 * request and limit concurrent set requests to one"*. What it costs is on the proxy side. Each
 * command independently writes an audit row before anything is dispatched (record-then-act) with
 * a 5 s timeout, and the browser gives up on its own request after `COMMAND_TIMEOUT_MS` (5 s).
 * Fourteen at once against a Pi makes a client-side timeout likely, and a timed-out command is
 * reported to the operator as failed while the relay may well have moved — the exact
 * false-report this project has already been burned by twice.
 */
describe('useCommandStore.send — bounded concurrency', () => {
  const ack = (command_id: string): CommandAck => ({
    command_id, device_id: 'co3', socket: 1, action: 'on', target: 'CO3_1',
    accepted_at: '', confirmed: false, confirmation: 'none', note: '',
  });


  it('does not put every master-action command in flight at once', async () => {
    let live = 0;
    let peak = 0;
    let calls = 0;
    vi.mocked(bridgeClient.sendCommand).mockImplementation(async () => {
      calls += 1;
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live -= 1;
      return ack('x');
    });

    const sends = [];
    for (let i = 1; i <= 7; i++) {
      sends.push(useCommandStore.getState().send(`co${i}`, 1, 'off'));
      sends.push(useCommandStore.getState().send(`co${i}`, 2, 'off'));
    }
    await Promise.all(sends);

    expect(peak).toBeLessThanOrEqual(MAX_COMMANDS_IN_FLIGHT);
    // Every queued command must still run. A cap that quietly drops commands would be worse
    // than the burst it replaced.
    expect(calls).toBe(14);
    expect(Object.keys(useCommandStore.getState().pending)).toHaveLength(14);
  });

  it('shows every command as pending immediately, however long it waits to dispatch', async () => {
    // The queue may not cost the operator feedback: all fourteen sockets must go grey at once,
    // or the button looks like it half worked.
    vi.mocked(bridgeClient.sendCommand).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return ack('x');
    });

    const sends = [];
    for (let i = 1; i <= 7; i++) sends.push(useCommandStore.getState().send(`co${i}`, 1, 'off'));
    expect(Object.keys(useCommandStore.getState().pending)).toHaveLength(7);
    for (let i = 1; i <= 7; i++) expect(useCommandStore.getState().pending[`co${i}:1`].phase).toBe('sending');

    await Promise.all(sends);
  });

  it('stamps issuedAt when the request starts, not when it was queued', async () => {
    // `reconcile`'s 30 s leak guard measures from `issuedAt` to decide a command never reached
    // the bridge, and `reportedSince` compares a reading's timestamp against it. Stamping at
    // QUEUE time would let the queue manufacture the very false failure this cap exists to
    // prevent. Both directions are pinned: the ones that went first must predate the advance.
    let openGate!: () => void;
    const gate = new Promise<void>((r) => { openGate = r; });
    let started = 0;
    vi.mocked(bridgeClient.sendCommand).mockImplementation(async () => {
      started += 1;
      if (started <= MAX_COMMANDS_IN_FLIGHT) await gate; // the first N hold every slot
      return ack('x');
    });

    const sends = [];
    for (let i = 1; i <= 7; i++) sends.push(useCommandStore.getState().send(`co${i}`, 1, 'off'));
    await Promise.resolve();
    await Promise.resolve();

    const later = Date.now() + 40_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    openGate();
    await Promise.all(sends);

    expect(useCommandStore.getState().pending['co1:1'].issuedAt).toBeLessThan(later);
    expect(useCommandStore.getState().pending['co7:1'].issuedAt).toBe(later);
  });

  it('a command superseded while still queued is never sent at all', async () => {
    // All-off then all-on must not put the off commands on the wire behind the on ones. Only the
    // handful already dispatched can escape; the queued ones must be dropped, not delivered.
    vi.mocked(bridgeClient.sendCommand).mockImplementation(async (cmd) => {
      seen.push(String(cmd.action));
      await new Promise((r) => setTimeout(r, 1));
      return ack('x');
    });
    const seen: string[] = [];

    const sends = [];
    for (let i = 1; i <= 7; i++) sends.push(useCommandStore.getState().send(`co${i}`, 1, 'off'));
    for (let i = 1; i <= 7; i++) sends.push(useCommandStore.getState().send(`co${i}`, 1, 'on'));
    await Promise.all(sends);

    const offs = seen.filter((a) => a === 'off').length;
    expect(offs).toBeLessThanOrEqual(MAX_COMMANDS_IN_FLIGHT);
    expect(seen.filter((a) => a === 'on')).toHaveLength(7);
    for (let i = 1; i <= 7; i++) expect(useCommandStore.getState().pending[`co${i}:1`].desired).toBe('on');
  });
});
