import { describe, it, expect, vi, afterEach } from 'vitest';
import { useContextStore, pendingWrites } from './contextStore';
import * as bridgeClient from '@/lib/bridgeClient';

vi.mock('@/lib/bridgeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/bridgeClient')>();
  return { ...actual, saveContext: vi.fn() };
});

afterEach(() => {
  vi.restoreAllMocks();
  useContextStore.setState({ saved: {}, draft: {}, saveStatus: 'idle', saveError: null, lastSave: null });
});

describe('useContextStore.save — write confirmation', () => {
  it('records what was written so the UI can confirm it, rather than only emptying the pending list', async () => {
    vi.mocked(bridgeClient.saveContext).mockResolvedValue(undefined as never);
    useContextStore.setState({
      saved: { 'global.dsm.max_total_kw': '5' },
      draft: { 'global.dsm.max_total_kw': '7', 'global.schedule.l1.armed': 'true' },
    });

    const before = Date.now();
    await useContextStore.getState().save();
    const { lastSave, draft, saved, saveStatus } = useContextStore.getState();

    expect(lastSave).not.toBeNull();
    expect(lastSave!.count).toBe(2);
    expect(lastSave!.at).toBeGreaterThanOrEqual(before);
    expect(saveStatus).toBe('idle');
    // The staged edits are now the saved truth, and nothing is left pending.
    expect(saved['global.dsm.max_total_kw']).toBe('7');
    expect(pendingWrites(draft, saved)).toEqual({});
  });

  it('leaves lastSave untouched when the write fails, so a stale success is never shown', async () => {
    vi.mocked(bridgeClient.saveContext).mockRejectedValue(new Error('bridge unreachable'));
    useContextStore.setState({ saved: {}, draft: { 'global.dsm.max_phase_a': '30' } });

    await useContextStore.getState().save();
    const { lastSave, saveStatus, saveError, draft, saved } = useContextStore.getState();

    expect(lastSave).toBeNull();
    expect(saveStatus).toBe('error');
    expect(saveError).toBe('bridge unreachable');
    // The edit stays pending so the user can retry it.
    expect(pendingWrites(draft, saved)).toEqual({ 'global.dsm.max_phase_a': '30' });
  });
});
