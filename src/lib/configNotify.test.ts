import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * RM-159 — a setting saved to Supabase tells the edge, so the scheduler reads it now. The scheduler no
 * longer reads its configuration every minute (1,440 requests a day in the project's log); without
 * this notice a saved schedule would wait for its fifteen-minute safety net. A save that FAILED must
 * not notify: nothing changed.
 */

const db = vi.hoisted(() => ({ result: { data: [{ id: 'x' }] as unknown[] | null, error: null as { message: string } | null } }));

vi.mock('@/config/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'delete', 'eq', 'update', 'upsert', 'insert']) chain[m] = () => chain;
  chain.select = () => Promise.resolve(db.result);
  return { supabase: { ...chain, auth: { getSession: async () => ({ data: { session: null } }) } } };
});
vi.mock('./bridgeClient', () => ({ notifyConfigChanged: vi.fn(), fetchJson: vi.fn() }));

import { notifyConfigChanged } from './bridgeClient';
import { deleteSchedule } from './supabaseSchedules';
import { deleteAcuRule } from './supabaseAcuRules';
import { writeSocketConfig } from './supabaseSocketConfig';

beforeEach(() => {
  vi.mocked(notifyConfigChanged).mockReset();
  db.result = { data: [{ id: 'x' }], error: null };
});

describe('a saved setting tells the edge', () => {
  it('deleting a schedule notifies once', async () => {
    await deleteSchedule('s1');
    expect(notifyConfigChanged).toHaveBeenCalledTimes(1);
  });

  it('deleting an aircon rule notifies once', async () => {
    await deleteAcuRule('r1');
    expect(notifyConfigChanged).toHaveBeenCalledTimes(1);
  });

  it('a saved socket tier notifies once', async () => {
    await writeSocketConfig({ deviceId: 'co1', socket: 1, shedGroup: 'group_1' } as never, 'user-1');
    expect(notifyConfigChanged).toHaveBeenCalledTimes(1);
  });

  it('a save the database refused does not notify', async () => {
    db.result = { data: null, error: { message: 'denied' } };
    await expect(deleteSchedule('s1')).rejects.toThrow();
    db.result = { data: [], error: null }; // RLS matching nothing: a 200 with no rows
    await expect(deleteAcuRule('r1')).rejects.toThrow();
    expect(notifyConfigChanged).not.toHaveBeenCalled();
  });
});
